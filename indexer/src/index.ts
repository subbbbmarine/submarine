import { pino } from 'pino';
import { build } from './api.js';
import { sync, syncLoop } from './chain.js';
import { CHAIN_ID, DB_PATH, DEPLOYMENT, HOST, PORT, RPC_URL } from './config.js';
import { all, initSchema } from './db.js';
import { sweepMeta } from './meta.js';
import { profileSchema } from './profiles.js';
import { pointsSchema } from './points.js';
import { startPriceFeed } from './price.js';

const log = pino({ level: 'info' });

/** Pictures saved for a launch that never came. Skipped while catching up, when not every token that uses one is known yet. */
async function sweep(): Promise<void> {
  if (sync.head === 0n || sync.head - sync.synced > 100n) return;
  // Profile pictures are kept like a launched token's: they're in use for as long as the profile names them.
  const rows = await all(`SELECT uri FROM tokens WHERE uri IS NOT NULL UNION SELECT image AS uri FROM profiles WHERE image IS NOT NULL`);
  const removed = sweepMeta(rows.map((r) => String(r.uri)));
  if (removed) log.info({ removed }, 'removed saved files no launch used');
}

async function main(): Promise<void> {
  await initSchema();
  await profileSchema();
  await pointsSchema();
  startPriceFeed();
  const api = await build();
  await api.listen({ port: PORT, host: HOST });
  log.info({ port: PORT, chainId: CHAIN_ID, rpc: RPC_URL, db: DB_PATH, deployed: Boolean(DEPLOYMENT) }, 'indexer up');
  setInterval(() => void sweep().catch((err) => log.warn({ err }, 'sweep failed')), 3_600_000);
  await syncLoop();
}

main().catch((err) => {
  log.fatal({ err }, 'fatal');
  process.exit(1);
});
