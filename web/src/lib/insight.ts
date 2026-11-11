// What the indexer works out about tokens and wallets: Pulse's columns with their risk figures, trending, labelled holders,
// top traders, the first buyers, holder clusters, a token's security, wallet records, the radar, inflow, referrals and the
// copy vault. Types mirror indexer/src/insight.ts and traderRoutes.ts.
import { get, type Token } from './api';

export type Label = 'dev' | 'insider' | 'sniper' | 'bundle' | 'whale' | 'top10' | 'fresh' | 'smart' | 'bot' | 'cluster';

export const LABEL_NAMES: Record<Label, { short: string; long: string }> = {
  dev: { short: 'Dev', long: 'Created this token' },
  insider: { short: 'Insider', long: 'Got coins straight from the dev' },
  sniper: { short: 'Sniper', long: 'Bought in the first 5 seconds' },
  bundle: { short: 'Bundle', long: 'Bought in the launch block' },
  whale: { short: 'Whale', long: 'Holds 2% or more of the supply' },
  top10: { short: 'Top 10', long: 'One of the ten biggest holders' },
  fresh: { short: 'New', long: 'First seen in the last 3 days, on 2 tokens or fewer' },
  smart: { short: 'Smart', long: 'Ahead over 30 days, with 3 in 5 tokens in profit' },
  bot: { short: 'Bot', long: '300 or more trades in a day' },
  cluster: { short: 'Linked', long: 'Passed coins to or from another holder' },
};

/** Shares of supply, 0 to 1. */
export interface Risk {
  holders: number;
  top10: number;
  dev: number;
  insiders: number;
  snipers: number;
  bundles: number;
  fresh: number;
  smart_holders: number;
}

export type RiskyToken = Token & { risk: Risk | null; change_24h?: number; volume_24h?: number; trades_24h?: number };
export type TrendingToken = RiskyToken & { window_volume: number; window_trades: number; window_buyers: number; window_change: number };

export type PulseColumn = 'new' | 'near' | 'migrated';
/** Every filter is optional. Ages in seconds, market cap and volume in ZRO, shares from 0 to 1. */
export interface PulseFilter {
  min_age?: number;
  max_age?: number;
  min_mcap?: number;
  max_mcap?: number;
  min_volume?: number;
  min_holders?: number;
  max_holders?: number;
  min_progress?: number;
  max_progress?: number;
  max_dev?: number;
  max_top10?: number;
  max_snipers?: number;
  max_bundles?: number;
  max_insiders?: number;
  min_smart?: number;
  socials?: boolean;
  launchpad?: string;
}

const query = (o: object) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== '' && v !== false && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v === true ? '1' : String(v))}`)
    .join('&');

export const pulse = (column: PulseColumn, filter: PulseFilter = {}) => get<{ tokens: RiskyToken[] }>(`/api/v1/pulse/${column}?${query(filter)}`).then((r) => r.tokens);
export type Window = '1m' | '5m' | '1h' | '6h' | '24h';
export const trending = (window: Window, sort: 'volume' | 'change' | 'trades' = 'volume') => get<{ tokens: TrendingToken[] }>(`/api/v1/trending?window=${window}&sort=${sort}`).then((r) => r.tokens);

export interface LabelledHolder {
  address: string;
  amount: number;
  share: number;
  spent: number;
  received: number;
  pnl: number;
  first_buy: number | null;
  labels: Label[];
}
export interface TopTrader {
  address: string;
  spent: number;
  received: number;
  held: number;
  realized: number;
  pnl: number;
  buys: number;
  sells: number;
  labels: Label[];
}
export type BuyerStatus = 'holding' | 'bought_more' | 'sold_part' | 'sold_all' | 'transferred';
export interface FirstBuyer {
  address: string;
  first_buy: number;
  spent: number;
  bought: number;
  held: number;
  status: BuyerStatus;
  labels: Label[];
}
export interface Clusters {
  nodes: Array<{ address: string; amount: number; share: number; cluster: string; labels: Label[] }>;
  edges: Array<{ from: string; to: string; amount: number }>;
  clusters: Array<{ id: string; wallets: number; share: number }>;
}
export interface Security {
  ours: boolean;
  owner: string | null;
  renounced: boolean;
  mintable: boolean | null;
  lp_burned: boolean | null;
  has_pool: boolean;
  fee_bps: number | null;
  liquidity: number;
}

export const tokenRisk = (token: string) => get<{ risk: Risk | null; ath: { price: number; ts: number } | null }>(`/api/v1/tokens/${token}/risk`);
export const labelledHolders = (token: string, limit = 100) => get<{ holders: LabelledHolder[] }>(`/api/v1/tokens/${token}/holders/labelled?limit=${limit}`).then((r) => r.holders);
export const topTraders = (token: string, limit = 50) => get<{ traders: TopTrader[] }>(`/api/v1/tokens/${token}/traders?limit=${limit}`).then((r) => r.traders);
export const firstBuyers = (token: string) =>
  get<{ buyers: FirstBuyer[]; summary: { holding: number; sold_part: number; sold_all: number; transferred: number; still_held: number } }>(`/api/v1/tokens/${token}/first-buyers`);
export const clusters = (token: string) => get<Clusters>(`/api/v1/tokens/${token}/clusters`);
export const security = (token: string) => get<Security>(`/api/v1/tokens/${token}/security`);

export interface WalletRecord {
  days: number;
  pnl: number;
  realized: number;
  spent: number;
  roi: number;
  tokens: number;
  wins: number;
  win_rate: number;
  avg_hold_seconds: number;
  sizes: { under_0_01: number; to_0_1: number; to_1: number; over_1: number };
  flags: { sold_more_than_bought: number; quick_flips: number };
  labels: Label[];
  best: Array<{ token: string; symbol: string; spent: number; received: number; value: number; pnl: number }>;
}
export const walletRecord = (address: string, days: 7 | 30) => get<WalletRecord>(`/api/v1/wallet/${address}/record?days=${days}`);

export interface RadarWallet {
  address: string;
  tokens: string[];
  spent: number;
  pnl: number;
  earliest: number;
}
export const radar = (tokens: string[] = []) => get<{ tokens: string[]; wallets: RadarWallet[] }>(`/api/v1/radar?tokens=${tokens.join(',')}`);

export interface InflowToken {
  token: string;
  symbol: string;
  name: string;
  uri: string | null;
  market_cap: number;
  bought: number;
  sold: number;
  net: number;
  buyers: number;
  wallets: string[];
  together: boolean;
  last_ts: number;
}
export const inflow = (wallets: string[], window: Window) => get<{ tokens: InflowToken[] }>(`/api/v1/inflow?wallets=${wallets.join(',')}&window=${window}`).then((r) => r.tokens);

export interface ReferralInfo {
  referrer: string | null;
  referred: number;
  active_traders: number;
  from_referrals: number;
  cashback: number;
  earned: number;
  claimed: number;
  unclaimed: number;
  contract: string | null;
}
export const referralInfo = (address: string) => get<ReferralInfo>(`/api/v1/referrals/${address}`);

export interface CopyRules {
  perTrade: string;
  perToken: string;
  perDay: string;
  sizeBps: number;
  slippageBps: number;
  chaseBps: number;
  minSellBps: number;
  buyOnce: boolean;
  copySells: boolean;
  maxAge: number;
}
export interface VaultInfo {
  contract: string | null;
  follows: Array<{ leader: string; rules: CopyRules; active: boolean; updated_at: number }>;
  exit: { take_profit_bps: number; stop_loss_bps: number; slippage_bps: number } | null;
  positions: Array<{ token: string; symbol: string; name: string; uri: string | null; tokens: number; spent: number; received: number; value: number }>;
  balance_estimate: number;
  events: Array<{ tx_hash: string; ts: number; kind: string; leader: string | null; token: string | null; zro: number; tokens: number }>;
}
export const vaultInfo = (address: string) => get<VaultInfo>(`/api/v1/vault/${address}`);
