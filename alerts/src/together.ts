// Several watched wallets buying the same token close together read as one story, so they go out as one message.

export type Buy = { wallet: string; ts: number };

/** The wallets (each once, oldest first) that bought within `windowS` seconds of this buy, this one included. */
export function noteBuy(recent: Buy[], buy: Buy, windowS = 60): { recent: Buy[]; wallets: string[] } {
  const kept = [...recent.filter((b) => Math.abs(buy.ts - b.ts) <= windowS), buy].sort((a, b) => a.ts - b.ts);
  return { recent: kept, wallets: [...new Set(kept.map((b) => b.wallet))] };
}

/** Recent buys per chat and token. */
export class Together {
  private buys = new Map<string, Buy[]>();
  constructor(private windowS = 60) {}

  /** Records a buy and returns every wallet in its group. Two or more means "together". */
  note(chatId: number, token: string, buy: Buy): string[] {
    const key = `${chatId}:${token}`;
    const { recent, wallets } = noteBuy(this.buys.get(key) ?? [], buy, this.windowS);
    this.buys.set(key, recent);
    return wallets;
  }

  /** Drops groups with nothing inside the window, so the map doesn't grow forever. */
  prune(nowS: number): void {
    for (const [key, list] of this.buys) if (list.every((b) => nowS - b.ts > this.windowS)) this.buys.delete(key);
  }

  get size(): number {
    return this.buys.size;
  }
}
