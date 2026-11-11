'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { useLive, type LaunchpadStats, type ProtocolPoint, type ProtocolStats } from '@/lib/api';
import { zro, cn, compact, short } from '@/lib/format';
import { useFormat } from '@/lib/money';
import { openWallet } from '@/lib/selection';
import { Avatar, Empty } from '@/components/bits';

const RANGES = [
  { key: '24h', label: '24 hours', noun: 'the 24 hours before' },
  { key: '7d', label: '7 days', noun: 'the 7 days before' },
  { key: '30d', label: '30 days', noun: 'the 30 days before' },
  { key: 'all', label: 'All time', noun: '' },
];

const pointTime = (t: number, bucket: number) => {
  const d = new Date(t * 1000);
  const day = d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  return bucket >= 86400 ? day : `${day}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

interface Series {
  key: keyof ProtocolPoint;
  label: string;
  /** Yellow is the measure itself. Grey is the second part of a stack. */
  tone: 'accent' | 'grey';
}

/**
 * Bars over time on one scale, with a readout under the pointer. A stack when the parts add up to something (revenue), never
 * two measures on two scales: each measure of a different size gets its own chart.
 */
function Bars({ title, total, points, series, format, bucket }: { title: string; total: string; points: ProtocolPoint[]; series: Series[]; format: (v: number) => string; bucket: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const sum = (p: ProtocolPoint) => series.reduce((s, x) => s + Number(p[x.key]), 0);
  const most = Math.max(...points.map(sum), 1e-12);
  const shown = hover === null ? null : points[hover];
  const stepWidth = 100 / Math.max(points.length, 1);
  return (
    <section className="panel p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        <span className="num text-[18px] font-bold tracking-tight">{total}</span>
      </div>
      {series.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-muted">
          {series.map((s) => (
            <span key={String(s.key)} className="flex items-center gap-1.5">
              <i className={cn('h-2 w-2 rounded-sm', s.tone === 'accent' ? 'bg-accent' : 'bg-white/30')} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_52px] gap-x-2.5">
        <div
          ref={box}
          className="relative h-[150px]"
          role="img"
          aria-label={`${title} over time, ${total} in total. The table at the foot of this page has every figure.`}
          onPointerMove={(e) => {
            const r = box.current!.getBoundingClientRect();
            setHover(Math.max(0, Math.min(points.length - 1, Math.floor(((e.clientX - r.left) / r.width) * points.length))));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {[0.5, 1].map((f) => (
            <div key={f} className="pointer-events-none absolute inset-x-0 border-t border-white/[.05]" style={{ bottom: `${f * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end">
            {points.map((p, i) => {
              const value = sum(p);
              return (
                <div key={p.t} className={cn('flex h-full flex-col justify-end transition-colors duration-100', hover === i && 'bg-white/[.04]')} style={{ width: `${stepWidth}%`, padding: '0 1px' }}>
                  {series
                    .slice()
                    .reverse()
                    .map((s, k) => {
                      const part = Number(p[s.key]);
                      if (part <= 0) return null;
                      return <div key={String(s.key)} className={cn('w-full', s.tone === 'accent' ? 'bg-accent' : 'bg-white/30', k === 0 && 'rounded-t-[3px]', series.length > 1 && 'mb-[1px]')} style={{ height: `${(part / most) * 100}%`, minHeight: value > 0 ? 2 : 0 }} />;
                    })}
                </div>
              );
            })}
          </div>
          <div className="absolute inset-x-0 bottom-0 border-t border-white/10" />
          {shown && (
            <div
              className="chart-card"
              style={{ left: `${(hover! + 0.5) * stepWidth}%`, transform: `translateX(${hover! > points.length / 2 ? 'calc(-100% - 10px)' : '10px'})` }}
            >
              <div className="chart-card-title">{pointTime(shown.t, bucket)}</div>
              {series.map((s) => (
                <div key={String(s.key)} className="chart-card-row">
                  <span className="chart-card-k">{s.label}</span>
                  <span className={cn('chart-card-v', s.tone === 'accent' ? 'tone-accent' : 'tone-ink')}>{format(Number(shown[s.key]))}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* The scale has a column of its own, so a tall bar can never run under its figures. */}
        <div className="relative h-[150px]">
          {[1, 0.5].map((f) => (
            <span key={f} className="num absolute right-0 -translate-y-1/2 whitespace-nowrap text-[11px] text-faint" style={{ top: `${(1 - f) * 100}%` }}>
              {format(most * f)}
            </span>
          ))}
        </div>
        <div className="num mt-1.5 flex justify-between text-[11px] text-faint">
          <span>{points[0] ? pointTime(points[0].t, bucket) : ''}</span>
          <span>Now</span>
        </div>
      </div>
    </section>
  );
}

function Headline({ label, value, note, change, lead }: { label: string; value: string; note?: string; change?: number | null; lead?: boolean }) {
  return (
    <div className="panel min-w-0 shrink grow basis-[160px] px-4 py-3.5">
      <div className="text-[13px] text-muted">{label}</div>
      <div className={cn('num mt-0.5 truncate font-bold tracking-tight', lead ? 'text-[24px] leading-tight text-accent' : 'text-[24px] leading-tight')}>{value}</div>
      <div className="num mt-0.5 truncate text-[12px] text-faint">
        {change !== undefined && change !== null && <span className={cn('mr-1.5', change > 0 ? 'text-up' : change < 0 ? 'text-down' : '')}>{change >= 10 ? 'over 10x' : `${change > 0 ? '+' : ''}${(change * 100).toFixed(Math.abs(change) >= 1 ? 0 : 1)}%`}</span>}
        {note}
      </div>
    </div>
  );
}

/** Every launchpad on the chain, including contracts minting tokens that aren't connected here yet. */
function Launchpads() {
  const { data } = useLive<LaunchpadStats>('/api/v1/launchpads/stats', (t) => t === 'launch' || t === 'graduated', 5000, true);
  const { money } = useFormat();
  if (!data) return null;
  return (
    <section className="panel p-4">
      <h2 className="mb-1 font-semibold">Launchpads on this chain</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-[12px] text-faint">
            <tr>
              {['Launchpad', 'Tokens', 'Finished', 'Volume, 24 hours', 'Trades, 24 hours'].map((h, i) => (
                <th key={h} className={cn('py-1.5 font-normal', i === 0 ? 'text-left' : 'whitespace-nowrap pl-3 text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="num">
            {data.known.map((p) => (
              <tr key={p.id}>
                <td className="py-1.5 font-medium">{p.name}</td>
                <td className="py-1.5 text-right">{p.tokens}</td>
                <td className="py-1.5 text-right">{p.graduated}</td>
                <td className="py-1.5 text-right">{money(p.volume_24h)}</td>
                <td className="py-1.5 text-right">{p.trades_24h}</td>
              </tr>
            ))}
            {data.unknown.map((p) => (
              <tr key={p.factory} className="text-muted">
                <td className="py-1.5" title={`${p.factory} has minted ${p.tokens} tokens and isn't connected here yet`}>
                  {short(p.factory)}, not connected
                </td>
                <td className="py-1.5 text-right">{p.tokens}</td>
                <td className="py-1.5 text-right" colSpan={3} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function StatsPage() {
  const [range, setRange] = useState('all');
  const { money } = useFormat();
  const { data, error } = useLive<ProtocolStats>(`/api/v1/protocol/stats?range=${range}`, (t) => t === 'trade' || t === 'launch' || t === 'graduated', 4000, true);
  const info = RANGES.find((r) => r.key === range)!;
  const compare = range === 'all' ? undefined : `vs ${info.noun}`;
  const points = data?.series ?? [];
  const venueTotal = useMemo(() => data?.venues.reduce((s, v) => s + v.volume, 0) ?? 0, [data]);
  const count = (v: number) => (v >= 10_000 ? compact(v) : String(Math.round(v)));

  if (!data) {
    return (
      <div>
        <section className="panel">{error ? <Empty title="Can't load the stats" body="The indexer isn't answering. It will retry on its own." /> : <div className="h-40 animate-pulse rounded-2xl bg-white/[.03]" />}</section>
      </div>
    );
  }
  const { current: c, previous: p, total: t } = data;
  // All time has no period before it to compare with.
  const changeOf = (now: number, before: number) => (range !== 'all' && before > 0 ? now / before - 1 : null);

  return (
    <div className="flex flex-col gap-2">
      <div className="panel flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold leading-tight tracking-tight">Stats</h1>
          <p className="text-[13px] text-muted">Everything here is read from this terminal&apos;s contracts on the chain.</p>
        </div>
        <div className="flex gap-0.5" role="radiogroup" aria-label="Period">
          {RANGES.map((r) => (
            <button key={r.key} role="radio" aria-checked={range === r.key} onClick={() => setRange(r.key)} className={cn('pill', range === r.key && 'pill-on')}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Headline lead label="Revenue, to the treasury" value={money(c.revenue)} change={changeOf(c.revenue, p.revenue)} note={compare ?? `${zro(c.revenue)} ZRO`} />
        <Headline label="Volume" value={money(c.volume)} change={changeOf(c.volume, p.volume)} note={compare ?? `${zro(c.volume)} ZRO`} />
        <Headline label="Paid to creators" value={money(c.creators)} change={changeOf(c.creators, p.creators)} note={compare ?? `${zro(c.creators)} ZRO`} />
        <Headline label="Launches" value={count(c.launches)} change={changeOf(c.launches, p.launches)} note={`${t.launched} in all`} />
        <Headline label="Moved to pools" value={count(c.graduations)} change={changeOf(c.graduations, p.graduations)} note={`${t.graduated} in all`} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Headline label="Trades" value={count(c.trades)} change={changeOf(c.trades, p.trades)} note={compare ?? `${count(t.trades)} in all`} />
        <Headline label="Active traders" value={count(c.traders)} change={changeOf(c.traders, p.traders)} note={compare ?? `${count(t.traders)} in all`} />
        <Headline label="Tokens on the chain" value={count(t.tokens)} note={`${t.launched} here, ${t.external} elsewhere`} />
        <Headline label="Volume, all time" value={money(t.volume)} note={`${zro(t.volume)} ZRO`} />
        <Headline label="Revenue, all time" value={money(t.revenue)} note={`${zro(t.revenue)} ZRO`} />
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        <Bars title="Revenue and creator fees" total={money(c.revenue + c.creators)} points={points} bucket={data.bucket} format={money} series={[{ key: 'revenue', label: 'To the treasury', tone: 'accent' }, { key: 'creators', label: 'To creators', tone: 'grey' }]} />
        <Bars title="Volume" total={money(c.volume)} points={points} bucket={data.bucket} format={money} series={[{ key: 'volume', label: 'Volume', tone: 'accent' }]} />
        <Bars title="Launches" total={count(c.launches)} points={points} bucket={data.bucket} format={count} series={[{ key: 'launches', label: 'Launches', tone: 'accent' }]} />
        <Bars title="Active traders" total={count(c.traders)} points={points} bucket={data.bucket} format={count} series={[{ key: 'traders', label: 'Traders', tone: 'accent' }]} />
      </div>

      <div className="grid gap-2 lg:grid-cols-3">
        <section className="panel p-4">
          <h2 className="font-semibold">Treasury</h2>
          {data.treasury ? (
            <dl className="mt-2 space-y-2 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Held in the treasury</dt>
                <dd className="num">{money(data.treasury.balance)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Waiting in the launchpad</dt>
                <dd className="num">{money(data.treasury.pending)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Spent on buybacks</dt>
                <dd className="num">{money(data.treasury.burned_zro)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Tokens bought and burned</dt>
                <dd className="num">{compact(data.treasury.burned_tokens)}</dd>
              </div>
              <p className="pt-1 text-[12px] leading-snug text-faint">The treasury can only buy one token, chosen once, and burn it. Nothing can withdraw from it.</p>
            </dl>
          ) : (
            <p className="mt-2 text-[13px] text-faint">Not deployed on this network yet.</p>
          )}
        </section>
        <section className="panel p-4">
          <h2 className="font-semibold">Limit orders</h2>
          <dl className="mt-2 space-y-2 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Placed</dt>
              <dd className="num">{data.orders.placed}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Open now</dt>
              <dd className="num">{data.orders.open}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Partly filled</dt>
              <dd className="num">{data.orders.partly_filled}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Waiting to fill</dt>
              <dd className="num">{money(data.orders.locked_zro)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Filled so far</dt>
              <dd className="num">{money(data.orders.filled_zro)}</dd>
            </div>
          </dl>
        </section>
        <section className="panel p-4">
          <h2 className="font-semibold">Where it traded</h2>
          {venueTotal > 0 ? (
            <>
              <div className="mt-3 flex h-2 gap-[2px] overflow-hidden rounded-full">
                {data.venues.map((v, i) => (
                  <span key={v.venue} className={cn('h-full', i === 0 ? 'bg-accent' : 'bg-white/30')} style={{ width: `${(v.volume / venueTotal) * 100}%` }} />
                ))}
              </div>
              <ul className="mt-3 space-y-2 text-[13px]">
                {data.venues.map((v, i) => (
                  <li key={v.venue} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-muted">
                      <i className={cn('h-2 w-2 rounded-sm', i === 0 ? 'bg-accent' : 'bg-white/30')} />
                      {v.venue === 'curve' ? 'Launchpad' : v.venue === 'pool' ? 'Pools' : v.venue}
                    </span>
                    <span className="num">
                      {money(v.volume)} <span className="text-faint">{((v.volume / venueTotal) * 100).toFixed(0)}%</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-2 text-[13px] text-faint">No trades in this period.</p>
          )}
        </section>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        <section className="panel p-4">
          <h2 className="mb-1 font-semibold">Most traded</h2>
          {!data.top_tokens.length && <Empty title="No trades in this period" />}
          <ul>
            {data.top_tokens.map((x, i) => (
              <li key={x.address}>
                <Link href={`/tokens/${x.address}`} className="flex h-11 items-center gap-2.5 text-[14px] transition-colors hover:text-accent">
                  <span className="num w-4 text-center text-[13px] text-faint">{i + 1}</span>
                  <Avatar address={x.address} uri={x.uri} size={28} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{x.symbol}</span>
                  <span className="num hidden text-[13px] text-faint sm:inline">{x.traders} traders</span>
                  <span className="num w-[84px] text-right">{money(x.volume)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel p-4">
          <h2 className="mb-1 font-semibold">Top creators, by fees earned</h2>
          {!data.top_creators.length && <Empty title="Nobody has launched yet" />}
          <ul>
            {data.top_creators.map((x, i) => (
              <li key={x.address}>
                <button onClick={() => openWallet(x.address)} className="flex h-11 w-full items-center gap-2.5 text-left text-[14px] transition-colors hover:text-accent">
                  <span className="num w-4 text-center text-[13px] text-faint">{i + 1}</span>
                  <span className="num min-w-0 flex-1 truncate">{short(x.address)}</span>
                  <span className="num text-[13px] text-faint">
                    {x.tokens} launched, {x.graduated} on pools
                  </span>
                  <span className="num w-[84px] text-right">{money(x.earned)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Launchpads />

      <details className="panel p-4">
        <summary className="cursor-pointer text-[13px] font-medium text-muted transition-colors hover:text-ink">All figures by period, as a table</summary>
        <div className="soft-scroll mt-2 max-h-[320px] overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-card text-[12px] text-faint">
              <tr>
                {['Period', 'Volume', 'Trades', 'Traders', 'Treasury', 'Creators', 'Launches', 'To pools'].map((h, i) => (
                  <th key={h} className={cn('py-1.5 font-normal', i === 0 ? 'text-left' : 'text-right')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="num">
              {points
                .slice()
                .reverse()
                .filter((x) => x.trades || x.launches)
                .map((x) => (
                  <tr key={x.t}>
                    <td className="whitespace-nowrap py-1 text-muted">{pointTime(x.t, data.bucket)}</td>
                    <td className="py-1 text-right">{money(x.volume)}</td>
                    <td className="py-1 text-right">{x.trades}</td>
                    <td className="py-1 text-right">{x.traders}</td>
                    <td className="py-1 text-right">{money(x.revenue)}</td>
                    <td className="py-1 text-right">{money(x.creators)}</td>
                    <td className="py-1 text-right">{x.launches}</td>
                    <td className="py-1 text-right">{x.graduations}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
