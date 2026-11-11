import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const CHAIN_ID = parseInt(process.env.CHAIN_ID || '31337');
export const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8546';

export interface Deployment {
  chainId: number;
  startBlock: number;
  vault: `0x${string}`;
  /** The Infinity hook: it opens each graduated token's pool and reports its trades, fees and burns. */
  pools: `0x${string}`;
  /** Infinity's vault, where every pool's ZRO and tokens sit, and the venue the router trades the pools through. */
  infinityVault?: `0x${string}`;
  poolVenue?: `0x${string}`;
  poolManager?: `0x${string}`;
  launchpad: `0x${string}`;
  router: `0x${string}`;
  limitOrders: `0x${string}`;
  referrals?: `0x${string}`;
  copyVault?: `0x${string}`;
}

/** Addresses come from the deploy script's output. Without one the indexer still discovers tokens, it just can't price them. */
function loadDeployment(): Deployment | null {
  const file = resolve(here, `../../contracts/deployments/${CHAIN_ID}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Deployment) : null;
}
export const DEPLOYMENT = loadDeployment();

/** How one of a launchpad's events reads: its signature, and which of its fields means what. See launchpads/README.md. */
export interface PadEvent {
  event: string;
  token: string;
  trader?: string;
  creator?: string;
  uri?: string;
  zro?: string;
  tokens?: string;
  isBuy?: string;
  raised?: string;
  reserveZro?: string;
  reserveToken?: string;
}
export interface Launchpad {
  id: string;
  name: string;
  chainId: number;
  contract: `0x${string}`;
  startBlock?: number;
  /** Other contracts of theirs that hold tokens without being holders in any useful sense. */
  notHolders?: string[];
  curve?: { target?: number };
  events?: { created?: PadEvent; buy?: PadEvent; sell?: PadEvent; trade?: PadEvent; graduated?: PadEvent };
  /** The rest, launching and trading, is read by the site. */
  [other: string]: unknown;
}

/** Every launchpad this terminal knows, one file each, for this chain. A broken file is skipped and said so, and nothing else stops. */
function loadLaunchpads(): Launchpad[] {
  const dir = process.env.LAUNCHPADS_DIR || resolve(here, '../../launchpads');
  if (!existsSync(dir)) return [];
  const out = new Map<string, Launchpad>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    try {
      const pad = JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as Launchpad;
      if (!pad.id || !pad.name || !/^0x[0-9a-fA-F]{40}$/.test(pad.contract ?? '')) throw new Error('needs id, name and contract');
      if (pad.chainId !== CHAIN_ID) continue;
      if (out.has(pad.id) || pad.id === 'terminal') throw new Error(`the id ${pad.id} is taken`);
      out.set(pad.id, pad);
    } catch (err) {
      console.warn(`launchpads/${file} skipped: ${(err as Error).message}`);
    }
  }
  return [...out.values()];
}
export const LAUNCHPADS = loadLaunchpads();

export const DB_PATH = process.env.DB_PATH || resolve(here, `../data/indexer-${CHAIN_ID}.db`);
/** Token pictures and descriptions, which outlive the database: they can't be read back from the chain. */
export const META_DIR = resolve(dirname(DB_PATH), 'meta');
/** Where this API is reached from outside, which is what a saved picture's address starts with. */
export const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');
export const POLL_MS = parseInt(process.env.POLL_INTERVAL_MS || '250');
/** Log queries go 1000 blocks at a time, which every node we've met accepts. */
export const MAX_RANGE = 1000n;
/**
 * Which tip to follow. `finalized` can't reorg, and on a fast chain it is only seconds behind, so the feed never has to undo
 * anything. A local chain has no real finality, so it follows `latest`.
 */
export const SYNC_TAG = (process.env.SYNC_TAG || 'finalized') as 'finalized' | 'latest';
export const START_BLOCK = process.env.START_BLOCK ? BigInt(process.env.START_BLOCK) : null;

/** Contracts whose tokens aren't listed, such as our own throwaway test deployments. A comma list. */
export const IGNORED_FACTORIES = new Set((process.env.IGNORE_FACTORIES || '').toLowerCase().split(',').filter(Boolean));

export const PORT = parseInt(process.env.PORT || '3011');
export const HOST = process.env.HOST || '127.0.0.1';
export const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3010';

/**
 * What an order's minimum allows for: the trade fee and LimitOrders.runFee. The site builds the minimum from the level the
 * same way, in web/src/lib/config.ts, and these undo it. The owner can change either fee, which would only shift how old orders read.
 */
export const LIMIT_FEES = { run: 0.04 };

/** Mirrors Launchpad.sol. The numbers are constants there too, so these can't drift for a given deployment. */
export const CURVE = {
  virtualZro: 2_000,
  raiseTarget: 6_000,
  supply: 1_000_000_000,
};
