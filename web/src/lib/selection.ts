'use client';

import { create } from 'zustand';

interface Selection {
  /** The token open on the trade screen. */
  address: string | null;
  /** What's typed in the search box. The token list filters on it live. */
  query: string;
  /** The wallet open in the side drawer. */
  wallet: string | null;
  select: (address: string) => void;
  setQuery: (query: string) => void;
  openWallet: (address: string | null) => void;
}

export const useSelection = create<Selection>((set) => ({
  address: null,
  query: '',
  wallet: null,
  select: (address) => set({ address }),
  setQuery: (query) => set({ query }),
  openWallet: (wallet) => set({ wallet: wallet?.toLowerCase() ?? null }),
}));

/** Opens a wallet's stats beside whatever is on screen, without leaving it. */
export const openWallet = (address: string | null) => useSelection.getState().openWallet(address);

/**
 * Opens a token without reloading anything: the list stays put and the chart and panels update in place, while the address
 * bar still gets a link you can share. `replace` is for stepping through the list with the keyboard, so Back isn't flooded.
 */
export function openToken(address: string, replace = false) {
  useSelection.getState().select(address);
  const url = `/tokens/${address}`;
  if (window.location.pathname === url) return;
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
}

/** A level picked on the chart's price scale, on its way to the trade card's limit form. */
export const useTicket = create<{ price: number; nonce: number; set: (price: number) => void }>((set, get) => ({
  price: 0,
  nonce: 0,
  set: (price) => set({ price, nonce: get().nonce + 1 }),
}));
