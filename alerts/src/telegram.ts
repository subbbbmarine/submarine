// The few Bot API calls this needs, over plain HTTPS. The token is part of every URL, so URLs are never logged.
import { log, sleep } from './log.js';

export class TelegramError extends Error {
  constructor(
    readonly code: number,
    readonly description: string,
    readonly parameters: { retry_after?: number; migrate_to_chat_id?: number } = {},
  ) {
    super(`Telegram ${code}: ${description}`);
  }
}

export type Update = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; is_bot?: boolean };
    text?: string;
  };
};

/** Telegram asks callers to wait this long on a 429; a few waits in a row, then the error goes up. */
const MAX_429_WAITS = 5;

export class Telegram {
  constructor(
    private token: string,
    private base = 'https://api.telegram.org',
  ) {}

  async call<T>(method: string, params: Record<string, unknown> = {}, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
    for (let waits = 0; ; waits++) {
      const timeout = AbortSignal.timeout(opts.timeoutMs ?? 15_000);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      const res = await fetch(`${this.base}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal,
      });
      let body: { ok?: boolean; result?: T; error_code?: number; description?: string; parameters?: TelegramError['parameters'] };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        throw new TelegramError(res.status, `HTTP ${res.status} without a JSON answer`);
      }
      if (body.ok) return body.result as T;
      const code = body.error_code ?? res.status;
      const retry = body.parameters?.retry_after;
      if (code === 429 && retry !== undefined && waits < MAX_429_WAITS) {
        log.warn({ method, retryAfterS: retry }, 'Telegram asked to slow down');
        await sleep(retry * 1000 + 250, opts.signal);
        if (opts.signal?.aborted) throw new Error('stopped');
        continue;
      }
      throw new TelegramError(code, body.description ?? 'no description', body.parameters);
    }
  }

  getMe() {
    return this.call<{ id: number; username: string }>('getMe');
  }

  /** Long polling: Telegram holds the request up to `timeoutS` until there is something new. */
  getUpdates(offset: number, timeoutS: number, signal: AbortSignal) {
    return this.call<Update[]>('getUpdates', { offset, timeout: timeoutS, allowed_updates: ['message'] }, { timeoutMs: (timeoutS + 15) * 1000, signal });
  }

  sendMessage(chatId: number, text: string) {
    return this.call('sendMessage', { chat_id: chatId, text, link_preview_options: { is_disabled: true } });
  }

  setMyCommands(commands: Array<{ command: string; description: string }>) {
    return this.call('setMyCommands', { commands });
  }
}
