'use client';

import { useCallback, useEffect, useState } from 'react';

/** A horizontal line someone drew on a token's chart. The level is a price, ZRO per token, whatever unit the scale shows. */
export interface HLine {
  id: string;
  price: number;
}

const SAVE = 'terminal.drawings.v1';
/** Tells other charts of the same token on the page, such as a multichart cell, that the lines changed. */
const CHANGED = 'terminal-drawings';

type Saved = Record<string, { lines?: HLine[] }>;

function readAll(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE) ?? '{}') as unknown;
    return saved && typeof saved === 'object' ? (saved as Saved) : {};
  } catch {
    return {};
  }
}

function readLines(address: string): HLine[] {
  const lines = readAll()[address]?.lines;
  return Array.isArray(lines) ? lines.filter((l) => l && typeof l.id === 'string' && Number.isFinite(l.price) && l.price > 0) : [];
}

function writeLines(address: string, lines: HLine[]) {
  try {
    const all = readAll();
    if (lines.length) all[address] = { ...all[address], lines };
    else delete all[address];
    localStorage.setItem(SAVE, JSON.stringify(all));
  } catch {
    // kept for this visit
  }
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: address }));
}

export const lineId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The lines on one token's chart, kept in localStorage and in step across every chart of that token, in this tab and others. */
export function useLines(address: string): [HLine[], (lines: HLine[]) => void] {
  const [lines, setState] = useState<HLine[]>([]);
  useEffect(() => {
    const load = () => setState(readLines(address));
    load();
    const onChanged = (e: Event) => {
      if ((e as CustomEvent<string>).detail === address) load();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === SAVE) load();
    };
    window.addEventListener(CHANGED, onChanged);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGED, onChanged);
      window.removeEventListener('storage', onStorage);
    };
  }, [address]);
  const setLines = useCallback(
    (next: HLine[]) => {
      setState(next);
      writeLines(address, next);
    },
    [address],
  );
  return [lines, setLines];
}
