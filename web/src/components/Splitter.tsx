'use client';

import { useRef } from 'react';
import { cn } from '@/lib/format';
import { useLayout, type Part } from '@/lib/layout';

/**
 * A handle on the edge between two parts of the screen: drag it to give one more room, double click to put the default back.
 * `sign` turns a drag the way the part grows: a handle on a part's left or top edge grows it when dragged left or up.
 */
export function Splitter({ part, dir, sign = 1, measure, className }: { part: Part; dir: 'x' | 'y'; sign?: 1 | -1; measure: () => number; className?: string }) {
  const start = useRef<{ at: number; size: number } | null>(null);
  const setSize = useLayout((s) => s.setSize);
  return (
    <div
      role="separator"
      aria-orientation={dir === 'x' ? 'vertical' : 'horizontal'}
      title="Drag to resize, double click to reset"
      className={cn('group/split absolute z-20 hidden touch-none lg:block', dir === 'x' ? 'inset-y-0 w-2 cursor-col-resize' : 'inset-x-0 h-2 cursor-row-resize', className)}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { at: dir === 'x' ? e.clientX : e.clientY, size: measure() };
        document.body.style.cursor = dir === 'x' ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        setSize(part, s.size + ((dir === 'x' ? e.clientX : e.clientY) - s.at) * sign);
      }}
      onPointerUp={(e) => {
        start.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }}
      onDoubleClick={() => setSize(part, undefined)}
    >
      <span className={cn('absolute rounded-full bg-accent opacity-0 transition-opacity duration-150 group-hover/split:opacity-70', dir === 'x' ? 'inset-y-3 left-[3px] w-0.5' : 'inset-x-3 top-[3px] h-0.5')} />
    </div>
  );
}
