// Every chat's subscriptions, in one JSON file. Written whole to a temp file and renamed over the old one, so a crash mid-write
// leaves the previous version rather than half a file.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Direction } from './commands.js';
import { log, why } from './log.js';
import type { SeenOrder } from './rules.js';

export type Watch = { wallet: string; name: string | null };
export type CapAlert = { token: string; symbol: string; direction: Direction; levelUsd: number; lastCapUsd: number | null; createdAt: number };
/** `seen` null until the wallet's orders were read once. */
export type OrderSub = { wallet: string; seen: Record<string, SeenOrder> | null };
export type Chat = { watches: Watch[]; alerts: CapAlert[]; orders: OrderSub[] };
export type Data = { version: 1; offset: number; chats: Record<string, Chat> };

/** Per chat, and how many chats the bot keeps subscriptions for at all, so one person with many accounts can't fill it. */
export const LIMITS = { watches: 100, alerts: 50, orders: 20, chats: 5000 };

const empty = (): Data => ({ version: 1, offset: 0, chats: {} });

/** ALERTS_DATA may name the file (anything ending in .json) or the folder to keep subscriptions.json in. */
export function dataPath(setting: string | undefined, defaultDir: string): string {
  const p = setting?.trim() || defaultDir;
  return p.toLowerCase().endsWith('.json') ? resolve(p) : join(resolve(p), 'subscriptions.json');
}

export function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** Reads the file, or starts empty. A file that doesn't parse is kept aside under another name, never overwritten. */
export function loadData(path: string): Data {
  if (!existsSync(path)) return empty();
  try {
    const d = JSON.parse(readFileSync(path, 'utf8')) as Partial<Data>;
    if (!d || typeof d !== 'object' || typeof d.chats !== 'object' || d.chats === null) throw new Error('no chats in it');
    for (const c of Object.values(d.chats)) {
      c.watches ??= [];
      c.alerts ??= [];
      c.orders ??= [];
    }
    return { version: 1, offset: Number(d.offset) || 0, chats: d.chats };
  } catch (err) {
    const aside = `${path}.broken-${Date.now()}`;
    renameSync(path, aside);
    log.error({ path, aside, err: why(err) }, 'the subscriptions file did not parse, so it was moved aside and the bot starts empty');
    return empty();
  }
}

type Index = {
  watchers: Map<string, Array<{ chatId: number; watch: Watch }>>;
  alerts: Map<string, Array<{ chatId: number; alert: CapAlert }>>;
  orders: Map<string, Array<{ chatId: number; sub: OrderSub }>>;
};

export class Store {
  data: Data;
  private index: Index | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    readonly path: string,
    private delayMs = 1000,
  ) {
    this.data = loadData(path);
  }

  /** A chat's subscriptions, made if it has none yet. */
  chat(id: number): Chat {
    return (this.data.chats[String(id)] ??= { watches: [], alerts: [], orders: [] });
  }

  /** How many chats have anything set up. */
  size(): number {
    return Object.keys(this.data.chats).length;
  }

  peek(id: number): Chat | undefined {
    return this.data.chats[String(id)];
  }

  /** Marks a change: the lookups are rebuilt and the file is written soon, many changes at once in one write. */
  changed(): void {
    this.index = null;
    for (const [id, c] of Object.entries(this.data.chats)) if (!c.watches.length && !c.alerts.length && !c.orders.length) delete this.data.chats[id];
    this.save();
  }

  /** Writes soon. For values that change often but don't change who gets what, like the last cap an alert saw. */
  save(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.delayMs);
    this.timer.unref?.();
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      writeAtomic(this.path, JSON.stringify(this.data, null, 1));
    } catch (err) {
      log.error({ path: this.path, err: why(err) }, 'could not write the subscriptions file');
    }
  }

  setOffset(offset: number): void {
    if (offset === this.data.offset) return;
    this.data.offset = offset;
    this.save();
  }

  dropChat(id: number): void {
    delete this.data.chats[String(id)];
    this.changed();
  }

  /** A group that became a supergroup gets a new id, and keeps its subscriptions. */
  moveChat(from: number, to: number): void {
    const c = this.data.chats[String(from)];
    if (!c) return;
    delete this.data.chats[String(from)];
    this.data.chats[String(to)] = c;
    this.changed();
  }

  private lookups(): Index {
    if (this.index) return this.index;
    const index: Index = { watchers: new Map(), alerts: new Map(), orders: new Map() };
    const add = <T>(m: Map<string, T[]>, k: string, v: T) => (m.get(k) ?? m.set(k, []).get(k)!).push(v);
    for (const [id, c] of Object.entries(this.data.chats)) {
      const chatId = Number(id);
      for (const watch of c.watches) add(index.watchers, watch.wallet, { chatId, watch });
      for (const alert of c.alerts) add(index.alerts, alert.token, { chatId, alert });
      for (const sub of c.orders) add(index.orders, sub.wallet, { chatId, sub });
    }
    return (this.index = index);
  }

  watchersOf(wallet: string) {
    return this.lookups().watchers.get(wallet) ?? [];
  }

  alertsOn(token: string) {
    return this.lookups().alerts.get(token) ?? [];
  }

  orderSubsOf(wallet: string) {
    return this.lookups().orders.get(wallet) ?? [];
  }

  orderWallets(): string[] {
    return [...this.lookups().orders.keys()];
  }
}
