// What a chat message asks for, checked before anything else looks at it.

export type Direction = 'above' | 'below';

export type Command =
  | { kind: 'help' }
  | { kind: 'watch'; wallet: string; name: string | null }
  | { kind: 'unwatch'; wallet: string }
  | { kind: 'watching' }
  | { kind: 'alert'; token: string; direction: Direction; levelUsd: number }
  | { kind: 'alerts' }
  | { kind: 'unalert'; index: number }
  | { kind: 'orders'; wallet: string | null }
  | { kind: 'unorders'; wallet: string }
  | { kind: 'unknown'; name: string }
  | { kind: 'error'; message: string };

export const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);

/** The longest name a watched wallet can have, so a list of them stays readable. */
export const MAX_NAME = 32;
/** A market cap above this is a typo, not a target. */
export const MAX_CAP = 1e12;

/** "/watch@MyBot 0xabc Bob" into its name and words. Null when it isn't a command, or is one for another bot in a group. */
export function splitCommand(text: string, botUsername?: string): { name: string; args: string[] } | null {
  const words = text.trim().split(/\s+/);
  const m = /^\/([a-zA-Z0-9_]+)(?:@([a-zA-Z0-9_]+))?$/.exec(words[0] ?? '');
  if (!m) return null;
  if (m[2] && botUsername && m[2].toLowerCase() !== botUsername.toLowerCase()) return null;
  return { name: m[1]!.toLowerCase(), args: words.slice(1) };
}

/** "50k", "1.2m", "$50,000", "2B" into dollars. Null for anything else, zero or less, or past MAX_CAP. */
export function parseCap(s: string): number | null {
  const m = /^\$?(\d+(?:\.\d+)?|\.\d+)([kmb])?$/i.exec(s.replace(/[,\s_]/g, ''));
  if (!m) return null;
  const scale = ({ k: 1e3, m: 1e6, b: 1e9 } as Record<string, number>)[(m[2] ?? '').toLowerCase()] ?? 1;
  const n = Number(m[1]) * scale;
  return Number.isFinite(n) && n > 0 && n <= MAX_CAP ? n : null;
}

const BAD_WALLET = 'That is not a wallet address. It should be 0x followed by 40 letters and digits.';
const BAD_TOKEN = 'That is not a token address. It should be 0x followed by 40 letters and digits.';
const CONTROL = /[\u0000-\u001f\u007f]/g;

export function parseCommand(text: string, botUsername?: string): Command | null {
  const split = splitCommand(text, botUsername);
  if (!split) return null;
  const { name, args } = split;
  switch (name) {
    case 'start':
    case 'help':
      return { kind: 'help' };
    case 'watch': {
      const wallet = args[0];
      if (!wallet) return { kind: 'error', message: 'Usage: /watch <wallet> [name], for example /watch 0x1234...abcd Whale' };
      if (!isAddress(wallet)) return { kind: 'error', message: BAD_WALLET };
      const label = args.slice(1).join(' ').replace(CONTROL, '').trim().slice(0, MAX_NAME);
      return { kind: 'watch', wallet: wallet.toLowerCase(), name: label || null };
    }
    case 'unwatch': {
      const wallet = args[0];
      if (!wallet) return { kind: 'error', message: 'Usage: /unwatch <wallet>' };
      if (!isAddress(wallet)) return { kind: 'error', message: BAD_WALLET };
      return { kind: 'unwatch', wallet: wallet.toLowerCase() };
    }
    case 'watching':
      return { kind: 'watching' };
    case 'alert': {
      const usage = 'Usage: /alert <token> above|below <market cap in USD>, for example /alert 0x1234...abcd above 50k';
      const [token, dir] = args;
      if (!token || !dir || args.length < 3) return { kind: 'error', message: usage };
      if (!isAddress(token)) return { kind: 'error', message: BAD_TOKEN };
      const direction = dir.toLowerCase();
      if (direction !== 'above' && direction !== 'below') return { kind: 'error', message: `Say "above" or "below", not "${dir}". ${usage}` };
      const levelUsd = parseCap(args.slice(2).join(''));
      if (levelUsd === null) return { kind: 'error', message: 'That market cap is not a number I can use. Write it in dollars, like 50000, 50k, 1.2m or 2b.' };
      return { kind: 'alert', token: token.toLowerCase(), direction, levelUsd };
    }
    case 'alerts':
      return { kind: 'alerts' };
    case 'unalert': {
      const n = args[0];
      if (!n || !/^\d+$/.test(n) || Number(n) < 1) return { kind: 'error', message: 'Usage: /unalert <n>, where n is the number from /alerts.' };
      return { kind: 'unalert', index: Number(n) };
    }
    case 'orders': {
      const wallet = args[0];
      if (!wallet) return { kind: 'orders', wallet: null };
      if (!isAddress(wallet)) return { kind: 'error', message: BAD_WALLET };
      return { kind: 'orders', wallet: wallet.toLowerCase() };
    }
    case 'unorders': {
      const wallet = args[0];
      if (!wallet) return { kind: 'error', message: 'Usage: /unorders <wallet>' };
      if (!isAddress(wallet)) return { kind: 'error', message: BAD_WALLET };
      return { kind: 'unorders', wallet: wallet.toLowerCase() };
    }
    default:
      return { kind: 'unknown', name };
  }
}
