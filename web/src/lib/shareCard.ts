'use client';

import { SUBMARINE_H, SUBMARINE_PATH, SUBMARINE_W } from './submarine';
import { get, type Candle } from './api';
import { backdropFor } from './backdrops';
import { usdText } from './format';

/**
 * The picture of one trade, for posting: what went in, what it's worth or what came out, and the return on it. Drawn in the
 * browser from the trade's own figures. Nothing is sent anywhere unless you post or save it yourself.
 */
export interface TradeCard {
  symbol: string;
  token: string;
  image: string | null;
  /** All in ZRO. */
  invested: number;
  out: number;
  profit: number;
  /** Return on what went in, as a fraction. */
  ratio: number;
  /** Still held, so `out` includes what it's worth now rather than only what it sold for. */
  open: boolean;
  ts: number;
  /** USD per ZRO, or null to show ZRO alone. */
  usd: number | null;
}

export type CardArt = { kind: 'chart' } | { kind: 'picture'; src: string };

const W = 1200;
const H = 675;
const SCALE = 2;
const LEFT = 64;
/** The text column's right edge: the art has everything past it. */
const COLUMN = 560;
const GROUND = '#0a0a0d';
const INK = '#f4f4f5';
const FAINT = 'rgba(255,255,255,.62)';
const UP = '#34d399';
const DOWN = '#f87171';
const ACCENT = '#66e4ec';

const load = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    const t = setTimeout(() => reject(new Error('timeout')), 6000);
    im.onload = () => {
      clearTimeout(t);
      resolve(im);
    };
    im.onerror = () => {
      clearTimeout(t);
      reject(new Error('image'));
    };
    im.src = src;
  });

const zroText = (n: number) => {
  const a = Math.abs(n);
  return a === 0 ? '0' : a >= 100 ? a.toFixed(1) : a >= 0.0001 ? a.toFixed(3) : a.toPrecision(2);
};
const moneyText = (n: number, usd: number | null) => (usd ? usdText(Math.abs(n) * usd) : `${zroText(n)} ZRO`);
export const pctText = (ratio: number) => {
  const p = ratio * 100;
  return `${p >= 0 ? '+' : '-'}${Math.abs(p) >= 100 ? Math.abs(p).toFixed(0) : Math.abs(p).toFixed(1)}%`;
};
const dateText = (ts: number) => new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const FONT = () => getComputedStyle(document.body).fontFamily;
export function font(ctx: CanvasRenderingContext2D, weight: number, size: number, tracking = 0) {
  ctx.font = `${weight} ${size}px ${FONT()}`;
  ctx.letterSpacing = `${tracking}px`;
}


/** Submarine's submarine, the same as in the header, fitted into a square of `size`. */
export function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const k = size / Math.max(SUBMARINE_W, SUBMARINE_H);
  ctx.save();
  ctx.translate(x + (size - SUBMARINE_W * k) / 2, y + (size - SUBMARINE_H * k) / 2);
  ctx.scale(k, k);
  ctx.fillStyle = '#ffffff';
  ctx.fill(new Path2D(SUBMARINE_PATH), 'evenodd');
  ctx.restore();
}

/** The token's own price history, running off the right of the card. A token with too little history gets a picture. */
async function drawChart(ctx: CanvasRenderingContext2D, card: TradeCard) {
  let candles: Candle[] = [];
  for (const interval of [300, 60]) {
    candles = await get<{ candles: Candle[] }>(`/api/v1/tokens/${card.token}/candles?interval=${interval}&limit=200`)
      .then((d) => d.candles)
      .catch(() => []);
    if (candles.length >= 12) break;
  }
  if (candles.length < 2) {
    const im = await load(backdropFor(card.token, card.profit).src).catch(() => null);
    if (im) drawPicture(ctx, im);
    return;
  }
  const x0 = 520;
  const top = 120;
  const bottom = H - 96;
  const low = Math.min(...candles.map((c) => c.c));
  const high = Math.max(...candles.map((c) => c.c));
  const px = (i: number) => x0 + (i / (candles.length - 1)) * (W - x0);
  const py = (v: number) => bottom - ((v - low) / (high - low || 1)) * (bottom - top);
  const line = () => {
    ctx.beginPath();
    candles.forEach((c, i) => (i ? ctx.lineTo(px(i), py(c.c)) : ctx.moveTo(px(i), py(c.c))));
  };
  line();
  ctx.lineTo(W, H);
  ctx.lineTo(x0, H);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, top, 0, H);
  fill.addColorStop(0, 'rgba(102,228,236,.26)');
  fill.addColorStop(1, 'rgba(102,228,236,0)');
  ctx.fillStyle = fill;
  ctx.fill();
  line();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // Melts into the ground before the figures start.
  const fade = ctx.createLinearGradient(x0, 0, x0 + 220, 0);
  fade.addColorStop(0, GROUND);
  fade.addColorStop(1, 'rgba(10,10,11,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(x0 - 1, 0, 222, H);
}

/** A picture over the whole card, darkened on the left just enough that the figures read on anything. */
function drawPicture(ctx: CanvasRenderingContext2D, im: HTMLImageElement) {
  const k = Math.max(W / im.width, H / im.height);
  const sw = W / k;
  const sh = H / k;
  ctx.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, 0, 0, W, H);
  const shade = ctx.createLinearGradient(0, 0, COLUMN + 240, 0);
  shade.addColorStop(0, 'rgba(6,6,7,.82)');
  shade.addColorStop(0.55, 'rgba(6,6,7,.6)');
  shade.addColorStop(1, 'rgba(6,6,7,0)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, COLUMN + 240, H);
}

async function drawToken(ctx: CanvasRenderingContext2D, card: TradeCard, y: number) {
  const size = 44;
  ctx.save();
  ctx.beginPath();
  ctx.arc(LEFT + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#26262a';
  ctx.fillRect(LEFT, y, size, size);
  const im = card.image ? await load(card.image).catch(() => null) : null;
  if (im) ctx.drawImage(im, LEFT, y, size, size);
  else {
    font(ctx, 600, 20);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.fillText(card.symbol.slice(0, 1).toUpperCase(), LEFT + size / 2, y + 29);
    ctx.textAlign = 'left';
  }
  ctx.restore();
  font(ctx, 600, 30, -0.6);
  ctx.fillStyle = INK;
  ctx.fillText(card.symbol.length > 18 ? `${card.symbol.slice(0, 17)}...` : card.symbol, LEFT + size + 14, y + 33);
}

/** The card as a PNG, at twice the size X shows it. A picture that fails to load leaves the ground bare and keeps the card. */
export async function drawCard(card: TradeCard, art: CardArt): Promise<Blob> {
  await document.fonts.ready.catch(() => undefined);
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, W, H);

  if (art.kind === 'chart') await drawChart(ctx, card);
  else {
    const im = await load(art.src).catch(() => null);
    if (im) drawPicture(ctx, im);
  }

  drawMark(ctx, LEFT - 4, 38, 60);
  await drawToken(ctx, card, 128);

  const colour = card.profit >= 0 ? UP : DOWN;
  const sign = card.profit >= 0 ? '+' : '-';
  const width = COLUMN - LEFT;

  // The return, as large as its digits allow.
  const pct = pctText(card.ratio);
  let size = 124;
  font(ctx, 700, size, -size * 0.04);
  while (ctx.measureText(pct).width > width && size > 56) {
    size -= 4;
    font(ctx, 700, size, -size * 0.04);
  }
  ctx.fillStyle = colour;
  ctx.fillText(pct, LEFT - 3, 296);

  font(ctx, 600, 46, -1.2);
  ctx.fillText(`${sign}${moneyText(card.profit, card.usd)}`, LEFT, 358);
  if (card.usd) {
    font(ctx, 500, 26, -0.3);
    ctx.fillText(`${sign}${zroText(card.profit)} ZRO`, LEFT, 400);
  }

  ctx.fillStyle = 'rgba(255,255,255,.14)';
  ctx.fillRect(LEFT, 438, width, 1);

  const figure = (x: number, label: string, value: string) => {
    font(ctx, 500, 19);
    ctx.fillStyle = FAINT;
    ctx.fillText(label, x, 480);
    font(ctx, 600, 32, -0.6);
    ctx.fillStyle = INK;
    ctx.fillText(value, x, 522);
  };
  figure(LEFT, 'Invested', moneyText(card.invested, card.usd));
  figure(LEFT + width / 2, card.open ? 'Worth now' : 'Took out', moneyText(card.out, card.usd));

  font(ctx, 500, 19);
  ctx.fillStyle = FAINT;
  ctx.fillText(dateText(card.ts), LEFT, 622);
  ctx.textAlign = 'right';
  ctx.fillText('Traded on Zero', COLUMN, 622);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas'))), 'image/png'));
}

interface HistoryRow {
  ts: number;
  token: string;
  is_buy: number;
  zro: number;
  amount: number;
}

/**
 * What one sale made: what it brought in less what those tokens had cost, at the wallet's average price for the token up to
 * that moment. The same reckoning as the trading calendar.
 */
export async function saleCard(wallet: string, sale: { token: string; symbol: string; uri?: string | null; ts: number; zro: number; amount: number }, usd: number | null): Promise<TradeCard> {
  const { trades } = await get<{ trades: HistoryRow[] }>(`/api/v1/wallet/${wallet}/trades?limit=20000`);
  let held = 0;
  let cost = 0;
  for (const t of [...trades].sort((a, b) => a.ts - b.ts)) {
    if (t.token !== sale.token) continue;
    if (t.is_buy) {
      held += t.amount;
      cost += t.zro;
      continue;
    }
    const sold = Math.min(t.amount, held);
    const spent = held > 0 ? (cost / held) * sold : 0;
    if (t.ts === sale.ts && t.amount === sale.amount) {
      if (spent <= 0) throw new Error('no cost');
      const out = t.zro * (sold / t.amount);
      return { symbol: sale.symbol, token: sale.token, image: sale.uri ?? null, invested: spent, out, profit: out - spent, ratio: (out - spent) / spent, open: false, ts: t.ts, usd };
    }
    held -= sold;
    cost -= spent;
  }
  throw new Error('not found');
}

export const postUrl = (c: Pick<TradeCard, 'ratio' | 'symbol'>) => `https://x.com/intent/post?text=${encodeURIComponent(`${pctText(c.ratio)} on $${c.symbol} on Zero.`)}`;

/** A picture from your own disk, cut to a size the browser can keep. It never leaves the browser. */
export async function ownPicture(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const im = await load(url);
    const k = Math.min(1, 1400 / Math.max(im.width, im.height));
    const c = document.createElement('canvas');
    c.width = Math.round(im.width * k);
    c.height = Math.round(im.height * k);
    c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}
