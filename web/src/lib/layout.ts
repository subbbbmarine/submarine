'use client';

import { create } from 'zustand';

export type ListTab = 'tokens' | 'feed' | 'leaders' | 'tracked';
export type Part = 'list' | 'lists' | 'side' | 'bottom';

const SAVE = 'terminal.layout.v1';
const LIMITS: Record<Part, [number, number]> = {
  list: [260, 560],
  lists: [500, 1000],
  side: [290, 520],
  bottom: [120, 620],
};

interface Layout {
  ready: boolean;
  /** Which list the left column shows. */
  tab: ListTab;
  /** A second list beside the first, and what it shows. */
  split: boolean;
  tab2: ListTab;
  /** Sizes the user dragged, in pixels. Unset means the default. */
  sizes: Partial<Record<Part, number>>;
  hydrate: () => void;
  setTab: (tab: ListTab) => void;
  setSplit: (split: boolean) => void;
  setTab2: (tab: ListTab) => void;
  setSize: (part: Part, value: number | undefined) => void;
}

function save(state: Pick<Layout, 'tab' | 'tab2' | 'split' | 'sizes'>) {
  try {
    localStorage.setItem(SAVE, JSON.stringify({ tab: state.tab, tab2: state.tab2, split: state.split, sizes: state.sizes }));
  } catch {
    // kept for this visit
  }
}

export const useLayout = create<Layout>((set, get) => ({
  ready: false,
  tab: 'tokens',
  split: false,
  tab2: 'tokens',
  sizes: {},
  hydrate() {
    if (get().ready) return;
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE) ?? '{}') as Partial<Layout>;
      set({ ready: true, tab: saved.tab ?? 'tokens', tab2: saved.tab2 ?? 'tokens', split: Boolean(saved.split), sizes: saved.sizes ?? {} });
    } catch {
      set({ ready: true });
    }
  },
  setTab(tab) {
    set({ tab });
    save(get());
  },
  setSplit(split) {
    set({ split });
    save(get());
  },
  setTab2(tab2) {
    set({ tab2 });
    save(get());
  },
  setSize(part, value) {
    const [low, high] = LIMITS[part];
    const sizes = { ...get().sizes };
    if (value === undefined) delete sizes[part];
    else sizes[part] = Math.round(Math.max(low, Math.min(high, value)));
    set({ sizes });
    save(get());
  },
}));
