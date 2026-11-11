// The indexer's REST side: token details, a wallet's orders, the ZRO price.
import type { OrderRow } from './rules.js';
import { cleanText } from './format.js';

export type TokenInfo = { address: string; name: string; symbol: string; market_cap: number; price: number; total_supply: number };

export interface IndexerApi {
  token(address: string): Promise<TokenInfo | null>;
  /** The same without the cache. */
  tokenNow(address: string): Promise<TokenInfo | null>;
  /** A wallet's orders, or with no wallet the latest orders of everyone (up to 200). */
  orders(owner?: string): Promise<OrderRow[]>;
  zroUsd(): Promise<number | null>;
}

/** Names and supply barely change, so a token is asked about once in this long. */
const TOKEN_TTL_MS = 10 * 60_000;

export class Indexer implements IndexerApi {
  private tokens = new Map<string, { at: number; value: Promise<TokenInfo | null> }>();

  constructor(private base: string) {
    this.base = base.replace(/\/+$/, '');
  }

  private async get<T>(path: string): Promise<T | null> {
    const res = await fetch(`${this.base}${path}`, { signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${path.split('?')[0]}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** Fresh: for /alert, which needs today's cap, not ten minutes ago's. */
  tokenNow(address: string): Promise<TokenInfo | null> {
    // Names and symbols are cleaned once, here, so no message anywhere can carry a line break from one.
    const value = this.get<TokenInfo>(`/api/v1/tokens/${address}`).then((t) => (t ? { ...t, name: cleanText(t.name, 48), symbol: cleanText(t.symbol) } : t));
    this.tokens.set(address, { at: Date.now(), value });
    value.catch(() => this.tokens.delete(address)); // a failure isn't remembered
    if (this.tokens.size > 5000) this.tokens.delete(this.tokens.keys().next().value!);
    return value;
  }

  token(address: string): Promise<TokenInfo | null> {
    const hit = this.tokens.get(address);
    if (hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.value;
    return this.tokenNow(address);
  }

  async orders(owner?: string): Promise<OrderRow[]> {
    const rows = (await this.get<{ orders: OrderRow[] }>(owner ? `/api/v1/orders?owner=${owner}` : '/api/v1/orders'))?.orders ?? [];
    return rows.map((o) => (o.symbol ? { ...o, symbol: cleanText(o.symbol) } : o));
  }

  async zroUsd(): Promise<number | null> {
    const usd = Number((await this.get<{ usd: number | null }>('/api/v1/zro-price'))?.usd);
    return usd > 0 ? usd : null;
  }
}
