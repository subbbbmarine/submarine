import { EventEmitter } from 'node:events';
import { createPublicClient, decodeEventLog, encodeEventTopics, formatUnits, http, parseAbi, parseAbiItem, type AbiEvent, type Log } from 'viem';
import type { InStatement } from '@libsql/client';
import { pino } from 'pino';
import { CHAIN_ID, CURVE, DEPLOYMENT, IGNORED_FACTORIES, LAUNCHPADS, MAX_RANGE, POLL_MS, RPC_URL, START_BLOCK, SYNC_TAG, type PadEvent } from './config.js';
import { all, batch, getState, one } from './db.js';
import { openRemoteUri, openUri } from './meta.js';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

/** Everything the API streams to browsers goes through here. */
export const bus = new EventEmitter();
bus.setMaxListeners(0);

export const client = createPublicClient({
  chain: {
    id: CHAIN_ID,
    name: 'Zero',
    nativeCurrency: { name: 'ZRO', symbol: 'ZRO', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  },
  transport: http(RPC_URL, { timeout: 10_000, retryCount: 2 }),
});

const EVENTS = parseAbi([
  'event TokenLaunched(address indexed token, address indexed creator, string name, string symbol, string uri, uint256 timestamp, uint256 supply, uint16 feeBps, uint16 holdersBps, uint16 burnBps, bool antiSnipe)',
  // Where the earners' part of a fee went, from the launchpad, and the burn share bought back inside a pool swap.
  'event EarnersPaid(address indexed token, uint256 toCreator, uint256 toHolders, uint256 toBurn, uint256 burned)',
  'event Burned(address indexed token, uint256 zro, uint256 tokens)',
  'event Trade(address indexed token, address indexed trader, bool isBuy, uint256 zroAmount, uint256 tokenAmount, uint256 fee, uint256 toTreasury, uint256 raisedAfter, uint256 soldAfter)',
  'event Graduated(address indexed token, uint256 zroToPool, uint256 tokensToPool)',
  'event PoolFeePaid(address indexed token, uint256 amount)',
  // The terminal's 0.4% on a graduated token's pool: the Infinity hook takes it and hands it to the launchpad, which emits this.
  'event ProtocolFeeFromPool(address indexed token, uint256 toTreasury)',
  'event PoolCreated(address indexed token, address indexed by, bool graduated)',
  'event Swap(address indexed token, address indexed trader, bool isBuy, uint256 zroAmount, uint256 tokenAmount, uint256 reserveZro, uint256 reserveToken)',
  'event Routed(address indexed token, address indexed trader, address indexed venue, bool isBuy, uint256 zroAmount, uint256 tokenAmount, uint256 fee)',
  'event Placed(uint256 indexed id, address indexed owner, address indexed token, bool isBuy, uint256 amount, uint256 minOut, uint256 expiry)',
  'event Filled(uint256 indexed id, uint256 zroSide, uint256 tokenSide, address indexed by)',
  'event Closed(uint256 indexed id, bool expired)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Buyback(address indexed token, uint256 zroSpent, uint256 tokensBurned)',
  // LimitOrders: what an order waits for, and a trailing stop's high moving up.
  'event Conditions(uint256 indexed id, uint8 kind, uint256 trigger, uint16 trailBps, uint32 interval, uint16 slices, uint256 group)',
  'event Peak(uint256 indexed id, uint256 value)',
  // CopyVault. Its Withdrawn shares a signature with LimitOrders' but not the indexed fields, so only this one decodes.
  'event Deposited(address indexed follower, uint256 amount)',
  'event Withdrawn(address indexed follower, address to, uint256 amount)',
  'event Followed(address indexed follower, address indexed leader, (uint128 perTrade, uint128 perToken, uint128 perDay, uint16 sizeBps, uint16 slippageBps, uint16 chaseBps, uint16 minSellBps, bool buyOnce, bool copySells, uint32 maxAge) rules)',
  'event Unfollowed(address indexed follower, address indexed leader)',
  'event ExitSet(address indexed follower, (uint16 takeProfitBps, uint16 stopLossBps, uint16 slippageBps) exit)',
  'event CopiedBuy(address indexed follower, address indexed leader, address indexed token, uint256 zro, uint256 tokens, address by)',
  'event CopiedSell(address indexed follower, address indexed leader, address indexed token, uint256 zro, uint256 tokens, address by)',
  'event Exited(address indexed follower, address indexed token, bool takeProfit, uint256 zro, uint256 tokens, address by)',
  'event Sold(address indexed follower, address indexed token, uint256 zro, uint256 tokens)',
  'event TokensWithdrawn(address indexed follower, address indexed token, address to, uint256 tokens)',
  // Referrals.
  'event Linked(address indexed trader, address indexed referrer)',
  'event Credited(address indexed trader, address indexed referrer, uint256 toReferrer, uint256 toTrader)',
  'event Claimed(address indexed who, uint256 amount)',
]);
const ERC20 = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
]);
const PAIR = parseAbi(['function token0() view returns (address)']);
/** Protocol predeploys sit in the low address range: staking credit, the governance token and so on. */
const isSystem = (address: string | null) => address !== null && /^0x0{34}/.test(address);

const ZERO = '0x0000000000000000000000000000000000000000';
const DEAD = '0x000000000000000000000000000000000000dead';
const lc = (a: string) => a.toLowerCase();
const eth = (v: bigint, decimals = 18) => Number(formatUnits(v, decimals));

/** Other launchpads, from their files in launchpads/. Each event is read by the signature and field names its file gives. */
type PadKind = 'created' | 'buy' | 'sell' | 'trade' | 'graduated';
interface PadDecoder {
  kind: PadKind;
  map: PadEvent;
  item: AbiEvent;
}
const PADS = new Map(
  LAUNCHPADS.map((pad) => {
    const decoders = new Map<string, PadDecoder>();
    for (const [kind, map] of Object.entries(pad.events ?? {}) as Array<[PadKind, PadEvent]>) {
      try {
        const item = parseAbiItem(map.event) as AbiEvent;
        decoders.set(encodeEventTopics({ abi: [item] })[0] as string, { kind, map, item });
      } catch (err) {
        log.warn({ pad: pad.id, kind, err: (err as Error).message }, 'launchpad event skipped');
      }
    }
    return [lc(pad.contract), { ...pad, address: lc(pad.contract), decoders, topics: [...decoders.keys()] }];
  }),
);
type Pad = NonNullable<ReturnType<typeof PADS.get>>;

const TOPICS = [...new Set([...EVENTS.map((e) => encodeEventTopics({ abi: [e] })[0] as string), ...[...PADS.values()].flatMap((p) => p.topics)])];

const dep = DEPLOYMENT && {
  launchpad: lc(DEPLOYMENT.launchpad),
  pools: lc(DEPLOYMENT.pools),
  router: lc(DEPLOYMENT.router),
  limitOrders: lc(DEPLOYMENT.limitOrders),
  vault: lc(DEPLOYMENT.vault),
  referrals: DEPLOYMENT.referrals ? lc(DEPLOYMENT.referrals) : null,
  copyVault: DEPLOYMENT.copyVault ? lc(DEPLOYMENT.copyVault) : null,
  /** Infinity's vault holds the pools' tokens; the venue only passes them through. Neither is a holder. */
  poolContracts: [DEPLOYMENT.infinityVault, DEPLOYMENT.poolVenue, DEPLOYMENT.poolManager].filter((a): a is `0x${string}` => Boolean(a)).map(lc),
};
/** Contracts that hold tokens without being holders in any useful sense. */
const NOT_HOLDERS = new Set([ZERO, DEAD, ...(dep ? [dep.launchpad, dep.pools, dep.router, dep.limitOrders, ...(dep.copyVault ? [dep.copyVault] : []), ...dep.poolContracts] : []), ...[...PADS.values()].flatMap((p) => [p.address, ...(p.notHolders ?? []).map(lc)])]);

type Decoded = { name: string; args: Record<string, any>; log: Log; pad?: Pad; decoder?: PadDecoder };

function decode(l: Log): Decoded | null {
  const pad = PADS.get(lc(l.address));
  const decoder = pad?.decoders.get(l.topics[0] as string);
  if (decoder) {
    try {
      const d = decodeEventLog({ abi: [decoder.item], data: l.data, topics: l.topics, strict: true });
      return { name: 'Pad', args: d.args as unknown as Record<string, any>, log: l, pad, decoder };
    } catch {
      return null; // its file doesn't match what the contract emits, which the check script is there to catch
    }
  }
  try {
    const d = decodeEventLog({ abi: EVENTS, data: l.data, topics: l.topics, strict: true });
    return { name: d.eventName, args: d.args as Record<string, any>, log: l };
  } catch {
    return null; // same topic, different shape: an ERC-721 Transfer, for one
  }
}

/** The price on a curve. Its virtual tokens are 16/15 of the supply the creator chose. */
const curvePrice = (raised: number, sold: number, supply: number) => (CURVE.virtualZro + raised) / ((supply * 16) / 15 - sold);

export const CANDLE_INTERVALS = [1, 5, 60, 300, 900, 3600, 14400, 86400];

function tradeStatements(t: { tx: string; idx: number; block: number; ts: number; token: string; trader: string; isBuy: boolean; zro: number; amount: number; price: number; venue: string }): InStatement[] {
  const out: InStatement[] = [
    {
      sql: `INSERT OR IGNORE INTO trades (tx_hash, log_index, block, ts, token, trader, is_buy, zro, amount, price, venue) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [t.tx, t.idx, t.block, t.ts, t.token, t.trader, t.isBuy ? 1 : 0, t.zro, t.amount, t.price, t.venue],
    },
  ];
  for (const interval of CANDLE_INTERVALS) {
    const bucket = t.ts - (t.ts % interval);
    // A candle opens where the last one closed, so one trade in a minute reads as the move it made and not as a flat dash.
    out.push({
      sql: `INSERT INTO candles (token, interval, t, o, h, l, c, v)
            SELECT :token, :interval, :t, open, max(open, :price), min(open, :price), :price, :zro
            FROM (SELECT coalesce((SELECT c FROM candles WHERE token = :token AND interval = :interval AND t < :t ORDER BY t DESC LIMIT 1), (SELECT nullif(price, 0) FROM tokens WHERE address = :token), :price) AS open) WHERE true
            ON CONFLICT (token, interval, t) DO UPDATE SET h = max(h, excluded.c), l = min(l, excluded.c), c = excluded.c, v = v + excluded.v`,
      args: { token: t.token, interval, t: bucket, price: t.price, zro: t.zro },
    });
  }
  return out;
}

/** A token we haven't seen: read its metadata, and walk away if it doesn't answer like an ERC-20. */
async function probeToken(address: string, block: bigint, tx: string, ts: number, padId?: string): Promise<InStatement | null> {
  try {
    const contract = { address: address as `0x${string}`, abi: ERC20 };
    const [name, symbol, decimals, supply] = await Promise.all([
      client.readContract({ ...contract, functionName: 'name' }),
      client.readContract({ ...contract, functionName: 'symbol' }),
      client.readContract({ ...contract, functionName: 'decimals' }),
      client.readContract({ ...contract, functionName: 'totalSupply' }),
    ]);
    const txn = await client.getTransaction({ hash: tx as `0x${string}` });
    const factory = txn.to ? lc(txn.to) : null;
    if (isSystem(address) || isSystem(factory) || (factory && IGNORED_FACTORIES.has(factory))) return null;
    // A liquidity pair is ERC-20 by shape but nobody trades it as a token. Only a real pair answers token0().
    const isPair = await client.readContract({ address: address as `0x${string}`, abi: PAIR, functionName: 'token0' }).then(() => true, () => false);
    if (isPair) return null;
    if (decimals > 36) return null; // nothing real, and it would break every amount shown for it
    return {
      sql: `INSERT OR IGNORE INTO tokens (address, name, symbol, decimals, total_supply, creator, source, factory, block, tx_hash, created_at, launchpad)
            VALUES (?,?,?,?,?,?,'external',?,?,?,?,?)`,
      // Anyone's contract can answer with anything, and every token list carries these. Our own launchpad holds them to 64 and 16.
      args: [address, name.slice(0, 64), symbol.slice(0, 16), decimals, eth(supply, decimals), lc(txn.from), factory, Number(block), tx, ts, padId ?? (factory && PADS.get(factory)?.id) ?? null],
    };
  } catch {
    return null;
  }
}

/** With `only`, one launchpad's own events, for catching up on its past. Those are history, so they aren't pushed to browsers. */
async function processRange(from: bigint, to: bigint, only?: Pad): Promise<void> {
  const logs = (await client.request({
    method: 'eth_getLogs',
    params: [{ fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, ...(only ? { address: only.address as `0x${string}`, topics: [only.topics as `0x${string}`[]] } : { topics: [TOPICS as `0x${string}`[]] }) }],
  })) as unknown as Log[];
  if (!logs.length) return;

  const events = logs
    .map((l) => ({ ...l, blockNumber: BigInt(l.blockNumber as unknown as string), logIndex: Number(l.logIndex) }))
    .map((l) => decode(l as Log))
    .filter((d): d is Decoded => d !== null)
    .sort((a, b) => Number(a.log.blockNumber! - b.log.blockNumber!) || a.log.logIndex! - b.log.logIndex!);

  const times = new Map<bigint, number>();
  await Promise.all(
    [...new Set(events.map((e) => e.log.blockNumber!))].map(async (n) => {
      const b = await client.getBlock({ blockNumber: n });
      times.set(n, Number(b.timestamp));
    }),
  );

  // Router and limit-order contracts appear as "trader" on the venue's own event. These maps recover who really traded.
  // A batch fills several orders in one transaction, so a trade belongs to the first fill logged after it.
  const routedBy = new Map<string, string>();
  // CopyVault trades for its followers: the follower named on the vault's own event in the same transaction.
  const copiedFor = new Map<string, string>();
  const fillsByTx = new Map<string, Array<{ at: number; id: string }>>();
  const orders = new Map<string, { owner: string; isBuy: boolean; filled: bigint; filledOut: bigint }>();
  for (const e of events) {
    const tx = e.log.transactionHash!;
    if (e.name === 'Routed' && dep && lc(e.log.address) === dep.router) routedBy.set(`${tx}:${lc(e.args.token)}`, lc(e.args.trader));
    if (e.name === 'Filled' && dep && lc(e.log.address) === dep.limitOrders) fillsByTx.set(tx, [...(fillsByTx.get(tx) ?? []), { at: e.log.logIndex!, id: String(e.args.id) }]);
    if (['CopiedBuy', 'CopiedSell', 'Exited', 'Sold'].includes(e.name) && dep?.copyVault && lc(e.log.address) === dep.copyVault) copiedFor.set(`${tx}:${lc(e.args.token)}`, lc(e.args.follower));
    if (e.name === 'Placed' && dep && lc(e.log.address) === dep.limitOrders) orders.set(String(e.args.id), { owner: lc(e.args.owner), isBuy: e.args.isBuy, filled: 0n, filledOut: 0n });
  }
  const orderOf = async (id: string) => {
    const known = orders.get(id);
    if (known) return known;
    const row = await one('SELECT owner, is_buy, filled, filled_out FROM orders WHERE id = ?', [Number(id)]);
    if (!row) return undefined;
    const loaded = { owner: String(row.owner), isBuy: Boolean(row.is_buy), filled: BigInt(String(row.filled)), filledOut: BigInt(String(row.filled_out)) };
    orders.set(id, loaded);
    return loaded;
  };
  for (const fills of fillsByTx.values()) for (const f of fills) await orderOf(f.id);

  const statements: InStatement[] = [];
  const pushed: Array<{ type: string; data: unknown }> = [];
  // Every token we follow and who created it, which is how a creator's transfers are told from anyone else's.
  const known = new Map((await all('SELECT address, creator FROM tokens')).map((r) => [String(r.address), r.creator ? String(r.creator) : null]));

  // Each token's supply, which its curve's price depends on. A token launched in this range isn't in the database yet.
  const supplies = new Map<string, number>();
  const supplyOf = async (token: string) => {
    if (!supplies.has(token)) supplies.set(token, Number((await one('SELECT total_supply FROM tokens WHERE address = ?', [token]))?.total_supply ?? CURVE.supply));
    return supplies.get(token)!;
  };

  // Launches first: the mint Transfer comes before TokenLaunched in the same transaction.
  for (const e of events) {
    if (e.name !== 'TokenLaunched' || !dep || lc(e.log.address) !== dep.launchpad) continue;
    const a = e.args;
    const address = lc(a.token);
    const ts = times.get(e.log.blockNumber!)!;
    // Saved here, or on another copy of the terminal, the public site say, when this one runs elsewhere.
    const opened = (await openRemoteUri(a.uri)) ?? openUri(a.uri);
    const supply = eth(a.supply);
    supplies.set(address, supply);
    statements.push({
      sql: `INSERT OR IGNORE INTO tokens (address, name, symbol, decimals, total_supply, creator, source, factory, uri, description, links, block, tx_hash, created_at, price, fee_bps, fee_route, holders_bps, burn_bps, anti_snipe)
            VALUES (?,?,?,18,?,?,'terminal',?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      // fee_route 1 still means a token that pays its holders, which is what a holder's rewards are looked up by.
      args: [address, a.name, a.symbol, supply, lc(a.creator), dep.launchpad, opened.image, opened.description, opened.links, Number(e.log.blockNumber), e.log.transactionHash!, ts, curvePrice(0, 0, supply), Number(a.feeBps), Number(a.holdersBps) > 0 ? 1 : 0, Number(a.holdersBps), Number(a.burnBps), a.antiSnipe ? 1 : 0],
    });
    known.set(address, lc(a.creator));
    pushed.push({ type: 'launch', data: { address, name: a.name, symbol: a.symbol, creator: lc(a.creator), ts } });
  }

  const balanceDeltas = new Map<string, bigint>();
  const decimalsOf = new Map<string, number>();
  for (const e of events) {
    const tx = e.log.transactionHash!;
    const idx = e.log.logIndex!;
    const block = Number(e.log.blockNumber);
    const ts = times.get(e.log.blockNumber!)!;
    const source = lc(e.log.address);

    const realTrader = (reported: string): string => {
      let r = lc(reported);
      if (!dep) return r;
      if (r === dep.router) r = routedBy.get(`${tx}:${lc(e.args.token)}`) ?? r;
      if (dep.copyVault && r === dep.copyVault) r = copiedFor.get(`${tx}:${lc(e.args.token)}`) ?? r;
      if (r === dep.limitOrders) {
        const fill = fillsByTx.get(tx)?.find((f) => f.at > idx);
        r = (fill && orders.get(fill.id)?.owner) ?? r;
      }
      return r;
    };

    switch (e.name) {
      case 'Pad': {
        const { pad, decoder } = e as Required<Decoded>;
        const { kind, map } = decoder;
        const token = lc(String(e.args[map.token]));
        // Normally the mint's Transfer introduced it just before this. Catching up on a past, that log isn't in the range.
        if (!known.has(token)) {
          const insert = await probeToken(token, e.log.blockNumber!, tx, ts, pad.id);
          if (!insert) break;
          statements.push(insert);
          known.set(token, map.creator ? lc(String(e.args[map.creator])) : null);
        }
        if (kind === 'created') {
          const creator = map.creator ? lc(String(e.args[map.creator])) : null;
          const uri = map.uri ? String(e.args[map.uri]) || null : null;
          const opened = (await openRemoteUri(uri)) ?? openUri(uri);
          if (creator) known.set(token, creator);
          statements.push({ sql: `UPDATE tokens SET launchpad = ?, creator = coalesce(?, creator), uri = coalesce(?, uri), description = coalesce(?, description), links = coalesce(?, links) WHERE address = ?`, args: [pad.id, creator, opened.image, opened.description, opened.links, token] });
          pushed.push({ type: 'launch', data: { address: token, ts, external: true, launchpad: pad.id } });
          break;
        }
        if (kind === 'graduated') {
          statements.push({ sql: `UPDATE tokens SET graduated = 1, graduated_at = ? WHERE address = ?`, args: [ts, token] });
          pushed.push({ type: 'graduated', data: { token, ts } });
          break;
        }
        if (!map.trader || !map.zro || !map.tokens) break;
        const isBuy = kind === 'buy' || (kind === 'trade' && Boolean(map.isBuy && e.args[map.isBuy]));
        if (!decimalsOf.has(token)) decimalsOf.set(token, Number((await one('SELECT decimals FROM tokens WHERE address = ?', [token]))?.decimals ?? 18));
        const zro = eth(e.args[map.zro]);
        const amount = eth(e.args[map.tokens], decimalsOf.get(token));
        if (amount <= 0) break;
        // Its reserves give the real price after this trade. Without them, what this trade paid per token is the best there is.
        const price = map.reserveZro && map.reserveToken ? eth(e.args[map.reserveZro]) / eth(e.args[map.reserveToken], decimalsOf.get(token)) : zro / amount;
        const trade = { tx, idx, block, ts, token, trader: lc(String(e.args[map.trader])), isBuy, zro, amount, price, venue: `pad:${pad.id}` };
        statements.push(...tradeStatements(trade));
        const raised = map.raised ? eth(e.args[map.raised]) : null;
        statements.push({ sql: `UPDATE tokens SET price = ?, raised = coalesce(?, raised), liquidity = coalesce(?, liquidity), last_trade_at = ? WHERE address = ?`, args: [price, raised, raised, ts, token] });
        pushed.push({ type: 'trade', data: trade });
        break;
      }
      case 'Trade': {
        if (!dep || source !== dep.launchpad) break;
        const token = lc(e.args.token);
        const raised = eth(e.args.raisedAfter);
        const sold = eth(e.args.soldAfter);
        const price = curvePrice(raised, sold, await supplyOf(token));
        const trade = { tx, idx, block, ts, token, trader: realTrader(e.args.trader), isBuy: e.args.isBuy as boolean, zro: eth(e.args.zroAmount), amount: eth(e.args.tokenAmount), price, venue: 'curve' };
        statements.push(...tradeStatements(trade));
        statements.push({ sql: `UPDATE tokens SET raised = ?, sold = ?, price = ?, liquidity = ?, last_trade_at = ? WHERE address = ?`, args: [raised, sold, price, raised, ts, token] });
        const fee = eth(e.args.fee);
        const toTreasury = eth(e.args.toTreasury);
        if (fee > 0) statements.push({ sql: `INSERT OR IGNORE INTO fee_events (tx_hash, log_index, ts, token, kind, to_treasury, to_creator) VALUES (?,?,?,?,'curve',?,?)`, args: [tx, idx, ts, token, toTreasury, fee - toTreasury] });
        pushed.push({ type: 'trade', data: trade });
        break;
      }
      case 'EarnersPaid': {
        if (!dep || source !== dep.launchpad) break;
        statements.push({ sql: `INSERT OR IGNORE INTO earner_events (tx_hash, log_index, ts, token, to_creator, to_holders, to_burn, burned) VALUES (?,?,?,?,?,?,?,?)`, args: [tx, idx, ts, lc(e.args.token), eth(e.args.toCreator), eth(e.args.toHolders), eth(e.args.toBurn), eth(e.args.burned)] });
        break;
      }
      case 'Burned': {
        if (!dep || source !== dep.pools) break;
        statements.push({ sql: `INSERT OR IGNORE INTO earner_events (tx_hash, log_index, ts, token, to_creator, to_holders, to_burn, burned) VALUES (?,?,?,?,0,0,?,?)`, args: [tx, idx, ts, lc(e.args.token), eth(e.args.zro), eth(e.args.tokens)] });
        break;
      }
      case 'PoolFeePaid': {
        if (!dep || source !== dep.launchpad) break;
        statements.push({ sql: `INSERT OR IGNORE INTO fee_events (tx_hash, log_index, ts, token, kind, to_treasury, to_creator) VALUES (?,?,?,?,'pool',0,?)`, args: [tx, idx, ts, lc(e.args.token), eth(e.args.amount)] });
        break;
      }
      // The terminal's 0.4% on a graduated token's pool, which the hook takes itself and pays through the launchpad.
      case 'ProtocolFeeFromPool': {
        if (!dep || source !== dep.launchpad) break;
        statements.push({ sql: `INSERT OR IGNORE INTO fee_events (tx_hash, log_index, ts, token, kind, to_treasury, to_creator) VALUES (?,?,?,?,'pool',?,0)`, args: [tx, idx, ts, lc(e.args.token), eth(e.args.toTreasury)] });
        break;
      }
      case 'Swap': {
        if (!dep || source !== dep.pools) break;
        const token = lc(e.args.token);
        const price = eth(e.args.reserveZro) / eth(e.args.reserveToken);
        const trade = { tx, idx, block, ts, token, trader: realTrader(e.args.trader), isBuy: e.args.isBuy as boolean, zro: eth(e.args.zroAmount), amount: eth(e.args.tokenAmount), price, venue: 'pool' };
        statements.push(...tradeStatements(trade));
        statements.push({ sql: `UPDATE tokens SET price = ?, liquidity = ?, last_trade_at = ? WHERE address = ?`, args: [price, eth(e.args.reserveZro), ts, token] });
        pushed.push({ type: 'trade', data: trade });
        break;
      }
      case 'Graduated': {
        if (!dep || source !== dep.launchpad) break;
        const token = lc(e.args.token);
        statements.push({ sql: `UPDATE tokens SET graduated = 1, has_pool = 1, graduated_at = ?, liquidity = ? WHERE address = ?`, args: [ts, eth(e.args.zroToPool), token] });
        pushed.push({ type: 'graduated', data: { token, ts } });
        break;
      }
      case 'Routed': {
        if (!dep || source !== dep.router) break;
        const fee = eth(e.args.fee);
        if (fee > 0) statements.push({ sql: `INSERT OR IGNORE INTO fee_events (tx_hash, log_index, ts, token, kind, to_treasury, to_creator) VALUES (?,?,?,?,'router',?,0)`, args: [tx, idx, ts, lc(e.args.token), fee] });
        // Volume through the terminal, for points and ranks.
        statements.push({ sql: `INSERT OR IGNORE INTO routed (tx_hash, log_index, ts, token, trader, is_buy, zro) VALUES (?,?,?,?,?,?,?)`, args: [tx, idx, ts, lc(e.args.token), lc(e.args.trader), e.args.isBuy ? 1 : 0, eth(e.args.zroAmount)] });
        break;
      }
      case 'Buyback': {
        if (!dep || source !== dep.vault) break;
        statements.push({ sql: `INSERT OR IGNORE INTO buybacks (tx_hash, log_index, ts, token, zro, tokens) VALUES (?,?,?,?,?,?)`, args: [tx, idx, ts, lc(e.args.token), eth(e.args.zroSpent), eth(e.args.tokensBurned)] });
        break;
      }
      case 'PoolCreated': {
        if (!dep || source !== dep.pools) break;
        statements.push({ sql: `UPDATE tokens SET has_pool = 1 WHERE address = ?`, args: [lc(e.args.token)] });
        break;
      }
      case 'Placed': {
        if (!dep || source !== dep.limitOrders) break;
        statements.push({
          sql: `INSERT OR IGNORE INTO orders (id, owner, token, is_buy, amount, min_out, expiry, created_at) VALUES (?,?,?,?,?,?,?,?)`,
          args: [Number(e.args.id), lc(e.args.owner), lc(e.args.token), e.args.isBuy ? 1 : 0, String(e.args.amount), String(e.args.minOut), Number(e.args.expiry), ts],
        });
        pushed.push({ type: 'order', data: { id: Number(e.args.id) } });
        break;
      }
      case 'Filled': {
        if (!dep || source !== dep.limitOrders) break;
        const id = Number(e.args.id);
        const order = await orderOf(String(id));
        if (!order) break; // placed before the block we started from
        const zroSide = e.args.zroSide as bigint;
        const tokenSide = e.args.tokenSide as bigint;
        // `filled` counts what the order escrowed, `filled_out` what it got for it.
        order.filled += order.isBuy ? zroSide : tokenSide;
        order.filledOut += order.isBuy ? tokenSide : zroSide;
        statements.push({ sql: `UPDATE orders SET filled = ?, filled_out = ?, fills = fills + 1 WHERE id = ?`, args: [order.filled.toString(), order.filledOut.toString(), id] });
        statements.push({ sql: `INSERT OR IGNORE INTO order_fills (tx_hash, log_index, id, ts, zro, tokens, keeper) VALUES (?,?,?,?,?,?,?)`, args: [tx, idx, id, ts, eth(zroSide), eth(tokenSide), lc(e.args.by)] });
        pushed.push({ type: 'order', data: { id } });
        break;
      }
      case 'Closed': {
        if (!dep || source !== dep.limitOrders) break;
        statements.push({ sql: `UPDATE orders SET open = 0, closed_at = ?, closed_expired = ? WHERE id = ?`, args: [ts, e.args.expired ? 1 : 0, Number(e.args.id)] });
        pushed.push({ type: 'order', data: { id: Number(e.args.id) } });
        break;
      }
      case 'Conditions': {
        if (!dep || source !== dep.limitOrders) break;
        statements.push({
          sql: `UPDATE orders SET kind = ?, trigger_wei = ?, trail_bps = ?, interval_s = ?, slices = ?, grp = CASE WHEN is_buy = 1 THEN NULL ELSE ? END WHERE id = ?`,
          args: [Number(e.args.kind), String(e.args.trigger), Number(e.args.trailBps), Number(e.args.interval), Number(e.args.slices), Number(e.args.group), Number(e.args.id)],
        });
        break;
      }
      case 'Peak': {
        if (!dep || source !== dep.limitOrders) break;
        statements.push({ sql: `UPDATE orders SET trigger_wei = ? WHERE id = ?`, args: [String(e.args.value), Number(e.args.id)] });
        pushed.push({ type: 'order', data: { id: Number(e.args.id) } });
        break;
      }
      case 'Deposited':
      case 'Withdrawn':
      case 'CopiedBuy':
      case 'CopiedSell':
      case 'Exited':
      case 'Sold':
      case 'TokensWithdrawn': {
        if (!dep?.copyVault || source !== dep.copyVault) break;
        const kinds: Record<string, string> = { Deposited: 'deposit', Withdrawn: 'withdraw', CopiedBuy: 'copy_buy', CopiedSell: 'copy_sell', Exited: 'exit', Sold: 'sell', TokensWithdrawn: 'tokens_out' };
        const a = e.args;
        const token = a.token ? lc(a.token) : null;
        const zro = a.zro ?? a.amount ?? 0n;
        statements.push({
          sql: `INSERT OR IGNORE INTO vault_events (tx_hash, log_index, ts, follower, kind, leader, token, zro, tokens) VALUES (?,?,?,?,?,?,?,?,?)`,
          args: [tx, idx, ts, lc(a.follower), kinds[e.name]!, a.leader ? lc(a.leader) : null, token, eth(zro), a.tokens ? eth(a.tokens) : 0],
        });
        pushed.push({ type: 'vault', data: { follower: lc(a.follower), kind: kinds[e.name], token } });
        break;
      }
      case 'Followed':
      case 'Unfollowed': {
        if (!dep?.copyVault || source !== dep.copyVault) break;
        const rules = e.args.rules ? JSON.stringify(e.args.rules, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) : null;
        statements.push({
          sql: `INSERT INTO vault_follows (follower, leader, rules, active, updated_at) VALUES (?,?,coalesce(?, '{}'),?,?)
                ON CONFLICT (follower, leader) DO UPDATE SET rules = coalesce(?, rules), active = excluded.active, updated_at = excluded.updated_at`,
          args: [lc(e.args.follower), lc(e.args.leader), rules, e.name === 'Followed' ? 1 : 0, ts, rules],
        });
        break;
      }
      case 'ExitSet': {
        if (!dep?.copyVault || source !== dep.copyVault) break;
        const x = e.args.exit;
        statements.push({
          sql: `INSERT INTO vault_exits (follower, take_profit_bps, stop_loss_bps, slippage_bps) VALUES (?,?,?,?)
                ON CONFLICT (follower) DO UPDATE SET take_profit_bps = excluded.take_profit_bps, stop_loss_bps = excluded.stop_loss_bps, slippage_bps = excluded.slippage_bps`,
          args: [lc(e.args.follower), Number(x.takeProfitBps), Number(x.stopLossBps), Number(x.slippageBps)],
        });
        break;
      }
      case 'Linked': {
        if (!dep?.referrals || source !== dep.referrals) break;
        statements.push({ sql: `INSERT OR IGNORE INTO referral_links (trader, referrer, ts) VALUES (?,?,?)`, args: [lc(e.args.trader), lc(e.args.referrer), ts] });
        break;
      }
      case 'Credited': {
        if (!dep?.referrals || source !== dep.referrals) break;
        statements.push({
          sql: `INSERT OR IGNORE INTO referral_credits (tx_hash, log_index, ts, trader, referrer, to_referrer, to_trader) VALUES (?,?,?,?,?,?,?)`,
          args: [tx, idx, ts, lc(e.args.trader), lc(e.args.referrer), eth(e.args.toReferrer), eth(e.args.toTrader)],
        });
        break;
      }
      case 'Claimed': {
        if (!dep?.referrals || source !== dep.referrals) break;
        statements.push({ sql: `INSERT OR IGNORE INTO referral_claims (tx_hash, log_index, ts, who, amount) VALUES (?,?,?,?,?)`, args: [tx, idx, ts, lc(e.args.who), eth(e.args.amount)] });
        break;
      }
      case 'Transfer': {
        const from = lc(e.args.from);
        const to = lc(e.args.to);
        const value = e.args.value as bigint;
        if (!known.has(source)) {
          if (from !== ZERO) break; // only a mint introduces a token: the rest would be every old token's history
          const insert = await probeToken(source, e.log.blockNumber!, tx, ts);
          if (!insert) break;
          statements.push(insert);
          known.set(source, String((insert as { args: unknown[] }).args[5]));
          pushed.push({ type: 'launch', data: { address: source, ts, external: true } });
        }
        // The creator handing coins to someone or burning them. Selling goes to a contract in NOT_HOLDERS and shows as a trade.
        const creator = known.get(source);
        if (creator && from === creator && from !== to && (to === ZERO || to === DEAD || !NOT_HOLDERS.has(to))) {
          if (!decimalsOf.has(source)) decimalsOf.set(source, Number((await one('SELECT decimals FROM tokens WHERE address = ?', [source]))?.decimals ?? 18));
          const kind = to === ZERO || to === DEAD ? 'burn' : 'transfer';
          statements.push({ sql: `INSERT OR IGNORE INTO dev_moves (tx_hash, log_index, ts, token, kind, to_addr, amount) VALUES (?,?,?,?,?,?,?)`, args: [tx, idx, ts, source, kind, to, eth(value, decimalsOf.get(source))] });
          pushed.push({ type: 'dev', data: { token: source, kind } });
        }
        // Wallet to wallet, which is how holders turn out to be one person. Trades go through a contract and aren't this.
        if (from !== to && !NOT_HOLDERS.has(from) && !NOT_HOLDERS.has(to) && from !== creator) {
          if (!decimalsOf.has(source)) decimalsOf.set(source, Number((await one('SELECT decimals FROM tokens WHERE address = ?', [source]))?.decimals ?? 18));
          statements.push({ sql: `INSERT OR IGNORE INTO transfers (tx_hash, log_index, ts, token, from_addr, to_addr, amount) VALUES (?,?,?,?,?,?,?)`, args: [tx, idx, ts, source, from, to, eth(value, decimalsOf.get(source))] });
        }
        if (!NOT_HOLDERS.has(from)) balanceDeltas.set(`${source}|${from}`, (balanceDeltas.get(`${source}|${from}`) ?? 0n) - value);
        if (!NOT_HOLDERS.has(to)) balanceDeltas.set(`${source}|${to}`, (balanceDeltas.get(`${source}|${to}`) ?? 0n) + value);
        break;
      }
    }
  }

  await batch(statements); // tokens must exist before decimals are read back below

  const balanceStatements: InStatement[] = [];
  for (const [key, delta] of balanceDeltas) {
    const [token, holder] = key.split('|') as [string, string];
    if (!decimalsOf.has(token)) {
      const row = await one('SELECT decimals FROM tokens WHERE address = ?', [token]);
      decimalsOf.set(token, Number(row?.decimals ?? 18));
    }
    const row = await one('SELECT wei FROM balances WHERE token = ? AND holder = ?', [token, holder]);
    const wei = BigInt(String(row?.wei ?? '0')) + delta;
    balanceStatements.push(
      wei <= 0n
        ? { sql: 'DELETE FROM balances WHERE token = ? AND holder = ?', args: [token, holder] }
        : {
            sql: `INSERT INTO balances (token, holder, wei, amount) VALUES (?,?,?,?) ON CONFLICT (token, holder) DO UPDATE SET wei = excluded.wei, amount = excluded.amount`,
            args: [token, holder, wei.toString(), eth(wei, decimalsOf.get(token))],
          },
    );
  }
  await batch(balanceStatements);

  if (!only) for (const p of pushed) bus.emit('event', p);
}

export const sync = { head: 0n, synced: 0n };

const putState = (key: string, value: string) => batch([{ sql: `INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, args: [key, value] }]);

/**
 * A launchpad added after the chain has moved on: its tokens may already be here as outside tokens, without their trades. This
 * reads its past once, beside the live feed, so adding one only ever takes its file. Progress is saved, so a restart carries on.
 */
async function catchUpPad(pad: Pad, upTo: bigint, start: bigint | null): Promise<void> {
  const key = `pad_synced:${pad.id}`;
  // Before its file existed its contract looked like any wallet: a holder of its tokens, and where their creators sent coins.
  const own = [pad.address, ...(pad.notHolders ?? []).map(lc)];
  const marks = own.map(() => '?').join(',');
  await batch([
    { sql: `UPDATE tokens SET launchpad = ? WHERE factory = ? AND launchpad IS NULL`, args: [pad.id, pad.address] },
    { sql: `DELETE FROM balances WHERE holder IN (${marks})`, args: own },
    { sql: `DELETE FROM dev_moves WHERE to_addr IN (${marks})`, args: own },
  ]);
  const saved = await getState(key);
  if (saved === 'done') return;
  let at = saved ? BigInt(saved) : BigInt(pad.startBlock ?? start ?? upTo) - 1n;
  log.info({ pad: pad.id, from: at.toString(), to: upTo.toString() }, 'reading a launchpad past');
  while (at < upTo) {
    const to = at + MAX_RANGE < upTo ? at + MAX_RANGE : upTo;
    try {
      await processRange(at + 1n, to, pad);
      await putState(key, to.toString());
      at = to;
    } catch (err) {
      log.warn({ pad: pad.id, err: (err as Error).message }, 'catching up failed, retrying');
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  await putState(key, 'done');
  log.info({ pad: pad.id }, 'launchpad caught up');
}

export async function syncLoop(): Promise<never> {
  const saved = await getState('last_block');
  const start = START_BLOCK ?? (DEPLOYMENT ? BigInt(DEPLOYMENT.startBlock) : null);
  let last = saved ? BigInt(saved) : start !== null ? start - 1n : null;
  log.info({ last: last?.toString(), tag: SYNC_TAG, deployment: Boolean(DEPLOYMENT), launchpads: [...PADS.values()].map((p) => p.id) }, 'sync starting');
  // On a new database the live feed reads every launchpad from the start anyway, so only one that exists needs this.
  for (const pad of PADS.values()) {
    if (saved) void catchUpPad(pad, BigInt(saved), start);
    else void putState(`pad_synced:${pad.id}`, 'done');
  }

  for (;;) {
    try {
      const head = (await client.getBlock({ blockTag: SYNC_TAG, includeTransactions: false })).number!;
      sync.head = head;
      if (last === null) last = head - 1n; // no deployment and no start block: follow the tip
      if (head < last) {
        // a local chain that was restarted: its old history is gone, and so is everything we derived from it
        log.error({ head: head.toString(), last: last.toString() }, 'chain is behind the database, delete the db file and restart');
      }
      while (last !== null && last < head) {
        const from: bigint = last + 1n;
        const to: bigint = last + MAX_RANGE < head ? last + MAX_RANGE : head;
        await processRange(from, to);
        await batch([{ sql: `INSERT INTO state (key, value) VALUES ('last_block', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, args: [to.toString()] }]);
        last = to;
        sync.synced = to;
      }
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'sync step failed, retrying');
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
