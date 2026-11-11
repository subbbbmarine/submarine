/**
 * What traders read before they buy, worked out from what the index already holds: who holds a token and how they came by
 * it, how a wallet trades, and which wallets keep getting in early. Everything here is a reading of trades, balances and
 * transfers, so a label means "behaves like", never more.
 */
import type { Row } from '@libsql/client';
import { all, one } from './db.js';

const now = () => Math.floor(Date.now() / 1000);
const inClause = (list: string[]) => list.map((a) => `'${a}'`).join(',');

/** A buy this soon after launch counts as a sniper's. About five blocks on Zero. */
export const SNIPE_SECONDS = 5;
const WHALE_SHARE = 0.02;
const FRESH_SECONDS = 3 * 86400;

export type Label = 'dev' | 'insider' | 'sniper' | 'bundle' | 'whale' | 'top10' | 'fresh' | 'smart' | 'bot' | 'cluster';

// ---------------------------------------------------------------- smart money, shared and refreshed once a minute

let smartAt = 0;
let smart = new Set<string>();
let bots = new Set<string>();

/**
 * Wallets with a real record over the last 30 days: at least five tokens traded, three in five of them closed or marked in
 * profit, and ahead overall. Bots are wallets trading hundreds of times a day.
 */
export async function walletClasses(): Promise<{ smart: Set<string>; bots: Set<string> }> {
  if (Date.now() - smartAt < 60_000) return { smart, bots };
  smartAt = Date.now();
  const since = now() - 30 * 86400;
  const rows = await all(
    `SELECT x.trader, x.token, t.price,
            sum(CASE WHEN x.is_buy = 1 THEN x.zro ELSE 0 END) AS spent,
            sum(CASE WHEN x.is_buy = 0 THEN x.zro ELSE 0 END) AS received,
            sum(CASE WHEN x.is_buy = 1 THEN x.amount ELSE -x.amount END) AS net
     FROM trades x JOIN tokens t ON t.address = x.token WHERE x.ts > ? GROUP BY x.trader, x.token`,
    [since],
  );
  const per = new Map<string, { tokens: number; wins: number; pnl: number }>();
  for (const r of rows) {
    const w = per.get(String(r.trader)) ?? { tokens: 0, wins: 0, pnl: 0 };
    const pnl = Number(r.received) - Number(r.spent) + Math.max(Number(r.net), 0) * Number(r.price);
    w.tokens += 1;
    w.pnl += pnl;
    if (pnl > 0) w.wins += 1;
    per.set(String(r.trader), w);
  }
  smart = new Set([...per].filter(([, w]) => w.tokens >= 5 && w.wins / w.tokens >= 0.6 && w.pnl > 0).map(([a]) => a));
  const busy = await all(`SELECT trader FROM trades WHERE ts > ? GROUP BY trader HAVING count(*) >= 300`, [now() - 86400]);
  bots = new Set(busy.map((r) => String(r.trader)));
  return { smart, bots };
}

// ---------------------------------------------------------------- a token's holders

export interface RiskRow {
  address: string;
  holders: number;
  top10: number;
  dev: number;
  insiders: number;
  snipers: number;
  bundles: number;
  fresh: number;
  smart_holders: number;
}

/** Shares of supply, 0 to 1. One query for a whole list, since every row of Pulse shows these. */
export async function riskOf(tokens: string[]): Promise<Map<string, RiskRow>> {
  const out = new Map<string, RiskRow>();
  if (!tokens.length) return out;
  const list = inClause(tokens);
  const rows = await all(
    `WITH t AS (SELECT address, creator, block, created_at, total_supply FROM tokens WHERE address IN (${list})),
          first AS (SELECT x.token, x.trader, min(x.ts) AS ts, min(x.block) AS block FROM trades x WHERE x.token IN (${list}) AND x.is_buy = 1 GROUP BY x.token, x.trader),
          seen AS (SELECT trader, min(ts) AS ts, count(DISTINCT token) AS tokens FROM trades WHERE trader IN (SELECT holder FROM balances WHERE token IN (${list})) GROUP BY trader),
          b AS (SELECT token, holder, amount, row_number() OVER (PARTITION BY token ORDER BY amount DESC) AS rk FROM balances WHERE token IN (${list}))
     SELECT t.address, t.total_supply AS supply,
            (SELECT count(*) FROM b WHERE b.token = t.address) AS holders,
            (SELECT coalesce(sum(amount), 0) FROM b WHERE b.token = t.address AND rk <= 10) AS top10,
            (SELECT coalesce(sum(amount), 0) FROM b WHERE b.token = t.address AND b.holder = t.creator) AS dev,
            (SELECT coalesce(sum(b.amount), 0) FROM b WHERE b.token = t.address AND b.holder IN (SELECT to_addr FROM dev_moves m WHERE m.token = t.address AND m.kind = 'transfer')) AS insiders,
            (SELECT coalesce(sum(b.amount), 0) FROM b JOIN first f ON f.token = b.token AND f.trader = b.holder
               WHERE b.token = t.address AND b.holder != coalesce(t.creator, '') AND f.ts - t.created_at <= ${SNIPE_SECONDS}) AS snipers,
            (SELECT coalesce(sum(b.amount), 0) FROM b JOIN first f ON f.token = b.token AND f.trader = b.holder
               WHERE b.token = t.address AND b.holder != coalesce(t.creator, '') AND f.block = t.block) AS bundles,
            (SELECT coalesce(sum(b.amount), 0) FROM b JOIN seen s ON s.trader = b.holder
               WHERE b.token = t.address AND s.ts > ${now() - FRESH_SECONDS} AND s.tokens <= 2) AS fresh
     FROM t`,
  );
  const { smart: smartSet } = await walletClasses();
  const holders = smartSet.size ? await all(`SELECT token, holder FROM balances WHERE token IN (${list}) AND holder IN (${inClause([...smartSet])})`) : [];
  const smartCount = new Map<string, number>();
  for (const h of holders) smartCount.set(String(h.token), (smartCount.get(String(h.token)) ?? 0) + 1);
  for (const r of rows) {
    const supply = Number(r.supply) || 1;
    const share = (v: unknown) => Math.min(Number(v) / supply, 1);
    out.set(String(r.address), {
      address: String(r.address),
      holders: Number(r.holders),
      top10: share(r.top10),
      dev: share(r.dev),
      insiders: share(r.insiders),
      snipers: share(r.snipers),
      bundles: share(r.bundles),
      fresh: share(r.fresh),
      smart_holders: smartCount.get(String(r.address)) ?? 0,
    });
  }
  return out;
}

interface TokenFacts {
  creator: string | null;
  block: number;
  created_at: number;
  supply: number;
  price: number;
}

async function factsOf(token: string): Promise<TokenFacts | null> {
  const t = await one(`SELECT creator, block, created_at, total_supply, price FROM tokens WHERE address = ?`, [token]);
  if (!t) return null;
  return { creator: t.creator ? String(t.creator) : null, block: Number(t.block), created_at: Number(t.created_at), supply: Number(t.total_supply) || 1, price: Number(t.price) };
}

/** Every trader of a token with what they put in, took out and still hold, oldest first. */
async function tradersOf(token: string): Promise<Row[]> {
  return all(
    `SELECT x.trader,
            min(CASE WHEN x.is_buy = 1 THEN x.ts END) AS first_buy, min(CASE WHEN x.is_buy = 1 THEN x.block END) AS first_block,
            max(x.ts) AS last_ts,
            sum(CASE WHEN x.is_buy = 1 THEN x.zro ELSE 0 END) AS spent,
            sum(CASE WHEN x.is_buy = 0 THEN x.zro ELSE 0 END) AS received,
            sum(CASE WHEN x.is_buy = 1 THEN x.amount ELSE 0 END) AS bought,
            sum(CASE WHEN x.is_buy = 0 THEN x.amount ELSE 0 END) AS sold,
            sum(x.is_buy = 1) AS buys, sum(x.is_buy = 0) AS sells,
            coalesce((SELECT amount FROM balances b WHERE b.token = x.token AND b.holder = x.trader), 0) AS held
     FROM trades x WHERE x.token = ? GROUP BY x.trader ORDER BY first_buy ASC`,
    [token],
  );
}

/** The labels a wallet earns on one token, from the facts already gathered for it. */
async function labeller(token: string, facts: TokenFacts) {
  const [linked, firstSeen, links] = await Promise.all([
    all(`SELECT DISTINCT to_addr FROM dev_moves WHERE token = ? AND kind = 'transfer'`, [token]),
    all(`SELECT trader, min(ts) AS ts, count(DISTINCT token) AS tokens FROM trades WHERE trader IN (SELECT trader FROM trades WHERE token = ?) GROUP BY trader`, [token]),
    all(`SELECT from_addr, to_addr FROM transfers WHERE token = ?`, [token]),
  ]);
  const insiders = new Set(linked.map((r) => String(r.to_addr)));
  const fresh = new Set(firstSeen.filter((r) => Number(r.ts) > now() - FRESH_SECONDS && Number(r.tokens) <= 2).map((r) => String(r.trader)));
  const clustered = new Set(links.flatMap((r) => [String(r.from_addr), String(r.to_addr)]));
  const { smart: smartSet, bots: botSet } = await walletClasses();
  return (wallet: string, firstBuy: number | null, firstBlock: number | null, held: number, rank: number | null): Label[] => {
    const out: Label[] = [];
    if (wallet === facts.creator) out.push('dev');
    if (insiders.has(wallet)) out.push('insider');
    if (wallet !== facts.creator && firstBuy !== null && firstBuy - facts.created_at <= SNIPE_SECONDS) out.push('sniper');
    if (wallet !== facts.creator && firstBlock !== null && firstBlock === facts.block) out.push('bundle');
    if (held / facts.supply >= WHALE_SHARE) out.push('whale');
    if (rank !== null && rank < 10) out.push('top10');
    if (fresh.has(wallet)) out.push('fresh');
    if (smartSet.has(wallet)) out.push('smart');
    if (botSet.has(wallet)) out.push('bot');
    if (clustered.has(wallet)) out.push('cluster');
    return out;
  };
}

/** Holders with their labels and record on this token, biggest first. */
export async function holdersOf(token: string, limit: number) {
  const facts = await factsOf(token);
  if (!facts) return null;
  const [balances, traders] = await Promise.all([all(`SELECT holder, amount FROM balances WHERE token = ? ORDER BY amount DESC LIMIT ?`, [token, limit]), tradersOf(token)]);
  const byTrader = new Map(traders.map((r) => [String(r.trader), r]));
  const label = await labeller(token, facts);
  return balances.map((b, i) => {
    const wallet = String(b.holder);
    const t = byTrader.get(wallet);
    const held = Number(b.amount);
    const spent = Number(t?.spent ?? 0);
    const received = Number(t?.received ?? 0);
    return {
      address: wallet,
      amount: held,
      share: held / facts.supply,
      spent,
      received,
      pnl: received + held * facts.price - spent,
      first_buy: t?.first_buy ? Number(t.first_buy) : null,
      labels: label(wallet, t?.first_buy ? Number(t.first_buy) : null, t?.first_block ? Number(t.first_block) : null, held, i),
    };
  });
}

/** Everyone who traded the token, ranked by profit marked to today's price. */
export async function topTraders(token: string, limit: number) {
  const facts = await factsOf(token);
  if (!facts) return null;
  const traders = await tradersOf(token);
  const label = await labeller(token, facts);
  return traders
    .map((t) => {
      const held = Number(t.held);
      const spent = Number(t.spent);
      const received = Number(t.received);
      return {
        address: String(t.trader),
        spent,
        received,
        held,
        realized: received - (Number(t.bought) > 0 ? (spent * Math.min(Number(t.sold), Number(t.bought))) / Number(t.bought) : 0),
        pnl: received + held * facts.price - spent,
        buys: Number(t.buys),
        sells: Number(t.sells),
        labels: label(String(t.trader), t.first_buy ? Number(t.first_buy) : null, t.first_block ? Number(t.first_block) : null, held, null),
      };
    })
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, limit);
}

/** The first buyers, in order, and what each has done since. */
export async function firstBuyers(token: string, limit = 70) {
  const facts = await factsOf(token);
  if (!facts) return null;
  const traders = (await tradersOf(token)).filter((t) => t.first_buy !== null).slice(0, limit);
  const label = await labeller(token, facts);
  const buyers = traders.map((t) => {
    const bought = Number(t.bought);
    const sold = Number(t.sold);
    const held = Number(t.held);
    const status = held <= 0 ? (sold > 0 ? 'sold_all' : 'transferred') : sold > 0 ? 'sold_part' : Number(t.buys) > 1 ? 'bought_more' : held < bought * 0.98 ? 'transferred' : 'holding';
    return {
      address: String(t.trader),
      first_buy: Number(t.first_buy),
      spent: Number(t.spent),
      bought,
      held,
      status,
      labels: label(String(t.trader), Number(t.first_buy), Number(t.first_block), held, null),
    };
  });
  const summary = {
    holding: buyers.filter((b) => b.status === 'holding' || b.status === 'bought_more').length,
    sold_part: buyers.filter((b) => b.status === 'sold_part').length,
    sold_all: buyers.filter((b) => b.status === 'sold_all').length,
    transferred: buyers.filter((b) => b.status === 'transferred').length,
    still_held: buyers.reduce((s, b) => s + b.held, 0) / facts.supply,
  };
  return { buyers, summary };
}

/** The holders' map: the biggest holders, the transfers between them, and which ones are really one cluster. */
export async function clustersOf(token: string, limit = 60) {
  const facts = await factsOf(token);
  if (!facts) return null;
  const holders = await all(`SELECT holder, amount FROM balances WHERE token = ? ORDER BY amount DESC LIMIT ?`, [token, limit]);
  const inMap = new Set(holders.map((h) => String(h.holder)));
  if (facts.creator) inMap.add(facts.creator);
  const edges = (
    await all(
      `SELECT from_addr AS a, to_addr AS b, sum(amount) AS amount FROM transfers WHERE token = :t GROUP BY from_addr, to_addr
       UNION ALL SELECT :c AS a, to_addr AS b, sum(amount) AS amount FROM dev_moves WHERE token = :t AND kind = 'transfer' GROUP BY to_addr`,
      { t: token, c: facts.creator ?? '' },
    )
  )
    .map((r) => ({ from: String(r.a), to: String(r.b), amount: Number(r.amount) }))
    .filter((e) => e.from && inMap.has(e.from) && inMap.has(e.to));
  // Union-find over the transfers: wallets passing coins between them end up in one cluster.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  for (const e of edges) parent.set(find(e.from), find(e.to));
  const label = await labeller(token, facts);
  const nodes = holders.map((h, i) => {
    const address = String(h.holder);
    const amount = Number(h.amount);
    return { address, amount, share: amount / facts.supply, cluster: find(address), labels: label(address, null, null, amount, i) };
  });
  const clusters = new Map<string, { id: string; wallets: number; share: number }>();
  for (const n of nodes) {
    const c = clusters.get(n.cluster) ?? { id: n.cluster, wallets: 0, share: 0 };
    c.wallets += 1;
    c.share += n.share;
    clusters.set(n.cluster, c);
  }
  return { nodes, edges, clusters: [...clusters.values()].filter((c) => c.wallets > 1).sort((a, b) => b.share - a.share) };
}

// ---------------------------------------------------------------- wallets

/** A wallet over 7 or 30 days: results, how long it holds, what size it buys at, and anything that looks off. */
export async function walletRecord(wallet: string, days: number) {
  const since = now() - days * 86400;
  const rows = await all(
    `SELECT x.token, t.price, t.symbol,
            sum(CASE WHEN x.is_buy = 1 THEN x.zro ELSE 0 END) AS spent,
            sum(CASE WHEN x.is_buy = 0 THEN x.zro ELSE 0 END) AS received,
            sum(CASE WHEN x.is_buy = 1 THEN x.amount ELSE 0 END) AS bought,
            sum(CASE WHEN x.is_buy = 0 THEN x.amount ELSE 0 END) AS sold,
            min(CASE WHEN x.is_buy = 1 THEN x.ts END) AS first_buy, max(CASE WHEN x.is_buy = 0 THEN x.ts END) AS last_sell,
            coalesce((SELECT amount FROM balances b WHERE b.token = x.token AND b.holder = x.trader), 0) AS held
     FROM trades x JOIN tokens t ON t.address = x.token WHERE x.trader = ? AND x.ts > ? GROUP BY x.token`,
    [wallet, since],
  );
  const buys = await all(`SELECT zro, ts, token FROM trades WHERE trader = ? AND is_buy = 1 AND ts > ?`, [wallet, since]);
  const sells = await all(`SELECT ts, token FROM trades WHERE trader = ? AND is_buy = 0 AND ts > ?`, [wallet, since]);
  let pnl = 0;
  let realized = 0;
  let spent = 0;
  let wins = 0;
  let closed = 0;
  let holdSeconds = 0;
  let soldMoreThanBought = 0;
  const tokens = rows.map((r) => {
    const value = Number(r.held) * Number(r.price);
    const result = Number(r.received) + value - Number(r.spent);
    pnl += result;
    spent += Number(r.spent);
    if (result > 0) wins += 1;
    if (Number(r.held) === 0 && r.first_buy && r.last_sell) {
      closed += 1;
      realized += result;
      holdSeconds += Number(r.last_sell) - Number(r.first_buy);
    }
    if (Number(r.sold) > Number(r.bought) * 1.001) soldMoreThanBought += 1;
    return { token: String(r.token), symbol: String(r.symbol), spent: Number(r.spent), received: Number(r.received), value, pnl: result };
  });
  const sizes = { under_0_01: 0, to_0_1: 0, to_1: 0, over_1: 0 };
  for (const b of buys) {
    const v = Number(b.zro);
    // Buckets in ZRO. The keys keep their old names, since the API returns them.
    if (v < 5) sizes.under_0_01 += 1;
    else if (v < 50) sizes.to_0_1 += 1;
    else if (v < 500) sizes.to_1 += 1;
    else sizes.over_1 += 1;
  }
  // A buy and a sale of the same token within ten seconds.
  const firstBuyOf = new Map<string, number>();
  for (const b of buys) firstBuyOf.set(String(b.token), Math.min(firstBuyOf.get(String(b.token)) ?? Infinity, Number(b.ts)));
  const flips = sells.filter((s) => Number(s.ts) - (firstBuyOf.get(String(s.token)) ?? -Infinity) <= 10).length;
  const { smart: smartSet, bots: botSet } = await walletClasses();
  return {
    days,
    pnl,
    realized,
    spent,
    roi: spent > 0 ? pnl / spent : 0,
    tokens: tokens.length,
    wins,
    win_rate: tokens.length ? wins / tokens.length : 0,
    avg_hold_seconds: closed ? holdSeconds / closed : 0,
    sizes,
    flags: { sold_more_than_bought: soldMoreThanBought, quick_flips: flips },
    labels: [...(smartSet.has(wallet) ? ['smart'] : []), ...(botSet.has(wallet) ? ['bot'] : [])],
    best: tokens.sort((a, b) => b.pnl - a.pnl).slice(0, 5),
  };
}

/**
 * Wallets that got in early on several of the given tokens: among the first `early` buyers of at least two. The ones that
 * also made money on them are the ones worth following.
 */
export async function radar(tokens: string[], early = 30) {
  if (!tokens.length) return [];
  const hits = new Map<string, { address: string; tokens: string[]; spent: number; pnl: number; earliest: number }>();
  for (const token of tokens) {
    const facts = await factsOf(token);
    if (!facts) continue;
    const traders = (await tradersOf(token)).filter((t) => t.first_buy !== null && String(t.trader) !== facts.creator).slice(0, early);
    for (const t of traders) {
      const address = String(t.trader);
      const h = hits.get(address) ?? { address, tokens: [], spent: 0, pnl: 0, earliest: Infinity };
      h.tokens.push(token);
      h.spent += Number(t.spent);
      h.pnl += Number(t.received) + Number(t.held) * facts.price - Number(t.spent);
      h.earliest = Math.min(h.earliest, Number(t.first_buy) - facts.created_at);
      hits.set(address, h);
    }
  }
  return [...hits.values()].filter((h) => h.tokens.length >= 2).sort((a, b) => b.tokens.length - a.tokens.length || b.pnl - a.pnl).slice(0, 50);
}

/** What a list of wallets put into each token over a window, and where several of them went in together. */
export async function inflow(wallets: string[], seconds: number) {
  if (!wallets.length) return { tokens: [] };
  const rows = await all(
    `SELECT x.token, t.symbol, t.name, t.uri, t.price, t.total_supply,
            sum(CASE WHEN x.is_buy = 1 THEN x.zro ELSE 0 END) AS bought, sum(CASE WHEN x.is_buy = 0 THEN x.zro ELSE 0 END) AS sold,
            count(DISTINCT CASE WHEN x.is_buy = 1 THEN x.trader END) AS buyers, group_concat(DISTINCT x.trader) AS wallets, max(x.ts) AS last_ts
     FROM trades x JOIN tokens t ON t.address = x.token WHERE x.trader IN (${inClause(wallets)}) AND x.ts > ? GROUP BY x.token ORDER BY bought - sold DESC LIMIT 50`,
    [now() - seconds],
  );
  return {
    tokens: rows.map((r) => ({
      token: String(r.token),
      symbol: String(r.symbol),
      name: String(r.name),
      uri: r.uri ? String(r.uri) : null,
      market_cap: Number(r.price) * Number(r.total_supply),
      bought: Number(r.bought),
      sold: Number(r.sold),
      net: Number(r.bought) - Number(r.sold),
      buyers: Number(r.buyers),
      wallets: String(r.wallets ?? '').split(',').filter(Boolean),
      together: Number(r.buyers) >= 2,
      last_ts: Number(r.last_ts),
    })),
  };
}

/** The highest price a token has traded at, and when. */
export async function allTimeHigh(token: string) {
  const r = await one(`SELECT price, ts FROM trades WHERE token = ? ORDER BY price DESC LIMIT 1`, [token]);
  return r ? { price: Number(r.price), ts: Number(r.ts) } : null;
}
