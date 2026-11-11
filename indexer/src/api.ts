import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { InArgs, Row } from '@libsql/client';
import { formatEther, parseAbi } from 'viem';
import { CHAIN_ID, CORS_ORIGIN, CURVE, DEPLOYMENT, LAUNCHPADS, LIMIT_FEES, META_DIR, SYNC_TAG } from './config.js';
import { IMAGE_TYPES, readMeta, saveMeta } from './meta.js';
import { all, one } from './db.js';
import { bus, CANDLE_INTERVALS, client, sync } from './chain.js';
import { zroPrice } from './price.js';
import { traderRoutes } from './traderRoutes.js';
import { profileRoutes } from './profiles.js';
import { pointsRoutes } from './points.js';

const num = (v: unknown, fallback: number, max = 500) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback;
};
const isAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
/** A comma list of addresses, checked and lowercased, so it can go straight into an IN clause. */
const addressList = (v: string | undefined) => (v ?? '').split(',').map((a) => a.trim().toLowerCase()).filter(isAddress).slice(0, 200);
const inClause = (list: string[]) => list.map((a) => `'${a}'`).join(',');
const now = () => Math.floor(Date.now() / 1000);

/** A launchpad's tokens can be traded from here while it's still theirs to trade, if its file says how. */
const PADS_THAT_TRADE = LAUNCHPADS.filter((p) => p.buy && p.sell && /^[a-z0-9-]+$/.test(p.id)).map((p) => `'${p.id}'`).join(',') || `''`;
const TRADABLE = `(t.source = 'terminal' OR t.has_pool = 1 OR (t.graduated = 0 AND t.launchpad IN (${PADS_THAT_TRADE})))`;
const padTarget = new Map(LAUNCHPADS.map((p) => [p.id, p.curve?.target ?? 0]));
/** The Stats page is about this terminal's own contracts, and these are other people's. */
const OURS = `venue NOT LIKE 'pad:%'`;

const TOKEN_COLUMNS = `
  t.*,
  ${TRADABLE} AS tradable,
  t.price * t.total_supply AS market_cap,
  (SELECT count(*) FROM balances b WHERE b.token = t.address) AS holders,
  coalesce((SELECT sum(zro) FROM trades x WHERE x.token = t.address AND x.ts > :since), 0) AS volume_24h,
  (SELECT count(*) FROM trades x WHERE x.token = t.address AND x.ts > :since) AS trades_24h,
  (SELECT price FROM trades x WHERE x.token = t.address AND x.ts <= :since ORDER BY ts DESC, log_index DESC LIMIT 1) AS price_before,
  (SELECT price FROM trades x WHERE x.token = t.address AND x.ts > :since ORDER BY ts ASC, log_index ASC LIMIT 1) AS price_first
`;

function shapeToken(r: Row) {
  const base = Number(r.price_before ?? r.price_first ?? 0);
  const price = Number(r.price);
  const { price_before: _a, price_first: _b, ...rest } = r as unknown as Record<string, unknown>;
  return {
    ...rest,
    graduated: Boolean(r.graduated),
    has_pool: Boolean(r.has_pool),
    tradable: Boolean(r.tradable),
    links: r.links ? (JSON.parse(String(r.links)) as Record<string, string>) : null,
    // Whether its holders earn anything, which is what the rewards on the trading screen go by. The shares themselves are holders_bps and burn_bps.
    fee_route: Number(r.fee_route) === 1 ? 'holders' : 'creator',
    holders_bps: Number(r.holders_bps ?? 0),
    burn_bps: Number(r.burn_bps ?? 0),
    anti_snipe: Boolean(r.anti_snipe),
    progress: r.launchpad ? (padTarget.get(String(r.launchpad)) ? Math.min(Number(r.raised) / padTarget.get(String(r.launchpad))!, 1) : 0) : Math.min(Number(r.raised) / CURVE.raiseTarget, 1),
    change_24h: base > 0 ? price / base - 1 : 0,
  };
}

const wei = (v: unknown) => Number(formatEther(BigInt(String(v ?? '0'))));

/** An order's figures in plain numbers: the limit price, and its size and what's left of it as ZRO at that price. */
function orderShape(r: Row) {
  const amount = wei(r.amount);
  const minOut = wei(r.min_out);
  const filled = wei(r.filled);
  const isBuy = Boolean(r.is_buy);
  // The level the market has to reach. The minimum is what that price pays after fees, so fees come back out here.
  const keep = 1 - Number(r.fee_bps ?? 100) / 10_000;
  const kind = Number(r.kind ?? 0);
  const trigger = wei(r.trigger_wei);
  // A stop's level is where it fires, not its floor. A trailing stop's is its high less the drop. Event orders have no level.
  const price =
    kind === 1 && amount > 0
      ? trigger / amount
      : kind === 2 && amount > 0
        ? (trigger * (1 - Number(r.trail_bps ?? 0) / 10_000)) / amount
        : kind === 3 || kind === 4
          ? 0
          : isBuy
            ? minOut > 0
              ? (Math.max(amount - LIMIT_FEES.run, 0) * keep) / minOut
              : 0
            : amount > 0
              ? (minOut + LIMIT_FEES.run) / (amount * keep)
              : 0;
  const sizeZro = isBuy ? amount : amount * price;
  const leftZro = isBuy ? Math.max(0, amount - filled) : Math.max(0, amount - filled) * price;
  return {
    id: Number(r.id),
    is_buy: isBuy,
    expiry: Number(r.expiry ?? 0),
    price,
    size_zro: sizeZro,
    left_zro: leftZro,
    amount_num: amount,
    filled_num: filled,
    filled_out_num: wei(r.filled_out),
    filled_share: amount > 0 ? Math.min(filled / amount, 1) : 0,
    kind: ['limit', 'stop', 'trailing', 'on_graduation', 'on_dev_sell', 'dca'][kind] ?? 'limit',
    group: r.grp === null || r.grp === undefined ? null : Number(r.grp),
    trail_bps: Number(r.trail_bps ?? 0),
    interval_s: Number(r.interval_s ?? 0),
    slices: Number(r.slices ?? 0),
  };
}

function orderStatus(r: Row, t: number): 'open' | 'partial' | 'filled' | 'cancelled' | 'expired' | 'unfilled_expired' {
  const filled = BigInt(String(r.filled ?? '0'));
  const amount = BigInt(String(r.amount ?? '0'));
  if (filled >= amount && amount > 0n) return 'filled';
  if (r.open) {
    if (Number(r.expiry) > 0 && Number(r.expiry) < t) return 'unfilled_expired'; // past its time and still holding funds
    return filled > 0n ? 'partial' : 'open';
  }
  return r.closed_expired ? 'expired' : 'cancelled';
}

const CODE = new Map<string, boolean>();
/** Contract or wallet. A contract stays one, so each address is asked about once. EIP-7702 code (0xef01) is a wallet. */
async function isContract(address: string): Promise<boolean> {
  const known = CODE.get(address);
  if (known !== undefined) return known;
  try {
    const code = await client.getCode({ address: address as `0x${string}` });
    const answer = Boolean(code && code.length > 2 && !code.startsWith('0xef01'));
    CODE.set(address, answer);
    return answer;
  } catch {
    return false;
  }
}

const VAULT_ABI = parseAbi(['function protocolFees() view returns (uint256)']);

async function treasuryNow() {
  const [balance, pending] = await Promise.all([
    client.getBalance({ address: DEPLOYMENT!.vault }),
    client.readContract({ address: DEPLOYMENT!.launchpad, abi: VAULT_ABI, functionName: 'protocolFees' }),
  ]);
  return { balance: Number(formatEther(balance)), pending: Number(formatEther(pending)) };
}

/** A wallet's record over the trades we've seen, marked to today's prices. */
async function walletStats(addresses: string[]) {
  if (!addresses.length) return [];
  const list = inClause(addresses);
  const [trades, balances] = await Promise.all([
    all(
      `SELECT x.trader, x.token,
              sum(CASE WHEN x.is_buy = 1 THEN x.zro ELSE 0 END) AS spent,
              sum(CASE WHEN x.is_buy = 0 THEN x.zro ELSE 0 END) AS received,
              sum(x.is_buy = 1) AS buys, sum(x.is_buy = 0) AS sells, min(x.ts) AS first_ts, max(x.ts) AS last_ts
       FROM trades x WHERE x.trader IN (${list}) GROUP BY x.trader, x.token`,
    ),
    all(`SELECT b.holder, b.token, b.amount * t.price AS value FROM balances b JOIN tokens t ON t.address = b.token WHERE b.holder IN (${list})`),
  ]);
  const held = new Map(balances.map((b) => [`${b.holder}|${b.token}`, Number(b.value)]));
  const out = new Map(addresses.map((address) => [address, { address, worth: 0, pnl: 0, realized: 0, open: 0, trades: 0, buys: 0, sells: 0, volume: 0, wins: 0, losses: 0, first_ts: 0, last_ts: 0 }]));
  for (const b of balances) {
    const w = out.get(String(b.holder));
    if (!w) continue;
    w.worth += Number(b.value);
    if (Number(b.value) > 0) w.open += 1;
  }
  for (const r of trades) {
    const w = out.get(String(r.trader));
    if (!w) continue;
    const spent = Number(r.spent);
    const received = Number(r.received);
    const value = held.get(`${r.trader}|${r.token}`) ?? 0;
    const result = received + value - spent;
    w.pnl += result;
    if (value === 0) w.realized += result;
    if (result > 0) w.wins += 1;
    else if (result < 0) w.losses += 1;
    w.buys += Number(r.buys);
    w.sells += Number(r.sells);
    w.trades += Number(r.buys) + Number(r.sells);
    w.volume += spent + received;
    w.first_ts = w.first_ts ? Math.min(w.first_ts, Number(r.first_ts)) : Number(r.first_ts);
    w.last_ts = Math.max(w.last_ts, Number(r.last_ts));
  }
  return [...out.values()];
}

export async function build(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: '127.0.0.1' }); // nginx is the only thing in front, and it says who's asking
  await app.register(cors, { origin: CORS_ORIGIN.split(',') });

  app.get('/health', async () => ({
    status: 'ok',
    chainId: CHAIN_ID,
    tag: SYNC_TAG,
    head: Number(sync.head),
    synced: Number(sync.synced),
    deployment: DEPLOYMENT,
  }));

  /** A token's picture, description and links, saved before its launch. The answer is the uri to launch it with. */
  app.post('/api/v1/meta', { bodyLimit: 3.5 * 1024 * 1024 }, async (req, reply) => {
    if (req.body === null || typeof req.body !== 'object') return reply.code(400).send({ message: 'Expected JSON' });
    const saved = await saveMeta(req.body as Record<string, unknown>, req.ip);
    if ('error' in saved) return reply.code(400).send({ message: saved.error });
    return saved;
  });

  app.get('/api/v1/meta/:hash', async (req, reply) => {
    const meta = readMeta((req.params as { hash: string }).hash);
    if (!meta) return reply.code(404).send({ message: 'Not found' });
    return reply.header('Cache-Control', 'public, max-age=31536000, immutable').send(meta);
  });

  // Only names this API made itself: the hash of the file and a type it checked when saving, so nothing else on disk can be asked for.
  app.get('/api/v1/images/:file', async (req, reply) => {
    const found = /^([0-9a-f]{64})\.(png|jpg|webp|gif)$/.exec((req.params as { file: string }).file);
    if (!found) return reply.code(404).send({ message: 'Not found' });
    try {
      const bytes = readFileSync(resolve(META_DIR, found[0]));
      return reply.header('Content-Type', IMAGE_TYPES[found[2]!]!).header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'public, max-age=31536000, immutable').send(bytes);
    } catch {
      return reply.code(404).send({ message: 'Not found' });
    }
  });

  /** Every launchpad this terminal can work with: ours first, then one per file in launchpads/. The site reads this when it runs, so adding one needs no new build. */
  app.get('/api/v1/launchpads', async () => ({
    launchpads: [
      ...(DEPLOYMENT ? [{ id: 'terminal', name: 'Submarine', builtin: true, contract: DEPLOYMENT.launchpad, curve: { target: CURVE.raiseTarget }, description: `Submarine's own. ${CURVE.raiseTarget} ZRO raised moves it to a pool with locked liquidity.` }] : []),
      ...LAUNCHPADS.map(({ startBlock: _a, notHolders: _b, ...pad }) => pad),
    ],
  }));

  /** How each launchpad is doing, and the contracts minting tokens that nobody has connected yet: that list is what to add next. */
  app.get('/api/v1/launchpads/stats', async () => {
    const since = now() - 86400;
    const [tokens, volume] = await Promise.all([
      all(`SELECT CASE WHEN t.source = 'terminal' THEN 'terminal' ELSE t.launchpad END AS id, CASE WHEN t.source = 'terminal' OR t.launchpad IS NOT NULL THEN NULL ELSE t.factory END AS factory,
                  count(*) AS tokens, coalesce(sum(t.graduated), 0) AS graduated, max(t.created_at) AS latest
           FROM tokens t GROUP BY 1, 2 ORDER BY tokens DESC`),
      all(`SELECT CASE WHEN t.source = 'terminal' THEN 'terminal' ELSE t.launchpad END AS id, sum(x.zro) AS volume, count(*) AS trades
           FROM trades x JOIN tokens t ON t.address = x.token WHERE x.ts > ? GROUP BY 1`, [since]),
    ]);
    const traded = new Map(volume.map((r) => [String(r.id), r]));
    const names = new Map(LAUNCHPADS.map((p) => [p.id, p.name]));
    names.set('terminal', 'Submarine');
    const known = tokens.filter((r) => r.id).map((r) => ({ id: String(r.id), name: names.get(String(r.id)) ?? String(r.id), tokens: Number(r.tokens), graduated: Number(r.graduated), latest: Number(r.latest), volume_24h: Number(traded.get(String(r.id))?.volume ?? 0), trades_24h: Number(traded.get(String(r.id))?.trades ?? 0) }));
    for (const pad of LAUNCHPADS) if (!known.some((k) => k.id === pad.id)) known.push({ id: pad.id, name: pad.name, tokens: 0, graduated: 0, latest: 0, volume_24h: 0, trades_24h: 0 });
    // One token from a contract is usually someone deploying a token. Two is what a launchpad looks like.
    const unknown = tokens.filter((r) => !r.id && r.factory && Number(r.tokens) >= 2).map((r) => ({ factory: String(r.factory), tokens: Number(r.tokens), latest: Number(r.latest) }));
    return { known, unknown };
  });

  app.get('/api/v1/tokens', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const where: string[] = [];
    const args: Record<string, string | number> = { since: now() - 86400, limit: num(q.limit, 50), offset: num(q.offset, 0, 1e9) };
    if (q.stage === 'curve') where.push(`t.source = 'terminal' AND t.graduated = 0`);
    if (q.stage === 'graduating') where.push(`t.source = 'terminal' AND t.graduated = 0 AND t.raised >= ${CURVE.raiseTarget * 0.25}`);
    if (q.stage === 'graduated') where.push(`(t.graduated = 1 OR t.has_pool = 1)`);
    if (q.stage === 'external') where.push(`t.source = 'external'`);
    if (q.launchpad === 'terminal') where.push(`t.source = 'terminal'`);
    else if (q.launchpad) {
      where.push(`t.launchpad = :launchpad`);
      args.launchpad = q.launchpad;
    }
    if (q.addresses !== undefined) where.push(`t.address IN (${inClause(addressList(q.addresses))})`);
    if (q.creator) {
      where.push(`t.creator = :creator`);
      args.creator = q.creator.toLowerCase();
    }
    if (q.q) {
      where.push(`(lower(t.name) LIKE :q OR lower(t.symbol) LIKE :q OR t.address = :exact)`);
      args.q = `%${q.q.toLowerCase().replace(/[%_]/g, '')}%`;
      args.exact = q.q.toLowerCase();
    }
    const order: Record<string, string> = {
      new: 't.created_at DESC, t.block DESC',
      volume: 'volume_24h DESC',
      progress: 't.raised DESC',
      mcap: 'market_cap DESC',
      active: 'coalesce(t.last_trade_at, t.created_at) DESC',
    };
    const rows = await all(
      `SELECT ${TOKEN_COLUMNS} FROM tokens t ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${order[q.sort ?? 'new'] ?? order.new} LIMIT :limit OFFSET :offset`,
      args as InArgs,
    );
    return { tokens: rows.map(shapeToken) };
  });

  // Who has a token's page open right now. Each open page checks in every 20 s with an id of its own and counts for 50 s.
  // Kept in memory only. One address counts at most a few pages, so reloading or a script can't inflate it much.
  const watching = new Map<string, Map<string, number>>();
  const WATCH_FOR = 50_000;
  const PAGES_PER_ADDRESS = 4;
  app.get('/api/v1/tokens/:address/viewers', async (req, reply) => {
    const token = (req.params as { address: string }).address.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(token)) return reply.code(400).send({ message: 'Not a token address' });
    const id = String((req.query as { id?: string }).id ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
    const t = Date.now();
    let pages = watching.get(token);
    if (id) {
      if (!pages) watching.set(token, (pages = new Map()));
      const mine = [...pages.keys()].filter((k) => k.startsWith(`${req.ip}|`));
      if (pages.has(`${req.ip}|${id}`) || mine.length < PAGES_PER_ADDRESS) pages.set(`${req.ip}|${id}`, t);
    }
    if (pages) {
      for (const [k, seen] of pages) if (t - seen > WATCH_FOR) pages.delete(k);
      if (!pages.size) watching.delete(token);
    }
    reply.header('cache-control', 'no-store');
    return { viewers: pages?.size ?? 0 };
  });
  // Pages closed without saying so leave with the sweep above, and tokens nobody opens again with this one.
  setInterval(() => {
    const t = Date.now();
    for (const [token, pages] of watching) {
      for (const [k, seen] of pages) if (t - seen > WATCH_FOR) pages.delete(k);
      if (!pages.size) watching.delete(token);
    }
  }, 60_000).unref();

  app.get('/api/v1/tokens/:address', async (req, reply) => {
    const address = (req.params as { address: string }).address.toLowerCase();
    const row = await one(`SELECT ${TOKEN_COLUMNS} FROM tokens t WHERE t.address = :a`, { a: address, since: now() - 86400 });
    if (!row) return reply.code(404).send({ message: 'Token not found' });
    const price = Number(row.price);
    const changeOver = async (seconds: number) => {
      const since = now() - seconds;
      const base = await one(
        `SELECT coalesce(
           (SELECT price FROM trades WHERE token = :a AND ts <= :since ORDER BY ts DESC, log_index DESC LIMIT 1),
           (SELECT price FROM trades WHERE token = :a AND ts > :since ORDER BY ts ASC, log_index ASC LIMIT 1)
         ) AS base`,
        { a: address, since },
      );
      const b = Number(base?.base ?? 0);
      return b > 0 ? price / b - 1 : 0;
    };
    const [change_5m, change_1h, change_6h, flow, earned] = await Promise.all([
      changeOver(300),
      changeOver(3600),
      changeOver(21600),
      one(
        `SELECT coalesce(sum(is_buy = 1), 0) AS buys_24h, coalesce(sum(is_buy = 0), 0) AS sells_24h,
                coalesce(sum(CASE WHEN is_buy = 1 THEN zro END), 0) AS buy_volume_24h,
                coalesce(sum(CASE WHEN is_buy = 0 THEN zro END), 0) AS sell_volume_24h
         FROM trades WHERE token = ? AND ts > ?`,
        [address, now() - 86400],
      ),
      // What its fee has paid, on the curve and on its pool: its creator, its holders, and the buyback that burns it.
      one(
        `SELECT coalesce(sum(to_creator), 0) AS creator, coalesce(sum(to_holders), 0) AS holders, coalesce(sum(to_burn), 0) AS burn, coalesce(sum(burned), 0) AS burned
         FROM earner_events WHERE token = ?`,
        [address],
      ),
    ]);
    return {
      ...shapeToken(row),
      change_5m,
      change_1h,
      change_6h,
      ...flow,
      earner_fees: Number(earned?.creator ?? 0) + Number(earned?.holders ?? 0) + Number(earned?.burn ?? 0),
      creator_earned: Number(earned?.creator ?? 0),
      holders_earned: Number(earned?.holders ?? 0),
      burned_zro: Number(earned?.burn ?? 0),
      burned_tokens: Number(earned?.burned ?? 0),
    };
  });

  app.get('/api/v1/tokens/:address/trades', async (req) => {
    const address = (req.params as { address: string }).address.toLowerCase();
    const q = req.query as Record<string, string | undefined>;
    if (q.trader && isAddress(q.trader)) {
      return { trades: await all(`SELECT * FROM trades WHERE token = ? AND trader = ? ORDER BY ts DESC, log_index DESC LIMIT ?`, [address, q.trader.toLowerCase(), num(q.limit, 50)]) };
    }
    if (q.traders !== undefined) {
      return { trades: await all(`SELECT * FROM trades WHERE token = ? AND trader IN (${inClause(addressList(q.traders))}) ORDER BY ts DESC, log_index DESC LIMIT ?`, [address, num(q.limit, 200)]) };
    }
    return { trades: await all(`SELECT * FROM trades WHERE token = ? ORDER BY ts DESC, log_index DESC LIMIT ?`, [address, num(q.limit, 50, 1000)]) };
  });

  app.get('/api/v1/tokens/:address/holders', async (req) => {
    const address = (req.params as { address: string }).address.toLowerCase();
    const q = req.query as Record<string, string | undefined>;
    return { holders: await all(`SELECT holder, amount FROM balances WHERE token = ? ORDER BY amount DESC LIMIT ?`, [address, num(q.limit, 20)]) };
  });

  /** Everything a trader checks about a token's creator: every move for the chart, and who else the creator paid in this token. */
  app.get('/api/v1/tokens/:address/dev', async (req, reply) => {
    const a = (req.params as { address: string }).address.toLowerCase();
    const t = await one('SELECT creator, block, total_supply FROM tokens WHERE address = ?', [a]);
    if (!t) return reply.code(404).send({ message: 'Token not found' });
    const creator = t.creator ? String(t.creator) : null;
    if (!creator) return { creator: null, moves: [], holds: 0, share: 0, bought: 0, sold: 0, linked: [], linked_share: 0, linked_sold: 0, launch_block: 0, launched: 0, graduated: 0 };
    const supply = Number(t.total_supply) || 1;
    const [trades, others, holds, recipients, launchBlock, launched] = await Promise.all([
      all(`SELECT ts, is_buy, zro, amount FROM trades WHERE token = ? AND trader = ? ORDER BY ts ASC LIMIT 1000`, [a, creator]),
      all(`SELECT ts, kind, to_addr, amount FROM dev_moves WHERE token = ? ORDER BY ts ASC LIMIT 1000`, [a]),
      one(`SELECT amount FROM balances WHERE token = ? AND holder = ?`, [a, creator]),
      all(
        `SELECT m.to_addr AS address, sum(m.amount) AS got, coalesce((SELECT amount FROM balances b WHERE b.token = m.token AND b.holder = m.to_addr), 0) AS held
         FROM dev_moves m WHERE m.token = ? AND m.kind = 'transfer' GROUP BY m.to_addr ORDER BY held DESC LIMIT 20`,
        [a],
      ),
      one(`SELECT count(DISTINCT trader) AS n FROM trades WHERE token = ? AND block = ? AND trader != ?`, [a, Number(t.block), creator]),
      one(`SELECT count(*) AS n, coalesce(sum(graduated), 0) AS graduated FROM tokens WHERE creator = ?`, [creator]),
    ]);
    const moves = [
      ...trades.map((r) => ({ t: Number(r.ts), kind: r.is_buy ? 'buy' : 'sell', tokens: Number(r.amount), zro: Number(r.zro) })),
      ...others.map((r) => ({ t: Number(r.ts), kind: String(r.kind), tokens: Number(r.amount), to: String(r.to_addr) })),
    ].sort((x, y) => x.t - y.t);
    const bought = trades.filter((r) => r.is_buy).reduce((s, r) => s + Number(r.zro), 0);
    const sold = trades.filter((r) => !r.is_buy).reduce((s, r) => s + Number(r.zro), 0);
    const linked = await Promise.all(
      recipients.map(async (r) => {
        const address = String(r.address);
        return { address, got: Number(r.got), held: Number(r.held), share: Number(r.held) / supply, contract: await isContract(address) };
      }),
    );
    const list = linked.map((l) => l.address);
    const linkedSold = list.length ? await one(`SELECT coalesce(sum(zro), 0) AS zro FROM trades WHERE token = ? AND is_buy = 0 AND trader IN (${inClause(list)})`, [a]) : null;
    return {
      creator,
      moves,
      holds: Number(holds?.amount ?? 0),
      share: Number(holds?.amount ?? 0) / supply,
      bought,
      sold,
      linked,
      // A contract the creator sent coins to (a vesting or a staking one) isn't a second wallet of theirs.
      linked_share: linked.filter((l) => !l.contract).reduce((s, l) => s + l.share, 0),
      linked_sold: Number(linkedSold?.zro ?? 0),
      launch_block: Number(launchBlock?.n ?? 0),
      launched: Number(launched?.n ?? 0),
      graduated: Number(launched?.graduated ?? 0),
    };
  });

  /**
   * Every limit order on a token with what rested at each moment, for the heatmap. A level is the order's own limit, and the
   * amount at a level is what was still unfilled then, in ZRO at that limit.
   */
  app.get('/api/v1/tokens/:address/orderbook', async (req) => {
    const a = (req.params as { address: string }).address.toLowerCase();
    const [rows, fills] = await Promise.all([
      all(`SELECT id, owner, is_buy, amount, min_out, filled, expiry, open, created_at, closed_at, kind, trigger_wei, trail_bps, grp, (SELECT fee_bps FROM tokens WHERE address = orders.token) AS fee_bps FROM orders WHERE token = ? ORDER BY id DESC LIMIT 500`, [a]),
      all(`SELECT f.id, f.ts, f.zro, f.tokens FROM order_fills f JOIN orders o ON o.id = f.id WHERE o.token = ? ORDER BY f.ts ASC`, [a]),
    ]);
    const byOrder = new Map<number, Array<{ ts: number; zro: number; tokens: number }>>();
    for (const f of fills) {
      const id = Number(f.id);
      byOrder.set(id, [...(byOrder.get(id) ?? []), { ts: Number(f.ts), zro: Number(f.zro), tokens: Number(f.tokens) }]);
    }
    const t = now();
    return {
      // Orders waiting on an event have no level to draw.
      orders: rows.filter((r) => Number(r.kind ?? 0) !== 3 && Number(r.kind ?? 0) !== 4).map((r) => {
        const shape = orderShape(r);
        const expired = shape.expiry > 0 && shape.expiry < t;
        // What was left after each fill, as an amount of ZRO at the order's level.
        let left = shape.size_zro;
        const steps = (byOrder.get(shape.id) ?? []).map((f) => {
          left = Math.max(0, left - (shape.is_buy ? f.zro : f.tokens * shape.price));
          return [f.ts, left] as [number, number];
        });
        const live = Boolean(r.open) && !expired;
        return {
          id: shape.id,
          owner: String(r.owner),
          is_buy: shape.is_buy,
          kind: shape.kind,
          group: shape.group,
          price: shape.price,
          size_zro: shape.size_zro,
          left_zro: live ? left : 0,
          start: Number(r.created_at),
          end: live ? null : Number(r.closed_at ?? (expired ? shape.expiry : t)),
          steps,
        };
      }),
    };
  });

  app.get('/api/v1/tokens/:address/candles', async (req) => {
    const address = (req.params as { address: string }).address.toLowerCase();
    const q = req.query as Record<string, string | undefined>;
    const interval = CANDLE_INTERVALS.includes(Number(q.interval)) ? Number(q.interval) : 60;
    // The newest `limit` before `before`, so a long history can be read page by page, back to the first trade.
    const before = Number(q.before) > 0 ? Number(q.before) : Number.MAX_SAFE_INTEGER;
    const rows = await all(
      `SELECT t, o, h, l, c, v FROM (SELECT * FROM candles WHERE token = ? AND interval = ? AND t < ? ORDER BY t DESC LIMIT ?) ORDER BY t ASC`,
      [address, interval, before, num(q.limit, 300, 4000)],
    );
    return { interval, candles: rows };
  });

  app.get('/api/v1/market/trades', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const filter = q.traders !== undefined ? `WHERE x.trader IN (${inClause(addressList(q.traders))})` : '';
    return {
      trades: await all(
        `SELECT x.*, t.symbol, t.name, t.uri, t.source, t.has_pool, ${TRADABLE} AS tradable,
                coalesce((SELECT amount FROM balances b WHERE b.token = x.token AND b.holder = x.trader), 0) AS held
         FROM trades x JOIN tokens t ON t.address = x.token ${filter} ORDER BY x.ts DESC, x.log_index DESC LIMIT ?`,
        [num(q.limit, 30)],
      ),
    };
  });

  app.get('/api/v1/market/stats', async () => {
    const since = now() - 86400;
    const row = await one(
      `SELECT (SELECT count(*) FROM tokens) AS tokens,
              (SELECT count(*) FROM tokens WHERE graduated = 1) AS graduated,
              (SELECT count(*) FROM tokens WHERE source = 'external') AS external,
              (SELECT coalesce(sum(zro), 0) FROM trades WHERE ts > ?) AS volume_24h,
              (SELECT count(*) FROM trades WHERE ts > ?) AS trades_24h,
              (SELECT count(DISTINCT trader) FROM trades WHERE ts > ?) AS traders_24h`,
      [since, since, since],
    );
    return row ?? {};
  });

  app.get('/api/v1/zro-price', async () => zroPrice());

  /**
   * Traders by profit over a window, marked to the current price: cash in minus cash out, plus tokens gained or given up in
   * the window valued at today's price. That counts a position still open, and it doesn't credit selling tokens bought
   * before the window as pure profit.
   */
  app.get('/api/v1/leaderboard', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const seconds: Record<string, number> = { '24h': 86400, '7d': 604800 };
    const since = q.window && seconds[q.window] ? now() - seconds[q.window]! : 0;
    const rows = await all(
      `SELECT x.trader, x.token, t.price,
              sum(CASE WHEN x.is_buy = 1 THEN x.zro ELSE 0 END) AS spent,
              sum(CASE WHEN x.is_buy = 0 THEN x.zro ELSE 0 END) AS received,
              sum(CASE WHEN x.is_buy = 1 THEN x.amount ELSE -x.amount END) AS net,
              count(*) AS trades, max(x.ts) AS last_ts
       FROM trades x JOIN tokens t ON t.address = x.token WHERE x.ts > ? GROUP BY x.trader, x.token`,
      [since],
    );
    const contracts = new Set(DEPLOYMENT ? [DEPLOYMENT.router, DEPLOYMENT.limitOrders, DEPLOYMENT.vault, DEPLOYMENT.launchpad, DEPLOYMENT.pools, DEPLOYMENT.poolVenue, DEPLOYMENT.infinityVault].filter((a): a is `0x${string}` => Boolean(a)).map((a) => a.toLowerCase()) : []);
    const traders = new Map<string, { trader: string; pnl: number; volume: number; trades: number; tokens: number; wins: number; last_ts: number }>();
    for (const r of rows) {
      const trader = String(r.trader);
      if (contracts.has(trader)) continue;
      const t = traders.get(trader) ?? { trader, pnl: 0, volume: 0, trades: 0, tokens: 0, wins: 0, last_ts: 0 };
      const pnl = Number(r.received) - Number(r.spent) + Number(r.net) * Number(r.price);
      t.pnl += pnl;
      t.volume += Number(r.spent) + Number(r.received);
      t.trades += Number(r.trades);
      t.tokens += 1;
      if (pnl > 0) t.wins += 1;
      t.last_ts = Math.max(t.last_ts, Number(r.last_ts));
      traders.set(trader, t);
    }
    return { traders: [...traders.values()].sort((a, b) => b.pnl - a.pnl).slice(0, num(q.limit, 50)) };
  });

  app.get('/api/v1/wallet/:address', async (req, reply) => {
    const address = (req.params as { address: string }).address;
    if (!isAddress(address)) return reply.code(400).send({ message: 'Bad address' });
    const a = address.toLowerCase();
    // Average-cost basis per token: what the holder paid per token on buys, compared to the price now.
    const holdings = await all(
      `SELECT b.token, b.amount, t.name, t.symbol, t.uri, t.price, t.graduated, t.source, ${TRADABLE} AS tradable,
              b.amount * t.price AS value,
              coalesce((SELECT sum(zro) FROM trades x WHERE x.token = b.token AND x.trader = :a AND x.is_buy = 1), 0) AS spent,
              coalesce((SELECT sum(amount) FROM trades x WHERE x.token = b.token AND x.trader = :a AND x.is_buy = 1), 0) AS bought,
              coalesce((SELECT sum(zro) FROM trades x WHERE x.token = b.token AND x.trader = :a AND x.is_buy = 0), 0) AS received
       FROM balances b JOIN tokens t ON t.address = b.token WHERE b.holder = :a ORDER BY value DESC`,
      { a },
    );
    const trades = await all(
      `SELECT x.*, t.symbol, t.uri, t.source, t.has_pool, ${TRADABLE} AS tradable,
              coalesce((SELECT amount FROM balances b WHERE b.token = x.token AND b.holder = x.trader), 0) AS held
       FROM trades x JOIN tokens t ON t.address = x.token WHERE x.trader = ? ORDER BY x.ts DESC, x.log_index DESC LIMIT 50`,
      [a],
    );
    const totals = await one(
      `SELECT coalesce(sum(CASE WHEN is_buy = 1 THEN zro END), 0) AS spent, coalesce(sum(CASE WHEN is_buy = 0 THEN zro END), 0) AS received, count(*) AS trades
       FROM trades WHERE trader = ?`,
      [a],
    );
    const launched = await all(`SELECT address, name, symbol, uri, raised, graduated, created_at FROM tokens WHERE creator = ? AND source = 'terminal' ORDER BY created_at DESC`, [a]);
    const closed = await all(
      `SELECT x.token, t.symbol, t.uri,
              sum(CASE WHEN x.is_buy = 1 THEN x.zro ELSE 0 END) AS spent,
              sum(CASE WHEN x.is_buy = 0 THEN x.zro ELSE 0 END) AS received,
              count(*) AS trades, max(x.ts) AS closed_at
       FROM trades x JOIN tokens t ON t.address = x.token
       WHERE x.trader = :a AND NOT EXISTS (SELECT 1 FROM balances b WHERE b.token = x.token AND b.holder = :a)
       GROUP BY x.token ORDER BY closed_at DESC LIMIT 100`,
      { a },
    );
    const locked = await one(`SELECT count(*) AS n FROM orders WHERE owner = ? AND open = 1`, [a]);
    const stats = (await walletStats([a]))[0]!;
    // Tokens that pay their holders, among those this wallet holds or has traded: it may have rewards left after selling.
    const rewardTokens = await all(`SELECT t.address AS token, t.symbol FROM tokens t WHERE t.fee_route = 1 AND (t.address IN (SELECT token FROM balances WHERE holder = ?) OR t.address IN (SELECT token FROM trades WHERE trader = ?)) LIMIT 100`, [a, a]);
    return { holdings, trades, totals, launched, closed, stats, open_orders: Number(locked?.n ?? 0), reward_tokens: rewardTokens };
  });

  /** A wallet's whole trade history in a compact form, for the calendar and anything else worked out in the browser. */
  app.get('/api/v1/wallet/:address/trades', async (req, reply) => {
    const address = (req.params as { address: string }).address;
    if (!isAddress(address)) return reply.code(400).send({ message: 'Bad address' });
    const q = req.query as Record<string, string | undefined>;
    return { trades: await all(`SELECT ts, token, is_buy, zro, amount FROM trades WHERE trader = ? ORDER BY ts DESC, log_index DESC LIMIT ?`, [address.toLowerCase(), num(q.limit, 5000, 20000)]) };
  });

  /** One query for every followed wallet, so a long list doesn't ask the index once per wallet. */
  app.get('/api/v1/wallets', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return { wallets: await walletStats(addressList(q.addresses)) };
  });

  app.get('/api/v1/orders', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const where: string[] = [];
    const args: string[] = [];
    if (q.owner) (where.push('o.owner = ?'), args.push(q.owner.toLowerCase()));
    if (q.token) (where.push('o.token = ?'), args.push(q.token.toLowerCase()));
    if (q.open === '1') where.push('o.open = 1');
    if (q.open === '0') where.push('o.open = 0');
    const orders = await all(
      `SELECT o.*, t.symbol, t.uri, t.price, t.total_supply, t.fee_bps FROM orders o JOIN tokens t ON t.address = o.token ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.id DESC LIMIT 200`,
      args,
    );
    const t = now();
    return {
      orders: orders.map((r) => {
        const { price: limit_price, ...shape } = orderShape(r);
        return { ...r, ...shape, limit_price, status: orderStatus(r, t) };
      }),
    };
  });

  app.get('/api/v1/orders/:id/fills', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isSafeInteger(id) || id < 0) return reply.code(400).send({ message: 'Not an order id' });
    return { fills: await all(`SELECT tx_hash, ts, zro, tokens, keeper FROM order_fills WHERE id = ? ORDER BY ts DESC LIMIT 200`, [id]) };
  });

  /** The protocol in one answer: lifetime totals, the chosen window against the one before it, a series to chart, and leaders. */
  const STATS_RANGES: Record<string, number> = { '24h': 86400, '7d': 604800, '30d': 2592000 };
  const statsCache = new Map<string, { at: number; answer: Promise<unknown> }>();
  app.get('/api/v1/protocol/stats', (req) => {
    // Slow to work out and it reads the chain too, so everyone asking within a few seconds shares one answer.
    const asked = (req.query as Record<string, string | undefined>).range;
    const range = asked && STATS_RANGES[asked] ? asked : 'all';
    const held = statsCache.get(range);
    if (held && Date.now() - held.at < 10_000) return held.answer;
    const answer = protocolStats(range);
    statsCache.set(range, { at: Date.now(), answer });
    answer.catch(() => statsCache.delete(range));
    return answer;
  });
  const protocolStats = async (range: string) => {
    const q = { range: range === 'all' ? undefined : range };
    const seconds = STATS_RANGES;
    const t = now();
    const first = Number((await one(`SELECT min(ts) AS ts FROM trades WHERE ${OURS}`))?.ts ?? t);
    const window = q.range && seconds[q.range] ? seconds[q.range]! : Math.max(t - first, 3600);
    const since = t - window;
    const bucket = window <= 172800 ? 3600 : window <= 1209600 ? 14400 : 86400;

    const period = async (from: number, to: number) => {
      const [x, f, l, g] = await Promise.all([
        one(`SELECT coalesce(sum(zro), 0) AS volume, count(*) AS trades, count(DISTINCT trader) AS traders FROM trades WHERE ${OURS} AND ts > ? AND ts <= ?`, [from, to]),
        one(`SELECT coalesce(sum(to_treasury), 0) AS treasury, coalesce(sum(to_creator), 0) AS creators FROM fee_events WHERE ts > ? AND ts <= ?`, [from, to]),
        one(`SELECT count(*) AS n FROM tokens WHERE source = 'terminal' AND created_at > ? AND created_at <= ?`, [from, to]),
        one(`SELECT count(*) AS n FROM tokens WHERE graduated_at > ? AND graduated_at <= ?`, [from, to]),
      ]);
      return {
        volume: Number(x?.volume ?? 0),
        trades: Number(x?.trades ?? 0),
        traders: Number(x?.traders ?? 0),
        revenue: Number(f?.treasury ?? 0),
        creators: Number(f?.creators ?? 0),
        launches: Number(l?.n ?? 0),
        graduations: Number(g?.n ?? 0),
      };
    };
    const [total, current, previous] = await Promise.all([period(0, t + 86400), period(since, t + 86400), period(since - window, since)]);

    const [volumeRows, feeRows, launchRows, graduationRows, newRows, venues, topTokens, topCreators, orders, buybacks, discovered] = await Promise.all([
      all(`SELECT ts / ${bucket} * ${bucket} AS t, sum(zro) AS volume, count(*) AS trades, count(DISTINCT trader) AS traders FROM trades WHERE ${OURS} AND ts > ? GROUP BY 1`, [since]),
      all(`SELECT ts / ${bucket} * ${bucket} AS t, sum(to_treasury) AS revenue, sum(to_creator) AS creators FROM fee_events WHERE ts > ? GROUP BY 1`, [since]),
      all(`SELECT created_at / ${bucket} * ${bucket} AS t, count(*) AS n FROM tokens WHERE source = 'terminal' AND created_at > ? GROUP BY 1`, [since]),
      all(`SELECT graduated_at / ${bucket} * ${bucket} AS t, count(*) AS n FROM tokens WHERE graduated_at > ? GROUP BY 1`, [since]),
      all(`SELECT first / ${bucket} * ${bucket} AS t, count(*) AS n FROM (SELECT min(ts) AS first FROM trades WHERE ${OURS} GROUP BY trader) WHERE first > ? GROUP BY 1`, [since]),
      all(`SELECT venue, sum(zro) AS volume, count(*) AS trades FROM trades WHERE ${OURS} AND ts > ? GROUP BY venue ORDER BY volume DESC`, [since]),
      all(
        `SELECT x.token AS address, t.symbol, t.name, t.uri, t.graduated, t.price * t.total_supply AS market_cap, sum(x.zro) AS volume, count(*) AS trades, count(DISTINCT x.trader) AS traders
         FROM trades x JOIN tokens t ON t.address = x.token WHERE x.${OURS} AND x.ts > ? GROUP BY x.token ORDER BY volume DESC LIMIT 10`,
        [since],
      ),
      all(
        `SELECT t.creator AS address, count(DISTINCT t.address) AS tokens, count(DISTINCT CASE WHEN t.graduated = 1 THEN t.address END) AS graduated,
                coalesce((SELECT sum(f.to_creator) FROM fee_events f JOIN tokens o ON o.address = f.token WHERE o.creator = t.creator AND f.ts > :s), 0) AS earned
         FROM tokens t WHERE t.source = 'terminal' AND t.creator IS NOT NULL GROUP BY t.creator ORDER BY earned DESC LIMIT 10`,
        { s: since },
      ),
      all(`SELECT is_buy, amount, min_out, filled, open, expiry, fills FROM orders`),
      one(`SELECT coalesce(sum(zro), 0) AS zro, coalesce(sum(tokens), 0) AS tokens, count(*) AS n FROM buybacks`),
      one(`SELECT count(*) AS tokens, coalesce(sum(graduated), 0) AS graduated, coalesce(sum(source = 'external'), 0) AS external, coalesce(sum(source = 'terminal'), 0) AS launched FROM tokens`),
    ]);

    const series = new Map<number, Record<string, number>>();
    for (let at = Math.floor(since / bucket) * bucket; at <= t; at += bucket) {
      series.set(at, { t: at, volume: 0, trades: 0, traders: 0, revenue: 0, creators: 0, launches: 0, graduations: 0, new_traders: 0 });
    }
    const merge = (rows: Row[], map: Record<string, string>) => {
      for (const r of rows) {
        const point = series.get(Number(r.t));
        if (!point) continue;
        for (const [from, to] of Object.entries(map)) point[to] = Number(r[from] ?? 0);
      }
    };
    merge(volumeRows, { volume: 'volume', trades: 'trades', traders: 'traders' });
    merge(feeRows, { revenue: 'revenue', creators: 'creators' });
    merge(launchRows, { n: 'launches' });
    merge(graduationRows, { n: 'graduations' });
    merge(newRows, { n: 'new_traders' });

    let openCount = 0;
    let locked = 0;
    let filledVolume = 0;
    let partly = 0;
    for (const o of orders) {
      const shape = orderShape(o);
      if (o.open && (shape.expiry === 0 || shape.expiry > t)) {
        openCount += 1;
        if (BigInt(String(o.filled)) > 0n) partly += 1;
        locked += shape.left_zro;
      }
      filledVolume += shape.size_zro - shape.left_zro;
    }

    // What the contracts hold right now, read from the chain and not added up from events.
    const treasury = DEPLOYMENT ? await treasuryNow().catch(() => null) : null;

    return {
      range: q.range ?? 'all',
      bucket,
      total: { ...total, tokens: Number(discovered?.tokens ?? 0), launched: Number(discovered?.launched ?? 0), external: Number(discovered?.external ?? 0), graduated: Number(discovered?.graduated ?? 0) },
      current,
      previous,
      series: [...series.values()],
      venues: venues.map((v) => ({ venue: String(v.venue), volume: Number(v.volume), trades: Number(v.trades) })),
      top_tokens: topTokens,
      top_creators: topCreators,
      orders: { placed: orders.length, open: openCount, partly_filled: partly, locked_zro: locked, filled_zro: filledVolume },
      treasury: treasury && { ...treasury, burned_zro: Number(buybacks?.zro ?? 0), burned_tokens: Number(buybacks?.tokens ?? 0), buybacks: Number(buybacks?.n ?? 0) },
    };
  };

  traderRoutes(app, TOKEN_COLUMNS, shapeToken);
  profileRoutes(app);
  pointsRoutes(app);

  /** Live feed. One stream per browser, so the terminal never polls for trades. */
  const streams = new Set<ServerResponse>();
  bus.on('event', (e: { type: string; data: unknown }) => {
    if (!streams.size) return;
    const text = `event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`;
    for (const res of streams) {
      // A reader that stopped reading would otherwise have everything queue up here for it. Its browser reconnects if it's alive.
      if (res.writableLength > 1024 * 1024) res.destroy();
      else res.write(text);
    }
  });
  app.get('/api/v1/stream', (req, reply) => {
    if (streams.size >= 2000) return reply.code(503).send({ message: 'Too many live connections' });
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': CORS_ORIGIN.split(',')[0]!,
    });
    res.write(': connected\n\n');
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    streams.add(res);
    req.raw.on('close', () => {
      clearInterval(ping);
      streams.delete(res);
    });
  });

  return app;
}
