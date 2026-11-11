'use client';

import { useSyncExternalStore } from 'react';
import { parseEther, type Address } from 'viem';
import { get, type Token } from './api';
import { checkExit, LOSSY } from './exit';
import { sellShare, marketBuy, tokenBalance } from './trade';
import { nameOf } from './tracked';
import { publicClient, useWallet } from './wallet';

/**
 * Copies the trades of followed wallets on its own, for the wallets switched on. It runs in this browser and signs with the
 * same wallet as a click, so it only works while a tab is open. It spends real money with nobody looking, so it's off until
 * switched on per wallet, stops at a daily limit, and won't buy a token a test sale says you couldn't get out of.
 */
export interface AutoEvent {
  at: number;
  symbol: string;
  who: string;
  side: 'buy' | 'sell';
  /** What it did, or why it left the trade alone. */
  note: string;
  done: boolean;
}

export interface AutoSettings {
  wallets: string[];
  /** ZRO a copied buy spends, unless the wallet has its own size. */
  size: string;
  /** Sizes set for one wallet. */
  sizes: Record<string, string>;
  /** ZRO copied buys may spend in a day. */
  limit: string;
  /** Ignore buys smaller than this, so dust from a followed wallet doesn't cost you a real trade. */
  minTheirs: string;
  sells: boolean;
  alerts: boolean;
  day: number;
  spent: number;
}

const SAVE = 'terminal.autocopy.v1';
/** Only a trade this fresh is copied: anything older is a price already gone, or a reconnect catching up. */
const FRESH_S = 60;
/** A wallet buying a token in many small pieces is copied once a minute, not once a piece. */
const TOKEN_GAP_MS = 60_000;
/** ZRO left for the gas of getting out again. */
const RESERVE = parseEther('1');

const today = () => Math.floor(Date.now() / 86_400_000);
const BASE: AutoSettings = { wallets: [], size: '20', sizes: {}, limit: '400', minTheirs: '0', sells: true, alerts: true, day: 0, spent: 0 };

function load(): AutoSettings {
  if (typeof window === 'undefined') return BASE;
  try {
    return { ...BASE, ...(JSON.parse(localStorage.getItem(SAVE) ?? 'null') as Partial<AutoSettings> | null) };
  } catch {
    return BASE;
  }
}

let state = load();
let events: AutoEvent[] = [];
const NO_EVENTS: AutoEvent[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function set(next: Partial<AutoSettings>) {
  state = { ...state, ...next };
  try {
    localStorage.setItem(SAVE, JSON.stringify(state));
  } catch {
    // kept for this tab
  }
  emit();
}

const log = (who: string, symbol: string, side: 'buy' | 'sell', note: string, done = false) => {
  events = [{ at: Date.now(), who, symbol, side, note, done }, ...events].slice(0, 30);
  emit();
};

export const autocopy = {
  get: () => state,
  isOn: (address: string) => state.wallets.includes(address.toLowerCase()),
  toggle(address: string) {
    const a = address.toLowerCase();
    set({ wallets: state.wallets.includes(a) ? state.wallets.filter((w) => w !== a) : [a, ...state.wallets] });
  },
  setSize: (size: string) => set({ size }),
  setSizeFor(address: string, size: string) {
    const sizes = { ...state.sizes };
    if (size) sizes[address.toLowerCase()] = size;
    else delete sizes[address.toLowerCase()];
    set({ sizes });
  },
  sizeFor: (address: string) => state.sizes[address.toLowerCase()] || state.size,
  setLimit: (limit: string) => set({ limit }),
  setMinTheirs: (minTheirs: string) => set({ minTheirs }),
  setSells: (sells: boolean) => set({ sells }),
  setAlerts: (alerts: boolean) => set({ alerts }),
  spentToday: () => (state.day === today() ? state.spent : 0),
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export const useAutocopy = () => useSyncExternalStore(autocopy.subscribe, () => state, () => BASE);
export const useAutoEvents = () => useSyncExternalStore(autocopy.subscribe, () => events, () => NO_EVENTS);

/** The stream's trade, as the indexer sends it. */
export interface LiveTrade {
  tx: string;
  idx: number;
  ts: number;
  token: string;
  trader: string;
  isBuy: boolean;
  zro: number;
  amount: number;
}

const seen = new Set<string>();
const lastBuy = new Map<string, number>();

async function copyBuy(t: LiveTrade, token: Token, who: string, me: Address) {
  const min = Number(state.minTheirs) || 0;
  if (t.zro < min) return log(who, token.symbol, 'buy', `Skipped: they spent under ${state.minTheirs} ZRO`);
  const size = autocopy.sizeFor(t.trader);
  const amount = Number(size);
  if (!(amount > 0)) return log(who, token.symbol, 'buy', 'Skipped: no copy size set');
  const limit = Number(state.limit) || 0;
  if (autocopy.spentToday() + amount > limit) return log(who, token.symbol, 'buy', `Skipped: over the ${state.limit} ZRO daily limit`);
  if (Date.now() - (lastBuy.get(t.token) ?? 0) < TOKEN_GAP_MS) return log(who, token.symbol, 'buy', 'Skipped: bought this token under a minute ago');
  // Taken before anything waits, so two trades landing together can't both pass the checks above.
  lastBuy.set(t.token, Date.now());
  set({ day: today(), spent: autocopy.spentToday() + amount });
  const refund = () => set({ spent: Math.max(0, autocopy.spentToday() - amount) });
  const wei = parseEther(size as `${number}`);
  if ((await publicClient.getBalance({ address: me })) < wei + RESERVE) {
    refund();
    return log(who, token.symbol, 'buy', 'Skipped: not enough ZRO');
  }
  const exit = await checkExit(t.token as Address, wei);
  if (exit.kind === 'stuck') {
    refund();
    return log(who, token.symbol, 'buy', 'Skipped: a test sale reverted');
  }
  if (exit.kind === 'ok' && exit.lossPct >= LOSSY) {
    refund();
    return log(who, token.symbol, 'buy', `Skipped: a test sale loses ${exit.lossPct.toFixed(0)}%`);
  }
  log(who, token.symbol, 'buy', `Buying for ${size} ZRO`, true);
  try {
    await marketBuy(t.token as Address, token.symbol, size, `Copy ${who}: buy ${token.symbol}`);
  } catch (err) {
    refund();
    log(who, token.symbol, 'buy', `Failed: ${(err as Error).message}`);
  }
}

async function copySell(t: LiveTrade, token: Token, who: string, me: Address) {
  if (!state.sells) return;
  // Selling what isn't held is nothing to copy, and not worth a line in the log.
  if ((await tokenBalance(t.token as Address, me)) === 0n) return;
  // The share of its holding the followed wallet just sold, against what it holds now.
  const { holdings } = await get<{ holdings: Array<{ token: string; amount: number }> }>(`/api/v1/wallet/${t.trader}`).catch(() => ({ holdings: [] }));
  const held = holdings.find((h) => h.token === t.token)?.amount ?? 0;
  const share = Math.max(1, Math.min(100, Math.round((t.amount / (t.amount + held || 1)) * 100)));
  log(who, token.symbol, 'sell', `Selling ${share}%`, true);
  try {
    await sellShare(t.token as Address, token.symbol, share, `Copy ${who}: sell ${share}% of ${token.symbol}`);
  } catch (err) {
    log(who, token.symbol, 'sell', `Failed: ${(err as Error).message}`);
  }
}

async function handle(t: LiveTrade) {
  if (!state.wallets.includes(t.trader)) return;
  if (Date.now() / 1000 - t.ts > FRESH_S) return;
  const key = `${t.tx}:${t.idx}`;
  if (seen.has(key)) return;
  if (seen.size > 5_000) seen.clear();
  seen.add(key);
  const who = nameOf(t.trader);
  const side = t.isBuy ? 'buy' : 'sell';
  const me = useWallet.getState().account?.address;
  if (!me) return log(who, '', side, 'Skipped: create a wallet to copy');
  if (t.trader === me.toLowerCase()) return;
  let token: Token;
  try {
    token = await get<Token>(`/api/v1/tokens/${t.token}`);
  } catch {
    return log(who, '', side, 'Skipped: the token did not load');
  }
  if (!token.tradable) return log(who, token.symbol, side, 'Skipped: this terminal cannot trade this token yet');
  if (t.isBuy) await copyBuy(t, token, who, me);
  else await copySell(t, token, who, me);
}

// One copy at a time: they share a wallet and its nonce, and the order they landed in is the order that makes sense.
let queue: Promise<unknown> = Promise.resolve();
let leader = false;

/** What the app's stream hands every live trade to. Only one tab may act on them, or each copy would happen once per tab. */
export function onLiveTrade(t: LiveTrade) {
  if (!leader) return;
  queue = queue.then(() => handle(t)).catch(() => undefined);
}

let started = false;
export function startAutocopy() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const locks = navigator.locks;
  if (!locks) {
    leader = true;
    return;
  }
  void locks.request('terminal.autocopy', () => {
    leader = true;
    state = load(); // another tab may have spent while this one waited for its turn
    emit();
    return new Promise<void>(() => {}); // held until this tab closes, then the next one takes over
  });
}
