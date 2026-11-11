// pino isn't installed where this package can reach it, so this writes the same one-JSON-object-per-line shape pino does.
const LEVELS = { debug: 20, info: 30, warn: 40, error: 50 } as const;
type Level = keyof typeof LEVELS;
type Fields = Record<string, unknown>;

const min = LEVELS[(process.env.LOG_LEVEL || 'info') as Level] ?? LEVELS.info;

function write(level: Level, a: Fields | string, b?: string): void {
  if (LEVELS[level] < min) return;
  const fields = typeof a === 'string' ? {} : a;
  const msg = typeof a === 'string' ? a : b;
  process.stdout.write(`${JSON.stringify({ level: LEVELS[level], time: Date.now(), name: 'alerts', ...fields, msg })}\n`);
}

export const log = {
  debug: (a: Fields | string, b?: string) => write('debug', a, b),
  info: (a: Fields | string, b?: string) => write('info', a, b),
  warn: (a: Fields | string, b?: string) => write('warn', a, b),
  error: (a: Fields | string, b?: string) => write('error', a, b),
};

/** The first line of an error, for logs. */
export const why = (err: unknown) => (err instanceof Error ? err.message : String(err)).split('\n')[0];

/** Waits, or stops waiting early when the signal fires. Never rejects. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
