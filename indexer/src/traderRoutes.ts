/**
 * The routes behind Pulse, the token page's analysis tabs, wallet records, the radar, inflow from tracked wallets, referrals and
 * the copy vault. Token rows reuse the API's own shape, passed in, so every list on the site reads the same fields.
 */
import type { FastifyInstance } from 'fastify';
import type { InArgs, Row } from '@libsql/client';
import { parseAbi } from 'viem';
import { CURVE, DEPLOYMENT, LAUNCHPADS } from './config.js';
import { all, one } from './db.js';
import { client } from './chain.js';
import { allTimeHigh, clustersOf, firstBuyers, holdersOf, inflow, radar, riskOf, topTraders, walletRecord, type RiskRow } from './insight.js';

const now = () => Math.floor(Date.now() / 1000);
const isAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
const addressList = (v: string | undefined) => (v ?? '').split(',').map((a) => a.trim().toLowerCase()).filter(isAddress).slice(0, 200);
const num = (v: unknown, fallback: number, max = 500) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback;
};
const opt = (v: unknown) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

const WINDOWS: Record<string, number> = { '1m': 60, '5m': 300, '1h': 3600, '6h': 21600, '24h': 86400 };
const padTarget = new Map(LAUNCHPADS.map((p) => [p.id, p.curve?.target ?? 0]));
/** How far along its curve, as SQL, matching shapeToken's progress. */
const PROGRESS = `(CASE WHEN t.launchpad IS NULL THEN t.raised / ${CURVE.raiseTarget} ${[...padTarget].filter(([, v]) => v > 0).map(([id, v]) => `WHEN t.launchpad = '${id.replace(/'/g, '')}' THEN t.raised / ${v}`).join(' ')} ELSE 0 END)`;

const OWNER_ABI = parseAbi(['function owner() view returns (address)']);

export function traderRoutes(app: FastifyInstance, columns: string, shape: (r: Row) => Record<string, unknown>) {
  /** Token rows with their risk figures, in the order given. */
  const withRisk = async (rows: Row[]) => {
    const risk = await riskOf(rows.map((r) => String(r.address)));
    return rows.map((r) => Object.assign(shape(r), { risk: risk.get(String(r.address)) ?? null }) as Record<string, unknown> & { risk: RiskRow | null });
  };

  /**
   * Pulse: new launches, the ones close to their pool, and the ones that just got there. Each column takes its own filters, all
   * optional: ages in seconds, market cap and volume in ZRO, shares from 0 to 1.
   */
  app.get('/api/v1/pulse/:column', async (req, reply) => {
    const column = (req.params as { column: string }).column;
    const q = req.query as Record<string, string | undefined>;
    const where: Record<string, string> = {
      new: `t.graduated = 0 AND t.has_pool = 0 AND (t.source = 'terminal' OR t.launchpad IS NOT NULL)`,
      near: `t.graduated = 0 AND t.has_pool = 0 AND (t.source = 'terminal' OR t.launchpad IS NOT NULL) AND ${PROGRESS} >= 0.4`,
      migrated: `(t.graduated = 1 OR t.has_pool = 1)`,
    };
    const order: Record<string, string> = { new: 't.created_at DESC, t.block DESC', near: `${PROGRESS} DESC`, migrated: 'coalesce(t.graduated_at, t.created_at) DESC' };
    if (!where[column]) return reply.code(404).send({ message: 'Columns are new, near and migrated' });
    const args: Record<string, string | number> = { since: now() - 86400 };
    const extra: string[] = [];
    if (q.launchpad === 'terminal') extra.push(`t.source = 'terminal'`);
    else if (q.launchpad) (extra.push('t.launchpad = :launchpad'), (args.launchpad = q.launchpad));
    if (q.socials === '1') extra.push(`t.links IS NOT NULL AND t.links != '{}'`);
    const rows = await all(`SELECT ${columns} FROM tokens t WHERE ${[where[column], ...extra].join(' AND ')} ORDER BY ${order[column]} LIMIT 150`, args as InArgs);
    const t = now();
    const tokens = (await withRisk(rows)).filter((r) => {
      const risk = r.risk;
      const age = t - Number(r.created_at);
      const checks: Array<[number | null, number, 'min' | 'max']> = [
        [opt(q.min_age), age, 'min'],
        [opt(q.max_age), age, 'max'],
        [opt(q.min_mcap), Number(r.market_cap), 'min'],
        [opt(q.max_mcap), Number(r.market_cap), 'max'],
        [opt(q.min_volume), Number(r.volume_24h), 'min'],
        [opt(q.min_holders), Number(r.holders), 'min'],
        [opt(q.max_holders), Number(r.holders), 'max'],
        [opt(q.min_progress), Number(r.progress), 'min'],
        [opt(q.max_progress), Number(r.progress), 'max'],
        [opt(q.max_dev), risk?.dev ?? 0, 'max'],
        [opt(q.max_top10), risk?.top10 ?? 0, 'max'],
        [opt(q.max_snipers), risk?.snipers ?? 0, 'max'],
        [opt(q.max_bundles), risk?.bundles ?? 0, 'max'],
        [opt(q.max_insiders), risk?.insiders ?? 0, 'max'],
        [opt(q.min_smart), risk?.smart_holders ?? 0, 'min'],
      ];
      return checks.every(([limit, value, kind]) => limit === null || (kind === 'min' ? value >= limit : value <= limit));
    });
    return { tokens: tokens.slice(0, num(q.limit, 60, 150)) };
  });

  /** What's moving over a window: volume, trades, buyers and the price change inside it. */
  app.get('/api/v1/trending', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const seconds = WINDOWS[q.window ?? '1h'] ?? 3600;
    const since = now() - seconds;
    const moving = await all(
      `SELECT token, sum(zro) AS volume, count(*) AS trades, count(DISTINCT CASE WHEN is_buy = 1 THEN trader END) AS buyers,
              (SELECT price FROM trades y WHERE y.token = x.token AND y.ts <= :since ORDER BY ts DESC, log_index DESC LIMIT 1) AS before,
              (SELECT price FROM trades y WHERE y.token = x.token AND y.ts > :since ORDER BY ts ASC, log_index ASC LIMIT 1) AS first
       FROM trades x WHERE ts > :since GROUP BY token ORDER BY volume DESC LIMIT 50`,
      { since },
    );
    if (!moving.length) return { window: q.window ?? '1h', tokens: [] };
    const rows = await all(`SELECT ${columns} FROM tokens t WHERE t.address IN (${moving.map((m) => `'${m.token}'`).join(',')})`, { since: now() - 86400 });
    const byAddress = new Map((await withRisk(rows)).map((r) => [String(r.address), r]));
    const tokens = moving
      .map((m) => {
        const row = byAddress.get(String(m.token));
        if (!row) return null;
        const base = Number(m.before ?? m.first ?? 0);
        return { ...row, window_volume: Number(m.volume), window_trades: Number(m.trades), window_buyers: Number(m.buyers), window_change: base > 0 ? Number(row.price) / base - 1 : 0 };
      })
      .filter(Boolean);
    const sort = q.sort === 'change' ? 'window_change' : q.sort === 'trades' ? 'window_trades' : 'window_volume';
    tokens.sort((a, b) => Number((b as Record<string, unknown>)[sort]) - Number((a as Record<string, unknown>)[sort]));
    return { window: q.window ?? '1h', tokens };
  });

  const tokenParam = (req: { params: unknown }) => (req.params as { address: string }).address.toLowerCase();

  app.get('/api/v1/tokens/:address/risk', async (req) => ({ risk: (await riskOf([tokenParam(req)])).get(tokenParam(req)) ?? null, ath: await allTimeHigh(tokenParam(req)) }));

  app.get('/api/v1/tokens/:address/holders/labelled', async (req, reply) => {
    const rows = await holdersOf(tokenParam(req), num((req.query as Record<string, string>).limit, 100, 200));
    return rows ? { holders: rows } : reply.code(404).send({ message: 'Token not found' });
  });

  app.get('/api/v1/tokens/:address/traders', async (req, reply) => {
    const rows = await topTraders(tokenParam(req), num((req.query as Record<string, string>).limit, 50, 200));
    return rows ? { traders: rows } : reply.code(404).send({ message: 'Token not found' });
  });

  app.get('/api/v1/tokens/:address/first-buyers', async (req, reply) => {
    const result = await firstBuyers(tokenParam(req));
    return result ?? reply.code(404).send({ message: 'Token not found' });
  });

  app.get('/api/v1/tokens/:address/clusters', async (req, reply) => {
    const result = await clustersOf(tokenParam(req));
    return result ?? reply.code(404).send({ message: 'Token not found' });
  });

  /**
   * What can be read from the chain about a token's safety. Ours are fixed by the launchpad: no owner, no mint, the pool's
   * shares burned at graduation. For anything else, who still owns the contract, if anyone, and whether it has a pool here.
   */
  app.get('/api/v1/tokens/:address/security', async (req, reply) => {
    const a = tokenParam(req);
    const t = await one(`SELECT source, graduated, has_pool, liquidity, fee_bps FROM tokens WHERE address = ?`, [a]);
    if (!t) return reply.code(404).send({ message: 'Token not found' });
    if (t.source === 'terminal') {
      return { ours: true, owner: null, renounced: true, mintable: false, lp_burned: Boolean(t.graduated), has_pool: Boolean(t.has_pool), fee_bps: Number(t.fee_bps), liquidity: Number(t.liquidity) };
    }
    let owner: string | null = null;
    let renounced = true;
    try {
      owner = (await client.readContract({ address: a as `0x${string}`, abi: OWNER_ABI, functionName: 'owner' })).toLowerCase();
      renounced = /^0x0{40}$/.test(owner) || owner === '0x000000000000000000000000000000000000dead';
    } catch {
      owner = null; // no owner() at all, which reads as nobody to change it
    }
    return { ours: false, owner, renounced, mintable: null, lp_burned: null, has_pool: Boolean(t.has_pool), fee_bps: null, liquidity: Number(t.liquidity) };
  });

  app.get('/api/v1/wallet/:address/record', async (req, reply) => {
    const address = (req.params as { address: string }).address;
    if (!isAddress(address)) return reply.code(400).send({ message: 'Bad address' });
    const days = (req.query as Record<string, string>).days === '7' ? 7 : 30;
    return walletRecord(address.toLowerCase(), days);
  });

  /** Wallets early on several of the given tokens, or on today's five busiest when none are given. */
  app.get('/api/v1/radar', async (req) => {
    let tokens = addressList((req.query as Record<string, string>).tokens).slice(0, 10);
    if (!tokens.length) {
      const busiest = await all(`SELECT token FROM trades WHERE ts > ? GROUP BY token ORDER BY sum(zro) DESC LIMIT 5`, [now() - 86400]);
      tokens = busiest.map((r) => String(r.token));
    }
    return { tokens, wallets: await radar(tokens) };
  });

  app.get('/api/v1/inflow', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return inflow(addressList(q.wallets), WINDOWS[q.window ?? '1h'] ?? 3600);
  });

  /** One box for everything: tokens by name, ticker or address, and wallets by address or the start of one. */
  app.get('/api/v1/search', async (req) => {
    const q = String((req.query as Record<string, string>).q ?? '').trim().toLowerCase().slice(0, 64);
    if (!q) return { tokens: [], wallets: [] };
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const tokens = await all(
      `SELECT ${columns} FROM tokens t WHERE lower(t.name) LIKE :like OR lower(t.symbol) LIKE :like OR t.address = :q OR t.address LIKE :prefix
       ORDER BY (lower(t.symbol) = :q) DESC, volume_24h DESC LIMIT 8`,
      { like, q, prefix: /^0x[0-9a-f]{3,}$/.test(q) ? `${q}%` : '-', since: now() - 86400 },
    );
    // Wallets only by address: a full one, or at least the first four characters after 0x.
    const wallets = /^0x[0-9a-f]{4,40}$/.test(q)
      ? await all(
          `SELECT trader AS address, count(*) AS trades, count(DISTINCT token) AS tokens, max(ts) AS last_ts FROM trades WHERE trader LIKE ? GROUP BY trader ORDER BY trades DESC LIMIT 5`,
          [`${q}%`],
        )
      : [];
    return { tokens: tokens.map(shape), wallets };
  });

  app.get('/api/v1/referrals/:address', async (req, reply) => {
    const address = (req.params as { address: string }).address;
    if (!isAddress(address)) return reply.code(400).send({ message: 'Bad address' });
    const a = address.toLowerCase();
    const [link, referred, asReferrer, asTrader, claimed] = await Promise.all([
      one(`SELECT referrer, ts FROM referral_links WHERE trader = ?`, [a]),
      one(`SELECT count(*) AS n FROM referral_links WHERE referrer = ?`, [a]),
      one(`SELECT coalesce(sum(to_referrer), 0) AS zro, count(DISTINCT trader) AS traders FROM referral_credits WHERE referrer = ?`, [a]),
      one(`SELECT coalesce(sum(to_trader), 0) AS zro FROM referral_credits WHERE trader = ?`, [a]),
      one(`SELECT coalesce(sum(amount), 0) AS zro FROM referral_claims WHERE who = ?`, [a]),
    ]);
    const earned = Number(asReferrer?.zro ?? 0) + Number(asTrader?.zro ?? 0);
    return {
      referrer: link ? String(link.referrer) : null,
      referred: Number(referred?.n ?? 0),
      active_traders: Number(asReferrer?.traders ?? 0),
      from_referrals: Number(asReferrer?.zro ?? 0),
      cashback: Number(asTrader?.zro ?? 0),
      earned,
      claimed: Number(claimed?.zro ?? 0),
      unclaimed: Math.max(0, earned - Number(claimed?.zro ?? 0)),
      contract: DEPLOYMENT?.referrals ?? null,
    };
  });

  /** A follower's copy vault: who they follow and how, their exits, positions worked out from the vault's events, and history. */
  app.get('/api/v1/vault/:address', async (req, reply) => {
    const address = (req.params as { address: string }).address;
    if (!isAddress(address)) return reply.code(400).send({ message: 'Bad address' });
    const a = address.toLowerCase();
    const [follows, exit, events, positions] = await Promise.all([
      all(`SELECT leader, rules, active, updated_at FROM vault_follows WHERE follower = ? ORDER BY updated_at DESC`, [a]),
      one(`SELECT take_profit_bps, stop_loss_bps, slippage_bps FROM vault_exits WHERE follower = ?`, [a]),
      all(`SELECT * FROM vault_events WHERE follower = ? ORDER BY ts DESC, log_index DESC LIMIT 200`, [a]),
      all(
        `SELECT v.token, t.symbol, t.name, t.uri, t.price,
                sum(CASE WHEN v.kind = 'copy_buy' THEN v.tokens WHEN v.kind IN ('copy_sell', 'exit', 'sell', 'tokens_out') THEN -v.tokens ELSE 0 END) AS tokens,
                sum(CASE WHEN v.kind = 'copy_buy' THEN v.zro ELSE 0 END) AS spent,
                sum(CASE WHEN v.kind IN ('copy_sell', 'exit', 'sell') THEN v.zro ELSE 0 END) AS received
         FROM vault_events v JOIN tokens t ON t.address = v.token WHERE v.follower = ? AND v.token IS NOT NULL GROUP BY v.token`,
        [a],
      ),
    ]);
    const balance = events.reduce((s, e) => {
      const k = String(e.kind);
      const zro = Number(e.zro);
      return s + (k === 'deposit' ? zro : k === 'withdraw' ? -zro : k === 'copy_buy' ? -zro : ['copy_sell', 'exit', 'sell'].includes(k) ? zro : 0);
    }, 0);
    return {
      contract: DEPLOYMENT?.copyVault ?? null,
      follows: follows.map((f) => ({ leader: String(f.leader), rules: JSON.parse(String(f.rules)), active: Boolean(f.active), updated_at: Number(f.updated_at) })),
      exit: exit ? { take_profit_bps: Number(exit.take_profit_bps), stop_loss_bps: Number(exit.stop_loss_bps), slippage_bps: Number(exit.slippage_bps) } : null,
      positions: positions
        .filter((p) => Number(p.tokens) > 1e-9)
        .map((p) => ({ token: String(p.token), symbol: String(p.symbol), name: String(p.name), uri: p.uri ? String(p.uri) : null, tokens: Number(p.tokens), spent: Number(p.spent), received: Number(p.received), value: Number(p.tokens) * Number(p.price) })),
      balance_estimate: balance, // the contract's balanceOf is the real figure; this is from events, before run fees
      events,
    };
  });
}
