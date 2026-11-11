import type { Deployment } from '@/lib/config';

/**
 * Submarine's contracts on Zero. They are not deployed yet, so this is empty. Fill it in from contracts/deployments/<chain id>.json
 * at launch. The live list on the addresses page replaces it once the API answers with a Zero deployment.
 */
export const ZERO_DEPLOYMENT: (Deployment & { startBlock: number }) | null = null;

/** A test chain an earlier build ran on. An API that still answers for it is not Submarine on Zero, so the docs never show its addresses. */
export const OLD_CHAIN_ID = 1105;

/**
 * Zero's testnet as LayerZero's own chain list gives it (chain key zeroatlas-testnet). The RPC only answers builders LayerZero
 * has let in. Mainnet has no public RPC yet. The API's address comes with Submarine's deployment.
 */
export const ZERO_RPC = 'https://testnet.zero.layerzero.network';
export const ZERO_CHAIN_ID = '1337';
export const SUBMARINE_API = '<Submarine API URL>';
