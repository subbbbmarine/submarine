'use client';

import { RANKS, rankFor, TREASURY_BPS } from './config';
import { drawMark, font } from './shareCard';

/** Where a volume sits on the rank scale, 0 to 1. The marks are evenly spaced, and a mark's stretch fills in step with volume. */
export function scalePos(volume: number): number {
  const { index, next } = rankFor(volume);
  if (!next) return 1;
  const from = RANKS[index]!.from;
  const frac = Math.min(Math.max((volume - from) / (next.from - from), 0), 1);
  return (index + frac) / (RANKS.length - 1);
}

/** ZRO volumes run to millions, so the text steps through K and M. */
export const volumeText = (v: number) =>
  v >= 1_000_000 ? `${Number((v / 1_000_000).toFixed(2))}M` : v >= 1_000 ? `${Number((v / 1_000).toFixed(1))}K` : v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2);
export const markText = (v: number) => (v >= 1_000_000 ? `${v / 1_000_000}M` : v >= 1_000 ? `${v / 1_000}K` : String(v));
export const cutText = (offBps: number) => `${Number(((TREASURY_BPS - offBps) / 100).toFixed(2))}%`;

const W = 1200;
const H = 675;
const SCALE = 2;
const LEFT = 64;
const GROUND = '#0a0a0d';
const INK = '#f4f4f5';
const FAINT = 'rgba(255,255,255,.62)';
const DIM = 'rgba(255,255,255,.12)';
const ACCENT = '#66e4ec';

/** The picture of a wallet's rank, for posting. Drawn here from the router's own count; nothing is sent anywhere. */
export async function drawRankCard(volume: number, who: string): Promise<Blob> {
  await document.fonts.ready.catch(() => undefined);
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W - 160, 80, 0, W - 160, 80, 620);
  glow.addColorStop(0, 'rgba(102,228,236,.18)');
  glow.addColorStop(1, 'rgba(102,228,236,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const { index, rank, next } = rankFor(volume);
  drawMark(ctx, LEFT - 4, 38, 60);
  font(ctx, 500, 22);
  ctx.fillStyle = FAINT;
  ctx.textAlign = 'right';
  ctx.fillText(`Rank ${index + 1} of ${RANKS.length}`, W - LEFT, 76);
  ctx.textAlign = 'left';

  font(ctx, 700, 132, -5);
  ctx.fillStyle = ACCENT;
  ctx.fillText(rank.name, LEFT - 6, 258);

  font(ctx, 600, 48, -1.2);
  ctx.fillStyle = INK;
  ctx.fillText(`${volumeText(volume)} ZRO traded`, LEFT, 334);
  font(ctx, 500, 26, -0.2);
  ctx.fillStyle = FAINT;
  ctx.fillText(
    rank.offBps > 0 ? `Pays ${cutText(rank.offBps)} to the terminal instead of ${cutText(0)}` : `Pays the full ${cutText(0)} to the terminal`,
    LEFT,
    378,
  );
  if (next) ctx.fillText(`${volumeText(next.from - volume)} ZRO more to ${next.name}, then ${cutText(next.offBps)}`, LEFT, 414);

  // The scale: every mark, filled up to here. Square marks, as Submarine draws its other markers.
  const x0 = LEFT + 12;
  const x1 = W - LEFT - 12;
  const y = 512;
  ctx.fillStyle = DIM;
  ctx.fillRect(x0, y - 3, x1 - x0, 6);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(x0, y - 3, (x1 - x0) * scalePos(volume), 6);
  RANKS.forEach((r, i) => {
    const x = x0 + ((x1 - x0) * i) / (RANKS.length - 1);
    const reached = i <= index;
    const s = i === index ? 24 : 16;
    ctx.fillStyle = reached ? ACCENT : '#2a2a30';
    ctx.beginPath();
    ctx.roundRect(x - s / 2, y - s / 2, s, s, 4);
    ctx.fill();
    if (i === index) {
      ctx.strokeStyle = GROUND;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.textAlign = i === 0 ? 'left' : i === RANKS.length - 1 ? 'right' : 'center';
    const tx = i === 0 ? x - 8 : i === RANKS.length - 1 ? x + 8 : x;
    font(ctx, 600, 21);
    ctx.fillStyle = reached ? INK : FAINT;
    ctx.fillText(r.name, tx, y + 48);
    font(ctx, 500, 18);
    ctx.fillStyle = FAINT;
    ctx.fillText(`${markText(r.from)} ZRO, ${cutText(r.offBps)}`, tx, y + 74);
  });
  ctx.textAlign = 'left';

  font(ctx, 500, 20);
  ctx.fillStyle = FAINT;
  ctx.fillText(who, LEFT, H - 40);
  ctx.textAlign = 'right';
  ctx.fillText('Traded on Zero', W - LEFT, H - 40);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas'))), 'image/png'));
}
