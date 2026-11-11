'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { Address } from 'viem';
import { useLive, useStream, type Leader, type Token, type Trade } from '@/lib/api';
import { age, zro, cn, usdText } from '@/lib/format';
import { useFlip, useNow } from '@/lib/hooks';
import { useLayout, type ListTab } from '@/lib/layout';
import { useFormat } from '@/lib/money';
import { openToken, openWallet, useSelection } from '@/lib/selection';
import { useSocial } from '@/lib/social';
import { useLaunchpads } from '@/lib/launchpads';
import { prepareBuy } from '@/lib/prep';
import { marketBuy } from '@/lib/trade';
import { nameOf, useTracked } from '@/lib/tracked';
import { useWallet } from '@/lib/wallet';
import { Avatar, Change, Empty } from './bits';
import { WalletPic } from './WalletPic';
import { TrackedPanel } from './TrackedPanel';

const tradable = (t: Token) => t.tradable;

async function quickBuy(token: Token) {
  const { account, create, quickSize } = useWallet.getState();
  if (!account) {
    create();
    return;
  }
  openToken(token.address);
  try {
    await marketBuy(token.address as Address, token.symbol, quickSize);
  } catch {
    // the confirmation card already says what went wrong
  }
}

function Row({ token, now, selected, nearPool, lookalike, flash, padName }: { token: Token; now: number; selected: boolean; nearPool: boolean; lookalike: boolean; flash?: { id: number; up: boolean }; padName?: string }) {
  const size = useWallet((s) => s.quickSize);
  const { money, usd } = useFormat();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef(flash?.id);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  useEffect(() => {
    if (!flash || flash.id === seen.current) return;
    seen.current = flash.id;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    ref.current?.animate([{ backgroundColor: `rgb(var(--${flash.up ? 'up' : 'down'}) / .12)` }, { backgroundColor: 'transparent' }], { duration: 800, easing: 'ease-out' });
  }, [flash]);

  const buy = async (e: MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    await quickBuy(token);
    setBusy(false);
  };

  const subtitle = nearPool && token.source === 'terminal' ? `${Math.round(token.progress * 100)}% to pool` : token.name;
  // The figure without its unit, for places too small to repeat it on every row.
  const plain = (v: number) => (usd ? usdText(v * usd) : zro(v));

  return (
    <div
      ref={ref}
      data-flip={token.address}
      role="button"
      tabIndex={0}
      onClick={() => openToken(token.address)}
      onPointerEnter={() => {
        // The buy button on this row may be next. Being ready for it costs a read or two.
        if (tradable(token)) void prepareBuy(token.address as Address, size);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') openToken(token.address);
      }}
      className={cn('group relative isolate flex h-[56px] cursor-pointer items-center gap-2 overflow-hidden rounded-xl pl-[52px] pr-2 transition-colors duration-150', selected ? 'bg-white/[.08] ring-1 ring-inset ring-accent/45' : 'bg-white/[.025] hover:bg-white/[.05]')}
    >
      <RowFill address={token.address} uri={token.uri} />
      <div className="min-w-0 flex-1 leading-snug">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-semibold">{token.symbol}</span>
          {lookalike && <span className="shrink-0 rounded bg-down/15 px-1 text-[10px] font-semibold text-down" title="A far bigger token on this list has the same ticker">Copy</span>}
          {padName && <span className="shrink-0 truncate rounded bg-white/[.07] px-1 text-[10px] font-medium text-muted" title={`Launched on ${padName}`}>{padName}</span>}
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-muted">
          <span className="num shrink-0 text-faint">{age(token.created_at, now)}</span>
          <span className="truncate">{subtitle}</span>
        </div>
      </div>
      <div className="col-wide num text-right text-[13px] text-muted">{plain(token.liquidity)}</div>
      <div className="col-wide num text-right text-[13px] text-muted">{token.holders}</div>
      <div className="col-vol shrink-0 text-right leading-snug">
        <div className="num truncate text-[13px]">{plain(token.volume_24h)}</div>
        <div className="num narrow-only truncate text-[11px] text-faint" title="ZRO in its curve or pool">
          Liq {plain(token.liquidity)}
        </div>
        <div className="num wide-only truncate text-[11px] text-faint">{token.trades_24h} tx</div>
      </div>
      <div className="col-cap relative shrink-0 text-right leading-snug">
        <div className={cn('transition-opacity duration-150', tradable(token) && 'group-hover:opacity-0 group-has-[button:focus-visible]:opacity-0')}>
          {token.price > 0 ? <div className="num truncate">{money(token.market_cap)}</div> : <div className="text-[12px] text-faint">No price</div>}
          {token.price > 0 && <Change value={token.change_24h} className="text-[12px]" />}
        </div>
        {tradable(token) && (
          <button onClick={buy} disabled={busy} className="btn btn-accent num absolute right-0 top-1/2 h-8 -translate-y-1/2 whitespace-nowrap rounded-[7px] px-2.5 text-[13px] opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100" aria-label={`Buy ${token.symbol} for ${size} ZRO`}>
            {busy ? 'Buying' : `Buy ${size}`}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The token's picture in the row's left corner instead of a round avatar: a square the row's height, kept at its own size so
 * it stays recognisable, fading into the dark on its right. A token with no picture gets a soft square in a colour of its own.
 */
function RowFill({ address, uri }: { address: string; uri?: string | null }) {
  const [broken, setBroken] = useState(false);
  const fade = 'linear-gradient(90deg, #000 0%, #000 45%, transparent 100%)';
  const picture = uri && /^https?:\/\//.test(uri) && !broken;
  const hue = parseInt(address.slice(2, 8), 16) % 360;
  return (
    <div className="pointer-events-none absolute inset-y-0 left-0 -z-10 aspect-square h-full" aria-hidden="true" style={{ maskImage: fade, WebkitMaskImage: fade }}>
      {picture ? (
        <img src={uri} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover opacity-90 transition-opacity duration-200 group-hover:opacity-100" />
      ) : (
        <div className="h-full w-full opacity-60" style={{ background: `hsl(${hue} 45% 40%)` }} />
      )}
    </div>
  );
}

const FILTERS = [
  { key: 'new', label: 'New', title: 'Newest first', query: 'sort=new', sort: 'new', empty: 'No tokens on this chain yet' },
  { key: 'hot', label: 'Hot', title: 'Most traded in 24 hours', query: 'sort=volume', sort: 'volume', empty: 'No tokens on this chain yet' },
  { key: 'near', label: 'Near', title: 'Closest to moving to a pool', query: 'stage=curve&sort=progress', sort: 'progress', empty: 'No token is raising right now' },
  { key: 'pools', label: 'Pools', title: 'Already on a pool', query: 'stage=graduated&sort=volume', sort: 'volume', empty: 'No token has reached a pool yet' },
  { key: 'other', label: 'Other', title: 'Launched outside this terminal', query: 'stage=external&sort=new', sort: 'new', empty: 'Nothing launched elsewhere yet' },
];

function HeadCell({ label, sort, current, onSort, className, title }: { label: string; sort: string; current: string; onSort: (s: string) => void; className?: string; title?: string }) {
  const on = current === sort;
  return (
    <button onClick={() => onSort(sort)} title={title ?? `Sort by ${label.toLowerCase()}`} className={cn('flex items-center gap-0.5 transition-colors hover:text-ink', on && 'font-medium text-ink', className)}>
      {label}
      {on && (
        <svg viewBox="0 0 8 8" className="h-2 w-2 shrink-0" fill="currentColor" aria-hidden="true">
          <path d="M4 6.5L1 2h6z" />
        </svg>
      )}
    </button>
  );
}

function Tokens({ id, tools }: { id: 'a' | 'b'; tools?: ReactNode }) {
  const primary = id === 'a';
  const saveKey = `terminal.tokens.${id}`;
  const [filter, setFilterState] = useState(FILTERS[primary ? 0 : 1]!);
  const [starredOnly, setStarredOnly] = useState(false);
  const [sort, setSort] = useState<string | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(saveKey) ?? 'null') as { filter?: string; starred?: boolean; sort?: string | null } | null;
      if (!saved) return;
      const f = FILTERS.find((x) => x.key === saved.filter);
      if (f) setFilterState(f);
      setStarredOnly(Boolean(saved.starred));
      setSort(saved.sort ?? null);
    } catch {}
  }, [saveKey]);
  const save = (next: { filter?: string; starred?: boolean; sort?: string | null }) => {
    try {
      localStorage.setItem(saveKey, JSON.stringify({ filter: filter.key, starred: starredOnly, sort, ...next }));
    } catch {}
  };
  const pick = (f: (typeof FILTERS)[number]) => {
    setStarredOnly(false);
    setFilterState(f);
    setSort(null);
    save({ filter: f.key, starred: false, sort: null });
  };

  // Which launchpad to show. Nothing to choose until there's a second one, and the choice is kept per list.
  const pads = useLaunchpads();
  const padNames = useMemo(() => new Map(pads.filter((p) => !p.builtin).map((p) => [p.id, p.name])), [pads]);
  const [pad, setPad] = useState('');
  useEffect(() => {
    try {
      setPad(localStorage.getItem(`${saveKey}.pad`) ?? '');
    } catch {}
  }, [saveKey]);
  const pickPad = (id: string) => {
    setPad(id);
    try {
      localStorage.setItem(`${saveKey}.pad`, id);
    } catch {}
  };

  const stars = useSocial((s) => s.stars);
  const query = useSelection((s) => s.query).trim();
  const address = useSelection((s) => s.address);
  const select = useSelection((s) => s.select);

  const current = sort ?? (starredOnly ? 'active' : filter.sort);
  const listQuery = filter.query.replace(/sort=\w+/, `sort=${current}`);
  const path = query
    ? `/api/v1/tokens?q=${encodeURIComponent(query)}&limit=60${sort ? `&sort=${sort}` : ''}`
    : starredOnly
      ? `/api/v1/tokens?addresses=${stars.join(',')}&sort=${current}&limit=200`
      : `/api/v1/tokens?${listQuery}&limit=60${pad ? `&launchpad=${encodeURIComponent(pad)}` : ''}`;
  const { data, error } = useLive<{ tokens: Token[] }>(path, (t) => t === 'trade' || t === 'launch' || t === 'graduated', 500, true);
  const now = useNow();
  const [flashes, setFlashes] = useState<Record<string, { id: number; up: boolean }>>({});
  const flashId = useRef(0);

  useStream((type, d) => {
    if (type !== 'trade') return;
    const flash = ++flashId.current;
    setFlashes((f) => ({ ...f, [d.token]: { id: flash, up: Boolean(d.isBuy) } }));
  });

  const tokens = data?.tokens;
  const container = useFlip(tokens?.map((t) => t.address).join() ?? '', path);

  // Open something straight away on a wide screen, so the page is never half empty.
  useEffect(() => {
    if (primary && !address && tokens?.[0] && window.matchMedia('(min-width: 1024px)').matches) select((tokens.find(tradable) ?? tokens[0]).address);
  }, [primary, address, tokens, select]);

  // Up and down (or J and K) step through the first list.
  useEffect(() => {
    if (!primary) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || !tokens?.length) return;
      const i = tokens.findIndex((t) => t.address === address);
      const k = e.key.toLowerCase();
      if (k === 'arrowdown' || k === 'j') {
        e.preventDefault();
        openToken(tokens[Math.min(i + 1, tokens.length - 1)]!.address, true);
      } else if (k === 'arrowup' || k === 'k') {
        e.preventDefault();
        openToken(tokens[Math.max(i - 1, 0)]!.address, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [primary, tokens, address]);

  const emptyText = query ? 'Nothing matches that' : starredOnly ? 'Star a token and it stays here' : filter.empty;
  // A token with the ticker of a far bigger one on the same list is almost always riding its name: marked, so a fast click
  // doesn't buy the wrong one.
  const biggest = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tokens ?? []) m.set(t.symbol.toLowerCase(), Math.max(m.get(t.symbol.toLowerCase()) ?? 0, t.market_cap));
    return m;
  }, [tokens]);
  const onSort = (s: string) => {
    const next = s === current ? null : s;
    setSort(next);
    save({ sort: next });
  };

  return (
    <>
      {query ? (
        <div className="shrink-0 px-4 pb-2 pt-3 text-[13px] text-muted">Results for {query}</div>
      ) : (
        <div className="flex shrink-0 items-center gap-0.5 px-2 pb-1.5 pt-2.5">
          <div className="grid min-w-0 flex-1 grid-flow-col auto-cols-auto items-center gap-0.5" role="tablist">
            <button
              role="tab"
              aria-selected={starredOnly}
              aria-label="Starred tokens"
              title="Starred tokens"
              onClick={() => {
                setStarredOnly(true);
                setSort(null);
                save({ starred: true, sort: null });
              }}
              className={cn('pill flex items-center justify-center px-1.5', starredOnly && 'pill-on')}
            >
              <svg viewBox="0 0 16 16" className={cn('h-4 w-4', starredOnly && 'text-accent')} fill="currentColor" aria-hidden="true">
                <path d="M8 1.6l1.95 4 4.4.6-3.2 3.08.78 4.37L8 11.57l-3.93 2.08.78-4.37-3.2-3.08 4.4-.6z" />
              </svg>
            </button>
            {FILTERS.map((f) => {
              const on = !starredOnly && filter.key === f.key;
              return (
                <button key={f.key} role="tab" aria-selected={on} onClick={() => pick(f)} title={f.title} className={cn('pill px-1 text-center', on && 'pill-on')}>
                  {f.label}
                </button>
              );
            })}
          </div>
          {tools}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[.05] px-3.5 pb-1 text-[11px] text-faint">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <HeadCell label="Token" sort="new" current={current} onSort={onSort} className="shrink-0" title="Newest first" />
          {pads.length > 1 && !query && !starredOnly && (
            <select value={pad} onChange={(e) => pickPad(e.target.value)} aria-label="Show tokens from this launchpad" title="Show tokens from this launchpad" className="min-w-0 max-w-[110px] cursor-pointer truncate bg-transparent text-[11px] text-faint outline-none transition-colors hover:text-ink focus-visible:text-ink [&>option]:bg-card [&>option]:text-ink">
              <option value="">All launchpads</option>
              {pads.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </span>
        <span className="col-wide text-right" title="ZRO in its curve or pool">Liq</span>
        <span className="col-wide text-right">Holders</span>
        <HeadCell label="Vol 24h" sort="volume" current={current} onSort={onSort} className="col-vol shrink-0 justify-end" />
        <HeadCell label="Cap" sort="mcap" current={current} onSort={onSort} className="col-cap shrink-0 justify-end" />
      </div>
      <div ref={container} className="no-scrollbar relative min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-1.5 pb-1.5 pt-0.5">
        {error && !data && <Empty title="Can't load tokens" body="The indexer isn't answering. It will retry on its own." />}
        {tokens && !tokens.length && <Empty title={emptyText} />}
        {!data && !error && (
          <div className="space-y-1 px-1" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="h-[52px] animate-pulse rounded-xl bg-white/[.04]" />
            ))}
          </div>
        )}
        {tokens?.map((t) => <Row key={t.address} token={t} now={now} selected={t.address === address} nearPool={filter.key === 'near' && !query && !starredOnly} lookalike={t.market_cap * 20 < (biggest.get(t.symbol.toLowerCase()) ?? 0)} flash={flashes[t.address]} padName={t.launchpad ? padNames.get(t.launchpad) : undefined} />)}
      </div>
    </>
  );
}

function Feed({ tools }: { tools?: ReactNode }) {
  const [following, setFollowing] = useState(false);
  const list = useTracked();
  const path = following ? `/api/v1/market/trades?limit=50&traders=${list.map((t) => t.address).join(',')}` : '/api/v1/market/trades?limit=50';
  const { data } = useLive<{ trades: Trade[] }>(path, (t) => t === 'trade', 300, true);
  const now = useNow();
  const { money } = useFormat();
  const trades = data?.trades;
  const container = useFlip(trades?.map((t) => t.tx_hash + t.log_index).join() ?? '', path);
  const me = useWallet((s) => s.account?.address.toLowerCase());
  return (
    <>
      <div className="flex shrink-0 items-center gap-1 px-2.5 pb-2 pt-3" role="tablist">
        <button role="tab" aria-selected={!following} onClick={() => setFollowing(false)} className={cn('pill', !following && 'pill-on')}>
          Everyone
        </button>
        <button role="tab" aria-selected={following} onClick={() => setFollowing(true)} className={cn('pill', following && 'pill-on')}>
          Following
        </button>
        <span className="ml-auto">{tools}</span>
      </div>
      <div ref={container} className="soft-scroll relative min-h-0 flex-1 px-1.5 pb-1.5">
        {trades && !trades.length && <Empty title={following ? 'Nothing from people you follow' : 'No trades yet'} body={following ? 'Follow traders from Leaders and their trades show up here.' : undefined} />}
        {trades?.map((t) => (
          <div key={t.tx_hash + t.log_index} data-flip={t.tx_hash + t.log_index} role="button" tabIndex={0} onClick={() => openToken(t.token)} onKeyDown={(e) => e.key === 'Enter' && openToken(t.token)} className="flex h-[52px] w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 text-left transition-colors duration-150 hover:bg-white/[.04]">
            <Avatar address={t.token} uri={t.uri} size={30} />
            <div className="min-w-0 flex-1 leading-snug">
              <div className="truncate">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openWallet(t.trader);
                  }}
                  className="text-muted transition-colors hover:text-accent"
                >
                  {t.trader === me ? 'You' : nameOf(t.trader, list)}
                </button>{' '}
                {t.is_buy ? 'bought' : 'sold'} <span className="font-semibold">{t.symbol}</span>
              </div>
              <div className="num text-[13px] text-faint">{age(t.ts, now)} ago</div>
            </div>
            <span className={cn('num shrink-0', t.is_buy ? 'text-up' : 'text-down')}>{money(t.zro)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

const WINDOWS = [
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: 'all', label: 'All time' },
];

function Leaders({ tools }: { tools?: ReactNode }) {
  const [window_, setWindow] = useState('24h');
  const path = `/api/v1/leaderboard?window=${window_}&limit=50`;
  const { data } = useLive<{ traders: Leader[] }>(path, (t) => t === 'trade', 1500, true);
  const { signed, money } = useFormat();
  const me = useWallet((s) => s.account?.address.toLowerCase());
  const list = useTracked();
  const container = useFlip(data?.traders.map((t) => t.trader).join() ?? '', path);
  return (
    <>
      <div className="flex shrink-0 items-center gap-1 px-2.5 pb-2 pt-3" role="tablist">
        {WINDOWS.map((w) => (
          <button key={w.key} role="tab" aria-selected={window_ === w.key} onClick={() => setWindow(w.key)} className={cn('pill', window_ === w.key && 'pill-on')}>
            {w.label}
          </button>
        ))}
        <span className="ml-auto">{tools}</span>
      </div>
      <div ref={container} className="soft-scroll relative min-h-0 flex-1 px-1.5 pb-1.5">
        {data && !data.traders.length && <Empty title="No trades in this window" />}
        {data?.traders.map((t, i) => (
          <div key={t.trader} data-flip={t.trader} role="button" tabIndex={0} onClick={() => openWallet(t.trader)} onKeyDown={(e) => e.key === 'Enter' && openWallet(t.trader)} className="flex h-[58px] cursor-pointer items-center gap-3 rounded-xl px-2.5 transition-colors duration-150 hover:bg-white/[.04]">
            <span className={cn('num w-5 shrink-0 text-center text-[13px]', i < 3 ? 'font-semibold text-accent' : 'text-faint')}>{i + 1}</span>
            <WalletPic address={t.trader} size={32} />
            <div className="min-w-0 flex-1 leading-snug">
              <div className="flex items-center gap-1.5 font-semibold">
                <span className={cn('num truncate', t.trader === me && 'text-accent')}>{t.trader === me ? 'You' : nameOf(t.trader, list)}</span>
                {list.some((x) => x.address === t.trader) && <span className="shrink-0 rounded bg-white/10 px-1 text-[11px] font-medium text-muted">Following</span>}
              </div>
              <div className="num truncate text-[13px] text-faint" title={`Volume ${money(t.volume)}`}>
                {t.trades} trades, {money(t.volume)}
              </div>
            </div>
            <span className={cn('num shrink-0', t.pnl > 0 ? 'text-up' : t.pnl < 0 ? 'text-down' : 'text-muted')}>{signed(t.pnl)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

const SIZES = ['5', '50', '200', '500'];

function QuickSize() {
  const { quickSize, setQuickSize } = useWallet();
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-white/[.06] px-3 py-2.5">
      <span className="text-[13px] text-muted">Quick buy</span>
      <div className="flex items-center gap-0.5">
        {SIZES.map((s) => (
          <button key={s} onClick={() => setQuickSize(s)} className={cn('num rounded-lg px-2 py-1 text-[13px] transition-colors duration-150', quickSize === s ? 'bg-accent/15 text-accent' : 'text-muted hover:text-ink')}>
            {s}
          </button>
        ))}
        <span className="ml-1 text-[13px] text-faint">ZRO</span>
      </div>
    </div>
  );
}

const iconButton = 'hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/[.06] hover:text-ink xl:flex';

function SplitButton() {
  const split = useLayout((s) => s.split);
  const setSplit = useLayout((s) => s.setSplit);
  return (
    <button onClick={() => setSplit(!split)} aria-pressed={split} title={split ? 'Back to one list' : 'Two lists side by side'} aria-label={split ? 'Back to one list' : 'Two lists side by side'} className={cn(iconButton, split && 'text-accent')}>
      <svg viewBox="0 0 16 16" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="1.8" y="2.5" width="12.4" height="11" rx="2.2" />
        <path d="M8 2.500v11" />
      </svg>
    </button>
  );
}

const SECOND_TABS: Array<{ tab: ListTab; label: string }> = [
  { tab: 'tokens', label: 'Tokens' },
  { tab: 'feed', label: 'Feed' },
  { tab: 'leaders', label: 'Leaders' },
  { tab: 'tracked', label: 'Tracked' },
];

/** The second list, which keeps its own choice of what to show: New beside Hot, say, or Tokens beside Tracked. */
function SecondList() {
  const tab = useLayout((s) => s.tab2);
  const setTab = useLayout((s) => s.setTab2);
  const setSplit = useLayout((s) => s.setSplit);
  const close = (
    <button onClick={() => setSplit(false)} title="Close this list" aria-label="Close this list" className={iconButton}>
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <path d="M4 4l8 8m0-8l-8 8" />
      </svg>
    </button>
  );
  return (
    <section className="list-box panel hidden h-full min-w-0 flex-col overflow-hidden xl:flex">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-white/[.05] px-2 py-1.5" role="tablist">
        {SECOND_TABS.map((t) => (
          <button key={t.tab} role="tab" aria-selected={tab === t.tab} onClick={() => setTab(t.tab)} className={cn('pill px-1.5', tab === t.tab && 'pill-on')}>
            {t.label}
          </button>
        ))}
        <span className="ml-auto">{close}</span>
      </div>
      {tab === 'tokens' && <Tokens id="b" />}
      {tab === 'feed' && <Feed />}
      {tab === 'leaders' && <Leaders />}
      {tab === 'tracked' && <TrackedPanel />}
    </section>
  );
}

/** What the first list shows, picked at its top. On a phone the same choice is in the row of places under the header. */
function ListTabs() {
  const tab = useLayout((s) => s.tab);
  const setTab = useLayout((s) => s.setTab);
  const count = useTracked().length;
  return (
    <div className="hidden shrink-0 items-center gap-0.5 border-b border-white/[.06] px-2 py-1.5 lg:flex" role="tablist" aria-label="List">
      {SECOND_TABS.map((t) => (
        <button key={t.tab} role="tab" aria-selected={tab === t.tab} onClick={() => setTab(t.tab)} className={cn('pill flex items-center gap-1.5 px-2', tab === t.tab && 'pill-on')}>
          {t.label}
          {t.tab === 'tracked' && count > 0 && <span className="num min-w-[16px] rounded-[5px] bg-accent/20 px-1 text-center text-[11px] font-semibold leading-[16px] text-accent">{count}</span>}
        </button>
      ))}
    </div>
  );
}

/** The list column, beside the chart. Its tabs pick what it shows; the chart stays open whatever it is. */
export function TokenList() {
  const tab = useLayout((s) => s.tab);
  const split = useLayout((s) => s.split);
  const tools = <SplitButton />;
  return (
    <div className={cn('h-full', split && 'xl:grid xl:grid-cols-2 xl:gap-2')}>
      <section className="list-box panel flex h-full min-h-[70vh] min-w-0 flex-col overflow-hidden lg:min-h-0">
        <ListTabs />
        {tab === 'tokens' && <Tokens id="a" tools={tools} />}
        {tab === 'feed' && <Feed tools={tools} />}
        {tab === 'leaders' && <Leaders tools={tools} />}
        {tab === 'tracked' && <TrackedPanel tools={tools} />}
        {(tab === 'tokens' || tab === 'tracked') && <QuickSize />}
      </section>
      {split && <SecondList />}
    </div>
  );
}
