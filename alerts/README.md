# Telegram alerts

A small Telegram bot for the terminal. It reads the indexer's live stream and sends a chat a message when:

- a wallet it watches trades (`/watch`), with several watched wallets buying the same token within a minute sent as one "together" message;
- a token's market cap crosses a level in USD (`/alert`), once;
- a wallet's limit orders fill or partly fill (`/orders`).

It only reads and sends messages. It holds no keys and can't move funds.

## Create the bot

1. In Telegram, open a chat with **@BotFather** and send `/newbot`.
2. Give it a display name (for example `Submarine Alerts`) and a username ending in `bot` (for example `submarine_alerts_bot`).
3. BotFather replies with a token like `123456789:AA...`. That is `TELEGRAM_BOT_TOKEN`. Keep it secret: anyone with it controls the bot.
4. Optional: to use the bot in groups, send BotFather `/setprivacy`, pick the bot, and leave privacy **enabled**. Commands addressed to the bot (`/watch@submarine_alerts_bot ...`) still reach it.

The bot sets its own command menu when it starts. It uses long polling, so it needs no public address or webhook. If the bot had a webhook set before, remove it (open `https://api.telegram.org/bot<token>/deleteWebhook` once), or Telegram refuses polling with a 409 and the log says so.

## Settings

| Variable | Default | What it is |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | none | The token from BotFather. Without it the service logs a message and exits with code 0, so a deploy without a token doesn't restart over and over. |
| `API_URL` | `http://127.0.0.1:3001` | The indexer. The bot uses `/api/v1/stream`, `/api/v1/tokens/:address`, `/api/v1/orders` and `/api/v1/zro-price`. |
| `SITE_URL` | none | The public terminal, for links like `https://example.com/tokens/0x...`. Without it messages go out without links. |
| `ALERTS_DATA` | `alerts/data` | Where subscriptions are kept. A path ending in `.json` is the file itself; anything else is a folder that gets `subscriptions.json`. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. Logs are one JSON object per line. |
| `TELEGRAM_API_URL` | `https://api.telegram.org` | Only for a self-hosted Bot API server or for testing. |

## Run

It uses TypeScript and `tsx` from the repository's root `node_modules`; there is nothing extra to install.

Windows PowerShell:

```powershell
Set-Location alerts
$env:TELEGRAM_BOT_TOKEN = "123456789:AA..."; $env:SITE_URL = "https://your-terminal.example"; npm.cmd run dev
```

Linux:

```sh
cd alerts
TELEGRAM_BOT_TOKEN=123456789:AA... SITE_URL=https://your-terminal.example npm run dev
```

For production, build once and run the JavaScript:

```sh
npm run build
npm start
```

Tests (pure logic, the outbox, the store, the SSE reader against a local HTTP server, and the alert engine with a fake indexer):

```sh
npm test
```

Only one copy may run per bot token: two copies polling the same token get 409 errors from Telegram.

## Commands

```
/start                                   what the bot does
/watch <wallet> [name]                   a message on every trade by that wallet
/unwatch <wallet>
/watching
/alert <token> above|below <cap>         cap in USD: 50000, 50k, 1.2m, 2b
/alerts
/unalert <n>                             n from /alerts
/orders <wallet>                         a message when its limit orders fill or partly fill
/orders                                  wallets whose orders you follow
/unorders <wallet>
```

## How it behaves

- **Trades.** Every trade by a watched wallet: "Alice bought 0.5 ZRO of PEPE at $12.3K cap" and a link to the token. The cap is the trade's price times the token's supply, in USD at the indexer's ZRO price. When a second watched wallet buys the same token within 60 seconds, the chat gets "2 wallets you watch bought PEPE in the last minute: Alice, Bob" instead of another single message. Trades more than 10 minutes old (the indexer catching up after a pause) are not announced.
- **Market cap alerts.** Checked on every trade of that token, with the ZRO price refreshed every minute. Each fires once, when the cap moves across the level, and is then removed. An alert that would fire at once (the cap is already past the level) is refused with the current cap.
- **Orders.** On each `order` event the bot reads the owner's orders again and compares each one with the last status it saw. The first look after `/orders` only remembers, so old fills aren't announced. All followed wallets are also read again every 5 minutes and after the stream reconnects, to catch anything missed.
- **Sending.** At most one message per chat per second. Messages that pile up meanwhile go out joined into one. When Telegram answers 429 the bot waits the `retry_after` it gives. A chat that blocks the bot is forgotten; a group that becomes a supergroup keeps its subscriptions.
- **Stream.** The SSE stream is parsed by hand from `fetch`. If it drops, or goes silent for 45 seconds (the indexer pings every 15), it reconnects after 1 s, doubling up to 30 s.
- **Storage.** One JSON file, written to a temporary file and renamed over the old one. A file that doesn't parse is moved aside as `subscriptions.json.broken-<time>` and the bot starts empty rather than overwriting it.

Limits per chat: 100 watched wallets, 50 market cap alerts, 20 wallets' orders.
