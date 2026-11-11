export function short(address: string, head = 4, tail = 4): string {
  return `${address.slice(0, head + 2)}...${address.slice(-tail)}`;
}

/** ZRO amounts: enough digits to be useful, never a wall of them. */
export function zro(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (a >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (a >= 0.001) return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return v.toPrecision(2);
}

/** Dollars the way a trader reads them: $9.42K, $12.30, $0.45. */
export function usdText(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '$0';
  const a = Math.abs(v);
  if (a >= 1000) return `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(a)}`;
  if (a >= 0.01) return `$${a.toFixed(2)}`;
  return '<$0.01';
}

export function compact(v: number): string {
  if (!Number.isFinite(v)) return '0';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: v >= 1000 ? 2 : 3 }).format(v);
}

/** Splits a tiny price into its leading zeros and digits, so the UI can render 0.0(7)512 instead of counting zeros. */
export function priceParts(v: number): { zeros: number; digits: string } | null {
  if (!(v > 0) || v >= 0.001) return null;
  const zeros = Math.ceil(-Math.log10(v)) - 1; // zeros right after the decimal point: 1.4e-8 has seven
  const digits = (v * 10 ** (zeros + 1)).toFixed(2).replace('.', '').replace(/0+$/, '') || '0';
  return { zeros, digits };
}

export function plainPrice(v: number): string {
  if (!(v > 0)) return '0';
  return v >= 1 ? v.toLocaleString('en-US', { maximumFractionDigits: 4 }) : v.toPrecision(3).replace(/\.?0+$/, '');
}

const SUB = '₀₁₂₃₄₅₆₇₈₉';
/** A tiny price as plain text, for places that can't set a subscript: 0.0₇512. */
export function priceText(v: number): string {
  const parts = priceParts(v);
  if (!parts) return plainPrice(v);
  return `0.0${String(parts.zeros).split('').map((d) => SUB[Number(d)]).join('')}${parts.digits}`;
}

export function percent(v: number): string {
  const p = v * 100;
  const body = Math.abs(p) >= 100 ? p.toFixed(0) : p.toFixed(1);
  return `${p > 0 ? '+' : ''}${body}%`;
}

export function age(ts: number, nowMs: number = Date.now()): string {
  const s = Math.max(0, Math.floor(nowMs / 1000 - ts));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** A stable hue from an address, so a token keeps its colour everywhere it appears. */
export function hueOf(address: string): number {
  let h = 0;
  for (let i = 2; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) % 360;
  return h;
}
