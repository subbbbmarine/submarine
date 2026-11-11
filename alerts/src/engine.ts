// What the bot does: answers commands and turns the indexer's events into messages. Talks to the indexer through IndexerApi
// and to chats through `push`, so tests run it with fakes.
import type { Command } from './commands.js';
import { formatZro, formatUsd, shortAddress } from './format.js';
import type { IndexerApi, TokenInfo } from './indexer.js';
import { log, why } from './log.js';
import type { Message } from './outbox.js';
import { alreadyPast, crossed, orderNews, type OrderNews, type OrderRow } from './rules.js';
import { LIMITS, type OrderSub, type Store } from './store.js';
import { Together } from './together.js';

export type Trade = { tx: string; idx: number; block: number; ts: number; token: string; trader: string; isBuy: boolean; zro: number; amount: number; price: number; venue: string };

/** A trade older than this is the indexer catching up after a pause. Announcing it now would be news from the past. */
export const MAX_TRADE_AGE_S = 600;
/** Order events come in bursts (placed, filled, closed in one block), so they're gathered this long before looking. */
const ORDER_DEBOUNCE_MS = 1500;

export const HELP = [
  'I send alerts from Submarine.',
  '',
  '/watch <wallet> [name] - a message on every trade that wallet makes',
  '/unwatch <wallet> - stop watching a wallet',
  '/watching - the wallets you watch',
  '',
  '/alert <token> above|below <market cap> - one message when a token crosses a market cap in USD, for example /alert 0x... above 50k',
  '/alerts - your market cap alerts',
  '/unalert <n> - remove alert number n',
  '',
  '/orders <wallet> - a message when that wallet\'s limit orders fill or partly fill',
  '/orders - the wallets whose orders you follow',
  '/unorders <wallet> - stop following a wallet\'s orders',
].join('\n');

/** The indexer's trade event, checked, or null when it isn't one. */
export function asTrade(x: unknown): Trade | null {
  if (!x || typeof x !== 'object') return null;
  const t = x as Record<string, unknown>;
  if (typeof t.token !== 'string' || typeof t.trader !== 'string' || typeof t.isBuy !== 'boolean') return null;
  const trade: Trade = {
    tx: String(t.tx ?? ''),
    idx: Number(t.idx ?? 0),
    block: Number(t.block ?? 0),
    ts: Number(t.ts),
    token: t.token.toLowerCase(),
    trader: t.trader.toLowerCase(),
    isBuy: t.isBuy,
    zro: Number(t.zro),
    amount: Number(t.amount),
    price: Number(t.price),
    venue: String(t.venue ?? ''),
  };
  return Number.isFinite(trade.ts) && Number.isFinite(trade.zro) && Number.isFinite(trade.price) ? trade : null;
}

const KIND_LABEL: Record<string, string> = { stop: 'stop', trailing: 'trailing stop', on_graduation: 'on-graduation', on_dev_sell: 'on-dev-sell', dca: 'DCA' };

export function orderText({ order: o, what }: OrderNews, wallet: string): string {
  const kind = KIND_LABEL[o.kind ?? 'limit'];
  const head = `${o.is_buy ? 'Buy' : 'Sell'}${kind ? ` ${kind}` : ''} order #${o.id} on ${o.symbol || shortAddress(o.token)} (${formatZro(Number(o.size_zro) || 0)} ZRO) from ${wallet}`;
  if (what === 'filled') return `${head} filled.`;
  const pct = Math.min(99, Math.round((Number(o.filled_share) || 0) * 100));
  const closed = o.status !== 'open' && o.status !== 'partial';
  return `${head} partly filled${closed ? ' and then closed' : ''}, ${pct}% done.`;
}

export type EngineDeps = {
  store: Store;
  indexer: IndexerApi;
  /** The public site, without a trailing slash. Empty means messages go out without links. */
  siteUrl: string;
  push: (chatId: number, msg: Message) => void;
  now?: () => number;
};

export class Engine {
  /** Refreshed from the indexer every minute by the caller. */
  zroUsd: number | null = null;
  private together = new Together(60);
  private seenTrades = new Set<string>();
  private orderOwner = new Map<number, string>();
  private pendingOwners = new Set<string>();
  private pendingIds = new Set<number>();
  private orderTimer: NodeJS.Timeout | null = null;
  private orderWork: Promise<void> = Promise.resolve();

  constructor(private d: EngineDeps) {}

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  private link(token: string): string {
    return this.d.siteUrl ? `\n${this.d.siteUrl}/tokens/${token}` : '';
  }

  /** What a chat calls a wallet: its name from /watch, or its short address. */
  private label(chatId: number, wallet: string): string {
    return this.d.store.peek(chatId)?.watches.find((w) => w.wallet === wallet)?.name || shortAddress(wallet);
  }

  async command(chatId: number, cmd: Command): Promise<string | null> {
    const { store } = this.d;
    // A new chat starting a subscription is turned away once the bot is full. Chats it already serves carry on as usual.
    if ((cmd.kind === 'watch' || cmd.kind === 'alert' || cmd.kind === 'orders') && !store.peek(chatId) && store.size() >= LIMITS.chats) {
      return "I can't take on more chats right now. Try again later.";
    }
    switch (cmd.kind) {
      case 'help':
        return HELP;
      case 'error':
        return cmd.message;
      case 'unknown':
        return `I don't know /${cmd.name}. Send /start to see what I can do.`;
      case 'watch': {
        const chat = store.chat(chatId);
        const had = chat.watches.find((w) => w.wallet === cmd.wallet);
        if (had) {
          if (!cmd.name || cmd.name === had.name) return `You already watch ${had.name || shortAddress(had.wallet)}.`;
          had.name = cmd.name;
          store.changed();
          return `Renamed ${shortAddress(had.wallet)} to ${cmd.name}.`;
        }
        if (chat.watches.length >= LIMITS.watches) return `You already watch ${LIMITS.watches} wallets, which is the most I keep. Remove one with /unwatch first.`;
        chat.watches.push({ wallet: cmd.wallet, name: cmd.name });
        store.changed();
        return `Watching ${cmd.name || shortAddress(cmd.wallet)}. I'll message you on every trade it makes.`;
      }
      case 'unwatch': {
        const chat = store.peek(chatId);
        const had = chat?.watches.find((w) => w.wallet === cmd.wallet);
        if (!chat || !had) return 'You are not watching that wallet.';
        chat.watches = chat.watches.filter((w) => w !== had);
        store.changed();
        return `Stopped watching ${had.name || shortAddress(had.wallet)}.`;
      }
      case 'watching': {
        const list = store.peek(chatId)?.watches ?? [];
        if (!list.length) return 'You are not watching any wallets. Add one with /watch <wallet> [name].';
        return [`You watch ${list.length} wallet${list.length === 1 ? '' : 's'}:`, ...list.map((w, i) => `${i + 1}. ${w.name ? `${w.name}: ` : ''}${w.wallet}`)].join('\n');
      }
      case 'alert': {
        const chat = store.chat(chatId);
        if (chat.alerts.length >= LIMITS.alerts) return `You have ${LIMITS.alerts} alerts, which is the most I keep. Remove one with /unalert first.`;
        const usd = this.zroUsd;
        if (!usd) return "I don't have the ZRO price right now, so I can't check a market cap in dollars. Try again in a minute.";
        let info: TokenInfo | null;
        try {
          info = await this.d.indexer.tokenNow(cmd.token);
        } catch (err) {
          log.warn({ token: cmd.token, err: why(err) }, 'token lookup failed');
          return "I couldn't reach the terminal's index just now. Try again in a minute.";
        }
        if (!info) return "The terminal doesn't know a token at that address.";
        const symbol = info.symbol || shortAddress(cmd.token);
        const capUsd = Number(info.market_cap) * usd;
        if (!Number.isFinite(capUsd)) return `I couldn't work out ${symbol}'s market cap. Try again in a minute.`;
        if (alreadyPast(cmd.direction, cmd.levelUsd, capUsd)) {
          return `${symbol}'s market cap is already ${cmd.direction} ${formatUsd(cmd.levelUsd)} (it's ${formatUsd(capUsd)} now), so this alert would go off at once. Pick a level it hasn't reached.`;
        }
        chat.alerts.push({ token: cmd.token, symbol, direction: cmd.direction, levelUsd: cmd.levelUsd, lastCapUsd: capUsd, createdAt: Math.floor(this.now() / 1000) });
        store.changed();
        return `OK. I'll tell you once when ${symbol}'s market cap goes ${cmd.direction} ${formatUsd(cmd.levelUsd)}. It's ${formatUsd(capUsd)} now.`;
      }
      case 'alerts': {
        const list = store.peek(chatId)?.alerts ?? [];
        if (!list.length) return 'You have no market cap alerts. Add one with /alert <token> above|below <market cap>.';
        return [
          `Your alerts:`,
          ...list.map((a, i) => `${i + 1}. ${a.symbol} ${a.direction} ${formatUsd(a.levelUsd)}${a.lastCapUsd !== null ? `, last seen at ${formatUsd(a.lastCapUsd)}` : ''} (${a.token})`),
          '',
          'Remove one with /unalert <n>.',
        ].join('\n');
      }
      case 'unalert': {
        const chat = store.peek(chatId);
        const a = chat?.alerts[cmd.index - 1];
        if (!chat || !a) return `You have no alert number ${cmd.index}. See /alerts.`;
        chat.alerts.splice(cmd.index - 1, 1);
        store.changed();
        return `Removed: ${a.symbol} ${a.direction} ${formatUsd(a.levelUsd)}.`;
      }
      case 'orders': {
        if (!cmd.wallet) {
          const list = store.peek(chatId)?.orders ?? [];
          if (!list.length) return 'You are not following any wallet\'s orders. Add one with /orders <wallet>.';
          return [`You get order alerts for:`, ...list.map((o, i) => `${i + 1}. ${this.label(chatId, o.wallet)}: ${o.wallet}`)].join('\n');
        }
        const wallet = cmd.wallet;
        const chat = store.chat(chatId);
        if (chat.orders.some((o) => o.wallet === wallet)) return 'You already get order alerts for that wallet.';
        if (chat.orders.length >= LIMITS.orders) return `You follow the orders of ${LIMITS.orders} wallets, which is the most I keep. Remove one with /unorders first.`;
        const sub: OrderSub = { wallet, seen: null };
        let rows: OrderRow[] | null = null;
        try {
          rows = await this.d.indexer.orders(wallet);
          sub.seen = orderNews(null, rows).seen;
          for (const r of rows) this.orderOwner.set(Number(r.id), wallet);
        } catch (err) {
          log.warn({ wallet, err: why(err) }, 'orders lookup failed');
        }
        chat.orders.push(sub);
        store.changed();
        const name = this.label(chatId, wallet);
        if (!rows) return `OK. I'll tell you when an order from ${name} fills or partly fills. I couldn't read its orders just now, so I'll start from my next look.`;
        const open = rows.filter((r) => r.status === 'open' || r.status === 'partial').length;
        return `OK. I'll tell you when an order from ${name} fills or partly fills. It has ${open} open order${open === 1 ? '' : 's'} now.`;
      }
      case 'unorders': {
        const chat = store.peek(chatId);
        if (!chat?.orders.some((o) => o.wallet === cmd.wallet)) return 'You are not following that wallet\'s orders.';
        chat.orders = chat.orders.filter((o) => o.wallet !== cmd.wallet);
        store.changed();
        return `Stopped order alerts for ${this.label(chatId, cmd.wallet)}.`;
      }
    }
  }

  async onTrade(t: Trade): Promise<void> {
    const { store, push } = this.d;
    if (t.tx) {
      const key = `${t.tx}:${t.idx}`;
      if (this.seenTrades.has(key)) return;
      this.seenTrades.add(key);
      if (this.seenTrades.size > 5000) this.seenTrades.delete(this.seenTrades.values().next().value!);
    }
    if (this.now() / 1000 - t.ts > MAX_TRADE_AGE_S) return;
    const watchers = store.watchersOf(t.trader);
    const alerts = store.alertsOn(t.token);
    if (!watchers.length && !alerts.length) return;

    let info: TokenInfo | null = null;
    try {
      info = await this.d.indexer.token(t.token);
    } catch (err) {
      log.warn({ token: t.token, err: why(err) }, 'token lookup failed');
    }
    const symbol = info?.symbol || shortAddress(t.token);
    const supply = Number(info?.total_supply) || 0;
    // The same market cap the indexer reports: this trade's price times the supply.
    const capZro = supply > 0 && t.price > 0 ? t.price * supply : null;
    const capUsd = capZro !== null && this.zroUsd ? capZro * this.zroUsd : null;
    const cap = capUsd !== null ? `${formatUsd(capUsd)} cap` : capZro !== null ? `${formatZro(capZro)} ZRO cap` : null;
    const link = this.link(t.token);

    for (const { chatId, watch } of watchers) {
      if (t.isBuy) {
        const wallets = this.together.note(chatId, t.token, { wallet: t.trader, ts: t.ts });
        if (wallets.length >= 2) {
          // Up to ten by name: a chat can watch a hundred wallets, and a message has a length limit.
          const shown = wallets.slice(0, 10).map((w) => this.label(chatId, w));
          const names = wallets.length > 10 ? `${shown.join(', ')} and ${wallets.length - 10} more` : shown.join(', ');
          push(chatId, { key: `together:${t.token}`, text: `${wallets.length} wallets you watch bought ${symbol} in the last minute: ${names}.${cap ? ` Now at ${cap}.` : ''}${link}` });
          continue;
        }
      }
      const name = watch.name || shortAddress(watch.wallet);
      push(chatId, { text: `${name} ${t.isBuy ? 'bought' : 'sold'} ${formatZro(t.zro)} ZRO of ${symbol}${cap ? ` at ${cap}` : ''}${link}` });
    }

    if (capUsd === null || !alerts.length) return;
    let fired = false;
    for (const { chatId, alert } of alerts) {
      if (crossed(alert.direction, alert.levelUsd, alert.lastCapUsd, capUsd)) {
        push(chatId, { text: `${alert.symbol} market cap went ${alert.direction} ${formatUsd(alert.levelUsd)}. It's ${formatUsd(capUsd)} now.${link}` });
        const chat = store.peek(chatId);
        if (chat) chat.alerts = chat.alerts.filter((a) => a !== alert);
        fired = true;
      } else alert.lastCapUsd = capUsd;
    }
    if (fired) store.changed();
    else store.save();
  }

  /** An order changed somewhere. Its owner's orders are read again shortly, together with any others that changed meanwhile. */
  onOrderEvent(id: number): void {
    if (!this.d.store.orderWallets().length) return;
    const owner = this.orderOwner.get(id);
    if (owner === undefined) this.pendingIds.add(id);
    else if (this.d.store.orderSubsOf(owner).length) this.pendingOwners.add(owner);
    else return;
    this.orderTimer ??= setTimeout(() => void this.flushOrders(), ORDER_DEBOUNCE_MS);
  }

  /** Reads the orders gathered by onOrderEvent. One look at a time. */
  flushOrders(): Promise<void> {
    if (this.orderTimer) clearTimeout(this.orderTimer);
    this.orderTimer = null;
    const owners = new Set(this.pendingOwners);
    const ids = [...this.pendingIds];
    this.pendingOwners.clear();
    this.pendingIds.clear();
    this.orderWork = this.orderWork.then(async () => {
      if (ids.length) {
        // An order this hasn't seen: the latest orders of everyone say whose it is, in one request.
        try {
          for (const r of await this.d.indexer.orders()) if (r.owner) this.orderOwner.set(Number(r.id), String(r.owner).toLowerCase());
        } catch (err) {
          log.warn({ err: why(err) }, 'latest orders lookup failed');
        }
        for (const id of ids) {
          const owner = this.orderOwner.get(id);
          if (owner === undefined) {
            for (const w of this.d.store.orderWallets()) owners.add(w); // still unknown: look at everyone followed
            break;
          }
          if (this.d.store.orderSubsOf(owner).length) owners.add(owner);
        }
      }
      if (this.orderOwner.size > 50_000) this.orderOwner.clear();
      await this.refreshOrders([...owners]);
    });
    return this.orderWork;
  }

  /** Every followed wallet, for after the stream reconnects (events may have been missed) and as a slow safety net. */
  refreshAll(): Promise<void> {
    this.orderWork = this.orderWork.then(() => this.refreshOrders(this.d.store.orderWallets()));
    return this.orderWork;
  }

  private async refreshOrders(owners: string[]): Promise<void> {
    const { store, push } = this.d;
    for (const owner of owners) {
      const subs = store.orderSubsOf(owner);
      if (!subs.length) continue;
      let rows: OrderRow[];
      try {
        rows = await this.d.indexer.orders(owner);
      } catch (err) {
        log.warn({ owner, err: why(err) }, 'orders lookup failed');
        continue;
      }
      for (const r of rows) this.orderOwner.set(Number(r.id), owner);
      for (const { chatId, sub } of subs) {
        const { news, seen } = orderNews(sub.seen, rows);
        sub.seen = seen;
        for (const n of news) push(chatId, { text: `${orderText(n, this.label(chatId, owner))}${this.link(n.order.token)}` });
      }
      store.save();
    }
  }

  /** Housekeeping, once a minute. */
  tidy(): void {
    this.together.prune(this.now() / 1000);
  }
}
