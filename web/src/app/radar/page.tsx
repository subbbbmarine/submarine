'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { get, type Token } from '@/lib/api';
import { cn, short } from '@/lib/format';
import { radar, trending, type RadarWallet, type TrendingToken } from '@/lib/insight';
import { useFormat } from '@/lib/money';
import { nameOf, tracked, useTracked } from '@/lib/tracked';
import { Avatar, Empty } from '@/components/bits';
import { WalletPic } from '@/components/WalletPic';

const MOST = 10;

function after(s: number): string {
  if (s < 60) return `${Math.max(0, Math.round(s))}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}

export default function RadarPage() {
  const { money, signed } = useFormat();
  const list = useTracked();
  // null scans what the indexer picks: today's five busiest tokens.
  const [picked, setPicked] = useState<string[] | null>(null);
  const [answer, setAnswer] = useState<{ tokens: string[]; wallets: RadarWallet[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [hot, setHot] = useState<TrendingToken[]>([]);
  const [names, setNames] = useState<Record<string, { symbol: string; uri: string | null }>>({});
  const [paste, setPaste] = useState('');

  useEffect(() => {
    trending('24h')
      .then((t) => {
        setHot(t.slice(0, 24));
        setNames((n) => ({ ...Object.fromEntries(t.map((x) => [x.address, { symbol: x.symbol, uri: x.uri }])), ...n }));
      })
      .catch(() => {});
  }, []);

  const key = picked === null ? null : picked.join(',');
  useEffect(() => {
    // An empty list would make the indexer fall back to its own picks.
    if (key === '') {
      setAnswer({ tokens: [], wallets: [] });
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setFailed(false);
    radar(key ? key.split(',') : [])
      .then((a) => live && setAnswer(a))
      .catch(() => live && setFailed(true))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [key]);

  const scanned = useMemo(() => picked ?? answer?.tokens ?? [], [picked, answer]);

  // Pasted tokens and the indexer's own picks may not be in the trending list, so their symbols are looked up one by one.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const a of scanned) {
      if (names[a] || asked.current.has(a)) continue;
      asked.current.add(a);
      get<Token>(`/api/v1/tokens/${a}`)
        .then((t) => setNames((n) => ({ ...n, [a]: { symbol: t.symbol, uri: t.uri } })))
        .catch(() => setNames((n) => ({ ...n, [a]: { symbol: short(a), uri: null } })));
    }
  }, [scanned, names]);

  const toggle = (address: string) => {
    const now = picked ?? answer?.tokens ?? [];
    setPicked(now.includes(address) ? now.filter((a) => a !== address) : [...now, address].slice(0, MOST));
  };
  const addPasted = () => {
    const found = [...new Set(paste.match(/0x[0-9a-fA-F]{40}/g)?.map((a) => a.toLowerCase()) ?? [])];
    if (!found.length) return;
    const now = picked ?? answer?.tokens ?? [];
    setPicked([...now, ...found.filter((a) => !now.includes(a))].slice(0, MOST));
    setPaste('');
  };
  const symbolOf = (a: string) => names[a]?.symbol ?? short(a);
  const full = scanned.length >= MOST;

  return (
    // Tokens on the left in a narrow column, the wallets it finds beside them: the page never stretches a few chips across a wide screen.
    <div className="mx-auto grid w-full max-w-[1200px] items-start gap-2 lg:grid-cols-[340px_minmax(0,1fr)]">
      <section className="panel p-4 lg:sticky lg:top-0">
        <h1 className="text-[20px] font-bold leading-tight tracking-tight">Radar</h1>
        <p className="mb-4 mt-1 text-[13px] leading-snug text-muted">Finds wallets that got in early, among the first 30 buyers, on at least two of the tokens you pick. Those are the ones worth following.</p>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">
            Scanning <span className="num font-medium text-faint">{scanned.length}</span>
          </h2>
          {picked && (
            <button onClick={() => setPicked(null)} className="text-[13px] text-muted transition-colors hover:text-ink">
              Use today&apos;s busiest
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {scanned.map((a) => (
            <button key={a} onClick={() => toggle(a)} title="Stop scanning this token" className="flex h-8 items-center gap-1.5 rounded-lg bg-white/[.09] pl-1.5 pr-2.5 text-[13px] font-medium transition-colors hover:bg-white/[.14]">
              <Avatar address={a} uri={names[a]?.uri} size={20} />
              {symbolOf(a)}
            </button>
          ))}
          {!scanned.length && !loading && <span className="text-[13px] text-faint">No tokens picked. Choose some below or paste their addresses.</span>}
        </div>

        {hot.length > 0 && (
          <>
            <h3 className="mb-1.5 mt-4 text-[13px] text-muted">Trending in the last 24 hours</h3>
            <div className="flex flex-wrap gap-1.5">
              {hot.map((t) => {
                const on = scanned.includes(t.address);
                return (
                  <button
                    key={t.address}
                    onClick={() => toggle(t.address)}
                    disabled={!on && full}
                    aria-pressed={on}
                    className={cn('flex h-8 items-center gap-1.5 rounded-lg pl-1.5 pr-2.5 text-[13px] font-medium transition-colors disabled:opacity-40', on ? 'bg-accent/15 text-accent' : 'bg-white/[.05] text-muted hover:text-ink')}
                  >
                    <Avatar address={t.address} uri={t.uri} size={20} />
                    {t.symbol}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <form
          className="mt-3 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            addPasted();
          }}
        >
          <input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Or paste a token address" className="field num h-9 min-w-0 flex-1 text-[13px]" aria-label="Token addresses" />
          <button disabled={full || !/0x[0-9a-fA-F]{40}/.test(paste)} className="btn btn-soft h-9 px-3 text-[13px]">
            Add
          </button>
        </form>
        {full && <p className="mt-1.5 text-[12px] text-faint">Up to {MOST} tokens at a time.</p>}
      </section>

      <section className="panel p-4">
        <h2 className="mb-1 font-semibold">
          Wallets {answer && <span className="num font-medium text-faint">{answer.wallets.length}</span>}
        </h2>
        {!answer && (failed ? <Empty title="Can't run the radar" body="The indexer isn't answering. Try again in a moment." /> : <div className="h-40 animate-pulse rounded-xl bg-white/[.03]" />)}
        {answer && !answer.wallets.length && <Empty title={scanned.length < 2 ? 'Pick at least two tokens' : 'No wallet was early on two of these tokens'} />}
        {!!answer?.wallets.length && (
          <div className={cn('overflow-x-auto transition-opacity', loading && 'opacity-50')}>
            <table className="w-full text-[14px]">
              <thead className="text-[13px] text-faint">
                <tr>
                  <th className="py-1.5 text-left font-normal">Wallet</th>
                  <th className="whitespace-nowrap py-1.5 pl-3 text-right font-normal">Early on</th>
                  <th className="hidden whitespace-nowrap py-1.5 pl-3 text-right font-normal sm:table-cell">Earliest entry</th>
                  <th className="hidden py-1.5 pl-3 text-right font-normal md:table-cell">Spent</th>
                  <th className="py-1.5 pl-3 text-right font-normal">Profit</th>
                  <th className="w-[150px]" />
                </tr>
              </thead>
              <tbody className="num">
                {answer.wallets.map((w) => {
                  const following = list.some((t) => t.address === w.address);
                  return (
                    <tr key={w.address}>
                      <td className="py-1.5">
                        <Link href={`/traders/${w.address}`} className="flex items-center gap-2.5 font-semibold transition-colors hover:text-accent">
                          <WalletPic address={w.address} size={28} />
                          {nameOf(w.address, list)}
                        </Link>
                      </td>
                      <td className="py-1.5 pl-3 text-right" title={w.tokens.map(symbolOf).join(', ')}>
                        {w.tokens.length} of {answer.tokens.length}
                      </td>
                      <td className="hidden py-1.5 pl-3 text-right text-muted sm:table-cell" title="Seconds from launch to its first buy, on the quickest of these tokens">
                        {after(w.earliest)}
                      </td>
                      <td className="hidden py-1.5 pl-3 text-right md:table-cell">{money(w.spent)}</td>
                      <td className={cn('py-1.5 pl-3 text-right', w.pnl > 0 ? 'text-up' : w.pnl < 0 ? 'text-down' : 'text-muted')}>{signed(w.pnl)}</td>
                      <td className="py-1.5 pl-3">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => (following ? tracked.remove(w.address) : tracked.add(w.address))} className={cn('btn h-8 rounded-[7px] px-2.5 text-[13px]', following ? 'btn-soft' : 'btn-accent')}>
                            {following ? 'Following' : 'Follow'}
                          </button>
                          <Link href={`/copy?leader=${w.address}`} className="btn btn-soft h-8 rounded-[7px] px-2.5 text-[13px]">
                            Copy
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
