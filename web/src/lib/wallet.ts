'use client';

import { create } from 'zustand';
import { createPublicClient, custom, formatEther, http, numberToHex, type Address, type Hex, type LocalAccount } from 'viem';
import { generatePrivateKey, privateKeyToAccount, toAccount } from 'viem/accounts';
import { chain, CHAIN_ID, RPC_URL } from './config';
import { overSocket, SocketFailure, socketOpen } from './rpc';

const overHttp = http(RPC_URL, { timeout: 10_000 })({ chain });

/** Over the socket while it's open, and over HTTP otherwise: on a node with no socket, before it connects, or if it drops. */
export const publicClient = createPublicClient({
  chain,
  transport: custom(
    {
      async request({ method, params }: { method: string; params?: unknown }) {
        if (socketOpen()) {
          try {
            return await overSocket(method, params);
          } catch (err) {
            if (!(err instanceof SocketFailure)) throw err; // the node answered, and that answer stands
          }
        }
        return overHttp.request({ method, params } as never);
      },
    },
    { retryCount: 0 },
  ),
});

/** The key of the wallet in use. Kept apart from the list so a page that only knows this one still works. */
const KEY_STORAGE = 'terminal.wallet.v1';
/** Every wallet this browser holds: keys and names. Absent while a PIN locks them. */
const LIST_STORAGE = 'terminal.wallets.v1';
const PREFS_STORAGE = 'terminal.prefs.v1';
/** Set while a wallet made here hasn't had its key saved by its owner. A key they brought themselves is one they already have. */
const UNSAVED_STORAGE = 'terminal.wallet.unsaved.v1';
/** The wallets, encrypted with a key made from the owner's PIN, when they chose one. */
const LOCK_STORAGE = 'terminal.lock.v1';
/** The address of a browser wallet extension in use instead of a key held here. */
const INJECTED_STORAGE = 'terminal.wallet.injected.v1';
/** The network as an extension adds it. Its own RPC, since the extension isn't held back by CORS: Zero's testnet off the local chain. */
const EXTENSION_RPC = process.env.NEXT_PUBLIC_EXTENSION_RPC_URL || (process.env.NEXT_PUBLIC_CHAIN_ID === '1337' ? 'https://testnet.zero.layerzero.network' : 'http://127.0.0.1:8546');

interface Stored {
  key: Hex;
  name: string;
}
export interface WalletEntry {
  address: string;
  name: string;
}

/** Keys live here in memory, never in React state, so nothing renders or logs them. */
let keys: Stored[] = [];
let lockKey: CryptoKey | null = null;
/** A wallet waiting for its PIN before it is made or added: the key never touches storage unsealed. */
let pendingName = '';
let pendingImport: Hex | null = null;

const read = <T,>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const addressOf = (key: Hex) => privateKeyToAccount(key).address.toLowerCase();
const entries = (): WalletEntry[] => keys.map((k) => ({ address: addressOf(k.key), name: k.name }));

// ---------------------------------------------------------------- PIN

export const MIN_PIN = 8;
/** PBKDF2 rounds for a PIN set now. A list sealed earlier keeps the count it was sealed with, written beside it. */
const PIN_ROUNDS = 600_000;
const OLD_PIN_ROUNDS = 310_000;
/** The rounds the sealed list in storage was made with, so it unlocks the way it was locked. */
let lockRounds = PIN_ROUNDS;

const enc = new TextEncoder();
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFromPin(pin: string, salt: Uint8Array, rounds: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  // Exportable only so this tab can keep it in its session storage (see TAB_UNLOCK); it is never sent anywhere.
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: rounds, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/**
 * The key the PIN made, kept by this tab after it is typed, so a reload in the same tab doesn't ask again. Session storage
 * belongs to the tab and goes when it closes: a new tab or a restarted browser asks for the PIN.
 */
const TAB_UNLOCK = 'terminal.unlocked.v1';
/**
 * How long a tab stays unlocked across reloads. Session storage can outlive the tab when the browser restores it after a
 * restart, so the copy kept there expires, and the PIN is asked again after it.
 */
const TAB_UNLOCK_FOR_MS = 6 * 3_600_000;
async function rememberUnlock(key: CryptoKey | null) {
  try {
    if (key) sessionStorage.setItem(TAB_UNLOCK, JSON.stringify({ k: b64(await crypto.subtle.exportKey('raw', key)), until: Date.now() + TAB_UNLOCK_FOR_MS }));
    else sessionStorage.removeItem(TAB_UNLOCK);
  } catch {}
}
/** The key this tab kept, while it is still fresh. */
function tabUnlock(): string | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(TAB_UNLOCK) ?? 'null') as { k?: string; until?: number } | null;
    if (saved?.k && typeof saved.until === 'number' && saved.until > Date.now()) return saved.k;
    sessionStorage.removeItem(TAB_UNLOCK);
  } catch {}
  return null;
}

type Lock = { salt: string; iv: string; data: string; rounds?: number };
async function openLock(lock: Lock, key: CryptoKey): Promise<Stored[]> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(lock.iv) as BufferSource }, key, unb64(lock.data) as BufferSource);
  return JSON.parse(new TextDecoder().decode(plain)) as Stored[];
}

async function sealList(key: CryptoKey, salt: Uint8Array) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(keys)));
  localStorage.setItem(LOCK_STORAGE, JSON.stringify({ salt: b64(salt), iv: b64(iv), data: b64(data), rounds: lockRounds }));
}

/**
 * Which wallet was in use, for this tab, so unlocking after a reload picks it again. Only its address is kept: the key itself
 * stays sealed with the PIN and lives in memory once unlocked, never in storage.
 */
const ACTIVE_SESSION = 'terminal.active.v1';
function rememberActive(key: Hex | null) {
  try {
    sessionStorage.removeItem(KEY_STORAGE); // where an earlier version kept the whole key
    if (key) sessionStorage.setItem(ACTIVE_SESSION, addressOf(key));
    else sessionStorage.removeItem(ACTIVE_SESSION);
  } catch {}
}

/** Writes the list the way the owner chose: plain, or sealed with their PIN. The active key is plain only without a PIN. */
async function persist(active: Hex | null) {
  const lock = read<{ salt: string } | null>(LOCK_STORAGE, null);
  if (lock && lockKey) {
    await sealList(lockKey, unb64(lock.salt));
    localStorage.removeItem(LIST_STORAGE);
    localStorage.removeItem(KEY_STORAGE);
    rememberActive(active);
    return;
  }
  localStorage.setItem(LIST_STORAGE, JSON.stringify(keys));
  if (active) localStorage.setItem(KEY_STORAGE, active);
  else localStorage.removeItem(KEY_STORAGE);
}

// ---------------------------------------------------------------- browser extension

type Provider = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
export const extension = (): Provider | null => (typeof window !== 'undefined' ? ((window as unknown as { ethereum?: Provider }).ethereum ?? null) : null);

/** An extension's account. It can't hand over signed bytes, so tx.ts sends through the extension when it sees one. */
function extensionAccount(address: Address): LocalAccount {
  const refuse = async (): Promise<never> => {
    throw new Error('This wallet signs in its extension');
  };
  return toAccount({ address, signMessage: refuse, signTransaction: refuse, signTypedData: refuse });
}
export const isExtension = (a: LocalAccount | null) => a?.source === 'custom';

async function onOurChain(p: Provider) {
  const id = numberToHex(CHAIN_ID);
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: id }] });
  } catch (err) {
    if ((err as { code?: number }).code !== 4902) throw err;
    await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: id, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [EXTENSION_RPC] }] });
  }
}

// ---------------------------------------------------------------- the store

interface WalletState {
  ready: boolean;
  account: LocalAccount | null;
  wallets: WalletEntry[];
  /** Keys are sealed with a PIN and not unlocked yet. */
  locked: boolean;
  /** This tab is opening the keys with the PIN it was given earlier, so the PIN isn't asked for yet. */
  resuming: boolean;
  hasPin: boolean;
  /**
   * A PIN is needed first: to make a wallet, to add an imported one, or to seal keys an earlier version stored plain. Every
   * key here is sealed with the PIN, so none is made or added without one.
   */
  askPin: 'create' | 'import' | 'protect' | null;
  /** Sets the PIN and does what it was asked for. Throws on a PIN too short. */
  submitPin: (pin: string) => Promise<void>;
  cancelPin: () => void;
  balance: number;
  keyUnsaved: boolean;
  keySaved: () => void;
  /** ZRO a one-click buy spends. */
  quickSize: string;
  slippageBps: number;
  hydrate: () => void;
  /** Makes a new wallet and switches to it, asking for the PIN first when there is none yet. No arguments: a click handler. */
  create: () => void;
  createNamed: (name: string) => void;
  importKey: (key: string, name?: string) => void;
  exportKey: (address?: string) => string | null;
  switchTo: (address: string) => void;
  rename: (address: string, name: string) => void;
  /** Removes the wallet in use from this browser, and moves to another if there is one. */
  forget: () => void;
  connectExtension: () => Promise<void>;
  unlock: (pin: string) => Promise<boolean>;
  /** Whether `pin` opens the sealed list, without changing anything. True when there is no PIN. */
  checkPin: (pin: string) => Promise<boolean>;
  setPin: (pin: string) => Promise<void>;
  /** The keys of several wallets at once, for buying from them together. Never kept in state. */
  accountsFor: (addresses: string[]) => LocalAccount[];
  refreshBalance: () => Promise<void>;
  setQuickSize: (v: string) => void;
  setSlippageBps: (v: number) => void;
}

function savePrefs(quickSize: string, slippageBps: number) {
  localStorage.setItem(PREFS_STORAGE, JSON.stringify({ quickSize, slippageBps }));
}

/**
 * Keys the browser keeps, so a trade signs itself with no popup. That is the whole point of a fast terminal. They are always
 * sealed with the owner's PIN, so a copy of the browser profile holds nothing usable without it, and they live open only in
 * memory once it's typed. A browser wallet extension can be used instead, at the cost of its popup on every trade.
 */
export const useWallet = create<WalletState>((set, get) => {
  const activate = (key: Hex | null, extra: Partial<WalletState> = {}) => {
    set({ account: key ? privateKeyToAccount(key) : null, wallets: entries(), balance: 0, ...extra });
    void get().refreshBalance();
  };
  const addNew = (name: string) => {
    const key = generatePrivateKey();
    keys.push({ key, name: name || `Wallet ${keys.length + 1}` });
    localStorage.setItem(UNSAVED_STORAGE, '1');
    localStorage.removeItem(INJECTED_STORAGE);
    return key;
  };
  const addImported = (key: Hex, name: string) => {
    if (!keys.some((k) => k.key === key)) keys.push({ key, name: name || `Wallet ${keys.length + 1}` });
    localStorage.removeItem(UNSAVED_STORAGE);
    localStorage.removeItem(INJECTED_STORAGE);
  };

  return {
    ready: false,
    account: null,
    wallets: [],
    locked: false,
    resuming: false,
    hasPin: false,
    askPin: null,
    balance: 0,
    keyUnsaved: false,
    quickSize: '50',
    slippageBps: 0, // auto

    keySaved() {
      localStorage.removeItem(UNSAVED_STORAGE);
      set({ keyUnsaved: false });
    },

    hydrate() {
      if (get().ready) return;
      const prefs = read<{ quickSize?: string; slippageBps?: number }>(PREFS_STORAGE, {});
      const base = { ready: true, quickSize: prefs.quickSize ?? '50', slippageBps: prefs.slippageBps ?? 0 };
      const lock = read<Lock | null>(LOCK_STORAGE, null);
      if (lock) {
        const saved = tabUnlock();
        set({ ...base, locked: true, resuming: Boolean(saved), hasPin: true, account: null, wallets: [] });
        if (saved) {
          void (async () => {
            try {
              const key = await crypto.subtle.importKey('raw', unb64(saved) as BufferSource, 'AES-GCM', true, ['encrypt', 'decrypt']);
              keys = await openLock(lock, key);
              lockKey = key;
              lockRounds = lock.rounds ?? OLD_PIN_ROUNDS;
              const remembered = sessionStorage.getItem(ACTIVE_SESSION);
              activate(keys.find((k) => addressOf(k.key) === remembered)?.key ?? keys[0]?.key ?? null, { locked: false, resuming: false, keyUnsaved: localStorage.getItem(UNSAVED_STORAGE) !== null });
            } catch {
              void rememberUnlock(null); // a PIN set again elsewhere since: ask for it
              set({ resuming: false });
            }
          })();
        }
        return;
      }
      keys = read<Stored[]>(LIST_STORAGE, []);
      const active = localStorage.getItem(KEY_STORAGE) as Hex | null;
      // A key set the old way, or by a test, joins the list rather than being lost.
      if (active && !keys.some((k) => k.key === active)) {
        keys.push({ key: active, name: `Wallet ${keys.length + 1}` });
        localStorage.setItem(LIST_STORAGE, JSON.stringify(keys));
      }
      const injected = localStorage.getItem(INJECTED_STORAGE) as Address | null;
      set(base);
      if (injected && extension()) {
        set({ account: extensionAccount(injected), wallets: entries(), keyUnsaved: false });
        void get().refreshBalance();
        return;
      }
      // Keys an earlier version stored plain stay usable, and are sealed as soon as their owner picks a PIN.
      activate(active, { keyUnsaved: Boolean(active) && localStorage.getItem(UNSAVED_STORAGE) !== null, askPin: keys.length ? 'protect' : null });
    },

    create() {
      get().createNamed('');
    },

    createNamed(name) {
      if (get().locked) return; // the unlock dialog is up; the keys it opens are the ones to add to
      if (!lockKey) {
        pendingName = name;
        set({ askPin: 'create' });
        return;
      }
      const key = addNew(name);
      void persist(key);
      activate(key, { keyUnsaved: true });
    },

    importKey(raw, name) {
      const key = (raw.trim().startsWith('0x') ? raw.trim() : `0x${raw.trim()}`) as Hex;
      privateKeyToAccount(key); // throws on a malformed key, before anything is stored
      if (get().locked) throw new Error('Unlock your wallets first');
      if (!lockKey) {
        pendingImport = key;
        pendingName = name ?? '';
        set({ askPin: 'import' });
        return;
      }
      addImported(key, name ?? '');
      void persist(key);
      activate(key, { keyUnsaved: false });
    },

    async submitPin(pin) {
      if (pin.length < MIN_PIN) throw new Error(`Use at least ${MIN_PIN} digits or letters`);
      const asked = get().askPin;
      let active = (get().account && !isExtension(get().account) ? get().exportKey() : null) as Hex | null;
      let unsaved = get().keyUnsaved;
      if (asked === 'create') {
        active = addNew(pendingName);
        unsaved = true;
      } else if (asked === 'import' && pendingImport) {
        addImported(pendingImport, pendingName);
        active = pendingImport;
        unsaved = false;
      }
      pendingImport = null;
      pendingName = '';
      // Sealed before anything else, so the new key is never written down open.
      await get().setPin(pin);
      rememberActive(active);
      if (asked === 'protect') set({ askPin: null });
      else activate(active, { askPin: null, keyUnsaved: unsaved });
    },

    cancelPin() {
      pendingImport = null;
      pendingName = '';
      if (get().askPin !== 'protect') set({ askPin: null });
    },

    exportKey(address) {
      const target = (address ?? get().account?.address ?? '').toLowerCase();
      return keys.find((k) => addressOf(k.key) === target)?.key ?? null;
    },

    switchTo(address) {
      const found = keys.find((k) => addressOf(k.key) === address.toLowerCase());
      if (!found) return;
      localStorage.removeItem(INJECTED_STORAGE);
      localStorage.removeItem(UNSAVED_STORAGE);
      void persist(found.key);
      activate(found.key, { keyUnsaved: false });
    },

    rename(address, name) {
      const found = keys.find((k) => addressOf(k.key) === address.toLowerCase());
      if (!found) return;
      found.name = name.trim() || found.name;
      void persist((get().account && !isExtension(get().account) ? get().exportKey() : null) as Hex | null);
      set({ wallets: entries() });
    },

    forget() {
      const current = get().account;
      if (isExtension(current)) {
        localStorage.removeItem(INJECTED_STORAGE);
        activate(keys[0]?.key ?? null, { keyUnsaved: false });
        return;
      }
      const address = current?.address.toLowerCase();
      keys = keys.filter((k) => addressOf(k.key) !== address);
      localStorage.removeItem(UNSAVED_STORAGE);
      const next = keys[0]?.key ?? null;
      void persist(next);
      activate(next, { keyUnsaved: false });
    },

    async connectExtension() {
      const p = extension();
      if (!p) throw new Error('No browser wallet found. Install MetaMask or another one, then try again');
      const [address] = (await p.request({ method: 'eth_requestAccounts' })) as Address[];
      if (!address) throw new Error('The extension shared no account');
      await onOurChain(p);
      localStorage.setItem(INJECTED_STORAGE, address);
      set({ account: extensionAccount(address), keyUnsaved: false, balance: 0 });
      void get().refreshBalance();
    },

    async unlock(pin) {
      const lock = read<Lock | null>(LOCK_STORAGE, null);
      if (!lock) return true;
      try {
        const rounds = lock.rounds ?? OLD_PIN_ROUNDS;
        const key = await keyFromPin(pin, unb64(lock.salt), rounds);
        keys = await openLock(lock, key);
        lockKey = key;
        lockRounds = rounds;
        await rememberUnlock(key);
        const remembered = sessionStorage.getItem(ACTIVE_SESSION);
        sessionStorage.removeItem(KEY_STORAGE);
        const active = keys.find((k) => addressOf(k.key) === remembered)?.key ?? keys[0]?.key ?? null;
        activate(active, { locked: false, resuming: false, hasPin: true, keyUnsaved: localStorage.getItem(UNSAVED_STORAGE) !== null });
        return true;
      } catch {
        return false; // a wrong PIN fails the decryption
      }
    },

    async checkPin(pin) {
      const lock = read<Lock | null>(LOCK_STORAGE, null);
      if (!lock) return true;
      try {
        const key = await keyFromPin(pin, unb64(lock.salt), lock.rounds ?? OLD_PIN_ROUNDS);
        await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(lock.iv) as BufferSource }, key, unb64(lock.data) as BufferSource);
        return true;
      } catch {
        return false;
      }
    },

    async setPin(pin) {
      // Eight at the least: the sealed list sits in this browser's storage, where a copy of it can be guessed at offline.
      if (pin.length < MIN_PIN) throw new Error(`Use at least ${MIN_PIN} digits or letters`);
      const salt = crypto.getRandomValues(new Uint8Array(16));
      lockRounds = PIN_ROUNDS;
      lockKey = await keyFromPin(pin, salt, lockRounds);
      await sealList(lockKey, salt);
      await rememberUnlock(lockKey);
      const active = get().exportKey();
      localStorage.removeItem(LIST_STORAGE);
      localStorage.removeItem(KEY_STORAGE);
      rememberActive(active as Hex | null);
      set({ hasPin: true });
    },

    accountsFor(addresses) {
      const want = new Set(addresses.map((a) => a.toLowerCase()));
      return keys.filter((k) => want.has(addressOf(k.key))).map((k) => privateKeyToAccount(k.key));
    },

    async refreshBalance() {
      const a = get().account;
      if (!a) return;
      try {
        const wei = await publicClient.getBalance({ address: a.address as Address });
        if (get().account?.address === a.address) set({ balance: Number(formatEther(wei)) });
      } catch {}
    },

    setQuickSize(v) {
      set({ quickSize: v });
      savePrefs(v, get().slippageBps);
    },

    setSlippageBps(v) {
      set({ slippageBps: v });
      savePrefs(get().quickSize, v);
    },
  };
});
