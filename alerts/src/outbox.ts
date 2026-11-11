// Telegram allows a chat about one message a second. Everything for a chat waits here, and whatever piles up while it waits
// goes out together as one message.
import { log, why } from './log.js';

/** A message to a chat. A newer message with the same key replaces one still waiting, so a growing story is sent once. */
export type Message = { text: string; key?: string; tries?: number };

/** How many messages one chat may have waiting. */
export const MAX_WAITING = 200;

/** Telegram's limit is 4096 characters. */
export const MAX_TEXT = 4000;

export function enqueue(queue: Message[], msg: Message): Message[] {
  if (msg.key) {
    const i = queue.findIndex((m) => m.key === msg.key);
    if (i >= 0) return queue.map((m, j) => (j === i ? msg : m));
  }
  return [...queue, msg];
}

/** As many waiting messages as fit in one, joined by blank lines. The first always goes, cut down if it's too long. */
export function takeBatch(queue: Message[], max = MAX_TEXT): { text: string; tries: number; rest: Message[] } {
  if (!queue.length) return { text: '', tries: 0, rest: [] };
  let text = queue[0]!.text.slice(0, max);
  let tries = queue[0]!.tries ?? 0;
  let n = 1;
  while (n < queue.length && text.length + 2 + queue[n]!.text.length <= max) {
    text += `\n\n${queue[n]!.text}`;
    tries = Math.max(tries, queue[n]!.tries ?? 0);
    n++;
  }
  return { text, tries, rest: queue.slice(n) };
}

/** Sends one message. Throws only when trying again later could help, like a network error. */
export type Send = (chatId: number, text: string) => Promise<void>;

export class Outbox {
  private queues = new Map<number, Message[]>();
  private nextAt = new Map<number, number>();
  private wake: (() => void) | null = null;

  constructor(
    private send: Send,
    private gapMs = 1000,
    private maxTries = 3,
  ) {}

  push(chatId: number, msg: Message): void {
    // A chat that can't keep up keeps its newest messages: the oldest go first once it has too many waiting.
    const q = enqueue(this.queues.get(chatId) ?? [], msg);
    this.queues.set(chatId, q.length > MAX_WAITING ? q.slice(-MAX_WAITING) : q);
    this.wake?.();
  }

  /** Forgets everything waiting for a chat, for one that blocked the bot. */
  drop(chatId: number): void {
    this.queues.delete(chatId);
  }

  get waiting(): number {
    let n = 0;
    for (const q of this.queues.values()) n += q.length;
    return n;
  }

  /** Sends one chat's batch at a time, so the bot as a whole stays well inside Telegram's limits too. */
  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const now = Date.now();
      let ready: number | null = null;
      let soonest = Infinity;
      for (const [chat, q] of this.queues) {
        if (!q.length) {
          this.queues.delete(chat);
          continue;
        }
        const at = this.nextAt.get(chat) ?? 0;
        if (at <= now) {
          ready = chat;
          break;
        }
        soonest = Math.min(soonest, at);
      }
      if (ready !== null) {
        const { text, tries, rest } = takeBatch(this.queues.get(ready)!);
        if (rest.length) this.queues.set(ready, rest);
        else this.queues.delete(ready);
        this.nextAt.set(ready, Date.now() + this.gapMs);
        try {
          await this.send(ready, text);
        } catch (err) {
          if (tries + 1 < this.maxTries) this.queues.set(ready, [{ text, tries: tries + 1 }, ...(this.queues.get(ready) ?? [])]);
          else log.warn({ chat: ready, err: why(err) }, 'message dropped after retries');
        }
        // Counted from when the send finished: a send that waited out a 429 mustn't let the next one go straight after it.
        this.nextAt.set(ready, Date.now() + this.gapMs);
        // Round robin: this chat goes to the back, so a busy chat can't hold the others up.
        const q = this.queues.get(ready);
        if (q) {
          this.queues.delete(ready);
          this.queues.set(ready, q);
        }
        continue;
      }
      for (const [chat, at] of this.nextAt) if (at <= now) this.nextAt.delete(chat);
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(t);
          signal.removeEventListener('abort', done);
          this.wake = null;
          resolve();
        };
        const t = soonest < Infinity ? setTimeout(done, soonest - now) : undefined;
        this.wake = done;
        signal.addEventListener('abort', done, { once: true });
      });
    }
  }
}
