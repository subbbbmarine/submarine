// How numbers and wallets read in a message.

export const shortAddress = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

/**
 * A token's name or symbol as its creator typed it, made safe to put in a message: no line breaks, tabs or other control
 * characters that could fake a line of an alert, and no longer than `max`.
 */
export function cleanText(s: unknown, max = 32): string {
  const flat = String(s ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Three significant figures, without the trailing zeros toPrecision leaves. */
const sig3 = (n: number) => Number(n.toPrecision(3));

const UNITS: Array<[number, string]> = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];

/** Dollars the way a trader says them: $950, $12.3K, $1.2M. */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '$?';
  if (n < 0) return `-${formatUsd(-n)}`;
  if (n > 0 && n < 0.01) return '<$0.01';
  const r = sig3(n);
  for (const [size, unit] of UNITS) if (r >= size) return `$${sig3(r / size)}${unit}`;
  return `$${r}`;
}

/** An amount of ZRO: 0.5, 0.0123, 12.3, 1,230. */
export function formatZro(n: number): string {
  if (!Number.isFinite(n)) return '?';
  if (n > 0 && n < 0.0001) return '<0.0001';
  if (n >= 1000) return Math.round(n).toLocaleString('en-US');
  return String(sig3(n));
}
