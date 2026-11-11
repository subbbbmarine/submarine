// Telegram alerts for the terminal: trades by wallets a chat watches, market caps crossing a level, limit orders filling.
// Reads the indexer's live stream and REST API, and talks to Telegram by long polling, so it needs no public address.
// Nothing here can move funds: it only reads and sends messages.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCommand } from './commands.js';
import { Pacer } from './pacer.js';
import { asTrade, Engine } from './engine.js';
import { Indexer } from './indexer.js';
import { log, sleep, why } from './log.js';
import { Outbox } from './outbox.js';
import { backoffMs, followStream, type SseEvent } from './sse.js';
import { dataPath, Store } from './store.js';
import { Telegram, TelegramError, type Update } from './telegram.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim();
const API_URL = (process.env.API_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const SITE_URL = (process.env.SITE_URL || '').trim().replace(/\/+$/, '');
const here = dirname(fileURLToPath(import.meta.url));
const DATA = dataPath(process.env.ALERTS_DATA, resolve(here, '../data'));

/** Long polling holds each getUpdates this long when nothing happens. */
const POLL_S = 50;
/** Events waiting to be handled before new ones are dropped, so a stuck indexer lookup can't eat all memory. */
const MAX_BACKLOG = 10_000;

if (!TOKEN) {
  log.error('TELEGRAM_BOT_TOKEN is not set, so there is no bot to run. Create one with @BotFather and set the token (see alerts/README.md). Exiting.');
  process.exit(0); // not a crash: a deploy without a token shouldn't restart this over and over
}

const tg = new Telegram(TOKEN, (process.env.TELEGRAM_API_URL || 'https://api.telegram.org').replace(/\/+$/, ''));
const store = new Store(DATA);
const indexer = new Indexer(API_URL);
const stop = new AbortController();

function shutdown(code: number): void {
  if (stop.signal.aborted) return;
  stop.abort();
  store.flush();
  log.info('alerts stopped');
  setTimeout(() => process.exit(code), 200).unref();
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const pacer = new Pacer();
const outbox: Outbox = new Outbox(async (chatId, text) => {
  try {
    await tg.sendMessage(chatId, text);
  } catch (err) {
    if (!(err instanceof TelegramError)) throw err; // the network: worth another try
    const to = err.parameters.migrate_to_chat_id;
    if (to) {
      log.info({ from: chatId, to }, 'group became a supergroup, moving its subscriptions');
      store.moveChat(chatId, to);
      outbox.push(to, { text });
      return;
    }
    if (err.code === 403 || (err.code === 400 && /chat not found/i.test(err.description))) {
      log.info({ chat: chatId, why: err.description }, 'chat is gone or blocked the bot, forgetting it');
      store.dropChat(chatId);
      outbox.drop(chatId);
      return;
    }
    if (err.code === 429 || err.code >= 500) throw err;
    log.warn({ chat: chatId, err: err.message }, 'message not sent');
  }
});

const engine = new Engine({ store, indexer, siteUrl: SITE_URL, push: (chatId, msg) => outbox.push(chatId, msg) });

// Trades are handled one at a time in arrival order, so a market cap is never compared against an older one.
let work: Promise<void> = Promise.resolve();
let backlog = 0;
let warnedBehind = false;
function onEvent(e: SseEvent): void {
  if (e.event !== 'trade' && e.event !== 'order') return;
  let data: unknown;
  try {
    data = JSON.parse(e.data);
  } catch {
    return;
  }
  if (e.event === 'order') {
    const id = Number((data as { id?: unknown } | null)?.id);
    if (Number.isInteger(id)) engine.onOrderEvent(id);
    return;
  }
  const trade = asTrade(data);
  if (!trade) return;
  if (backlog >= MAX_BACKLOG) {
    if (!warnedBehind) log.warn({ backlog }, 'falling behind the stream, dropping trades until it catches up');
    warnedBehind = true;
    return;
  }
  warnedBehind = false;
  backlog++;
  work = work
    .then(() => engine.onTrade(trade))
    .catch((err) => log.warn({ tx: trade.tx, err: why(err) }, 'trade handling failed'))
    .finally(() => backlog--);
}

async function refreshPrice(): Promise<void> {
  try {
    const usd = await indexer.zroUsd();
    if (usd) engine.zroUsd = usd;
    else log.warn('the indexer has no ZRO price right now, keeping the last one');
  } catch (err) {
    log.warn({ err: why(err) }, 'ZRO price lookup failed');
  }
}

async function handle(u: Update, username: string): Promise<void> {
  const m = u.message;
  if (!m?.text || m.from?.is_bot) return;
  const cmd = parseCommand(m.text, username);
  if (!cmd) return;
  // Commands come in at most so fast per chat; past that they're dropped, with one note to say so.
  const pace = pacer.allow(m.chat.id, Date.now());
  if (pace === 'drop') return;
  if (pace === 'warn') {
    outbox.push(m.chat.id, { text: 'Slow down a little: up to 20 commands a minute.' });
    return;
  }
  // In a group, a command this bot doesn't know is probably for another bot.
  if (cmd.kind === 'unknown' && m.chat.type !== 'private') return;
  try {
    const reply = await engine.command(m.chat.id, cmd);
    if (reply) outbox.push(m.chat.id, { text: reply });
  } catch (err) {
    log.warn({ chat: m.chat.id, cmd: cmd.kind, err: why(err) }, 'command failed');
    outbox.push(m.chat.id, { text: 'Something went wrong on my side. Try again in a minute.' });
  }
}

function fatalToken(): void {
  log.error('Telegram rejected TELEGRAM_BOT_TOKEN (401 Unauthorized). Copy the token from @BotFather again. Exiting.');
  shutdown(0);
}

async function poll(username: string): Promise<void> {
  let failures = 0;
  while (!stop.signal.aborted) {
    let updates: Update[];
    try {
      updates = await tg.getUpdates(store.data.offset, POLL_S, stop.signal);
      failures = 0;
    } catch (err) {
      if (stop.signal.aborted) return;
      if (err instanceof TelegramError && err.code === 401) return fatalToken();
      if (err instanceof TelegramError && err.code === 409) {
        log.warn('Telegram says something else is reading this bot\'s updates: another copy of this service, or a webhook (remove it with deleteWebhook). Only one can run.');
      } else log.warn({ err: why(err) }, 'getUpdates failed');
      await sleep(backoffMs(failures++), stop.signal);
      continue;
    }
    for (const u of updates) {
      store.setOffset(u.update_id + 1);
      await handle(u, username);
    }
  }
}

async function main(): Promise<void> {
  let me: { username: string } | null = null;
  for (let attempt = 0; !me; attempt++) {
    try {
      me = await tg.getMe();
    } catch (err) {
      if (err instanceof TelegramError && err.code === 401) return fatalToken();
      log.warn({ err: why(err) }, 'cannot reach Telegram yet');
      await sleep(backoffMs(attempt), stop.signal);
      if (stop.signal.aborted) return;
    }
  }
  log.info({ bot: me.username, api: API_URL, site: SITE_URL || null, data: DATA }, 'alerts up');
  if (!SITE_URL) log.warn('SITE_URL is not set, so messages go out without links to the terminal');

  tg.setMyCommands([
    { command: 'watch', description: 'Alert on every trade by a wallet' },
    { command: 'watching', description: 'Wallets you watch' },
    { command: 'unwatch', description: 'Stop watching a wallet' },
    { command: 'alert', description: 'Alert once when a market cap crosses a level' },
    { command: 'alerts', description: 'Your market cap alerts' },
    { command: 'unalert', description: 'Remove a market cap alert' },
    { command: 'orders', description: "Alert when a wallet's limit orders fill" },
    { command: 'unorders', description: "Stop a wallet's order alerts" },
    { command: 'start', description: 'What this bot does' },
  ]).catch((err) => log.warn({ err: why(err) }, 'could not set the command menu'));

  await refreshPrice();
  const timers = [
    setInterval(() => void refreshPrice(), 60_000),
    setInterval(() => engine.tidy(), 60_000),
    setInterval(() => void engine.refreshAll(), 5 * 60_000),
  ];
  stop.signal.addEventListener('abort', () => timers.forEach(clearInterval), { once: true });

  void outbox.run(stop.signal);
  void followStream(`${API_URL}/api/v1/stream`, {
    signal: stop.signal,
    onEvent,
    // Whatever changed while the stream was down, orders included, is caught up on by reading them again.
    onOpen: () => void engine.refreshAll(),
  });
  await poll(me.username);
}

main().catch((err) => {
  log.error({ err: why(err) }, 'alerts crashed');
  shutdown(1);
});
