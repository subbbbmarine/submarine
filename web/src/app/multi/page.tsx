'use client';

import Link from 'next/link';
import { FastTrade } from '@/components/FastTrade';
import { useEffect, useRef, useState } from 'react';
import { get, useLive, type Token, type TokenDetail } from '@/lib/api';
import { cn } from '@/lib/format';
import { useFormat } from '@/lib/money';
import { Avatar, Empty } from '@/components/bits';
import { Chart } from '@/components/Chart';

const SAVE = 'terminal.multi.v1';
const SLOTS = 4;
type Grid = 'four' | 'two';
interface Saved {
  grid: Grid;
  tokens: Array<string | null>;
}
const isAddress = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v);

/** Finds a token by name, symbol or address with the same search the token list uses, and hands back its address. */
function TokenPicker({ label, startOpen = false, onPick }: { label: string; startOpen?: boolean; onPick: (address: string) => void }) {
  const [open, setOpen] = useState(startOpen);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Token[] | null>(null);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const { money } = useFormat();

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const q = query.trim();
    // With nothing typed, the most traded tokens, so a pick is one click away.
    const path = q ? `/api/v1/tokens?q=${encodeURIComponent(q)}&limit=8` : '/api/v1/tokens?sort=volume&limit=8';
    const id = setTimeout(
      () =>
        void get<{ tokens: Token[] }>(path)
          .then((d) => {
            if (!alive) return;
            setResults(d.tokens);
            setActive(0);
          })
          .catch(() => alive && setResults([])),
      q ? 180 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const pick = (address: string) => {
    onPick(address.toLowerCase());
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className={cn('pill', open && 'pill-on')}>
        {label}
      </button>
      {open && (
        <div className="animate-fade absolute right-0 top-[calc(100%+6px)] z-30 w-[300px] max-w-[80vw] rounded-xl border border-white/10 bg-card2 p-2 shadow-[0_12px_40px_rgb(0_0_0_/_.6)]">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              const list = results ?? [];
              if (e.key === 'Escape') setOpen(false);
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(list.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                const v = query.trim();
                if (isAddress(v)) pick(v);
                else if (list[active]) pick(list[active].address);
              }
            }}
            placeholder="Search tokens"
            aria-label="Search tokens by name, symbol or address"
            className="field h-9 w-full text-[14px]"
          />
          <div className="soft-scroll mt-1.5 max-h-[300px]">
            {results === null ? (
              <div className="px-2 py-3 text-[13px] text-muted">Searching</div>
            ) : results.length === 0 ? (
              <div className="px-2 py-3 text-[13px] text-muted">{isAddress(query.trim()) ? 'Press Enter to open this address' : 'Nothing matches that'}</div>
            ) : (
              results.map((t, k) => (
                <button key={t.address} onClick={() => pick(t.address)} onPointerEnter={() => setActive(k)} className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left', k === active && 'bg-white/[.06]')}>
                  <Avatar address={t.address} uri={t.uri} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{t.symbol}</span>
                    <span className="block truncate text-[12px] text-muted">{t.name}</span>
                  </span>
                  <span className="num text-[12px] text-muted">{money(t.market_cap)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({ slot, address, onPick }: { slot: number; address: string | null; onPick: (address: string) => void }) {
  const { data: token, error } = useLive<TokenDetail>(address ? `/api/v1/tokens/${address}` : null, (t, d) => (t === 'trade' || t === 'graduated') && d.token === address, 400, true);
  const { money } = useFormat();
  const shown = token && token.address.toLowerCase() === address ? token : null;
  const [trading, setTrading] = useState(false);

  return (
    <section className="panel relative flex h-[440px] min-w-0 flex-col lg:h-auto lg:min-h-0">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2.5">
        {shown ? (
          <Link href={`/tokens/${shown.address}`} title={`Open ${shown.symbol} on the trading screen`} className="group flex min-w-0 items-center gap-2">
            <Avatar address={shown.address} uri={shown.uri} size={24} />
            <span className="truncate font-semibold transition-colors group-hover:text-accent">{shown.symbol}</span>
            <span className="hidden truncate text-[13px] text-muted sm:inline">{shown.name}</span>
            <span className="num shrink-0 text-[13px] text-muted">{money(shown.market_cap)}</span>
          </Link>
        ) : (
          <span className="text-[13px] text-muted">{address ? (error ? 'Not in the index' : 'Loading') : `Chart ${slot + 1}`}</span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {shown?.tradable && (
            <button onClick={() => setTrading((v) => !v)} aria-expanded={trading} className={cn('btn h-7 rounded-[6px] px-2.5 text-[12px]', trading ? 'btn-soft' : 'btn-accent')}>
              Trade
            </button>
          )}
          <TokenPicker label={address ? 'Change token' : 'Pick a token'} onPick={onPick} />
        </div>
      </div>
      {trading && shown && <FastTrade token={shown} onClose={() => setTrading(false)} />}
      <div className="min-h-0 flex-1">
        {shown ? (
          <Chart token={shown} prefsKey={`terminal.chart.multi.${slot}`} trade={false} />
        ) : (
          <div className="flex h-full items-center justify-center">
            {address && !error ? <div className="m-3 h-24 w-2/3 animate-pulse rounded-xl bg-white/[.04]" aria-hidden="true" /> : <Empty title={address ? "This token isn't in the index" : 'No token here yet'} body={address ? 'Pick another one.' : 'Pick a token to chart it here.'} />}
          </div>
        )}
      </div>
    </section>
  );
}

/** Up to four charts at once, each with its own token and candle size, all remembered in this browser. */
export default function MultiPage() {
  const [saved, setSaved] = useState<Saved | null>(null);

  useEffect(() => {
    let stored: Partial<Saved> = {};
    try {
      stored = JSON.parse(localStorage.getItem(SAVE) ?? '{}') as Partial<Saved>;
    } catch {}
    const tokens = Array.from({ length: SLOTS }, (_, i) => (typeof stored.tokens?.[i] === 'string' ? stored.tokens[i]! : null));
    const grid: Grid = stored.grid === 'two' || stored.grid === 'four' ? stored.grid : window.innerWidth < 1024 ? 'two' : 'four';
    setSaved({ grid, tokens });
    // A first visit starts with the most traded tokens rather than four empty boxes.
    if (!stored.tokens) {
      void get<{ tokens: Token[] }>(`/api/v1/tokens?sort=volume&limit=${SLOTS}`)
        .then((d) => setSaved((s) => (s && s.tokens.every((t) => t === null) ? { ...s, tokens: s.tokens.map((_, i) => d.tokens[i]?.address.toLowerCase() ?? null) } : s)))
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!saved) return;
    try {
      localStorage.setItem(SAVE, JSON.stringify(saved));
    } catch {}
  }, [saved]);

  if (!saved) return null;
  const count = saved.grid === 'four' ? 4 : 2;
  const setToken = (slot: number, address: string) => setSaved((s) => s && { ...s, tokens: s.tokens.map((t, i) => (i === slot ? address : t)) });

  return (
    <div className="flex flex-col gap-2 lg:h-full">
      <div className="flex shrink-0 items-center gap-2 px-1">
        <h1 className="text-[15px] font-semibold">Multichart</h1>
        <div className="ml-auto flex items-center gap-0.5" role="radiogroup" aria-label="Charts on screen">
          {(['four', 'two'] as const).map((g) => (
            <button key={g} role="radio" aria-checked={saved.grid === g} onClick={() => setSaved({ ...saved, grid: g })} className={cn('pill', saved.grid === g && 'pill-on')}>
              {g === 'four' ? 'Four charts' : 'Two charts'}
            </button>
          ))}
        </div>
      </div>
      <div className={cn('grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-2', count === 4 ? 'lg:grid-rows-2' : 'lg:grid-rows-1')}>
        {saved.tokens.slice(0, count).map((address, slot) => (
          <Cell key={slot} slot={slot} address={address} onPick={(a) => setToken(slot, a)} />
        ))}
      </div>
    </div>
  );
}
