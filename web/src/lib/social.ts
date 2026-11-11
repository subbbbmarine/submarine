'use client';

import { create } from 'zustand';

const STARS = 'terminal.stars.v1';

const read = (key: string): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const toggled = (list: string[], item: string) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

interface SocialState {
  stars: string[];
  hydrate: () => void;
  toggleStar: (token: string) => void;
}

/** Starred tokens live in this browser, with no account needed. Followed wallets are in tracked.ts. */
export const useSocial = create<SocialState>((set, get) => ({
  stars: [],
  hydrate: () => set({ stars: read(STARS) }),
  toggleStar(token) {
    const stars = toggled(get().stars, token);
    localStorage.setItem(STARS, JSON.stringify(stars));
    set({ stars });
  },
}));
