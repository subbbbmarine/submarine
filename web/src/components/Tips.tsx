'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** How long the pointer rests on something before its hint shows, and how close to the top a hint flips below. */
const DELAY_MS = 220;
const ROOM_ABOVE = 64;

interface Tip {
  text: string;
  /** The hovered element's box, in the window. */
  box: DOMRect;
}

/**
 * The site's hover hints, in place of the browser's own. Any element with a `title` shows its text here instead: the title
 * moves to `data-tip` the moment the pointer arrives, so the browser never shows its grey box, and an element that sets
 * its title again while pointed at is caught too. Elements without text of their own keep the hint as their label.
 */
export function Tips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<{ left: number; top: number; below: boolean } | null>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Takes the title off as soon as something sets it, so the browser's own hint can't show.
    const take = (el: HTMLElement) => {
      const t = el.getAttribute('title');
      if (t === null) return;
      el.removeAttribute('title');
      if (t) el.setAttribute('data-tip', t);
      if (t && !el.getAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', t);
    };
    const watch = new MutationObserver((list) => {
      for (const m of list) if (m.target instanceof HTMLElement) take(m.target);
      if (current?.getAttribute('data-tip')) setTip((old) => (old ? { ...old, text: current!.getAttribute('data-tip')! } : old));
    });
    const hide = () => {
      clearTimeout(timer);
      current = null;
      watch.disconnect();
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as Element | null)?.closest?.('[title],[data-tip]') as HTMLElement | null;
      if (el === current) return;
      clearTimeout(timer);
      watch.disconnect();
      current = el;
      if (!el || el instanceof SVGElement) return setTip(null);
      take(el);
      watch.observe(el, { attributes: true, attributeFilter: ['title'] });
      const text = el.getAttribute('data-tip');
      if (!text) return setTip(null);
      timer = setTimeout(() => {
        if (current === el && el.isConnected) setTip({ text: el.getAttribute('data-tip') ?? text, box: el.getBoundingClientRect() });
      }, DELAY_MS);
    };
    const leave = (e: PointerEvent) => {
      if (!e.relatedTarget) hide();
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', leave);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      clearTimeout(timer);
      watch.disconnect();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Above the element when there's room, centred on it, and never past the window's edges.
  useLayoutEffect(() => {
    if (!tip || !card.current) return setSpot(null);
    const w = card.current.offsetWidth;
    const h = card.current.offsetHeight;
    const below = tip.box.top < ROOM_ABOVE + h;
    const left = Math.min(Math.max(8, tip.box.left + tip.box.width / 2 - w / 2), window.innerWidth - w - 8);
    const top = below ? tip.box.bottom + 8 : tip.box.top - h - 8;
    setSpot({ left, top, below });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={card}
      role="tooltip"
      style={spot ? { left: spot.left, top: spot.top } : { left: -9999, top: 0 }}
      className="animate-fade pointer-events-none fixed z-[100] max-w-[280px] whitespace-pre-line rounded-lg border border-white/10 bg-[#1c1c20] px-2.5 py-1.5 text-[12.5px] leading-snug text-ink shadow-[0_10px_30px_rgb(0_0_0_/_.55)]"
    >
      {tip.text}
    </div>
  );
}
