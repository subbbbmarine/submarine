import { parseAbi, type Address } from 'viem';

// Zero's chain ID and RPC aren't public yet, so with nothing set this runs against the local demo chain.
export const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '31337');
/** Goes through our own /api/rpc by default, so a node that refuses browser requests still works. See that route. */
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || '/api/rpc';
/** Zero has no public WebSocket yet: off the local chain an empty value means the site reads over HTTP only. */
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? (process.env.NEXT_PUBLIC_CHAIN_ID && process.env.NEXT_PUBLIC_CHAIN_ID !== '31337' ? '' : 'ws://127.0.0.1:8546');
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3011';
export const IS_LOCAL = CHAIN_ID === 31337;

export const chain = {
  id: CHAIN_ID,
  name: IS_LOCAL ? 'Local' : 'Zero',
  nativeCurrency: { name: 'ZRO', symbol: 'ZRO', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;

export interface Deployment {
  vault: Address;
  pools: Address;
  infinityVault?: Address;
  poolVenue?: Address;
  poolManager?: Address;
  launchpad: Address;
  router: Address;
  limitOrders: Address;
  referrals?: Address;
  copyVault?: Address;
  agentVaultFactory?: Address;
}

/** Mirrors Launchpad.sol: every token's curve, whatever supply its creator chose, as shares of that supply and ZRO. */
export const CURVE = { raiseTarget: 6_000, virtualZro: 2_000, curveShare: 0.8, lpShare: 0.2, virtualShare: 16 / 15, supply: 1_000_000_000 };
/** Where every token opens and where it moves to a pool, in ZRO of market cap. The supply doesn't change these. */
export const OPENING_CAP = CURVE.virtualZro / CURVE.virtualShare;
export const POOL_CAP = CURVE.raiseTarget / CURVE.lpShare;

/**
 * Mirrors Launchpad.sol: every token pays the same 1% base, 0.4% to the terminal and 0.6% to its creator, on the curve and on
 * its Infinity pool. On top, the creator can add a fee of their own, up to 10%, and split it between themselves, the holders
 * and buying back and burning.
 */
export const BASE_FEE_BPS = 100;
export const TREASURY_BPS = 40;
export const CREATOR_BASE_BPS = 60;
export const DEV_FEE_CHOICES = [0, 100, 200, 300, 500, 1000];

/**
 * Mirrors Router.sol: volume through the terminal, in ZRO, for good, and past each mark the terminal's cut on a wallet's trades
 * gets smaller. The names are the site's own.
 */
export const RANKS = [
  { name: 'Starter', from: 0, offBps: 0 },
  { name: 'Trader', from: 2_000, offBps: 5 },
  { name: 'Regular', from: 10_000, offBps: 10 },
  { name: 'Pro', from: 40_000, offBps: 15 },
  { name: 'Whale', from: 200_000, offBps: 20 },
  { name: 'Legend', from: 1_000_000, offBps: 25 },
] as const;

/**
 * Where each trade's fee goes on a token of ours, in percent of the trade: the base's two parts, then the creator's own fee
 * as they split it. Holders' and the buyback's shares are of the creator's own fee only.
 */
export function feeParts(feeBps: number, holdersBps = 0, burnBps = 0) {
  const own = Math.max(feeBps - BASE_FEE_BPS, 0) / 100;
  const holders = (own * holdersBps) / 10_000;
  const burn = (own * burnBps) / 10_000;
  return { terminal: TREASURY_BPS / 100, creator: CREATOR_BASE_BPS / 100 + own - holders - burn, holders, burn, own, total: feeBps / 100 };
}

/** A percent for a fee, without trailing zeros: 0.6, 1, 2.5. */
export const pctOf = (n: number) => `${Number(n.toFixed(2))}%`;

/** A wallet's rank by its volume in ZRO, and the next mark if there is one. */
export function rankFor(volume: number) {
  let i = 0;
  for (let r = RANKS.length - 1; r > 0; r--) {
    if (volume >= RANKS[r]!.from) {
      i = r;
      break;
    }
  }
  return { index: i, rank: RANKS[i]!, next: RANKS[i + 1] ?? null, feeBps: TREASURY_BPS - RANKS[i]!.offBps };
}
export const SUPPLY_CHOICES = [
  { whole: 1_000_000_000, label: '1B' },
  { whole: 10_000_000_000, label: '10B' },
  { whole: 100_000_000_000, label: '100B' },
  { whole: 1_000_000_000_000, label: '1T' },
];
export const SUPPLY_MIN = 1_000_000_000;
export const SUPPLY_MAX = 1_000_000_000_000_000;
/** With anti-snipe on, a buy pays this at launch, falling in a straight line to the token's own fee. */
export const SNIPE_START_BPS = 5000;
export const SNIPE_SECONDS = 60;

/** What a buy on a curve pays right now, as a fraction. */
export function buyFeeNow(feeBps: number, antiSnipe: boolean, createdAt: number, nowSeconds = Date.now() / 1000): number {
  const elapsed = nowSeconds - createdAt;
  if (!antiSnipe || elapsed >= SNIPE_SECONDS) return feeBps / 10_000;
  return (SNIPE_START_BPS - ((SNIPE_START_BPS - feeBps) * Math.max(elapsed, 0)) / SNIPE_SECONDS) / 10_000;
}

export const ROUTER_ABI = parseAbi([
  'function quoteBuy(address token, uint256 zroIn) view returns (uint256)',
  'function quoteSell(address token, uint256 tokensIn) view returns (uint256)',
  'function buy(address token, uint256 minOut, address recipient, uint256 deadline) payable returns (uint256)',
  'function sell(address token, uint256 tokensIn, uint256 minOut, address recipient, uint256 deadline) returns (uint256)',
  // Our limit orders and copy vault trade for their users through these, so the volume and rank are the user's.
  'function buyFor(address token, uint256 minOut, address recipient, uint256 deadline, address trader) payable returns (uint256)',
  'function sellFor(address token, uint256 tokensIn, uint256 minOut, address recipient, uint256 deadline, address trader) returns (uint256)',
  'function volumeOf(address trader) view returns (uint256)',
  'function rankOf(address trader) view returns (uint256)',
  'function rankAt(uint256 rank) view returns (uint256 volume, uint256 offBps)',
  'function discountOf(address trader) view returns (uint256)',
  'event RankUp(address indexed trader, uint256 rank, uint256 volume)',
]);

export const LAUNCHPAD_ABI = parseAbi([
  'function launch(string name, string symbol, string uri, uint256 minTokensOut, uint256 wholeSupply, uint16 devFeeBps, uint16 holdersBps, uint16 burnBps, bool antiSnipe) payable returns (address)',
  'function launchFee() view returns (uint256)',
  'function curves(address) view returns (address creator, uint40 createdAt, bool graduated, uint16 feeBps, uint16 holdersBps, uint16 burnBps, bool antiSnipe, uint128 raised, uint128 sold, uint128 supply, uint16 protocolBps)',
  'function quoteBuy(address token, uint256 zroIn) view returns (uint256)',
  'function buyFeeBpsFor(address token, address trader) view returns (uint256)',
  'function creatorFees(address) view returns (uint256)',
  'function claimCreatorFees()',
  'event TokenLaunched(address indexed token, address indexed creator, string name, string symbol, string uri, uint256 timestamp, uint256 supply, uint16 feeBps, uint16 holdersBps, uint16 burnBps, bool antiSnipe)',
]);

/** A token that pays its holders. */
export const HOLDER_TOKEN_ABI = parseAbi(['function rewardOf(address who) view returns (uint256)', 'function claim()']);

export const LIMITS_ABI = parseAbi([
  'function placeBuy(address token, uint256 minOut, uint40 expiry) payable returns (uint256)',
  'function placeBuyIf(address token, uint256 minOut, uint40 expiry, uint8 kind, uint32 interval, uint16 slices) payable returns (uint256)',
  'function placeSell(address token, uint256 amount, uint256 minOut, uint40 expiry) returns (uint256)',
  'function placeSellLegs(address token, uint256 amount, uint40 expiry, (uint8 kind, uint128 share, uint128 minOut, uint128 trigger, uint16 trailBps)[] legs) returns (uint256)',
  'function cancel(uint256 id)',
  'function runFee() view returns (uint256)',
  'function available(uint256 id) view returns (uint256)',
  'function groupLeft(uint256 head) view returns (uint256)',
  'function credit(address owner) view returns (uint256)',
  'function withdraw(address to)',
]);

/** LimitOrders.sol's order kinds, by number. */
export const ORDER_KIND = { limit: 0, stop: 1, trailing: 2, onGraduation: 3, onDevSell: 4, dca: 5 } as const;

export const REFERRALS_ABI = parseAbi([
  'function link(address referrer)',
  'function referrerOf(address trader) view returns (address)',
  'function earned(address who) view returns (uint256)',
  'function referredCount(address who) view returns (uint256)',
  'function claim()',
]);

/** A follower's limits for one leader, as CopyVault.Rules. */
export const COPY_RULES = '(uint128 perTrade, uint128 perToken, uint128 perDay, uint16 sizeBps, uint16 slippageBps, uint16 chaseBps, uint16 minSellBps, bool buyOnce, bool copySells, uint32 maxAge)';
export const COPY_VAULT_ABI = parseAbi([
  'function deposit() payable',
  'function withdraw(uint256 amount, address to)',
  `function follow(address leader, ${COPY_RULES} rules)`,
  'function unfollow(address leader)',
  'function setExit((uint16 takeProfitBps, uint16 stopLossBps, uint16 slippageBps) rules)',
  'function sell(address token, uint256 tokens, uint256 minOut) returns (uint256)',
  'function withdrawTokens(address token, uint256 tokens, address to)',
  'function balanceOf(address follower) view returns (uint256)',
  'function positions(address follower, address token) view returns (uint128 tokens, uint128 cost)',
  'function exits(address follower) view returns (uint16 takeProfitBps, uint16 stopLossBps, uint16 slippageBps)',
  'function RUN_FEE() view returns (uint256)',
]);

/** The Infinity hook's views: the pool as reserves, and its price. Trades go through the router. */
export const POOLS_ABI = parseAbi([
  'function pools(address token) view returns (uint256 reserveZro, uint256 reserveToken, uint256 totalShares)',
  'function priceOf(address token) view returns (uint256)',
  'function pending(address token) view returns (uint256)',
]);

export const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);
