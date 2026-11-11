'use client';

import { useMemo } from 'react';
import { create } from 'zustand';
import { get } from './api';
import { zro, usdText } from './format';

type Currency = 'usd' | 'zro';
const STORAGE = 'terminal.currency.v1';

interface MoneyState {
  currency: Currency;
  /** ZRO in USD, null until a price arrives. Display only: no transaction ever depends on it. */
  zroUsd: number | null;
  hydrate: () => void;
  setCurrency: (c: Currency) => void;
}

let started = false;

export const useMoney = create<MoneyState>((set) => ({
  currency: 'usd',
  zroUsd: null,
  hydrate() {
    if (started) return;
    started = true;
    if (localStorage.getItem(STORAGE) === 'zro') set({ currency: 'zro' });
    const load = () =>
      get<{ usd: number | null }>('/api/v1/zro-price')
        .then((p) => {
          if (p.usd) set({ zroUsd: p.usd });
        })
        .catch(() => {});
    void load();
    setInterval(load, 60_000);
  },
  setCurrency(currency) {
    localStorage.setItem(STORAGE, currency);
    set({ currency });
  },
}));

/** Amounts are always kept in ZRO. These show them in whichever currency the user picked, falling back to ZRO with no price. */
export function useFormat() {
  const currency = useMoney((s) => s.currency);
  const rate = useMoney((s) => s.zroUsd);
  const usd = currency === 'usd' && rate ? rate : null;
  return useMemo(() => {
    const money = (v: number) => (usd ? usdText(v * usd) : `${zro(v)} ZRO`);
    return {
      /** USD per ZRO when showing dollars, otherwise null. */
      usd,
      unit: usd ? 'USD' : 'ZRO',
      money,
      signed: (v: number) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${money(Math.abs(v))}`,
    };
  }, [usd]);
}
