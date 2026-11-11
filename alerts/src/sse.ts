// The indexer's live feed, read straight off fetch: Server-Sent Events parsed by hand, one read in flight at a time, and the
// connection opened again with growing pauses whenever it drops.
import { log, sleep, why } from './log.js';

export type SseEvent = { event: string; data: string; id?: string };

/** Turns text chunks, split anywhere, into whole events, following the EventSource rules for lines and fields. */
export class SseParser {
  private partial = '';
  private skipLF = false;
  private event = '';
  private data: string[] = [];
  lastId: string | undefined;
  retry: number | undefined;

  push(chunk: string): SseEvent[] {
    const out: SseEvent[] = [];
    let s = chunk;
    // A CR ended the last chunk. If this one starts with LF, the two are one line break.
    if (this.skipLF) {
      this.skipLF = false;
      if (s.startsWith('\n')) s = s.slice(1);
    }
    let from = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c !== 10 && c !== 13) continue;
      const line = this.partial + s.slice(from, i);
      this.partial = '';
      if (c === 13) {
        if (i + 1 < s.length) {
          if (s.charCodeAt(i + 1) === 10) i++;
        } else this.skipLF = true;
      }
      from = i + 1;
      const e = this.line(line);
      if (e) out.push(e);
    }
    this.partial += s.slice(from);
    return out;
  }

  private line(line: string): SseEvent | null {
    if (line === '') {
      const event = this.event || 'message';
      const data = this.data;
      this.event = '';
      this.data = [];
      if (!data.length) return null;
      return { event, data: data.join('\n'), ...(this.lastId !== undefined ? { id: this.lastId } : {}) };
    }
    if (line.startsWith(':')) return null; // a comment, like the indexer's pings
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
    else if (field === 'id' && !value.includes('\0')) this.lastId = value;
    else if (field === 'retry' && /^\d+$/.test(value)) this.retry = Number(value);
    return null;
  }
}

/** The pause before reconnect attempt `attempt` (0 first): 1 s doubling to 30 s, give or take a fifth so many clients spread out. */
export function backoffMs(attempt: number, jitter = Math.random(), baseMs = 1000, maxMs = 30_000): number {
  const plain = Math.min(maxMs, baseMs * 2 ** Math.min(Math.max(0, attempt), 20));
  return Math.round(plain * (0.8 + 0.4 * jitter));
}

export type StreamOptions = {
  onEvent: (e: SseEvent) => void;
  /** Called on every successful connect, so missed events can be caught up on. */
  onOpen?: () => void;
  signal: AbortSignal;
  /** The indexer pings every 15 s. Silence this long means the connection is dead even if the socket doesn't know it. */
  idleMs?: number;
};

/** Reads one connection until it ends or fails. */
async function readOnce(url: string, opts: StreamOptions): Promise<void> {
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  opts.signal.addEventListener('abort', stop, { once: true });
  let idle: NodeJS.Timeout | undefined;
  const kick = () => {
    clearTimeout(idle);
    idle = setTimeout(() => ctrl.abort(new Error('no data from the stream')), opts.idleMs ?? 45_000);
  };
  try {
    kick();
    const res = await fetch(url, { headers: { accept: 'text/event-stream' }, signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    log.info({ url }, 'stream connected');
    opts.onOpen?.();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    for (;;) {
      const { done, value } = await reader.read(); // the next read starts only once this one is handled
      if (done) return;
      kick();
      for (const e of parser.push(decoder.decode(value, { stream: true }))) {
        try {
          opts.onEvent(e);
        } catch (err) {
          log.warn({ event: e.event, err: why(err) }, 'event handler failed');
        }
      }
    }
  } finally {
    clearTimeout(idle);
    opts.signal.removeEventListener('abort', stop);
    ctrl.abort();
  }
}

/** Keeps a connection to the stream open until the signal fires. */
export async function followStream(url: string, opts: StreamOptions): Promise<void> {
  let attempt = 0;
  while (!opts.signal.aborted) {
    const started = Date.now();
    try {
      await readOnce(url, opts);
      if (!opts.signal.aborted) log.warn('stream ended');
    } catch (err) {
      if (opts.signal.aborted) break;
      log.warn({ err: why(err) }, 'stream dropped');
    }
    // A connection that held for a while was a good one, so the next pause starts short again.
    if (Date.now() - started > 30_000) attempt = 0;
    const wait = backoffMs(attempt++);
    log.info({ inMs: wait }, 'reconnecting to the stream');
    await sleep(wait, opts.signal);
  }
}
