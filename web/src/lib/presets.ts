// Three saved ways to trade, P1 to P3, each an amount and a slippage. Picking one sets the quick size and slippage every buy
// button uses. Gas and priority aren't here on purpose: a higher tip doesn't get a transaction in any sooner.
import { create } from 'zustand';
import { useWallet } from './wallet';

export interface Preset {
  amount: string;
  slippageBps: number;
}

const STORAGE = 'terminal.presets.v1';
const DEFAULTS: Preset[] = [
  { amount: '20', slippageBps: 300 },
  { amount: '80', slippageBps: 1000 },
  { amount: '400', slippageBps: 2000 },
];

interface PresetState {
  presets: Preset[];
  active: number | null;
  hydrate: () => void;
  use: (i: number) => void;
  edit: (i: number, preset: Preset) => void;
}

const save = (presets: Preset[], active: number | null) => {
  try {
    localStorage.setItem(STORAGE, JSON.stringify({ presets, active }));
  } catch {
    // private mode: the presets just won't outlive the tab
  }
};

export const usePresets = create<PresetState>((set, get) => ({
  presets: DEFAULTS,
  active: null,
  hydrate: () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null') as { presets?: Preset[]; active?: number | null } | null;
      if (saved?.presets?.length === 3) set({ presets: saved.presets, active: saved.active ?? null });
    } catch {
      // a damaged entry falls back to the defaults
    }
  },
  use: (i) => {
    const p = get().presets[i];
    if (!p) return;
    const w = useWallet.getState();
    w.setQuickSize(p.amount);
    w.setSlippageBps(p.slippageBps);
    set({ active: i });
    save(get().presets, i);
  },
  edit: (i, preset) => {
    const presets = get().presets.map((p, j) => (j === i ? preset : p));
    set({ presets });
    save(presets, get().active);
    if (get().active === i) get().use(i);
  },
}));
