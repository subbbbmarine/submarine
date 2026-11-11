'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/format';
import { STAGES, useTx, type TxFlow } from '@/lib/tx';

function Flow({ flow }: { flow: TxFlow }) {
  const dismiss = useTx((s) => s.dismiss);
  const stages = STAGES;
  const [clock, setClock] = useState(0);

  const terminal = flow.status === 'success' || flow.status === 'reverted' || flow.status === 'failed';
  const lastStage = stages[stages.length - 1]!.key;
  const settled = terminal && (flow.status !== 'success' || flow.stages[lastStage] !== undefined);

  // Runs only while something is pending. The ms under each step come from the store; this is just the counter on top.
  useEffect(() => {
    if (terminal) return;
    const started = performance.now();
    const id = setInterval(() => setClock(Math.round(performance.now() - started)), 33);
    return () => clearInterval(id);
  }, [terminal]);

  useEffect(() => {
    if (!settled) return;
    const id = setTimeout(() => dismiss(flow.id), flow.status === 'success' ? 5000 : 12000);
    return () => clearTimeout(id);
  }, [settled, dismiss, flow.id, flow.status]);

  const executed = flow.stages.executed;
  const big = flow.status === 'success' && executed !== undefined ? executed : terminal ? null : clock;
  const headline = flow.status === 'success' ? 'Done' : flow.status === 'reverted' ? 'It ran and reverted' : flow.status === 'failed' ? 'Not sent' : 'Confirming';
  const tone = flow.status === 'success' ? 'text-up' : flow.status === 'reverted' || flow.status === 'failed' ? 'text-down' : 'text-muted';

  return (
    <div className="animate-rise w-full max-w-[480px] rounded-2xl border border-white/10 bg-card2 p-4 shadow-[0_18px_50px_rgb(0_0_0_/_.65)]" role="status">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{flow.label}</div>
          <div className={cn('text-[13px]', tone)}>{headline}</div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {big !== null && (
            <div className="num text-[20px] font-semibold">
              {big}
              <span className="ml-0.5 text-[13px] font-medium text-muted">ms</span>
            </div>
          )}
          {terminal && (
            <button onClick={() => dismiss(flow.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/10 hover:text-ink" aria-label="Dismiss">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M3 3l10 10M13 3L3 13" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {flow.status !== 'failed' && (
        <ol className="mt-3 flex">
          {stages.map((s, i) => {
            const ms = flow.stages[s.key];
            const reached = ms !== undefined;
            const nextUp = !reached && !terminal && stages.slice(0, i).every((p) => flow.stages[p.key] !== undefined);
            return (
              <li key={s.key} className="relative min-w-0 flex-1 text-center" title={s.hint}>
                {i > 0 && <span className={cn('absolute right-1/2 top-[5px] h-0.5 w-full transition-colors duration-300', reached ? 'bg-accent' : 'bg-white/10')} />}
                <span className={cn('relative mx-auto block h-3 w-3 rounded-full transition-colors duration-300', reached ? 'bg-accent' : nextUp ? 'animate-pulse bg-accent/60' : 'bg-[#3a3a40]')} />
                <span className={cn('mt-1.5 block truncate text-xs', reached ? 'text-ink' : 'text-faint')}>{s.label}</span>
                <span className="num block h-4 text-xs text-muted">{reached ? `${ms} ms` : ''}</span>
              </li>
            );
          })}
        </ol>
      )}
      {flow.error && <p className="mt-2 text-[13px] leading-snug text-down">{flow.error}</p>}
    </div>
  );
}

/** Every trade shows how far it has really got, with times measured in this browser. Sits low in the middle, off the buttons. */
export function Ladder() {
  const flows = useTx((s) => s.flows);
  const visible = flows.filter((f) => !f.closed);
  if (!visible.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-2 bottom-3 z-40 flex flex-col items-center gap-2">
      {visible.map((f) => (
        <div key={f.id} className="pointer-events-auto flex w-full justify-center">
          <Flow flow={f} />
        </div>
      ))}
    </div>
  );
}
