'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/format';
import { usePresets } from '@/lib/presets';

/** P1, P2, P3: a click uses one, a double click edits it. */
export function Presets({ className }: { className?: string }) {
  const { presets, active, hydrate, use, edit } = usePresets();
  const [editing, setEditing] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('');
  useEffect(hydrate, [hydrate]);

  const open = (i: number) => {
    setEditing(i);
    setAmount(presets[i]!.amount);
    setSlippage(String(presets[i]!.slippageBps / 100));
  };
  const saveEdit = () => {
    if (editing === null) return;
    const a = Number(amount);
    const s = Number(slippage);
    if (a > 0 && s > 0 && s <= 50) edit(editing, { amount: String(a), slippageBps: Math.round(s * 100) });
    setEditing(null);
  };

  return (
    <div className={cn('relative flex items-center gap-1', className)}>
      {presets.map((p, i) => (
        <button
          key={i}
          onClick={() => use(i)}
          onDoubleClick={() => open(i)}
          title={`${p.amount} ZRO, ${p.slippageBps / 100}% slippage. Double click to change.`}
          className={cn('pill num h-8 px-2.5 text-[12px] font-semibold', active === i && 'pill-on')}
        >
          P{i + 1}
        </button>
      ))}
      {editing !== null && (
        <div className="panel absolute right-0 top-10 z-30 w-56 space-y-2 p-3 shadow-xl" role="dialog" aria-label={`Edit P${editing + 1}`}>
          <div className="text-[13px] font-semibold">P{editing + 1}</div>
          <label className="block text-[12px] text-muted">
            Amount, ZRO
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="field num mt-1 h-8 w-full" />
          </label>
          <label className="block text-[12px] text-muted">
            Slippage, %
            <input value={slippage} onChange={(e) => setSlippage(e.target.value)} inputMode="decimal" className="field num mt-1 h-8 w-full" />
          </label>
          <div className="flex gap-2 pt-1">
            <button onClick={saveEdit} className="btn btn-accent h-8 flex-1 text-[13px]">
              Save
            </button>
            <button onClick={() => setEditing(null)} className="btn btn-soft h-8 flex-1 text-[13px]">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
