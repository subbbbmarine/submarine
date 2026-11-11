'use client';

import { useEffect, useMemo, useState } from 'react';
import { get } from '@/lib/api';
import { cn } from '@/lib/format';
import { useFormat } from '@/lib/money';

/**
 * A wallet's month in tiles: each day green or red by the profit it took that day, deeper the bigger the day. Profit here is
 * realised profit: what a sale brought in less what those tokens cost at the wallet's average price, so a partial sale counts
 * on the day it happened.
 */
interface Day {
  pnl: number;
  trades: number;
}
interface Row {
  ts: number;
  token: string;
  is_buy: number;
  zro: number;
  amount: number;
}

const keyOf = (ts: number) => {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

function daysFrom(trades: Row[]): Map<string, Day> {
  const days = new Map<string, Day>();
  const held = new Map<string, { tokens: number; cost: number }>();
  for (const t of [...trades].sort((a, b) => a.ts - b.ts)) {
    const k = keyOf(t.ts);
    const day = days.get(k) ?? { pnl: 0, trades: 0 };
    day.trades += 1;
    const p = held.get(t.token) ?? { tokens: 0, cost: 0 };
    if (t.is_buy) {
      p.tokens += t.amount;
      p.cost += t.zro;
    } else if (p.tokens > 0 && t.amount > 0) {
      // Tokens that came in some other way than a buy have no known cost: only what was bought counts against what was sold.
      const sold = Math.min(t.amount, p.tokens);
      const cost = (p.cost / p.tokens) * sold;
      day.pnl += t.zro * (sold / t.amount) - cost;
      p.tokens -= sold;
      p.cost -= cost;
    }
    held.set(t.token, p);
    days.set(k, day);
  }
  return days;
}

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function Calendar({ address }: { address: string }) {
  const { money, usd } = useFormat();
  const [trades, setTrades] = useState<Row[] | null>(null);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  useEffect(() => {
    let alive = true;
    setTrades(null);
    get<{ trades: Row[] }>(`/api/v1/wallet/${address}/trades?limit=20000`)
      .then((r) => alive && setTrades(r.trades))
      .catch(() => alive && setTrades([]));
    return () => {
      alive = false;
    };
  }, [address]);

  const days = useMemo(() => daysFrom(trades ?? []), [trades]);
  const cells = useMemo(() => {
    const lead = (month.getDay() + 6) % 7;
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: Array<{ date: number; day?: Day } | null> = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= count; d++) out.push({ date: d, day: days.get(`${month.getFullYear()}-${month.getMonth()}-${d}`) });
    while (out.length % 7) out.push(null);
    return out;
  }, [month, days]);

  const inMonth = cells.filter((c): c is { date: number; day: Day } => Boolean(c?.day));
  const total = inMonth.reduce((s, c) => s + c.day.pnl, 0);
  const green = inMonth.filter((c) => c.day.pnl > 0).length;
  const red = inMonth.filter((c) => c.day.pnl < 0).length;
  const biggest = Math.max(...inMonth.map((c) => Math.abs(c.day.pnl)), 1e-12);
  const brief = (v: number) => {
    const a = Math.abs(v) * (usd ?? 1);
    const s = a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a >= 10 ? a.toFixed(0) : a.toFixed(usd ? 1 : 2);
    return `${v < 0 ? '-' : '+'}${usd ? '$' : ''}${s}`;
  };
  const now = new Date();
  const atNow = month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth();
  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const arrow = 'flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/[.06] hover:text-ink disabled:opacity-30';

  return (
    <section className="panel p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Trading calendar</h2>
        <div className="flex items-center gap-1">
          <button className={arrow} onClick={() => shift(-1)} aria-label="Previous month">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 3L5 8l5 5" />
            </svg>
          </button>
          <span className="num min-w-[116px] text-center text-[13px]">{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
          <button className={arrow} onClick={() => shift(1)} disabled={atNow} aria-label="Next month">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 3l5 5-5 5" />
            </svg>
          </button>
        </div>
      </div>
      <dl className="mt-2 flex gap-6 text-[13px]">
        <div>
          <dt className="text-muted">This month</dt>
          <dd className={cn('num text-[16px] font-semibold', total > 0 ? 'text-up' : total < 0 ? 'text-down' : '')}>{total === 0 ? money(0) : `${total > 0 ? '+' : '-'}${money(Math.abs(total))}`}</dd>
        </div>
        <div>
          <dt className="text-muted">Green days</dt>
          <dd className="num text-[16px] font-semibold text-up">{green}</dd>
        </div>
        <div>
          <dt className="text-muted">Red days</dt>
          <dd className="num text-[16px] font-semibold text-down">{red}</dd>
        </div>
      </dl>
      <div className="mt-3 grid grid-cols-7 gap-1">
        {WEEK.map((d) => (
          <span key={d} className="text-center text-[12px] text-faint">
            {d}
          </span>
        ))}
        {cells.map((c, i) => {
          if (!c) return <span key={i} />;
          const p = c.day?.pnl ?? 0;
          const strength = c.day && p !== 0 ? 0.14 + (Math.abs(p) / biggest) * 0.5 : 0;
          const today = atNow && now.getDate() === c.date;
          return (
            <div
              key={i}
              title={c.day ? `${c.day.trades} trades, ${p >= 0 ? '+' : '-'}${money(Math.abs(p))}` : undefined}
              className={cn('flex min-h-[54px] flex-col rounded-lg p-1.5 leading-tight', !c.day && 'bg-white/[.025]', c.day && p === 0 && 'bg-white/[.06]', today && 'ring-1 ring-accent/70')}
              style={strength ? { backgroundColor: `rgb(var(--${p > 0 ? 'up' : 'down'}) / ${strength})` } : undefined}
            >
              <span className="num text-[11px] text-muted">{c.date}</span>
              {c.day && p !== 0 && <span className="num mt-auto truncate text-[12px] font-semibold">{brief(p)}</span>}
              {c.day && <span className="num truncate text-[10px] text-muted">{c.day.trades} {c.day.trades === 1 ? 'trade' : 'trades'}</span>}
            </div>
          );
        })}
      </div>
      {trades === null && <p className="mt-2 text-[12px] text-faint">Reading the whole history</p>}
    </section>
  );
}
