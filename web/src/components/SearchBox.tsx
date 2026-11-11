'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { get, type Token } from '@/lib/api';
import { age, cn, short } from '@/lib/format';
import { useFormat } from '@/lib/money';
import { openToken, useSelection } from '@/lib/selection';
import { useTracked } from '@/lib/tracked';
import { Avatar } from './bits';
import { WalletPic } from './WalletPic';

interface Found {
  tokens: Token[];
  wallets: Array<{ address: string; trades: number; tokens: number; last_ts: number }>;
}
type Item = { kind: 'token'; token: Token } | { kind: 'wallet'; address: string; name?: string; note: string };

/**
 * The search box on every page. It still filters the token list on the trading screen as you type, and opens a list under
 * itself everywhere: tokens by name, ticker or address, wallets by address or by the name you gave one you follow.
 */
export function SearchBox() {
  const router = useRouter();
  const path = usePathname();
  const { query, setQuery } = useSelection();
  const followed = useTracked();
  const { money } = useFormat();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [active, setActive] = useState(0);
  const onTrade = path === '/' || path.startsWith('/tokens/');
  const q = query.trim();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === '/' && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Asks once typing pauses for a moment, and only keeps the answer to what's typed now.
  useEffect(() => {
    if (!q) return setFound(null);
    let live = true;
    const t = setTimeout(() => {
      get<Found>(`/api/v1/search?q=${encodeURIComponent(q)}`).then((r) => live && (setFound(r), setActive(0)), () => {});
    }, 160);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const lower = q.toLowerCase();
    const out: Item[] = (found?.tokens ?? []).map((token) => ({ kind: 'token', token }));
    const seen = new Set<string>();
    // Wallets you follow, matched by the name you gave them or their address.
    for (const f of followed) {
      const name = f.label ?? '';
      if (lower && (name.toLowerCase().includes(lower) || f.address.startsWith(lower))) {
        out.push({ kind: 'wallet', address: f.address, name: name || undefined, note: 'You follow it' });
        seen.add(f.address);
      }
    }
    for (const w of found?.wallets ?? []) {
      if (seen.has(w.address)) continue;
      out.push({ kind: 'wallet', address: w.address, note: `${w.trades} trades on ${w.tokens} tokens` });
      seen.add(w.address);
    }
    // A full address nobody has traded with here yet still opens: as a wallet, unless it's a token in the list above.
    if (/^0x[0-9a-f]{40}$/.test(lower) && !seen.has(lower) && !out.some((i) => i.kind === 'token' && i.token.address === lower)) {
      out.push({ kind: 'wallet', address: lower, note: 'Open as a wallet' });
    }
    return out.slice(0, 12);
  }, [found, followed, q]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    setOpen(false);
    setQuery('');
    input.current?.blur();
    if (item.kind === 'token') {
      if (onTrade) openToken(item.token.address);
      else router.push(`/tokens/${item.token.address}`);
    } else {
      router.push(`/traders/${item.address}`);
    }
  };

  const show = open && q.length > 0;
  return (
    <div className="relative w-full min-w-0 max-w-[460px]">
      <input
        ref={input}
        value={query}
        onChange={(e) => (setQuery(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, items.length - 1)));
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          else if (e.key === 'Enter') (e.preventDefault(), choose(items[active]));
          else if (e.key === 'Escape') (setQuery(''), setOpen(false), input.current?.blur());
        }}
        placeholder="Search tokens and wallets"
        className="field h-10 w-full pr-9"
        aria-label="Search tokens by name, ticker or address, and wallets by address or name"
        aria-expanded={show}
        aria-controls="search-results"
        role="combobox"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md bg-white/10 text-xs text-muted sm:flex">/</kbd>
      {show && (
        <ul id="search-results" role="listbox" className="panel soft-scroll absolute left-0 right-0 top-12 z-50 max-h-[70vh] p-1 shadow-[0_18px_50px_rgb(0_0_0_/_.6)]">
          {!found && <li className="px-3 py-2.5 text-[13px] text-faint">Searching</li>}
          {found && !items.length && <li className="px-3 py-2.5 text-[13px] text-faint">Nothing matches that</li>}
          {items.map((item, i) => (
            <li key={item.kind === 'token' ? item.token.address : `w${item.address}`} role="option" aria-selected={i === active}>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(item)}
                onMouseEnter={() => setActive(i)}
                className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left', i === active && 'bg-white/[.07]')}
              >
                {item.kind === 'token' ? (
                  <>
                    <Avatar address={item.token.address} uri={item.token.uri} size={28} />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate font-semibold">{item.token.symbol}</span>
                      <span className="block truncate text-[12px] text-muted">
                        {item.token.name} <span className="num text-faint">{short(item.token.address)}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right leading-tight">
                      <span className="num block text-[13px]">{money(item.token.market_cap)}</span>
                      <span className="num block text-[11px] text-faint">{age(item.token.created_at)}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <WalletPic address={item.address} size={28} />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate font-semibold">{item.name ?? short(item.address, 6, 4)}</span>
                      <span className="block truncate text-[12px] text-muted">{item.note}</span>
                    </span>
                    <span className="shrink-0 rounded bg-white/[.07] px-1.5 text-[11px] text-muted">Wallet</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
