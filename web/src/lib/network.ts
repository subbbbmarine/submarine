'use client';

import { create } from 'zustand';
import { publicClient } from './wallet';

interface NetworkState {
  connected: boolean;
  /** The newest block seen. */
  ordered: number;
  /** Milliseconds between blocks, smoothed. */
  blockMs: number | null;
  start: () => void;
}

let started = false;

/** The chain's head, asked for once a second. */
export const useNetwork = create<NetworkState>((set, get) => {
  let lastHeadAt = 0;

  const onHead = (ordered: number) => {
    const now = performance.now();
    const prev = get().ordered;
    if (ordered > prev) {
      const gap = lastHeadAt ? (now - lastHeadAt) / (ordered - prev) : null;
      lastHeadAt = now;
      const blockMs = gap === null ? get().blockMs : get().blockMs === null ? gap : get().blockMs! * 0.9 + gap * 0.1;
      set({ ordered, blockMs, connected: true });
    } else if (ordered < prev) {
      // A local chain that was restarted: its numbers start again, and so do ours.
      lastHeadAt = 0;
      set({ ordered, blockMs: null, connected: true });
    } else if (!get().connected) {
      set({ connected: true });
    }
  };

  return {
    connected: false,
    ordered: 0,
    blockMs: null,

    start() {
      if (started || typeof window === 'undefined') return;
      started = true;
      const poll = async () => {
        try {
          onHead(Number(await publicClient.getBlockNumber({ cacheTime: 0 })));
        } catch {
          set({ connected: false });
        }
      };
      void poll();
      setInterval(poll, 1000);
    },
  };
});
