import { pino } from 'pino';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

/** ZRO, the native coin on Zero, in USD, for display only. Nothing on-chain depends on it, so a stale or missing price can't cost anyone money. */
let current: { usd: number | null; at: number } = { usd: null, at: 0 };

const SOURCES: Array<{ url: string; read: (body: any) => number }> = [
  { url: 'https://api.binance.com/api/v3/ticker/price?symbol=ZROUSDT', read: (b) => Number(b.price) },
  { url: 'https://api.coingecko.com/api/v3/simple/price?ids=layerzero&vs_currencies=usd', read: (b) => Number(b.layerzero?.usd) },
];

async function refresh(): Promise<void> {
  for (const source of SOURCES) {
    try {
      const res = await fetch(source.url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const usd = source.read(await res.json());
      if (usd > 0) {
        current = { usd, at: Date.now() };
        return;
      }
    } catch {
      // try the next source
    }
  }
  log.warn('no ZRO price source answered, the UI falls back to ZRO');
}

export function startPriceFeed(): void {
  void refresh();
  setInterval(() => void refresh(), 60_000);
}

export const zroPrice = () => current;
