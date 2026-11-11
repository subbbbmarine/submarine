import type { FastifyInstance } from 'fastify';
import { DEPLOYMENT } from './config.js';
import { all, db } from './db.js';

/**
 * Points toward a future airdrop, counted from what's already on the chain. Nothing to sign up for and nothing to connect:
 * any address can be looked up. The rules are all here, in one place, so they can be read and changed together.
 *
 * - Trading through the terminal: every ZRO of volume, buys and sales, through our router, on any venue it reaches.
 * - Launching: every ZRO other wallets trade on a coin you launched here.
 * - Trading elsewhere on Zero: every ZRO on another launchpad, straight on it, not through us. Worth less, so trading here
 *   pays more, and anyone already trading on the chain starts with something.
 * - Points go live once a wallet has traded MIN_VOLUME through the terminal.
 *
 * Amounts are in ZRO, in whole points per ZRO: trading here counts twice what trading elsewhere does, and ten times your coins.
 */
export const POINTS = {
  perZroTraded: 10,
  perZroOnYourCoins: 1,
  perZroElsewhere: 5,
  minVolume: 40,
} as const;

export async function pointsSchema(): Promise<void> {
  // What the router credited, one row per routed trade. The same volume the contract keeps for ranks.
  await db.execute(`CREATE TABLE IF NOT EXISTS routed (
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    token TEXT NOT NULL,
    trader TEXT NOT NULL,
    is_buy INTEGER NOT NULL,
    zro REAL NOT NULL,
    PRIMARY KEY (tx_hash, log_index)
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS routed_trader ON routed(trader)`);
}

interface Score {
  address: string;
  points: number;
  traded: number;
  onCoins: number;
  elsewhere: number;
  live: boolean;
}

/** Our own contracts trade for people; their volume is the people's, so they never score themselves. */
const contracts = () =>
  new Set(
    DEPLOYMENT
      ? [DEPLOYMENT.router, DEPLOYMENT.limitOrders, DEPLOYMENT.vault, DEPLOYMENT.launchpad, DEPLOYMENT.pools, DEPLOYMENT.poolVenue, DEPLOYMENT.infinityVault, DEPLOYMENT.copyVault]
          .filter(Boolean)
          .map((a) => String(a).toLowerCase())
      : [],
  );

let cache: { at: number; list: Score[] } | null = null;

/** Every wallet's score, worked out at most every half minute: a page of the leaderboard and a lookup share it. */
async function scores(): Promise<Score[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.list;
  const [traded, onCoins, elsewhere] = await Promise.all([
    all(`SELECT trader AS who, sum(zro) AS v FROM routed GROUP BY trader`),
    all(
      `SELECT t.creator AS who, sum(x.zro) AS v FROM trades x JOIN tokens t ON t.address = x.token
       WHERE t.source = 'terminal' AND t.creator IS NOT NULL AND x.trader != t.creator GROUP BY t.creator`,
    ),
    all(
      `SELECT x.trader AS who, sum(x.zro) AS v FROM trades x JOIN tokens t ON t.address = x.token
       WHERE t.source != 'terminal' AND NOT EXISTS (SELECT 1 FROM routed r WHERE r.tx_hash = x.tx_hash) GROUP BY x.trader`,
    ),
  ]);
  const skip = contracts();
  const by = new Map<string, Score>();
  const at = (who: string) => {
    let s = by.get(who);
    if (!s) by.set(who, (s = { address: who, points: 0, traded: 0, onCoins: 0, elsewhere: 0, live: false }));
    return s;
  };
  for (const r of traded) if (!skip.has(String(r.who))) at(String(r.who)).traded = Number(r.v);
  for (const r of onCoins) if (!skip.has(String(r.who))) at(String(r.who)).onCoins = Number(r.v);
  for (const r of elsewhere) if (!skip.has(String(r.who))) at(String(r.who)).elsewhere = Number(r.v);
  for (const s of by.values()) {
    s.live = s.traded >= POINTS.minVolume;
    s.points = Math.round(s.traded * POINTS.perZroTraded + s.onCoins * POINTS.perZroOnYourCoins + s.elsewhere * POINTS.perZroElsewhere);
  }
  const list = [...by.values()].sort((a, b) => b.points - a.points);
  cache = { at: Date.now(), list };
  return list;
}

export function pointsRoutes(app: FastifyInstance): void {
  app.get('/api/v1/points/rules', async () => ({ rules: POINTS }));

  app.get('/api/v1/points/leaders', async (req) => {
    const limit = Math.min(Math.max(Number((req.query as { limit?: string }).limit) || 50, 1), 200);
    const list = await scores();
    const live = list.filter((s) => s.live);
    const total = live.reduce((a, s) => a + s.points, 0);
    return { total, wallets: live.length, leaders: live.slice(0, limit).map((s, i) => ({ ...s, place: i + 1 })) };
  });

  app.get('/api/v1/points/:address', async (req, reply) => {
    const address = String((req.params as { address: string }).address).toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) return reply.code(400).send({ error: 'Not an address' });
    const list = await scores();
    const live = list.filter((s) => s.live);
    const total = live.reduce((a, s) => a + s.points, 0);
    const mine = list.find((s) => s.address === address) ?? { address, points: 0, traded: 0, onCoins: 0, elsewhere: 0, live: false };
    const place = mine.live ? live.findIndex((s) => s.address === address) + 1 : null;
    return { ...mine, place, wallets: live.length, total, share: mine.live && total > 0 ? mine.points / total : 0, rules: POINTS };
  });
}
