// How fast one chat may send commands. Past the limit its commands are dropped, and it's told once until it slows down.

export const COMMANDS_PER_MINUTE = 20;
const WINDOW_MS = 60_000;

export class Pacer {
  private times = new Map<number, number[]>();
  private warned = new Set<number>();

  allow(chatId: number, now: number): 'ok' | 'warn' | 'drop' {
    const recent = (this.times.get(chatId) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= COMMANDS_PER_MINUTE) {
      this.times.set(chatId, recent);
      if (this.warned.has(chatId)) return 'drop';
      this.warned.add(chatId);
      return 'warn';
    }
    recent.push(now);
    this.times.set(chatId, recent);
    this.warned.delete(chatId);
    // Chats that went quiet are forgotten, so the map doesn't grow with every chat that ever wrote.
    if (this.times.size > 10_000) for (const [id, ts] of this.times) if (!ts.length || now - ts[ts.length - 1]! >= WINDOW_MS) this.times.delete(id);
    return 'ok';
  }
}
