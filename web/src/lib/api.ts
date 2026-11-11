'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL, type Deployment } from './config';

export interface Token {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  total_supply: number;
  creator: string | null;
  source: 'terminal' | 'external';
  factory: string | null;
  /** Which launchpad in launchpads/ it came from, for one that isn't ours. */
  launchpad: string | null;
  uri: string | null;
  description: string | null;
  links: Record<string, string> | null;
  /** What its creator chose, for one launched here. */
  fee_bps: number;
  /** 'holders' when its holders get any of the fee, which is when they have rewards to claim. */
  fee_route: 'creator' | 'holders';
  /** Of the earners' part of the fee, in basis points: to holders, and to buying it back to burn. The creator gets the rest. */
  holders_bps?: number;
  burn_bps?: number;
  anti_snipe: boolean;
  created_at: number;
  graduated: boolean;
  has_pool: boolean;
  /** Whether this terminal can trade it: through our router, or on its own launchpad. */
  tradable: boolean;
  raised: number;
  sold: number;
  price: number;
  market_cap: number;
  /** ZRO in its curve or pool. */
  liquidity: number;
  holders: number;
  volume_24h: number;
  trades_24h: number;
  progress: number;
  change_24h: number;
  last_trade_at: number | null;
}

/** One token with the extra activity figures the trade screen shows. */
export interface TokenDetail extends Token {
  /** ZRO its fee has paid so far, to its creator, its holders and the burn together, and each of them. */
  earner_fees?: number;
  creator_earned?: number;
  holders_earned?: number;
  burned_zro?: number;
  /** Tokens the burn has bought back and sent to the dead address. */
  burned_tokens?: number;
  change_5m: number;
  change_1h: number;
  change_6h: number;
  buys_24h: number;
  sells_24h: number;
  buy_volume_24h: number;
  sell_volume_24h: number;
}

export interface Trade {
  tx_hash: string;
  log_index: number;
  ts: number;
  token: string;
  trader: string;
  is_buy: number | boolean;
  zro: number;
  amount: number;
  price: number;
  venue: string;
  symbol?: string;
  uri?: string | null;
  /** What the trader holds of this token now, on lists that ask for it. */
  held?: number;
  source?: string;
  has_pool?: number;
  tradable?: number | boolean;
}

/** The trade the stream reports, in the shape the indexer's trade lists use. */
export function streamTrade(d: any): Trade {
  return { tx_hash: d.tx, log_index: d.idx, ts: d.ts, token: d.token, trader: d.trader, is_buy: Boolean(d.isBuy), zro: d.zro, amount: d.amount, price: d.price, venue: d.venue };
}

export interface LaunchpadStats {
  known: Array<{ id: string; name: string; tokens: number; graduated: number; latest: number; volume_24h: number; trades_24h: number }>;
  /** Contracts minting tokens that nobody has connected yet: what to add next. */
  unknown: Array<{ factory: string; tokens: number; latest: number }>;
}

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
export interface Holder { holder: string; amount: number }
export interface MarketStats { tokens: number; graduated: number; external: number; volume_24h: number; trades_24h: number; traders_24h: number }
export type OrderStatus = 'open' | 'partial' | 'filled' | 'cancelled' | 'expired' | 'unfilled_expired';
export interface Order {
  id: number;
  owner: string;
  token: string;
  symbol: string;
  uri?: string | null;
  is_buy: boolean;
  amount: string;
  min_out: string;
  filled: string;
  expiry: number;
  open: number;
  created_at: number;
  closed_at: number | null;
  price: number;
  total_supply: number;
  fills: number;
  status: OrderStatus;
  /** The order's own limit, ZRO per token. The `price` above is the token's price now. */
  limit_price: number;
  size_zro: number;
  left_zro: number;
  amount_num: number;
  filled_num: number;
  filled_out_num: number;
  filled_share: number;
  /** What it waits for. A stop's and a trailing stop's `limit_price` is where it fires; event orders have none. */
  kind?: 'limit' | 'stop' | 'trailing' | 'on_graduation' | 'on_dev_sell' | 'dca';
  /** Sale legs that share one escrow carry the first leg's id. */
  group?: number | null;
  trail_bps?: number;
  interval_s?: number;
  slices?: number;
}
export interface OrderFill { tx_hash: string; ts: number; zro: number; tokens: number; keeper: string }
/** An order as the heatmap reads it: its level, and what rested there from when to when. */
export interface BookOrder {
  id: number;
  owner: string;
  is_buy: boolean;
  /** limit, stop, trailing or dca. A stop's and a trailing stop's price is where it fires. */
  kind?: string;
  group?: number | null;
  price: number;
  size_zro: number;
  left_zro: number;
  start: number;
  end: number | null;
  /** After each fill: when, and how much ZRO was still unfilled. */
  steps: Array<[number, number]>;
}
export type DevKind = 'buy' | 'sell' | 'transfer' | 'burn';
export interface DevMove { t: number; kind: DevKind; tokens: number; zro?: number; to?: string }
export interface DevInfo {
  creator: string | null;
  moves: DevMove[];
  holds: number;
  share: number;
  bought: number;
  sold: number;
  linked: Array<{ address: string; got: number; held: number; share: number; contract: boolean }>;
  linked_share: number;
  linked_sold: number;
  launch_block: number;
  launched: number;
  graduated: number;
}
export interface WalletStats {
  address: string;
  worth: number;
  pnl: number;
  realized: number;
  open: number;
  trades: number;
  buys: number;
  sells: number;
  volume: number;
  wins: number;
  losses: number;
  first_ts: number;
  last_ts: number;
}
export interface ClosedPosition { token: string; symbol: string; uri?: string | null; spent: number; received: number; trades: number; closed_at: number }
export interface ProtocolPeriod { volume: number; trades: number; traders: number; revenue: number; creators: number; launches: number; graduations: number }
export interface ProtocolPoint extends ProtocolPeriod { t: number; new_traders: number }
export interface ProtocolStats {
  range: string;
  bucket: number;
  total: ProtocolPeriod & { tokens: number; launched: number; external: number; graduated: number };
  current: ProtocolPeriod;
  previous: ProtocolPeriod;
  series: ProtocolPoint[];
  venues: Array<{ venue: string; volume: number; trades: number }>;
  top_tokens: Array<{ address: string; symbol: string; name: string; uri?: string | null; graduated: number; market_cap: number; volume: number; trades: number; traders: number }>;
  top_creators: Array<{ address: string; tokens: number; graduated: number; earned: number }>;
  orders: { placed: number; open: number; partly_filled: number; locked_zro: number; filled_zro: number };
  treasury: { balance: number; pending: number; burned_zro: number; burned_tokens: number; buybacks: number } | null;
}
export interface Holding { token: string; amount: number; name: string; symbol: string; uri?: string | null; price: number; value: number; spent: number; bought: number; received: number }
export interface Leader { trader: string; pnl: number; volume: number; trades: number; tokens: number; wins: number; last_ts: number }
export interface WalletData {
  holdings: Holding[];
  trades: Trade[];
  totals: { spent: number; received: number; trades: number };
  launched: Array<{ address: string; name: string; symbol: string; uri?: string | null; raised: number; graduated: number; created_at: number }>;
  closed: ClosedPosition[];
  stats: WalletStats;
  open_orders: number;
  reward_tokens?: Array<{ token: string; symbol: string }>;
}

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Indexer answered ${res.status}`);
  return res.json() as Promise<T>;
}

let deployment: Promise<Deployment> | null = null;
/** The indexer is the one place that knows the addresses, so nothing else has to be reconfigured after a deploy. */
export function getDeployment(): Promise<Deployment> {
  deployment ??= get<{ deployment: Deployment | null }>('/health')
    .then((h) => {
      if (!h.deployment) throw new Error('The contracts are not deployed on this network yet');
      return h.deployment;
    })
    .catch((err) => {
      deployment = null;
      throw err;
    });
  return deployment;
}

type StreamHandler = (type: string, data: any) => void;
const handlers = new Set<StreamHandler>();
let source: EventSource | null = null;

function ensureStream() {
  if (source || typeof window === 'undefined') return;
  source = new EventSource(`${API_URL}/api/v1/stream`);
  for (const type of ['trade', 'launch', 'graduated', 'order', 'dev', 'vault', 'profile']) {
    source.addEventListener(type, (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      handlers.forEach((h) => h(type, data));
    });
  }
}

/** The same stream for code outside a component. Returns what stops listening. */
export function onStream(handler: StreamHandler): () => void {
  ensureStream();
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function useStream(handler: StreamHandler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    ensureStream();
    const h: StreamHandler = (t, d) => ref.current(t, d);
    handlers.add(h);
    return () => {
      handlers.delete(h);
    };
  }, []);
}

/**
 * Fetches once, then refetches when the stream reports something this view cares about. A burst of trades collapses
 * into one refetch, and a slow poll covers a stream that dropped.
 */
export function useLive<T>(path: string | null, matches: (type: string, data: any) => boolean = () => true, throttleMs = 400, keepPrevious = false) {
  const [data, setData] = useState<T | null>(null);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  const refresh = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const next = await get<T>(p);
      if (pathRef.current === p) {
        setData(next);
        setLoadedPath(p);
        setError(null);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!keepPrevious) setData(null);
    void refresh();
    const poll = setInterval(refresh, 15_000);
    return () => clearInterval(poll);
  }, [path, refresh, keepPrevious]);

  useStream((type, d) => {
    if (!matches(type, d) || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      void refresh();
    }, throttleMs);
  });

  return { data, loadedPath, error, refresh };
}
