'use client';

import { useSyncExternalStore } from 'react';
import { short } from './format';
import { profileOf, useProfilesVersion } from './profiles';

/** Wallets you follow, with the names you gave them. Kept in this browser, no account needed. */
export interface Tracked {
  address: string;
  label: string;
  addedAt: number;
}

const SAVE = 'terminal.tracked.v1';
/** Follows from before they could have names. */
const OLD = 'terminal.follows.v1';
const NONE: Tracked[] = [];

function load(): Tracked[] {
  if (typeof window === 'undefined') return NONE;
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE) ?? 'null') as Tracked[] | null;
    if (saved) return saved;
    const old = JSON.parse(localStorage.getItem(OLD) ?? '[]') as string[];
    return old.map((address) => ({ address, label: '', addedAt: Date.now() }));
  } catch {
    return NONE;
  }
}

let state = load();
const listeners = new Set<() => void>();

function set(next: Tracked[]) {
  state = next;
  try {
    localStorage.setItem(SAVE, JSON.stringify(state));
  } catch {
    // kept for this tab
  }
  listeners.forEach((l) => l());
}

export const tracked = {
  get: () => state,
  has: (address: string) => state.some((t) => t.address === address.toLowerCase()),
  add(address: string, label = '') {
    const a = address.toLowerCase();
    if (state.some((t) => t.address === a)) return set(state.map((t) => (t.address === a ? { ...t, label: label.trim() || t.label } : t)));
    set([{ address: a, label: label.trim(), addedAt: Date.now() }, ...state]);
  },
  remove: (address: string) => set(state.filter((t) => t.address !== address.toLowerCase())),
  rename: (address: string, label: string) => set(state.map((t) => (t.address === address.toLowerCase() ? { ...t, label: label.trim() } : t))),
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** The wallets you follow. Also re-renders when public profiles arrive, since every name on screen goes through nameOf. */
export const useTracked = () => {
  useProfilesVersion();
  return useSyncExternalStore(tracked.subscribe, () => state, () => NONE);
};

/** What to call a wallet: the name you gave it if you follow it, then the name it gave itself, then its short address. */
export function nameOf(address: string, list: Tracked[] = state): string {
  const a = address.toLowerCase();
  return list.find((t) => t.address === a)?.label || profileOf(a)?.name || short(a, 4, 3);
}
