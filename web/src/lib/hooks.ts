'use client';

import { useEffect, useRef, useState } from 'react';
import { onBlock } from './network';

/**
 * Runs `fn` on each new block while the page is visible, at most once every `minMs`, and every `fallbackMs` if blocks stop
 * coming. What it reads can only change with a block, so that is when to read it, not on a timer of its own.
 */
export function everyBlock(fn: () => void, minMs: number, fallbackMs = 5000): () => void {
  let last = 0;
  const run = () => {
    if (document.visibilityState !== 'visible') return;
    const t = Date.now();
    if (t - last < minMs) return;
    last = t;
    fn();
  };
  const stop = onBlock(run);
  const id = setInterval(() => Date.now() - last >= fallbackMs && run(), fallbackMs);
  return () => {
    stop();
    clearInterval(id);
  };
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** A class that briefly colours a number by the way it just moved. */
export function useFlash(value: number): string {
  const prev = useRef(value);
  const [tone, setTone] = useState('');
  useEffect(() => {
    if (value === prev.current) return;
    const up = value > prev.current;
    prev.current = value;
    setTone(up ? 'text-up' : 'text-down');
    const id = setTimeout(() => setTone(''), 700);
    return () => clearTimeout(id);
  }, [value]);
  return tone;
}

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/**
 * Glides list rows to their new places instead of letting them jump when the order changes, and fades in new ones.
 * Rows mark themselves with data-flip. `resetKey` changing (another filter, say) swaps the list without any movement.
 */
export function useFlip(order: string, resetKey: string) {
  const container = useRef<HTMLDivElement>(null);
  const tops = useRef(new Map<string, number>());
  const lastReset = useRef(resetKey);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const fresh = lastReset.current !== resetKey;
    lastReset.current = resetKey;
    const animate = !fresh && tops.current.size > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, number>();
    el.querySelectorAll<HTMLElement>('[data-flip]').forEach((row) => {
      const key = row.dataset.flip!;
      const top = row.offsetTop;
      next.set(key, top);
      if (!animate) return;
      const before = tops.current.get(key);
      if (before === undefined) {
        row.animate([{ opacity: 0, transform: 'translateY(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE });
      } else if (before !== top) {
        row.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'none' }], { duration: 360, easing: EASE });
      }
    });
    tops.current = next;
  }, [order, resetKey]);

  return container;
}
