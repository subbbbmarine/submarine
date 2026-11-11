'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Address } from 'viem';
import { get, useStream } from '@/lib/api';
import { age, cn } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { pulse, trending, type PulseColumn, type PulseFilter, type RiskyToken, type TrendingToken, type Window } from '@/lib/insight';
import { useLaunchpads } from '@/lib/launchpads';
import { useFormat } from '@/lib/money';
import { prepareBuy } from '@/lib/prep';
import { openToken } from '@/lib/selection';
import { marketBuy } from '@/lib/trade';
import { useWallet } from '@/lib/wallet';
import { Avatar, Change, Empty, Progress } from '@/components/bits';
import { Presets } from '@/components/Presets';
import { RiskChips } from '@/components/Risk';

const COLUMNS: Array<{ key: PulseColumn; label: string; hint: string; empty: string }> = [
  { key: 'new', label: 'New', hint: 'Just launched, on any launchpad', empty: 'Nothing matches these filters yet' },
  { key: 'near', label: 'Close to pool', hint: '40% of the way or more', empty: 'No token is that close right now' },
  { key: 'migrated', label: 'In a pool', hint: 'Moved from the curve to a pool', empty: 'No token has moved to a pool yet' },
];

const STORAGE = 'terminal.pulse.v1';
interface Saved {
  filters: Partial<Record<PulseColumn, PulseFilter>>;
  amounts: Partial<Record<PulseColumn, string>>;
}
const load = (): Saved => {
  try {
    return (JSON.parse(localStorage.getItem(STORAGE) ?? 'null') as Saved | null) ?? { filters: {}, amounts: {} };
  } catch {
    return { filters: {}, amounts: {} };
  }
};
const store = (s: Saved) => {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(s));
  } catch {
    // private mode: filters last as long as the tab
  }
};

function Socials({ links }: { links: Record<string, string> | null }) {
  if (!links) return null;
  const names: Array<[string, string]> = [
    ['twitter', 'X'],
    ['telegram', 'TG'],
    ['website', 'Web'],
    ['discord', 'DC'],
  ];
  return (
    <span className="flex gap-1">
      {names
        .filter(([k]) => links[k])
        .map(([k, label]) => (
          <a key={k} href={links[k]} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} className="rounded bg-white/[.06] px-1 text-[10px] font-semibold text-muted hover:text-ink">
            {label}
          </a>
        ))}
    </span>
  );
}

function Card({ token, amount, now, padName }: { token: RiskyToken; amount: string; now: number; padName?: string }) {
  const { money } = useFormat();
  const [busy, setBusy] = useState(false);
  const buy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const { account, create } = useWallet.getState();
    if (!account) return create();
    setBusy(true);
    try {
      await marketBuy(token.address as Address, token.symbol, amount);
    } catch {
      // the confirmation card says what went wrong
    }
    setBusy(false);
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openToken(token.address)}
      onKeyDown={(e) => e.key === 'Enter' && openToken(token.address)}
      onPointerEnter={() => token.tradable && void prepareBuy(token.address as Address, amount)}
      className="group cursor-pointer space-y-2 rounded-xl bg-white/[.025] p-2.5 transition-colors hover:bg-white/[.06]"
    >
      <div className="flex items-start gap-2.5">
        <Avatar address={token.address} uri={token.uri} size={40} />
        <div className="min-w-0 flex-1 leading-snug">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold">{token.symbol}</span>
            <span className="truncate text-[12px] text-muted">{token.name}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[12px] text-faint">
            <span className="num">{age(token.created_at, now)}</span>
            {padName && <span className="truncate rounded bg-white/[.07] px-1 text-[10px] text-muted">{padName}</span>}
            <Socials links={token.links} />
          </div>
        </div>
        <div className="shrink-0 text-right leading-snug">
          <div className="num text-[14px] font-semibold">{money(token.market_cap)}</div>
          <Change value={token.change_24h ?? 0} className="text-[11px]" />
        </div>
      </div>
      <div className="flex items-center gap-3 text-[12px] text-muted">
        <span className="num" title="Volume in 24 hours">
          Vol {money(token.volume_24h ?? 0)}
        </span>
        <span className="num" title="Holders">
          {token.holders} holders
        </span>
        <span className="num" title="Trades in 24 hours">
          {token.trades_24h ?? 0} tx
        </span>
      </div>
      {!token.graduated && token.progress > 0 && (
        <div className="flex items-center gap-2">
          <Progress value={token.progress} className="flex-1" />
          <span className="num text-[11px] text-faint">{Math.round(token.progress * 100)}%</span>
        </div>
      )}
      <div className="flex items-end justify-between gap-2">
        <RiskChips risk={token.risk} />
        {token.tradable && (
          <button onClick={buy} disabled={busy} className="btn btn-accent num h-7 shrink-0 rounded-[6px] px-2.5 text-[12px]" aria-label={`Buy ${token.symbol} for ${amount} ZRO`}>
            {busy ? 'Buying' : `Buy ${amount}`}
          </button>
        )}
      </div>
    </div>
  );
}

type FilterField = { key: keyof PulseFilter; label: string; scale?: number; unit?: string };
const FILTER_FIELDS: FilterField[][] = [
  [
    { key: 'min_age', label: 'Age from', scale: 60, unit: 'min' },
    { key: 'max_age', label: 'Age up to', scale: 60, unit: 'min' },
  ],
  [
    { key: 'min_mcap', label: 'Cap from', unit: 'ZRO' },
    { key: 'max_mcap', label: 'Cap up to', unit: 'ZRO' },
  ],
  [
    { key: 'min_holders', label: 'Holders from' },
    { key: 'max_holders', label: 'Holders up to' },
  ],
  [
    { key: 'min_progress', label: 'Progress from', scale: 0.01, unit: '%' },
    { key: 'min_volume', label: 'Volume from', unit: 'ZRO' },
  ],
  [
    { key: 'max_dev', label: 'Dev at most', scale: 0.01, unit: '%' },
    { key: 'max_top10', label: 'Top 10 at most', scale: 0.01, unit: '%' },
  ],
  [
    { key: 'max_snipers', label: 'Snipers at most', scale: 0.01, unit: '%' },
    { key: 'max_bundles', label: 'Bundle at most', scale: 0.01, unit: '%' },
  ],
  [
    { key: 'max_insiders', label: 'Insiders at most', scale: 0.01, unit: '%' },
    { key: 'min_smart', label: 'Smart holders from' },
  ],
];

function FilterPanel({ filter, onChange, onClose }: { filter: PulseFilter; onChange: (f: PulseFilter) => void; onClose: () => void }) {
  const pads = useLaunchpads();
  const [draft, setDraft] = useState<PulseFilter>(filter);
  const shown = (f: FilterField) => {
    const v = draft[f.key];
    return typeof v === 'number' ? String(+(v / (f.scale ?? 1)).toFixed(4)) : '';
  };
  const set = (f: FilterField, text: string) => {
    const n = Number(text);
    setDraft({ ...draft, [f.key]: text === '' || !Number.isFinite(n) ? undefined : n * (f.scale ?? 1) });
  };
  return (
    <div className="panel absolute left-0 right-0 top-12 z-30 space-y-2.5 p-3 shadow-2xl" role="dialog" aria-label="Filters">
      {FILTER_FIELDS.map((row, i) => (
        <div key={i} className="grid grid-cols-2 gap-2">
          {row.map((f) => (
            <label key={f.key} className="text-[12px] text-muted">
              {f.label}
              {f.unit && <span className="text-faint">, {f.unit}</span>}
              <input value={shown(f)} onChange={(e) => set(f, e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="Any" className="field num mt-1 h-8 w-full text-[13px]" />
            </label>
          ))}
        </div>
      ))}
      <div className="flex items-center gap-3 text-[13px]">
        <label className="flex items-center gap-1.5 text-muted">
          <input type="checkbox" checked={Boolean(draft.socials)} onChange={(e) => setDraft({ ...draft, socials: e.target.checked || undefined })} />
          Has socials
        </label>
        <select value={draft.launchpad ?? ''} onChange={(e) => setDraft({ ...draft, launchpad: e.target.value || undefined })} className="field h-8 flex-1 text-[13px]" aria-label="Launchpad">
          <option value="">Every launchpad</option>
          {pads.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={() => (onChange(draft), onClose())} className="btn btn-accent h-8 flex-1 text-[13px]">
          Apply
        </button>
        <button onClick={() => (onChange({}), onClose())} className="btn btn-soft h-8 flex-1 text-[13px]">
          Clear
        </button>
      </div>
    </div>
  );
}

function Column({ column, saved, onSave }: { column: (typeof COLUMNS)[number]; saved: Saved; onSave: (s: Saved) => void }) {
  const filter = saved.filters[column.key] ?? {};
  const quick = useWallet((s) => s.quickSize);
  const amount = saved.amounts[column.key] || quick;
  const [tokens, setTokens] = useState<RiskyToken[] | null>(null);
  const [paused, setPaused] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const now = useNow(1000);
  const pads = useLaunchpads();
  const padName = useMemo(() => new Map(pads.map((p) => [p.id, p.name])), [pads]);
  const key = JSON.stringify(filter);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const pending = useRef(false);

  const refresh = useRef(async () => {});
  refresh.current = async () => {
    try {
      const next = await pulse(column.key, JSON.parse(key) as PulseFilter);
      if (!pausedRef.current) setTokens(next);
    } catch {
      // the next event or poll tries again
    }
  };
  useEffect(() => {
    setTokens(null);
    void refresh.current();
    const id = setInterval(() => void refresh.current(), 10_000);
    return () => clearInterval(id);
  }, [key]);
  useEffect(() => {
    if (!paused && pending.current) {
      pending.current = false;
      void refresh.current();
    }
  }, [paused]);
  // New trades and launches redraw the column, at most every second and a half, and not while the pointer is on it.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useStream((type) => {
    if (!['trade', 'launch', 'graduated'].includes(type)) return;
    if (pausedRef.current) return void (pending.current = true);
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      void refresh.current();
    }, 1500);
  });

  const active = Object.values(filter).filter((v) => v !== undefined).length;
  return (
    <section className="panel relative flex min-h-0 flex-col" onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/[.05] px-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="font-semibold">{column.label}</h2>
            {tokens && <span className="num text-[12px] text-faint">{tokens.length}</span>}
            {paused && <span className="text-[11px] text-accent">Paused</span>}
          </div>
          <div className="truncate text-[11px] text-faint">{column.hint}</div>
        </div>
        <label className="flex items-center gap-1 text-[12px] text-muted" title="What a Buy button in this column spends">
          <input
            value={saved.amounts[column.key] ?? ''}
            placeholder={quick}
            onChange={(e) => onSave({ ...saved, amounts: { ...saved.amounts, [column.key]: e.target.value.replace(/[^0-9.]/g, '') } })}
            inputMode="decimal"
            className="field num h-8 w-16 px-2 text-right text-[13px]"
            aria-label={`Buy amount for ${column.label}`}
          />
          ZRO
        </label>
        <button onClick={() => setFiltering((v) => !v)} className={cn('pill h-8 text-[12px]', active > 0 && 'pill-on')} aria-expanded={filtering}>
          {active > 0 ? `Filters ${active}` : 'Filters'}
        </button>
      </header>
      {filtering && <FilterPanel filter={filter} onChange={(f) => onSave({ ...saved, filters: { ...saved.filters, [column.key]: f } })} onClose={() => setFiltering(false)} />}
      <div className="soft-scroll min-h-0 flex-1 space-y-1.5 p-2">
        {tokens === null ? (
          <div className="p-6 text-center text-[13px] text-faint">Loading</div>
        ) : tokens.length === 0 ? (
          <Empty title={column.empty} body={active ? 'Loosen the filters to see more.' : undefined} />
        ) : (
          tokens.map((t) => <Card key={t.address} token={t} amount={amount} now={now} padName={t.launchpad ? padName.get(t.launchpad) : undefined} />)
        )}
      </div>
    </section>
  );
}

const WINDOWS: Window[] = ['1m', '5m', '1h', '6h', '24h'];

function Trending() {
  const [window, setWindow] = useState<Window>('1h');
  const [sort, setSort] = useState<'volume' | 'change' | 'trades'>('volume');
  const [tokens, setTokens] = useState<TrendingToken[] | null>(null);
  const { money } = useFormat();
  const now = useNow(1000);
  useEffect(() => {
    let live = true;
    const load = () => trending(window, sort).then((t) => live && setTokens(t), () => {});
    setTokens(null);
    void load();
    const id = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [window, sort]);
  return (
    <section className="panel p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {WINDOWS.map((w) => (
          <button key={w} onClick={() => setWindow(w)} className={cn('pill num', window === w && 'pill-on')}>
            {w}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-white/10" />
        {(['volume', 'change', 'trades'] as const).map((s) => (
          <button key={s} onClick={() => setSort(s)} className={cn('pill', sort === s && 'pill-on')}>
            {s === 'volume' ? 'Volume' : s === 'change' ? 'Gainers' : 'Trades'}
          </button>
        ))}
      </div>
      {tokens === null ? (
        <div className="p-6 text-center text-[13px] text-faint">Loading</div>
      ) : tokens.length === 0 ? (
        <Empty title="Nothing traded in this window" />
      ) : (
        <div className="space-y-1">
          {tokens.map((t, i) => (
            <div key={t.address} role="button" tabIndex={0} onClick={() => openToken(t.address)} onKeyDown={(e) => e.key === 'Enter' && openToken(t.address)} className="grid cursor-pointer grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/[.04] sm:grid-cols-[24px_minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_minmax(0,2fr)]">
              <span className="num text-[12px] text-faint">{i + 1}</span>
              <div className="flex min-w-0 items-center gap-2">
                <Avatar address={t.address} uri={t.uri} size={28} />
                <div className="min-w-0 leading-tight">
                  <div className="truncate font-semibold">{t.symbol}</div>
                  <div className="num text-[11px] text-faint">{age(t.created_at, now)}</div>
                </div>
              </div>
              <div className="num text-right sm:text-left">{money(t.market_cap)}</div>
              <div className="num hidden text-muted sm:block" title={`Volume in ${window}`}>
                {money(t.window_volume)}
              </div>
              <div className="num hidden text-muted sm:block">{t.window_trades} tx</div>
              <Change value={t.window_change} className="hidden sm:block" />
              <div className="hidden sm:block">
                <RiskChips risk={t.risk} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function PulsePage() {
  const [saved, setSaved] = useState<Saved>({ filters: {}, amounts: {} });
  const [view, setView] = useState<'columns' | 'trending'>('columns');
  const [phoneColumn, setPhoneColumn] = useState<PulseColumn>('new');
  useEffect(() => setSaved(load()), []);
  const save = (s: Saved) => {
    setSaved(s);
    store(s);
  };
  // Warm the indexer's answer so the first column paints sooner.
  useEffect(() => void get('/api/v1/pulse/new').catch(() => {}), []);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <h1 className="mr-2 text-[18px] font-bold">Pulse</h1>
        <button onClick={() => setView('columns')} className={cn('pill', view === 'columns' && 'pill-on')}>
          Live
        </button>
        <button onClick={() => setView('trending')} className={cn('pill', view === 'trending' && 'pill-on')}>
          Trending
        </button>
        <span className="flex-1" />
        <span className="hidden text-[12px] text-faint sm:inline">Buy amount and slippage</span>
        <Presets />
      </div>
      {view === 'trending' ? (
        <Trending />
      ) : (
        <>
          <div className="flex gap-1 px-1 lg:hidden">
            {COLUMNS.map((c) => (
              <button key={c.key} onClick={() => setPhoneColumn(c.key)} className={cn('pill flex-1', phoneColumn === c.key && 'pill-on')}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-3">
            {COLUMNS.map((c) => (
              <div key={c.key} className={cn('min-h-[70vh] lg:min-h-0', phoneColumn !== c.key && 'hidden lg:flex', 'flex flex-col')}>
                <Column column={c} saved={saved} onSave={save} />
              </div>
            ))}
          </div>
        </>
      )}
      <p className="px-1 text-[11px] text-faint">Shares are of the whole supply and come from what the index has seen: a label means a wallet behaves like one, not that it is one.</p>
    </div>
  );
}
