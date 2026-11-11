'use client';

import { useState } from 'react';
import { RANKS } from '@/lib/config';
import { cn, short } from '@/lib/format';
import { useProfile } from '@/lib/profiles';
import { useRank } from '@/lib/rank';
import { cutText, drawRankCard, markText, scalePos, volumeText } from '@/lib/rankCard';

/**
 * A wallet's volume through the terminal on one scale, with a mark for every rank: pass one and from the next trade the
 * terminal takes less. The same figures the router keeps, so what it says here is what the next trade pays.
 */
export function RankCard({ address, own = false, className }: { address: string; own?: boolean; className?: string }) {
  const info = useRank(address);
  const profile = useProfile(address);
  const [note, setNote] = useState('');
  if (!info) return <section className={cn('panel h-[188px] animate-pulse p-4', className)} aria-busy="true" />;
  const { volume, index, rank, next } = info;
  const pos = scalePos(volume);

  const save = async () => {
    const blob = await drawRankCard(volume, profile?.name ?? short(address, 6, 4));
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setNote('The card is on your clipboard.');
    } catch {
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = `submarine-rank-${rank.name.toLowerCase()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setNote('The card is in your downloads.');
    }
  };

  return (
    <section className={cn('panel p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] text-muted">{own ? 'Your rank' : 'Rank'}</div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-[24px] font-semibold leading-none tracking-tight text-accent">{rank.name}</span>
            <span className="num text-[13px] text-faint">{`${index + 1} of ${RANKS.length}`}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[13px] text-muted">Terminal cut</div>
          <div className="num mt-0.5 text-[20px] font-semibold leading-none">{cutText(rank.offBps)}</div>
        </div>
      </div>

      <p className="num mt-3 text-[13px] leading-snug text-muted">
        <span className="font-semibold text-ink">{volumeText(volume)} ZRO</span> traded through the terminal
        {next ? `. ${volumeText(next.from - volume)} ZRO more to ${next.name}, then ${cutText(next.offBps)}.` : '. The top rank.'}
      </p>

      {/* The scale: a square mark for every rank, filled up to this wallet's volume. */}
      <div className="relative mt-4 h-1.5 rounded-[3px] bg-white/[.08]" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={pos} aria-label="Volume toward the next rank">
        <div className="absolute inset-y-0 left-0 rounded-[3px] bg-accent transition-[width] duration-300" style={{ width: `${pos * 100}%` }} />
        {RANKS.map((r, i) => (
          <span
            key={r.name}
            className={cn('absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border-2 border-card', i <= index ? 'bg-accent' : 'bg-[#34343c]')}
            style={{ left: `${(i / (RANKS.length - 1)) * 100}%` }}
            title={`${r.name}: from ${markText(r.from)} ZRO, the terminal takes ${cutText(r.offBps)}`}
          />
        ))}
      </div>
      <div className="mt-2.5 grid grid-cols-6 text-[11px] leading-tight">
        {RANKS.map((r, i) => (
          <div key={r.name} className={cn('min-w-0', i === 0 ? 'text-left' : i === RANKS.length - 1 ? 'text-right' : 'text-center')}>
            <div className={cn('truncate font-medium', i <= index ? 'text-ink' : 'text-faint')}>{r.name}</div>
            <div className="num truncate text-faint">{markText(r.from)}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[12px] text-faint">{note || 'Volume through the terminal counts for good.'}</span>
        <button type="button" onClick={() => void save()} className="btn btn-soft h-8 shrink-0 px-3 text-[13px]">
          Save card
        </button>
      </div>
    </section>
  );
}
