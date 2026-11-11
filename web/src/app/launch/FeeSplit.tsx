'use client';

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { BASE_FEE_BPS, CREATOR_BASE_BPS, TREASURY_BPS } from '@/lib/config';
import { cn } from '@/lib/format';

/** Shares of the creator's own fee on top of the base, in whole percent, always adding up to 100. */
export interface Split {
  holders: number;
  burn: number;
  creator: number;
}

type Part = keyof Split;
type Mode = Part | 'mix';

const PARTS: Array<{ key: Part; title: string; color: string; line: string }> = [
  { key: 'holders', title: 'Holders', color: '#7cc7a1', line: 'Paid in ZRO to wallets holding the coin, by how much they hold.' },
  { key: 'burn', title: 'Buyback', color: '#e9977a', line: 'Buys the coin back in the same trade and sends it to the dead address for good.' },
  { key: 'creator', title: 'You', color: '#66e4ec', line: 'Builds up for your wallet, to claim from Portfolio.' },
];

const MODES: Array<{ key: Mode; label: string; line: string }> = [
  { key: 'creator', label: 'Pays you', line: 'All of your fee builds up for your wallet, to claim from Portfolio whenever you like.' },
  { key: 'holders', label: 'Pays holders', line: 'All of your fee is paid in ZRO to everyone holding the coin, by how much they hold.' },
  { key: 'burn', label: 'Buys back', line: 'All of your fee buys the coin back in the same trade and sends it to the dead address, so the supply only shrinks.' },
  { key: 'mix', label: 'Mix', line: 'Split your fee between holders, buybacks and you.' },
];

const PRESETS: Array<{ label: string; split: Split }> = [
  { label: 'Even split', split: { holders: 34, burn: 33, creator: 33 } },
  { label: 'Holders and buyback', split: { holders: 50, burn: 50, creator: 0 } },
  { label: 'Holders and you', split: { holders: 50, burn: 0, creator: 50 } },
  { label: 'Buyback and you', split: { holders: 0, burn: 50, creator: 50 } },
];

const ALL: Record<Part, Split> = {
  creator: { holders: 0, burn: 0, creator: 100 },
  holders: { holders: 100, burn: 0, creator: 0 },
  burn: { holders: 0, burn: 100, creator: 0 },
};

const pct = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;
/** The creator's 0.6% of the base: a deeper shade of their own turquoise, since it's theirs too but fixed. */
const BASE_COLOR = '#2fa9b3';
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const same = (a: Split, b: Split) => a.holders === b.holders && a.burn === b.burn && a.creator === b.creator;

/** Changes one share and lets the others give way, so the three never stop adding up to 100. */
function setPart(s: Split, key: Part, raw: number): Split {
  const v = clamp(Math.round(raw), 0, 100);
  if (key === 'holders') {
    const holders = Math.min(v, 100 - s.burn);
    return { holders, burn: s.burn, creator: 100 - holders - s.burn };
  }
  if (key === 'burn') {
    const burn = Math.min(v, 100 - s.holders);
    return { holders: s.holders, burn, creator: 100 - s.holders - burn };
  }
  // The rest is shared between holders and the buyback as they were before, or evenly when both were empty.
  const rest = 100 - v;
  const was = s.holders + s.burn;
  const holders = was > 0 ? Math.round((rest * s.holders) / was) : Math.ceil(rest / 2);
  return { holders, burn: rest - holders, creator: v };
}

/**
 * Who the trading fee pays, as one bar of the whole fee: the 1% base first, the terminal's 0.4% and the creator's 0.6%, then
 * the creator's own fee on top cut three ways. In Mix the two handles drag the cuts and the fields below take exact numbers.
 */
export function FeeSplit({ devBps, split, onChange }: { devBps: number; split: Split; onChange: (s: Split) => void }) {
  const [mode, setMode] = useState<Mode>(() => (Object.keys(ALL) as Part[]).find((k) => same(ALL[k], split)) ?? 'mix');
  const earn = useRef<HTMLDivElement>(null);
  const drag = useRef<0 | 1 | null>(null);
  // How wide the bar really is, so a label only shows where it fits whole.
  const bar = useRef<HTMLDivElement>(null);
  const [barW, setBarW] = useState(0);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBarW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const feeBps = BASE_FEE_BPS + devBps;
  const terminalWidth = (TREASURY_BPS / feeBps) * 100;
  const baseWidth = (CREATOR_BASE_BPS / feeBps) * 100;
  const hasOwn = devBps > 0;

  const pick = (m: Mode) => {
    setMode(m);
    if (m === 'mix') {
      if (m !== mode && (Object.values(ALL) as Split[]).some((s) => same(s, split))) onChange(PRESETS[0]!.split);
    } else onChange(ALL[m]);
  };

  // The handles: the first sits where holders end, the second where the buyback ends.
  const at = (clientX: number) => {
    const r = earn.current!.getBoundingClientRect();
    return clamp(Math.round(((clientX - r.left) / r.width) * 100), 0, 100);
  };
  const moveHandle = (h: 0 | 1, p: number) => {
    const { holders, burn } = split;
    // Two handles on one spot: whichever way the drag goes decides which one moves.
    let which = h;
    if (burn === 0 && h === 1 && p < holders) which = 0;
    if (burn === 0 && h === 0 && p > holders) which = 1;
    drag.current = drag.current === null ? null : which;
    if (which === 0) {
      const end = holders + burn;
      const next = Math.min(p, end);
      onChange({ holders: next, burn: end - next, creator: split.creator });
    } else {
      const b = clamp(p - holders, 0, 100 - holders);
      onChange({ holders, burn: b, creator: 100 - holders - b });
    }
  };
  const down = (h: 0 | 1) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = h;
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    if (drag.current !== null) moveHandle(drag.current, at(e.clientX));
  };
  const up = () => {
    drag.current = null;
  };
  const key = (h: 0 | 1) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const pos = h === 0 ? split.holders : split.holders + split.burn;
    moveHandle(h, pos + d * (e.shiftKey ? 5 : 1));
  };

  const current = MODES.find((m) => m.key === mode)!;
  const handles: Array<{ h: 0 | 1; pos: number; label: string }> = [
    { h: 0, pos: split.holders, label: 'Where holders end and the buyback starts' },
    { h: 1, pos: split.holders + split.burn, label: 'Where the buyback ends and your share starts' },
  ];

  return (
    <div>
      {hasOwn && (
      <>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1 sm:grid-cols-4" role="radiogroup" aria-label="Who your fee pays">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={mode === m.key}
            onClick={() => pick(m.key)}
            className={cn('h-9 rounded-[6px] text-[14px] font-medium transition-colors duration-150', mode === m.key ? 'bg-white/[.14] text-ink' : 'text-muted hover:text-ink')}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[13px] leading-snug text-muted">{current.line}</p>
      </>
      )}

      <div className={cn(hasOwn && 'mt-3', hasOwn && mode === 'mix' && 'rounded-2xl border border-white/[.07] p-3 sm:p-4')}>
        {hasOwn && mode === 'mix' && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => onChange(p.split)}
                className={cn('h-8 rounded-lg px-3 text-[13px] font-medium transition-colors duration-150', same(p.split, split) ? 'bg-ink text-bg' : 'bg-white/[.06] text-muted hover:bg-white/10 hover:text-ink')}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        <div className="mb-1.5 flex items-baseline justify-between text-[12.5px]">
          <span className="text-muted">
            Each trade pays <span className="num font-semibold text-ink">{pct(feeBps)}</span>
          </span>
          <span className="text-faint">the whole fee, to scale</span>
        </div>

        {/* The whole fee, to scale. */}
        <div ref={bar} className="relative flex h-10 select-none gap-[2px]">
          <div
            className="flex shrink-0 items-center overflow-hidden rounded-l-[10px] px-2 text-[12.5px] text-ink/80"
            style={{ width: `${terminalWidth}%`, background: 'repeating-linear-gradient(135deg, #3a3a40 0 6px, #323237 6px 12px)' }}
            title={`The terminal's ${pct(TREASURY_BPS)} of every trade, the same on every token`}
          >
            {(barW * terminalWidth) / 100 >= 44 && (
              <span className="whitespace-nowrap">
                <span className="num font-semibold">{pct(TREASURY_BPS)}</span>
                {(barW * terminalWidth) / 100 >= 104 && <span className="ml-1">Terminal</span>}
              </span>
            )}
          </div>
          <div
            className={cn('flex shrink-0 items-center overflow-hidden px-2 text-[12.5px] text-[#0b0b0c]', !hasOwn && 'flex-1 rounded-r-[10px]')}
            style={{ width: hasOwn ? `${baseWidth}%` : undefined, background: BASE_COLOR }}
            title={`Your ${pct(CREATOR_BASE_BPS)} of the base, on every trade of your coin`}
          >
            {(barW * (hasOwn ? baseWidth : 100 - terminalWidth)) / 100 >= 44 && (
              <span className="whitespace-nowrap">
                <span className="num font-semibold">{pct(CREATOR_BASE_BPS)}</span>
                {(barW * (hasOwn ? baseWidth : 100 - terminalWidth)) / 100 >= 116 && <span className="ml-1 opacity-75">Your base</span>}
              </span>
            )}
          </div>
          {hasOwn && (
          <div ref={earn} className="relative min-w-0 flex-1">
            <div className="absolute inset-0 overflow-hidden rounded-r-[10px]">
            {PARTS.map((x, i) => {
              const share = split[x.key];
              if (share <= 0) return null;
              const start = PARTS.slice(0, i).reduce((a, y) => a + split[y.key], 0);
              const px = (barW * (share / 100) * (100 - terminalWidth - baseWidth)) / 100;
              return (
                <div
                  key={x.key}
                  className="absolute inset-y-0 flex min-w-0 items-center overflow-hidden px-2 text-[12.5px] text-[#0b0b0c]"
                  // A thin cut of the page colour on the left keeps neighbours apart without moving where they meet.
                  style={{ left: `${start}%`, width: `${share}%`, background: x.color, boxShadow: start > 0 ? 'inset 2px 0 0 rgb(var(--bg))' : undefined }}
                >
                  {px >= 52 && (
                    <span className="whitespace-nowrap">
                      <span className="num font-semibold">{pct((devBps * share) / 100)}</span>
                      {px >= 116 && <span className="ml-1 opacity-75">{x.title}</span>}
                    </span>
                  )}
                </div>
              );
            })}
            </div>
            {mode === 'mix' &&
              handles.map(({ h, pos, label }) => (
                <button
                  key={h}
                  type="button"
                  role="slider"
                  aria-label={label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pos}
                  onPointerDown={down(h)}
                  onPointerMove={move}
                  onPointerUp={up}
                  onPointerCancel={up}
                  onKeyDown={key(h)}
                  className="absolute top-1/2 z-10 h-7 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none rounded-[5px] border-2 border-[#0b0b0c] bg-white shadow-[0_1px_4px_rgba(0,0,0,.5)] outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  style={{ left: `${pos}%` } as CSSProperties}
                />
              ))}
          </div>
          )}
        </div>

        <p className="mt-2 flex items-center gap-2 text-[12.5px] leading-snug text-faint">
          <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: 'repeating-linear-gradient(135deg, #55555c 0 2px, #3a3a40 2px 4px)' }} aria-hidden="true" />
          {hasOwn
            ? `Every coin pays the 1% base: ${pct(TREASURY_BPS)} to the terminal and ${pct(CREATOR_BASE_BPS)} to you. Your own ${pct(devBps)} on top goes where you say.`
            : `Every coin pays the 1% base: ${pct(TREASURY_BPS)} to the terminal and ${pct(CREATOR_BASE_BPS)} to you. Add a fee of your own to pay holders or buy back.`}
        </p>

        {hasOwn && mode === 'mix' && (
          <div className="mt-4 grid gap-4 sm:grid-cols-3 sm:gap-3">
            {PARTS.map((x) => (
              <div key={x.key} className="min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[14px] font-semibold">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: x.color }} aria-hidden="true" />
                    {x.title}
                  </span>
                  <label className="flex h-9 w-[76px] items-center rounded-lg bg-white/[.06] pr-2.5 focus-within:bg-white/10">
                    <input
                      value={String(split[x.key])}
                      onChange={(e) => onChange(setPart(split, x.key, Number(e.target.value.replace(/[^0-9]/g, '').slice(0, 3)) || 0))}
                      onFocus={(e) => e.target.select()}
                      inputMode="numeric"
                      aria-label={`${x.title}, percent of your fee`}
                      className="num h-full w-full min-w-0 bg-transparent pl-2.5 text-right text-[14px] outline-none"
                    />
                    <span className="ml-0.5 text-[13px] text-faint">%</span>
                  </label>
                </div>
                <p className="num mt-1.5 text-[12.5px] text-muted">{`${pct((devBps * split[x.key]) / 100)} of each trade`}</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-faint">{x.line}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
