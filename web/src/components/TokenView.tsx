'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { get, useLive, useStream, streamTrade, type TokenDetail, type Trade } from '@/lib/api';
import { feeParts, pctOf } from '@/lib/config';
import { age, cn, compact, short } from '@/lib/format';
import { useFlash, useNow } from '@/lib/hooks';
import { useLayout } from '@/lib/layout';
import { useFormat } from '@/lib/money';
import { openWallet } from '@/lib/selection';
import { useSocial } from '@/lib/social';
import { nameOf, useTracked } from '@/lib/tracked';
import { useWallet } from '@/lib/wallet';
import { Avatar, Change, Empty, Price } from './bits';
import { Chart } from './Chart';
import { Splitter } from './Splitter';
import { FirstBuyers, HolderMap, LabelledHolders, RiskLine, Safety, TopTraders } from './TokenAnalysis';
import { AlertButton } from './Alerts';

function Stat({ label, value, title, children }: { label: string; value?: number; title?: string; children: React.ReactNode }) {
  const flash = useFlash(value ?? 0);
  return (
    <div className="shrink-0 rounded-xl bg-white/[.045] px-2.5 py-1 leading-snug" title={title}>
      <div className="text-xs text-muted">{label}</div>
      <div className={cn('num whitespace-nowrap transition-colors duration-500', flash)}>{children}</div>
    </div>
  );
}

/** A token's links, as small icons by its name. Only plain web addresses are ever linked. */
const SOCIALS: Array<{ key: string; name: string; icon: React.ReactNode }> = [
  {
    key: 'twitter',
    name: 'X',
    icon: <path d="M3 3l10 10M13 3L3 13" />,
  },
  {
    key: 'telegram',
    name: 'Telegram',
    icon: <path d="M14 2.5L1.8 7.3l4 1.5 1.5 4.6 2.3-3 3 2.2L14 2.5zM5.8 8.8l6-4.6" />,
  },
  {
    key: 'discord',
    name: 'Discord',
    icon: <path d="M4.5 4.2C6.8 3.3 9.2 3.3 11.5 4.2c1 1.6 1.6 3.6 1.7 5.8-.9.9-2 1.5-3.2 1.8l-.7-1.2M4.5 4.2C3.5 5.8 2.9 7.8 2.8 10c.9.9 2 1.5 3.2 1.8l.7-1.2M5.2 10.4c1.8.7 3.8.7 5.6 0M6.2 7.6h.1M9.7 7.6h.1" />,
  },
  {
    key: 'website',
    name: 'Website',
    icon: (
      <>
        <circle cx="8" cy="8" r="6" />
        <path d="M2 8h12M8 2c1.8 1.7 2.6 3.7 2.6 6S9.8 12.3 8 14C6.2 12.3 5.4 10.3 5.4 8S6.2 3.7 8 2z" />
      </>
    ),
  },
];
const safeHref = (v: string | undefined) => (v && /^https?:\/\//i.test(v) ? v : null);

/** The token's contract, big enough to hit at once: one click copies the whole address. As tall as the figures beside it. */
function ContractPlate({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(address).then(() => setCopied(true), () => {})}
      title={`Copy the contract address\n${address}`}
      className={cn('flex h-[44px] w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 text-left transition-colors duration-150', copied ? 'bg-up/15' : 'bg-white/[.06] hover:bg-white/[.1]')}
    >
      <span className="min-w-0 flex-1 leading-snug">
        <span className="block text-xs text-muted">Contract</span>
        <span className="num block truncate text-[14px] text-ink">{short(address, 10, 8)}</span>
      </span>
      <span className={cn('flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-semibold', copied ? 'text-up' : 'bg-accent text-black')}>
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {copied ? <path d="m3.5 8.5 3 3 6-7" /> : <path d="M5.5 5.5V3.2c0-.4.3-.7.7-.7h6.6c.4 0 .7.3.7.7v6.6c0 .4-.3.7-.7.7h-2.3M3.2 5.5h6.6c.4 0 .7.3.7.7v6.6c0 .4-.3.7-.7.7H3.2c-.4 0-.7-.3-.7-.7V6.2c0-.4.3-.7.7-.7z" />}
        </svg>
        {copied ? 'Copied' : 'Copy'}
      </span>
    </button>
  );
}

/** What a link reads as on its button: the handle for a profile, the domain for a site. */
function linkText(key: string, href: string) {
  try {
    const url = new URL(href);
    if (key === 'website') return url.hostname.replace(/^www\./, '');
    const handle = url.pathname.split('/').filter(Boolean)[0];
    return handle ? (key === 'discord' ? handle : `@${handle}`) : url.hostname;
  } catch {
    return href;
  }
}

/**
 * A token's links, always all four in the same places so they're found at a glance. One its creator didn't give stays as
 * a dim placeholder that says so.
 */
function Socials({ links }: { links: Record<string, string> | null }) {
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label="Links">
      {SOCIALS.map((x) => {
        const href = safeHref(links?.[x.key]);
        const glyph = (
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {x.icon}
          </svg>
        );
        return href ? (
          <a key={x.key} href={href} target="_blank" rel="noopener noreferrer nofollow" title={`${x.name}: ${href}`} className="flex h-[30px] max-w-[160px] items-center gap-1.5 rounded-lg bg-white/[.06] px-2.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-white/[.1]">
            {glyph}
            <span className="truncate">{linkText(x.key, href)}</span>
          </a>
        ) : (
          <span key={x.key} title={`No ${x.name} link was given at launch`} className="flex h-[30px] items-center gap-1.5 rounded-lg border border-dashed border-white/[.08] px-2.5 text-[12.5px] text-faint">
            {glyph}
            {x.name}
          </span>
        );
      })}
    </div>
  );
}

/** How many people have this token's page open now. The page checks in every 20 s with an id kept for this tab. */
function useViewers(token: string) {
  const [viewers, setViewers] = useState<number | null>(null);
  useEffect(() => {
    let id = '';
    try {
      id = sessionStorage.getItem('terminal.viewer') ?? '';
      if (!id) sessionStorage.setItem('terminal.viewer', (id = Math.random().toString(36).slice(2, 14)));
    } catch {
      id = Math.random().toString(36).slice(2, 14);
    }
    let live = true;
    const ask = () => get<{ viewers: number }>(`/api/v1/tokens/${token}/viewers?id=${id}`).then((r) => live && setViewers(r.viewers), () => {});
    setViewers(null);
    ask();
    const t = setInterval(ask, 20_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [token]);
  return viewers;
}

function Viewers({ token }: { token: string }) {
  const n = useViewers(token);
  if (!n) return null;
  return (
    <span className="flex items-center gap-1 rounded-md bg-white/[.06] px-1.5 text-[12px] leading-6 text-muted" title={`${n} ${n === 1 ? 'person has' : 'people have'} this token open right now`}>
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
        <circle cx="8" cy="8" r="2" />
      </svg>
      <span className="num">{n}</span>
    </span>
  );
}

const FILTERS = ['All', 'Buys', 'Sells', 'Large', 'Dev', 'Tracked'] as const;
type Filter = (typeof FILTERS)[number];
/** A trade this big counts as large. */
const LARGE_ZRO = 200;
const ROWS = 50;

/** What a token's fee has paid out so far, one figure for each place it goes: its creator, its holders and the burn. */
function Earned({ token }: { token: TokenDetail }) {
  const { money } = useFormat();
  const holdersBps = token.holders_bps ?? (token.fee_route === 'holders' ? 10_000 : 0);
  const burnBps = token.burn_bps ?? 0;
  const f = feeParts(token.fee_bps, holdersBps, burnBps);
  const rate = `${pctOf(f.total)} fee each way`;
  return (
    <>
      {f.creator > 0 && (
        <Stat label="Dev earned" value={token.creator_earned ?? token.earner_fees} title={`${rate}. The creator gets ${pctOf(f.creator)} of each trade`}>
          {money(token.creator_earned ?? token.earner_fees ?? 0)}
        </Stat>
      )}
      {f.holders > 0 && (
        <Stat label="Paid to holders" value={token.holders_earned} title={`${rate}. Holders get ${pctOf(f.holders)} of each trade, in ZRO`}>
          {money(token.holders_earned ?? 0)}
        </Stat>
      )}
      {f.burn > 0 && (
        <Stat label="Burned" value={token.burned_zro} title={`${rate}. ${pctOf(f.burn)} of each trade buys it back and burns it${token.burned_tokens ? `: ${compact(token.burned_tokens)} ${token.symbol} so far` : ''}`}>
          {money(token.burned_zro ?? 0)}
        </Stat>
      )}
    </>
  );
}

function WalletName({ address, creator, me }: { address: string; creator: string | null; me?: string }) {
  const list = useTracked();
  const name = address === me ? 'You' : nameOf(address, list);
  const followed = list.some((t) => t.address === address);
  return (
    <button onClick={() => openWallet(address)} className="flex min-w-0 items-center gap-1.5 text-left transition-colors hover:text-accent">
      <span className={cn('num truncate', address === me ? 'font-medium text-accent' : followed ? 'font-medium text-ink' : 'text-muted')}>{name}</span>
      {address === creator && <span className="shrink-0 rounded bg-accent/15 px-1 text-[10px] font-semibold text-accent">Dev</span>}
      {followed && address !== me && <span className="shrink-0 text-accent" title="You follow this wallet">●</span>}
    </button>
  );
}

function Trades({ token, filter }: { token: TokenDetail; filter: Filter }) {
  const me = useWallet((s) => s.account?.address.toLowerCase());
  const list = useTracked();
  const address = token.address;
  // Read once, then each trade the stream brings goes straight in: at a block a second, asking again for every trade is no way to keep up.
  const { data } = useLive<{ trades: Trade[] }>(`/api/v1/tokens/${address}/trades?limit=500`, () => false, 300, true);
  const [fresh, setFresh] = useState<Trade[]>([]);
  useEffect(() => setFresh([]), [address]);
  useStream((type, d) => {
    if (type === 'trade' && d.token === address) setFresh((v) => [streamTrade(d), ...v].slice(0, 200));
  });
  const all = useMemo(() => {
    const seen = new Set<string>();
    return [...fresh, ...(data?.trades.filter((t) => t.token === address) ?? [])].filter((t) => {
      const k = `${t.tx_hash}:${t.log_index}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [fresh, data, address]);
  const now = useNow();
  const { money } = useFormat();
  const [rows, setRows] = useState(ROWS);
  useEffect(() => setRows(ROWS), [address, filter]);
  const followed = useMemo(() => new Set(list.map((t) => t.address)), [list]);
  const shown = all.filter((t) => (filter === 'Buys' ? t.is_buy : filter === 'Sells' ? !t.is_buy : filter === 'Large' ? t.zro >= LARGE_ZRO : filter === 'Dev' ? t.trader === token.creator : filter === 'Tracked' ? followed.has(t.trader) : true));
  const biggest = Math.max(...shown.map((t) => t.zro), 1e-12);
  const grid = 'grid grid-cols-[38px_minmax(0,1.2fr)_minmax(0,.8fr)_minmax(0,1fr)_34px] items-center gap-x-2';
  return (
    <>
      {data && !shown.length && <Empty title={all.length ? 'No trades match' : 'No trades yet'} />}
      {shown.length > 0 && (
        <div className={cn(grid, 'px-2 pb-1 text-[12px] text-faint')}>
          <span>Side</span>
          <span>Wallet</span>
          <span className="truncate text-right">{token.symbol}</span>
          <span className="text-right">Amount</span>
          <span className="text-right">Age</span>
        </div>
      )}
      {shown.slice(0, rows).map((t) => (
        <div key={`${t.tx_hash}${t.log_index}`} className={cn(grid, 'relative h-8 rounded-lg px-2 text-[13px] transition-colors duration-150 hover:bg-white/[.04]')}>
          <span className={t.is_buy ? 'text-up' : 'text-down'}>{t.is_buy ? 'Buy' : 'Sell'}</span>
          <WalletName address={t.trader} creator={token.creator} me={me} />
          <span className="num truncate text-right text-faint">{compact(t.amount)}</span>
          <span className="relative block text-right">
            <i className={cn('absolute inset-y-0 right-0 -my-1 rounded', t.is_buy ? 'bg-up/[.14]' : 'bg-down/[.14]')} style={{ width: `${Math.max(3, Math.sqrt(t.zro / biggest) * 100)}%` }} />
            <span className="num relative pr-1">{money(t.zro)}</span>
          </span>
          <span className="num text-right text-faint">{age(t.ts, now)}</span>
        </div>
      ))}
      {shown.length > rows && (
        <button onClick={() => setRows((r) => r + ROWS)} className="mt-1 h-8 w-full rounded-lg text-[13px] text-muted transition-colors hover:bg-white/[.04] hover:text-ink">
          Show more <span className="num text-faint">{shown.length - rows} left</span>
        </button>
      )}
    </>
  );
}

const TABS = [
  { key: 'trades', label: 'Trades' },
  { key: 'holders', label: 'Holders' },
  { key: 'traders', label: 'Traders' },
  { key: 'first', label: 'First 70' },
  { key: 'map', label: 'Map' },
  { key: 'safety', label: 'Safety' },
] as const;
type Tab = (typeof TABS)[number]['key'];

function Activity({ token }: { token: TokenDetail }) {
  const [tab, setTab] = useState<Tab>('trades');
  const [filter, setFilter] = useState<Filter>('All');
  return (
    <section className="panel flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2.5 pb-1.5 pt-2.5">
        <div className="no-scrollbar flex gap-0.5 overflow-x-auto" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={cn('pill num shrink-0 font-semibold', tab === t.key && 'pill-on')}>
              {t.key === 'holders' ? `Holders ${token.holders}` : t.label}
            </button>
          ))}
        </div>
        {tab === 'trades' && (
          <div className="flex flex-wrap gap-0.5">
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cn('rounded-lg px-2 py-1 text-[12px] font-medium transition-colors duration-150', filter === f ? 'bg-white/[.09] text-ink' : 'text-faint hover:text-ink')}>
                {f}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="soft-scroll min-h-0 flex-1 px-1 pb-2">
        {tab === 'trades' && <Trades token={token} filter={filter} />}
        {tab === 'holders' && <LabelledHolders token={token} />}
        {tab === 'traders' && <TopTraders token={token} />}
        {tab === 'first' && <FirstBuyers token={token} />}
        {tab === 'map' && <HolderMap token={token} />}
        {tab === 'safety' && <Safety token={token} />}
      </div>
    </section>
  );
}

export function TokenView({ token, onBack }: { token: TokenDetail; onBack?: () => void }) {
  const hasPrice = token.price > 0;
  const { money } = useFormat();
  const starred = useSocial((s) => s.stars.includes(token.address));
  const toggleStar = useSocial((s) => s.toggleStar);
  const bottom = useLayout((s) => s.sizes.bottom);
  const bottomRef = useRef<HTMLDivElement>(null);

  // The contract and links stand beside the token only while its name and every figure still fit in one row next to them.
  // Otherwise the figures would wrap under the name with the column still beside them, so the column moves under instead.
  // Measured from what each piece needs, since the figures' widths change with their values and the currency.
  const head = useRef<HTMLDivElement>(null);
  const nameBox = useRef<HTMLDivElement>(null);
  const figures = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLDivElement>(null);
  const [beside, setBeside] = useState(true);
  useLayoutEffect(() => {
    const el = head.current;
    if (!el) return;
    const sum = (box: HTMLElement | null, gap: number) => {
      const kids = box ? [...box.children].filter((c): c is HTMLElement => c instanceof HTMLElement) : [];
      return kids.reduce((n, c) => n + c.offsetWidth, 0) + gap * Math.max(0, kids.length - 1);
    };
    const fit = () => {
      const links = side.current?.querySelector<HTMLElement>('[aria-label=Links]') ?? null;
      const row = (nameBox.current?.offsetWidth ?? 0) + 16 + sum(figures.current, 6);
      const column = Math.max(sum(links, 4), 300);
      setBeside(el.clientWidth >= row + 24 + column);
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    if (figures.current) watch.observe(figures.current);
    return () => watch.disconnect();
  }, [token.address]);
  return (
    <div className="flex min-h-0 flex-col gap-2 lg:h-full">
      <section className="panel shrink-0 px-3 py-2.5">
        {/* Two columns: the token and its figures with its safety under them on the left, its contract and links on the right.
            When the name and figures wouldn't fit in one row beside the right one, it moves under and starts from the same edge. */}
        <div key={token.address} ref={head} className={cn('animate-fade flex items-start', beside ? 'gap-x-6' : 'flex-col gap-y-2.5')}>
          <div className={cn('flex min-w-0 flex-col gap-2.5', beside ? 'flex-1' : 'w-full')}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
          {onBack && (
            <button onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 lg:hidden" aria-label="Back to tokens">
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 3L5 8l5 5" />
              </svg>
            </button>
          )}
          <div ref={nameBox} className="flex min-w-0 items-center gap-2.5">
            <Avatar address={token.address} uri={token.uri} size={38} />
            <div className="min-w-0 leading-tight">
              <div className="flex items-center gap-1.5">
                <h1 className="truncate text-[18px] font-bold tracking-tight">{token.symbol}</h1>
                <button onClick={() => toggleStar(token.address)} aria-pressed={starred} aria-label={starred ? `Remove ${token.symbol} from starred` : `Star ${token.symbol}`} className={cn('transition-colors duration-150', starred ? 'text-accent' : 'text-faint hover:text-muted')}>
                  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                    <path d="M8 1.6l1.95 4 4.4.6-3.2 3.08.78 4.37L8 11.57l-3.93 2.08.78-4.37-3.2-3.08 4.4-.6z" />
                  </svg>
                </button>
                <span className="ml-1 flex items-center gap-1">
                  <AlertButton token={token} small />
                  <Viewers token={token.address} />
                </span>
              </div>
              <div className="max-w-[220px] truncate text-[13px] text-muted">{token.name}</div>
            </div>
          </div>
          <div ref={figures} className="flex flex-wrap gap-1.5">
            {hasPrice && (
              <>
                <Stat label="Market cap" value={token.market_cap}>{money(token.market_cap)}</Stat>
                <Stat label="Price" value={token.price}>
                  <Price value={token.price} />
                </Stat>
                <Stat label="24h change">
                  <Change value={token.change_24h} />
                </Stat>
              </>
            )}
            <Stat label="24h volume" value={token.volume_24h}>{money(token.volume_24h)}</Stat>
            {/* What its fee has earned so far, in the money the site shows, rather than its rate: the rate is on the hover. */}
            {token.source === 'terminal' && <Earned token={token} />}
          </div>
          </div>
          <RiskLine token={token} />
          </div>
          {/* Beside the token: the contract over the links. Under it: the two side by side, wrapping only on a narrow screen. */}
          <div ref={side} className={cn('flex gap-2.5', beside ? 'w-max shrink-0 flex-col' : 'w-full flex-wrap items-center')}>
            <div className={beside ? 'w-full' : 'w-full sm:w-[340px]'}>
              <ContractPlate address={token.address} />
            </div>
            <Socials links={token.links} />
          </div>
        </div>
      </section>

      <section className="panel h-[380px] shrink-0 overflow-hidden lg:h-auto lg:min-h-[240px] lg:flex-1">
        <Chart token={token} />
      </section>

      <div ref={bottomRef} className="relative h-[280px] shrink-0 lg:h-[var(--bottom-h,min(270px,26vh))]" style={bottom ? ({ '--bottom-h': `${bottom}px` } as React.CSSProperties) : undefined}>
        <Splitter part="bottom" dir="y" sign={-1} className="-top-[8px]" measure={() => bottomRef.current?.getBoundingClientRect().height ?? 240} />
        <Activity token={token} />
      </div>
    </div>
  );
}
