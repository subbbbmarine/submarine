// When an alert fires. No I/O here, so every rule is tested on its own.
import type { Direction } from './commands.js';

/**
 * Whether the market cap crossed the level on this move. `prev` is the last cap seen for this alert, or null when none was.
 * Without a previous cap, being on the far side of the level counts.
 */
export function crossed(direction: Direction, level: number, prev: number | null, now: number): boolean {
  if (!Number.isFinite(now)) return false;
  if (direction === 'above') return now >= level && (prev === null || prev < level);
  return now <= level && (prev === null || prev > level);
}

/** Whether an alert would fire right away, which means it was set on the wrong side. */
export const alreadyPast = (direction: Direction, level: number, now: number) => (direction === 'above' ? now >= level : now <= level);

/** What the indexer's /api/v1/orders gives for one order, as far as alerts care. */
export type OrderRow = {
  id: number;
  owner?: string;
  token: string;
  symbol?: string | null;
  is_buy: boolean;
  status: string;
  kind?: string;
  filled_num: number;
  filled_share: number;
  size_zro: number;
};

export type SeenOrder = { status: string; filled: number };
export type OrderNews = { order: OrderRow; what: 'filled' | 'partial' };

/**
 * Compares a wallet's orders with what was seen last time. `seen` null means nothing was seen yet: the first look only
 * remembers, so subscribing doesn't announce old fills. Orders the indexer no longer lists are forgotten.
 */
export function orderNews(seen: Record<string, SeenOrder> | null, orders: OrderRow[]): { news: OrderNews[]; seen: Record<string, SeenOrder> } {
  const next: Record<string, SeenOrder> = {};
  const news: OrderNews[] = [];
  for (const o of orders) {
    const filled = Number(o.filled_num) || 0;
    next[String(o.id)] = { status: o.status, filled };
    if (!seen) continue;
    const before = seen[String(o.id)];
    const grew = filled > 0 && filled > (before?.filled ?? 0) * (1 + 1e-9);
    if (o.status === 'filled' && before?.status !== 'filled') news.push({ order: o, what: 'filled' });
    else if (o.status !== 'filled' && grew) news.push({ order: o, what: 'partial' });
  }
  return { news, seen: next };
}
