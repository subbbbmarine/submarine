'use client';

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { BookOrder, Candle, DevKind } from '@/lib/api';
import { lineId, type HLine } from '@/lib/drawings';

const AXIS = 72;
/** Height of the time axis along the foot. */
const TIME = 22;
const PAD = 14;
const GRID = 4;
/** The share of the height the volume bars take at the foot of the chart. */
const VOL = 0.16;
/** The fewest bars a zoom shows, and the free space allowed past the last bar, in bars. */
const MIN_BARS = 8;
const RIGHT_ROOM = 0.6;
/** However few trades a token has, the fitted view is at least this many bars wide, so two trades read as two slim candles. */
const MIN_VIEW = 32;
const MAX_BAR = 12;
/**
 * Every candle size spans the same history: every candle from the first trade to now is on the axis, a quiet one flat at the last
 * price, so the size only says how long a candle is. Past this many, the oldest quiet ones leave the axis and anything that traded
 * stays, which on one-second candles starts after about a day.
 */
const MOST_FILLED = 100_000;
const LIVE_ROOM = 8;
/**
 * Second-sized candles have to move with the clock and still show all the history. Once a token outgrows the screen, the newest
 * bars roll along the right three quarters at a steady speed, and everything older is pressed into the left quarter. LIVE_VIEW is
 * the width in bars at that speed: the window, the room past the tip, and a third more for the left quarter.
 */
const LIVE_WINDOW = 90;
const LIVE_VIEW = 130;
/** Clock steps the time axis labels on, in seconds, so they sit on round times and don't hop as a chart fills up. */
const LABEL_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 43200, 86400, 172800, 604800, 1209600, 2592000];
/** A strip along the left edge that stretches the chart, the way the scales on the other two sides do. */
const EDGE = 16;
const PALETTE = { up: '62,207,142', down: '242,85,90', accent: '102,228,236', ink: '244,244,245', muted: '158,158,173', faint: '124,124,139', bg: '10,10,13', card: '17,17,22', card2: '38,38,47' };
const rgba = (channels: string, a = 1) => `rgba(${channels},${a})`;

export interface Indicators {
  sma: boolean;
  ema: boolean;
  vwap: boolean;
}
export type DrawTool = 'line' | null;
const SMA_LEN = 20;
const EMA_LEN = 50;
/** Thin and quieter than the price, in the palette's own greys and yellow; VWAP dashed so it never reads as the line chart. */
export const INDICATOR_STYLE = {
  sma: { name: 'SMA 20', color: rgba(PALETTE.ink, 0.55), dash: [] as number[] },
  ema: { name: 'EMA 50', color: rgba('150,175,205', 0.75), dash: [] as number[] },
  vwap: { name: 'VWAP', color: rgba(PALETTE.accent, 0.6), dash: [5, 4] },
};
const INDICATOR_KEYS = ['sma', 'ema', 'vwap'] as const;
/** How near a drawn line the pointer has to be to grab it, in pixels. */
const LINE_GRAB = 6;
/** The small remove button at the right end of a hovered or selected line. */
const LINE_X = 16;

/** The heatmap's grid, in pixels. It's drawn this coarse and scaled up smooth, which is what makes it a field and not stripes. */
const HEAT_COL = 3;
const HEAT_ROW = 3;
/** How an order's amount spreads over the rows around its level. */
const HEAT_KERNEL = [0.1, 0.35, 0.72, 1, 0.72, 0.35, 0.1];
/** How far an order's light takes to fade in at its start and out at its end, in pixels. */
const HEAT_FADE = 44;
/** The narrowest an order is drawn, in pixels, however briefly it waited: four cells of the grid. */
const HEAT_MIN_W = 12;
/** A trail brightens along its length up to here, in pixels, like the tail of something moving. */
const HEAT_TRAIL = 220;
/** From almost nothing to the most waiting anywhere in view, for each side: green for buys, red for sales, pale at the very top. */
const BUY_STOPS: Array<[number, number, number, number, number]> = [
  [0, 8, 60, 42, 0],
  [0.12, 10, 88, 62, 0.3],
  [0.4, 24, 158, 112, 0.58],
  [0.7, 52, 211, 153, 0.82],
  [1, 150, 245, 205, 0.97],
];
const SELL_STOPS: Array<[number, number, number, number, number]> = [
  [0, 70, 16, 16, 0],
  [0.12, 108, 30, 30, 0.3],
  [0.4, 188, 60, 60, 0.58],
  [0.7, 248, 113, 113, 0.82],
  [1, 255, 196, 186, 0.97],
];
/** Trails keep the time: each order a tail of light. Clouds melt them into zones. Beams show only what waits now, from the scale. */
export type HeatStyle = 'trails' | 'clouds' | 'beams';
const rampOf = (stops: typeof BUY_STOPS) => {
  const out = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1]![0]) k++;
    const a = stops[k]!;
    const b = stops[k + 1]!;
    const f = (t - a[0]) / (b[0] - a[0]);
    for (let c = 0; c < 3; c++) out[i * 4 + c] = a[c + 1]! + (b[c + 1]! - a[c + 1]!) * f;
    out[i * 4 + 3] = (a[4] + (b[4] - a[4]) * f) * 255;
  }
  return out;
};
/** Stop losses and trailing stops are sales too, but they wait to be set off on the way down, so they get their own amber. */
const STOP_STOPS: Array<[number, number, number, number, number]> = [
  [0, 70, 40, 8, 0],
  [0.12, 120, 72, 16, 0.3],
  [0.4, 205, 124, 32, 0.58],
  [0.7, 250, 168, 62, 0.82],
  [1, 255, 218, 160, 0.97],
];
const BUY_RAMP = rampOf(BUY_STOPS);
const SELL_RAMP = rampOf(SELL_STOPS);
const STOP_RAMP = rampOf(STOP_STOPS);
/** A stop loss or trailing stop: a sale that waits below the price for it to fall there. */
export const isStop = (o: BookOrder) => !o.is_buy && (o.kind === 'stop' || o.kind === 'trailing');
/** The light on a band under the pointer, and the tag on the scale. */
const BUY_LIGHT = '150,245,205';
const SELL_LIGHT = '255,196,186';
const STOP_LIGHT = '255,206,140';
const lightOf = (o: BookOrder) => (o.is_buy ? BUY_LIGHT : isStop(o) ? STOP_LIGHT : SELL_LIGHT);

/** One stretch of time an order rested at its level with a given amount left, on screen. */
export interface BandHit {
  order: BookOrder;
  /** ZRO waiting during this stretch. */
  amount: number;
  /** When the stretch ended, or null if it's still waiting. */
  until: number | null;
}
interface HeatSegment extends BandHit {
  xa: number;
  xb: number;
  py: number;
}
interface HeatLayer {
  key: string;
  /** One picture per side, each in its own colour. */
  images: HTMLCanvasElement[];
  width: number;
  height: number;
  segments: HeatSegment[];
  above: number;
  below: number;
}

const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/** A soft blur over the grid, so nothing in it has an edge. */
function blurGrid(grid: Float32Array, cols: number, rows: number, radiusX: number, radiusY: number): Float32Array {
  const kernel = (radius: number) => {
    const out: number[] = [];
    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
      // Sigma a third of the radius, so the kernel is near zero where it stops: at half, the edge of a cloud showed as a cut.
      const v = Math.exp(-(i * i) / (2 * (radius / 3) ** 2));
      out.push(v);
      sum += v;
    }
    return out.map((v) => v / sum);
  };
  let from = grid;
  if (radiusX > 0) {
    const k = kernel(radiusX);
    const to = new Float32Array(grid.length);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = from[r * cols + c]!;
        if (v === 0) continue;
        for (let d = -radiusX; d <= radiusX; d++) {
          const at = c + d;
          if (at >= 0 && at < cols) to[r * cols + at]! += v * k[d + radiusX]!;
        }
      }
    }
    from = to;
  }
  if (radiusY > 0) {
    const k = kernel(radiusY);
    const to = new Float32Array(grid.length);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = from[r * cols + c]!;
        if (v === 0) continue;
        for (let d = -radiusY; d <= radiusY; d++) {
          const at = r + d;
          if (at >= 0 && at < rows) to[at * cols + c]! += v * k[d + radiusY]!;
        }
      }
    }
    from = to;
  }
  return from;
}

/** Adds up what rested where, and paints it. Kept until the view or the data changes, so moving the pointer costs nothing. */
function buildHeat(book: BookOrder[], style: HeatStyle, key: string, plot: number, priceH: number, lo: number, hi: number, y: (p: number) => number, xAt: (t: number) => number): HeatLayer {
  const cols = Math.max(1, Math.ceil(plot / HEAT_COL));
  const rows = Math.max(1, Math.ceil(priceH / HEAT_ROW));
  const rawBuy = new Float32Array(cols * rows);
  const rawSell = new Float32Array(cols * rows);
  const rawStop = new Float32Array(cols * rows);
  const segments: HeatSegment[] = [];
  const centre = (HEAT_KERNEL.length - 1) / 2;
  let above = 0;
  let below = 0;
  let largest = 1e-12;
  for (const o of book) if (o.end === null) largest = Math.max(largest, o.left_zro);
  // How bright an amount shows. Straight proportion let one big order put every small one out of sight, so each order gets
  // a quarter of the light to start with and the rest grows with the square root of its size.
  let biggest = 1e-12;
  for (const o of book) biggest = Math.max(biggest, o.size_zro, o.left_zro);
  const shown = (amount: number) => (amount > 0 ? biggest * (0.25 + 0.75 * Math.sqrt(Math.min(amount / biggest, 1))) : 0);

  for (const o of book) {
    if (o.end === null) {
      if (o.price > hi) above++;
      else if (o.price < lo) below++;
    }
    const py = y(o.price);
    if (py < -HEAT_ROW * centre || py > priceH + HEAT_ROW * centre) continue;
    const row = Math.round(py / HEAT_ROW);
    const raw = o.is_buy ? rawBuy : isStop(o) ? rawStop : rawSell;
    const add = (c: number, amount: number) => {
      HEAT_KERNEL.forEach((weight, k) => {
        const r = row + k - centre;
        if (r >= 0 && r < rows) raw[r * cols + c]! += amount * weight;
      });
    };

    if (style === 'beams') {
      // Only what waits now, as light coming out of the price scale, reaching further the more there is.
      if (o.end !== null || o.left_zro <= 0) continue;
      const reach = plot * (0.16 + 0.44 * Math.sqrt(o.left_zro / largest));
      segments.push({ order: o, amount: o.left_zro, until: null, xa: plot - reach, xb: plot, py });
      for (let c = 0; c < cols; c++) {
        const d = plot - c * HEAT_COL;
        if (d < reach) add(c, shown(o.left_zro) * (1 - d / reach) ** 2);
      }
      continue;
    }

    // An order still waiting always shows at the right edge, like a beam: placed a moment ago, or after the time on screen
    // when the view is moved back, it would otherwise be a sliver or nothing, and the styles would disagree about it.
    let startX = o.end === null ? Math.min(xAt(o.start), plot - HEAT_FADE) : xAt(o.start);
    let endX = o.end === null ? plot : xAt(o.end);
    // An order that lived a few seconds is narrower than one cell of the grid. Sampled as it was, it fell between cells or into
    // one depending on where the chart had been dragged to, and blinked. It gets a few cells of width around its moment instead.
    if (endX - startX < HEAT_MIN_W) {
      const mid = (startX + endX) / 2;
      startX = mid - HEAT_MIN_W / 2;
      endX = mid + HEAT_MIN_W / 2;
    }
    endX = Math.min(plot, endX);
    const length = Math.max(1, endX - startX);
    const fade = Math.min(HEAT_FADE, length / 2);
    let from = o.start;
    let amount = o.size_zro;
    // What rested from the placing to each fill, then what was left to the next one, and so on.
    const paint = (to: number | null) => {
      const xa = Math.max(0, from === o.start || (to === null && o.end === null) ? Math.min(xAt(from), startX) : xAt(from));
      const xb = Math.max(xa + 2, to === null ? plot : Math.min(plot, to === o.end ? Math.max(xAt(to), endX) : xAt(to)));
      if (xb <= 0 || xa >= plot || amount <= 0) return;
      segments.push({ order: o, amount, until: to, xa, xb, py });
      const ca = Math.floor(xa / HEAT_COL);
      const cb = Math.min(cols - 1, Math.ceil(xb / HEAT_COL));
      for (let c = ca; c <= cb; c++) {
        const px = (c + 0.5) * HEAT_COL;
        // Fades in from nothing and out to nothing: long and slow for a trail, short for a cloud.
        const rise = style === 'trails' ? smooth((px - startX) / Math.min(length, HEAT_TRAIL)) : smooth((px - startX) / fade);
        // An order still waiting doesn't fade out at the right edge: that edge is now, and it's still there.
        const fall = o.end === null ? 1 : smooth((endX - px) / fade);
        add(c, shown(amount) * rise * fall);
      }
    };
    for (const [ts, left] of o.steps) {
      paint(ts);
      from = ts;
      amount = left;
    }
    paint(o.end);
  }

  const soften = (raw: Float32Array) => (style === 'clouds' ? blurGrid(raw, cols, rows, 14, 8) : style === 'trails' ? blurGrid(raw, cols, rows, 4, 2) : blurGrid(raw, cols, rows, 0, 2));
  const buys = soften(rawBuy);
  const sells = soften(rawSell);
  const stops = soften(rawStop);
  // One scale for every kind, so the brighter one really is the one with more waiting.
  let most = 0;
  for (let i = 0; i < buys.length; i++) most = Math.max(most, buys[i]!, sells[i]!, stops[i]!);
  const curve = style === 'clouds' ? 0.8 : 0.62;
  const paint = (grid: Float32Array, ramp: Uint8ClampedArray) => {
    const image = document.createElement('canvas');
    image.width = cols;
    image.height = rows;
    const ctx = image.getContext('2d')!;
    const pixels = ctx.createImageData(cols, rows);
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === 0) continue;
      // The faintest few percent fade to nothing on a curve of their own, so no light ends in a visible edge.
      const t = grid[i]! / most;
      const shade = Math.round(Math.pow(t < 0.04 ? (t * t) / 0.04 : t, curve) * 255) * 4;
      pixels.data[i * 4] = ramp[shade]!;
      pixels.data[i * 4 + 1] = ramp[shade + 1]!;
      pixels.data[i * 4 + 2] = ramp[shade + 2]!;
      pixels.data[i * 4 + 3] = ramp[shade + 3]!;
    }
    ctx.putImageData(pixels, 0, 0);
    return image;
  };
  const images = most > 0 ? [paint(buys, BUY_RAMP), paint(sells, SELL_RAMP), paint(stops, STOP_RAMP)] : [];
  return { key, images, width: cols * HEAT_COL, height: rows * HEAT_ROW, segments, above, below };
}

export type ChartMode = 'line' | 'candles';

/** Something that happened on the chart: a move by the creator, by you, or by a wallet you follow. */
export interface Mark {
  t: number;
  kind: DevKind;
  who: 'dev' | 'you' | 'tracked';
  /** The followed wallet's name, and the few letters its badge has room for. */
  name?: string;
  tag?: string;
  tokens: number;
  zro?: number;
  to?: string;
}

/** What a card under the pointer says: a title in the colour of what happened, then a figure on each line. */
export type Tone = 'up' | 'down' | 'accent' | 'ink' | 'stop';
export interface HoverCard {
  title: string;
  tone?: Tone;
  rows: Array<{ k: string; v: string; tone?: Tone }>;
}

export type Describe = (m: Mark, close: number) => HoverCard;

/** A level drawn across the chart: where you got in, your own orders, where the token moves to a pool. */
export interface Level {
  price: number;
  label: string;
  tone: 'entry' | 'order' | 'quiet';
}

export interface ChartApi {
  reset: () => void;
  zoom: (factor: number) => void;
  marksInView: () => boolean;
  showMarks: () => void;
  ordersInView: () => boolean;
  showOrders: () => void;
}

interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** What part of the history is on screen: the bar at the right edge, how many fit, and a price range set by hand if any. */
interface View {
  end: number;
  span: number;
  lo?: number;
  hi?: number;
}

type Zone = 'plot' | 'price' | 'time' | 'edge';

interface Badge {
  i: number;
  key: string;
  items: Mark[];
  x: number;
  y: number;
  w: number;
}

const FONT = '"Figtree", system-ui, sans-serif';

const BADGE_TEXT: Record<DevKind, string> = { buy: 'B', sell: 'S', transfer: 'T', burn: 'Burn' };

/**
 * Price over the bars that traded, volume at the foot, a scale on the right, a time axis below, and a crosshair that reads any
 * point. Moves the way trading charts do: drag to pan, wheel to zoom around the pointer, drag a scale to stretch that side,
 * double click to fit again. Drawn on a canvas and never through React, so it keeps up with the pointer and with every trade.
 */
export function ChartCanvas({
  candles,
  resetKey,
  interval,
  live,
  label,
  mode,
  entry,
  volume,
  marks,
  describe,
  book,
  heatStyle = 'beams',
  levels,
  describeBand,
  valueName = 'Value',
  api,
  onMoved,
  onPick,
  lines,
  onLines,
  tool = null,
  indicators,
}: {
  candles: Candle[];
  /** A new value (another token, another candle size) starts from the fitted view. */
  resetKey: string;
  interval: number;
  /** The token's price now: inside the last candle's time it moves that candle. */
  live?: number;
  label: (price: number) => string;
  mode: ChartMode;
  /** Your average price paid, ZRO per token, when you hold the token. */
  entry?: number;
  volume: (zro: number) => string;
  marks?: Mark[];
  describe?: Describe;
  /** Limit orders for the heatmap. */
  book?: BookOrder[];
  heatStyle?: HeatStyle;
  levels?: Level[];
  /** The heatmap band under the pointer, in words. */
  describeBand?: (hits: BandHit[]) => HoverCard;
  /** What the scale is in, for a line's readout. */
  valueName?: string;
  api?: MutableRefObject<ChartApi | null>;
  onMoved?: (moved: boolean) => void;
  /** A click on the price scale, with the price it was at: where a limit order would go. */
  onPick?: (price: number) => void;
  /** Horizontal lines drawn by hand, at prices. */
  lines?: HLine[];
  /** Lines added, moved or removed on the chart. Without it the lines are only shown. */
  onLines?: (lines: HLine[]) => void;
  /** With the line tool on, a click on the plot or the price scale adds a line there instead of anything else. */
  tool?: DrawTool;
  indicators?: Indicators;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hover = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef(0);
  const count = useRef(0);
  const draw = useRef<() => void>(() => undefined);
  const view = useRef<View | null>(null);
  const barTimes = useRef<number[]>([]);
  const firstBar = useRef<{ key: string; t: number } | null>(null);
  /** What was drawn last, so a drag starts from what's on screen. */
  const drawn = useRef({ lo: 0, hi: 1, priceH: 1, step: 1, plot: 1, height: 1, shown: 0 });
  const drag = useRef<{ x: number; y: number; view: View; zone: Zone; moved: boolean; line?: string } | null>(null);
  // Lines, the tool and the indicators are read through refs, so switching one only redraws and never rebuilds the bars.
  const linesRef = useRef<HLine[]>([]);
  linesRef.current = lines ?? [];
  const onLinesRef = useRef(onLines);
  onLinesRef.current = onLines;
  const toolRef = useRef<DrawTool>(null);
  toolRef.current = onLines ? tool : null;
  const indRef = useRef<Indicators | undefined>(undefined);
  indRef.current = indicators;
  const selectedLine = useRef<string | null>(null);
  /** The line being dragged, where it is right now, until it's let go and saved. */
  const lineDraft = useRef<HLine | null>(null);
  const addTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const badges = useRef<Badge[]>([]);
  /**
   * The live roll on second-sized candles: how far into its candle the clock is, and the price the tip is on its way to. The second
   * under way adds to the axis (grow), or, once the axis is full, pushes the oldest quiet bar out of it (shift).
   */
  const rt = useRef<{ key: string; frac: number; grow: number; shift: number; shown: number | null } | null>(null);
  const lastTip = useRef<{ key: string; at: number } | null>(null);
  const tipKey = useRef('');
  const pickTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [tip, setTip] = useState<{ x: number; y: number; below: boolean; side: 'left' | 'mid' | 'right'; rows: HoverCard[] }>();
  const movedRef = useRef(false);
  const setMoved = (m: boolean) => {
    if (m === movedRef.current) return;
    movedRef.current = m;
    onMoved?.(m);
  };
  const fit = (n: number): View => {
    const r = rt.current;
    if (!r) return fitted(n);
    const wide = n + r.grow + LIVE_ROOM;
    return { end: n - 1 + r.grow + LIVE_ROOM, span: wide > LIVE_VIEW ? LIVE_VIEW : Math.max(MIN_VIEW, wide) };
  };

  const hoverEl = useRef<HTMLDivElement>(null);
  const hoverKey = useRef('');
  const showCard = (card: HoverCard | null, x: number, y: number) => {
    const el = hoverEl.current;
    if (!el) return;
    if (!card) {
      el.style.display = 'none';
      hoverKey.current = '';
      return;
    }
    const key = JSON.stringify(card);
    if (key !== hoverKey.current) {
      hoverKey.current = key;
      el.replaceChildren(...cardNodes(card));
    }
    el.style.display = 'block';
    const { plot, priceH } = drawn.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = x + 16;
    if (left + w > plot - 4) left = x - 16 - w;
    const top = Math.max(4, Math.min(priceH - h, y - h / 2));
    el.style.transform = `translate(${Math.round(Math.max(4, left))}px, ${Math.round(top)}px)`;
  };

  const redraw = () => {
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        draw.current();
      });
    }
  };

  useEffect(() => {
    view.current = null;
    setMoved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    if (selectedLine.current && !(lines ?? []).some((l) => l.id === selectedLine.current)) selectedLine.current = null;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, tool, indicators?.sma, indicators?.ema, indicators?.vwap]);

  // Delete or Backspace removes the selected line; Escape lets go of it. Never while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = selectedLine.current;
      if (!id) return;
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeLine(id);
      } else if (e.key === 'Escape') {
        selectedLine.current = null;
        redraw();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeLine = (id: string) => {
    if (selectedLine.current === id) selectedLine.current = null;
    onLinesRef.current?.(linesRef.current.filter((l) => l.id !== id));
    redraw();
  };
  /** The price at a height on the plot, by what was drawn last. */
  const priceAtY = (py: number) => {
    const { lo, hi, priceH } = drawn.current;
    return lo + (1 - (py - PAD) / (priceH - PAD)) * (hi - lo);
  };
  const yOfPrice = (p: number) => {
    const { lo, hi, priceH } = drawn.current;
    return PAD + (1 - (p - lo) / (hi - lo)) * (priceH - PAD);
  };
  /** The drawn line nearest the pointer within grabbing distance, on the plot or on its tag on the scale. */
  const lineAt = (p: { x: number; y: number }) => {
    if (!onLinesRef.current || p.y > drawn.current.priceH + LINE_GRAB) return null;
    let best: HLine | null = null;
    let bestD = LINE_GRAB + 1;
    for (const l of linesRef.current) {
      const d = Math.abs(yOfPrice(l.price) - p.y);
      if (d < bestD && (p.x <= drawn.current.plot || d <= 10)) {
        best = l;
        bestD = d;
      }
    }
    return best;
  };
  const onLineX = (p: { x: number; y: number }, l: HLine) => {
    const plot = drawn.current.plot;
    return p.x >= plot - LINE_X - 4 && p.x <= plot - 4 && Math.abs(p.y - yOfPrice(l.price)) <= LINE_X / 2;
  };

  useEffect(() => {
    let bars: Bar[] = candles.map((k) => ({ ...k }));
    const realtime = interval < 60;
    rt.current = realtime ? { key: resetKey, frac: 0, grow: 0, shift: 0, shown: rt.current?.key === resetKey ? rt.current.shown : null } : null;
    let liveFrom = 0;
    if (bars.length) {
      // Every candle up to now, a quiet one flat at the last price. Older than the filled stretch, only what traded.
      const now = Math.floor(Date.now() / 1000 / interval) * interval;
      const from = Math.max(bars[0]!.t, now - MOST_FILLED * interval);
      const filled: Bar[] = [];
      let j = 0;
      let prev = bars[0]!;
      while (j < bars.length && bars[j]!.t < from) filled.push((prev = bars[j++]!));
      liveFrom = filled.length;
      for (let t = from; t <= now; t += interval) {
        if (j < bars.length && bars[j]!.t === t) filled.push((prev = bars[j++]!));
        else filled.push({ t, o: prev.c, h: prev.c, l: prev.c, c: prev.c, v: 0 });
      }
      while (j < bars.length) filled.push(bars[j++]!);
      bars = filled;
    }
    if (live && live > 0) {
      const last = bars[bars.length - 1];
      if (last && Date.now() / 1000 - last.t < interval) {
        last.c = live;
        last.h = Math.max(last.h, live);
        last.l = Math.min(last.l, live);
      }
    }
    // The clock moves the axis: new candles at its end, the oldest quiet one out once it's full, and on second-sized candles the
    // part of a second under way. Everything here is continuous across a new second, so nothing on screen jumps when one starts.
    const roll = () => {
      const now = Date.now() / 1000;
      const bucket = Math.floor(now / interval) * interval;
      let tail = bars[bars.length - 1]!;
      while (tail.t < bucket) {
        tail = { t: tail.t + interval, o: tail.c, h: tail.c, l: tail.c, c: tail.c, v: 0 };
        bars.push(tail);
      }
      const edge = bucket - MOST_FILLED * interval;
      while (liveFrom < bars.length - 1 && bars[liveFrom]!.t < edge) {
        if (bars[liveFrom]!.v === 0) bars.splice(liveFrom, 1);
        else liveFrom++;
      }
      count.current = bars.length;
      const st = rt.current;
      if (st) {
        const head = bars[liveFrom]!;
        const leaving = liveFrom < bars.length - 1 && head.v === 0 && head.t < edge + interval;
        st.frac = Math.min(1, Math.max(0, (now - tail.t) / interval));
        st.shift = leaving ? st.frac : 0;
        st.grow = leaving ? 0 : st.frac;
      }
      // A view zoomed to the newest bars stays with them, as long as the newest bar was on screen.
      const tip = bars.length - 1 + (st?.grow ?? 0);
      const was = lastTip.current;
      const v = view.current;
      if (v && was?.key === resetKey && tip > was.at && tip - was.at < 2 && was.at <= v.end) v.end += tip - was.at;
      lastTip.current = { key: resetKey, at: tip };
    };
    if (bars.length) roll();
    count.current = bars.length;
    // Older history can arrive after the newest. What someone has zoomed to stays where it is, on the same bars.
    const before = firstBar.current;
    firstBar.current = bars[0] ? { key: resetKey, t: bars[0].t } : null;
    if (view.current && before?.key === resetKey && bars[0] && bars[0].t < before.t) {
      const added = bars.findIndex((b) => b.t >= before.t);
      if (added > 0) view.current = { ...view.current, end: view.current.end + added };
    }
    let heat: HeatLayer | null = null;

    // Indicator series, one value per bar, worked out only when one is on. All three look back and never forward, so bars the
    // clock adds at the end only extend them; anything else (new candles, a quiet bar leaving the axis) starts them over.
    const ind = { n: 0, firstT: 0, lastT: 0, sum: 0, ema: 0, pv: 0, vv: 0, sma: [] as number[], emaS: [] as number[], vwap: [] as number[] };
    const indicate = () => {
      const n = bars.length;
      if (ind.n && (ind.n > n || bars[0]!.t !== ind.firstT || bars[ind.n - 1]!.t !== ind.lastT)) {
        ind.n = 0;
        ind.sma.length = ind.emaS.length = ind.vwap.length = 0;
      }
      if (ind.n === n) return;
      if (ind.n === 0) ind.sum = ind.ema = ind.pv = ind.vv = 0;
      const alpha = 2 / (EMA_LEN + 1);
      for (let i = ind.n; i < n; i++) {
        const b = bars[i]!;
        ind.sum += b.c;
        if (i >= SMA_LEN) ind.sum -= bars[i - SMA_LEN]!.c;
        ind.sma.push(i >= SMA_LEN - 1 ? ind.sum / SMA_LEN : NaN);
        ind.ema = i === 0 ? b.c : ind.ema + alpha * (b.c - ind.ema);
        ind.emaS.push(i >= EMA_LEN - 1 ? ind.ema : NaN);
        // Volume is in ZRO, so the tokens traded are ZRO over the typical price, and VWAP is all the ZRO over all the tokens.
        const typical = (b.h + b.l + b.c) / 3;
        if (b.v > 0 && typical > 0) {
          ind.pv += b.v;
          ind.vv += b.v / typical;
        }
        ind.vwap.push(ind.vv > 0 ? ind.pv / ind.vv : NaN);
      }
      ind.n = n;
      ind.firstT = bars[0]!.t;
      ind.lastT = bars[n - 1]!.t;
    };

    draw.current = () => {
      const c = ref.current;
      if (!c) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== w * dpr || c.height !== h * dpr) {
        c.width = w * dpr;
        c.height = h * dpr;
      }
      const g = c.getContext('2d', { alpha: false });
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = rgba(PALETTE.card);
      g.fillRect(0, 0, w, h);
      g.font = `500 12px ${FONT}`;
      g.textBaseline = 'middle';

      const plot = w - AXIS;
      const foot = h - TIME;
      drawn.current.height = h;
      drawn.current.plot = plot;
      if (bars.length < 1) {
        g.strokeStyle = rgba(PALETTE.ink, 0.08);
        g.beginPath();
        g.moveTo(0, foot / 2);
        g.lineTo(plot, foot / 2);
        g.stroke();
        return;
      }

      const n = bars.length;
      const times = barTimes.current;
      if (times.length !== n || times[0] !== bars[0]!.t || times[n - 1] !== bars[n - 1]!.t) barTimes.current = bars.map((b) => b.t);
      const v = view.current ?? fit(n);
      const step = (plot - 8) / v.span;
      const start = v.end - v.span;
      const shift = rt.current?.shift ?? 0;
      // The two parts of the untouched view on second-sized candles, which meet exactly where a plain view would be, so nothing
      // jumps when a token grows into them. A zoom or a drag leaves them for a plain view at the same speed.
      const plotW = plot - 8;
      const zoned = !view.current && !!rt.current && n + rt.current.grow + LIVE_ROOM > LIVE_VIEW;
      const tipAt = n - 1 + (rt.current?.frac ?? 0);
      const joint = tipAt - LIVE_WINDOW;
      const leftW = plotW / 4;
      const leftStep = zoned ? leftW / (joint + 1.5) : step;
      const split = zoned ? Math.ceil(joint) : 0;
      const x = (i: number) => {
        if (!zoned) return 4 + ((i >= liveFrom ? i - shift : i) - start + 0.5) * step;
        return i >= joint ? 4 + plotW - (LIVE_ROOM - 0.5 + tipAt - i) * step : 4 + ((i + 1.5) / (joint + 1.5)) * leftW;
      };
      const first = zoned ? 0 : Math.max(0, Math.floor(start));
      const lastIdx = zoned ? n - 1 : Math.min(n - 1, Math.ceil(v.end));
      const seen = bars.slice(first, lastIdx + 1);
      // Thinner than a pixel, bars are drawn a column at a time. A long history would otherwise cost frames and show nothing more.
      const perColumn = step >= 1 ? 1 : Math.ceil(1 / step);
      const perLeft = leftStep >= 1 ? 1 : Math.ceil(1 / leftStep);
      const cut = (a: number, z: number) => (zoned ? [...columns(bars, a, Math.min(z, split - 1), perLeft), ...columns(bars, Math.max(a, split), z, perColumn)] : columns(bars, a, z, perColumn));
      const cols = cut(first, lastIdx);
      const colStepAt = (b: Column) => (zoned && b.i < split ? leftStep * perLeft : step * perColumn);

      const priceH = foot * (1 - VOL) - 6;
      let lo: number;
      let hi: number;
      if (v.lo !== undefined && v.hi !== undefined) {
        lo = v.lo;
        hi = v.hi;
      } else {
        const from = seen.length ? seen : bars;
        let min = Infinity;
        let max = -Infinity;
        for (const b of from) {
          const high = mode === 'candles' ? b.h : b.c;
          const low = mode === 'candles' ? b.l : b.c;
          if (high > max) max = high;
          if (low < min) min = low;
        }
        if (entry) {
          max = Math.max(max, entry);
          min = Math.min(min, entry);
        }
        // With the heatmap on, orders near the price are in range, or it would look off. One placed far away can't flatten the chart.
        // That counts orders already filled or cancelled too, while their time is on screen: only waiting ones counted before, so
        // a past order's cloud dropped out of range or came back as the chart was dragged and the range followed the candles.
        const nowPrice = bars[n - 1]!.c;
        const tFrom = from[0]?.t ?? 0;
        const tTo = (from[from.length - 1]?.t ?? 0) + interval;
        for (const o of book ?? []) {
          if (o.price < nowPrice * 0.7 || o.price > nowPrice * 1.3) continue;
          if (o.end !== null && (o.end < tFrom || o.start > tTo)) continue;
          if (o.price > max) max = o.price;
          if (o.price < min) min = o.price;
        }
        // A range at least a few percent of the price, so a quiet token doesn't read as a cliff.
        const span = Math.max(max - min, Math.abs(max) * 0.04) || 1;
        const mid = (max + min) / 2;
        lo = Math.min(min, mid - span / 2) - span * 0.06;
        hi = Math.max(max, mid + span / 2) + span * 0.06;
        if (marks?.length) {
          hi += span * 0.14;
          lo -= span * 0.08;
        }
        lo = Math.max(0, lo);
      }
      drawn.current = { lo, hi, priceH, step, plot, height: h, shown: seen.length };
      const y = (p: number) => PAD + (1 - (p - lo) / (hi - lo)) * (priceH - PAD);
      const last = rt.current?.shown ?? bars[n - 1]!.c;
      const tipX = x(n - 1 + (rt.current?.frac ?? 0));
      const at_ = (i: number) => (i === n - 1 ? last : bars[i]!.c);
      const up = last >= (seen[0] ?? bars[0]!).o;
      const color = up ? PALETTE.up : PALETTE.down;

      // Where a moment in time falls on the bars, which skip the stretches nothing traded.
      const xAt = (t: number) => {
        if (t <= bars[0]!.t) return x(0);
        if (t >= bars[n - 1]!.t) return x(n - 1) + Math.min(step, ((t - bars[n - 1]!.t) / interval) * step);
        let a = 0;
        let z = n - 1;
        while (a < z - 1) {
          const mid = (a + z) >> 1;
          if (bars[mid]!.t <= t) a = mid;
          else z = mid;
        }
        return x(a) + ((t - bars[a]!.t) / (bars[z]!.t - bars[a]!.t || 1)) * (x(z) - x(a));
      };

      // The scale: four figures down the right edge, with the levels they mark faint across the plot.
      const said = new Set<string>();
      for (let k = 0; k <= GRID; k++) {
        const p = lo + ((hi - lo) * k) / GRID;
        const text = label(p);
        const py = Math.round(y(p)) + 0.5;
        g.strokeStyle = rgba(PALETTE.ink, 0.035);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(0, py);
        g.lineTo(plot, py);
        g.stroke();
        // Nothing costs less than nothing: dragged below zero, the scale goes quiet instead of counting up again.
        if (p < 0) continue;
        // The live price has its own tag on the scale, so a figure right behind it would only blur it.
        if (said.has(text) || Math.abs(py - y(last)) < 12) continue;
        said.add(text);
        g.fillStyle = rgba(PALETTE.muted);
        g.textAlign = 'left';
        g.fillText(text, plot + 8, py);
      }
      // With zero on screen, its line and a 0 on the scale show where the bottom is.
      if (lo < 0 && hi > 0) {
        const py = Math.round(y(0)) + 0.5;
        g.strokeStyle = rgba(PALETTE.ink, 0.14);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(0, py);
        g.lineTo(plot, py);
        g.stroke();
        if (Math.abs(py - y(last)) >= 12) {
          g.fillStyle = rgba(PALETTE.muted);
          g.textAlign = 'left';
          g.fillText('0', plot + 8, py);
        }
      }

      // The time axis: a label every hundred pixels or so, on round times, so they stay with their bars as the chart moves and fills.
      g.textAlign = 'center';
      let lastDay = '';
      let lastLabel = -Infinity;
      const timeLabel = (i: number) => {
        const px = x(i);
        if (px < 24 || px > plot - 24 || px - lastLabel < 64) return;
        lastLabel = px;
        // On second-sized candles a faint line goes with each label, which is what shows the clock moving when the price doesn't.
        if (realtime) {
          g.fillStyle = rgba(PALETTE.ink, 0.035);
          g.fillRect(Math.round(px), 0, 1, foot);
        }
        const d = new Date(bars[i]!.t * 1000);
        const day = d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
        const text = day !== lastDay && lastDay !== '' ? day : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...(interval < 60 ? { second: '2-digit' } : {}) });
        lastDay = day;
        g.fillStyle = rgba(PALETTE.muted);
        g.fillText(text, px, h - TIME / 2);
      };
      const axis = (a: number, z: number, barPx: number) => {
        const wanted = Math.max(1, Math.ceil(100 / barPx)) * interval;
        const every = (LABEL_STEPS.find((s) => s >= wanted && s % interval === 0) ?? Math.ceil(wanted / interval) * interval) / interval;
        // Older than the filled stretch the bars skip time, so there they're picked by position.
        for (let i = Math.ceil(a / every) * every; i < liveFrom && i <= z; i += every) timeLabel(i);
        const from = Math.max(liveFrom, a);
        if (from > z) return;
        const past = Math.round(bars[from]!.t / interval) % every;
        for (let i = from + (every - past) % every; i <= z; i += every) timeLabel(i);
      };
      if (zoned) {
        // The pressed part always says when the history starts, whether or not a round time falls inside it.
        const startedAt = new Date(bars[0]!.t * 1000);
        lastDay = startedAt.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
        lastLabel = 34;
        g.fillStyle = rgba(PALETTE.muted);
        g.fillText(startedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), 34, h - TIME / 2);
        axis(0, split - 1, leftStep);
        axis(split, lastIdx, step);
        g.fillStyle = rgba(PALETTE.ink, 0.08);
        g.fillRect(Math.round(4 + leftW), 0, 1, foot);
      } else axis(first, lastIdx, step);

      // Everything of the history itself stays inside the plot.
      g.save();
      g.beginPath();
      g.rect(0, 0, plot, foot);
      g.clip();

      // The heatmap: what rested at each price and for how long, as one soft field behind the candles. Dark where little waited,
      // bright where a lot did. Which side of the price it sits on says whether it's buys or sells.
      if (book?.length) {
        // The last bar's time keeps it in step with the clock, about once a second on second-sized candles rather than every frame.
        const key = `${heatStyle}|${lo}|${hi}|${realtime ? Math.round(start) : start}|${realtime ? Math.round(v.span) : v.span}|${plot}|${priceH}|${bars[n - 1]!.t}|${zoned ? Math.floor((rt.current?.frac ?? 0) * 4) : ''}`;
        if (heat?.key !== key) heat = buildHeat(book, heatStyle, key, plot, priceH, lo, hi, y, xAt);
      } else heat = null;
      const pointerNow = drag.current ? null : hover.current;
      let bandHits: HeatSegment[] = [];
      if (heat && pointerNow && pointerNow.x >= 0 && pointerNow.x <= plot && pointerNow.y <= priceH && describeBand) {
        const near = heat.segments.filter((s) => Math.abs(s.py - pointerNow.y) <= 8 && pointerNow.x >= s.xa - 3 && pointerNow.x <= s.xb + 3);
        if (near.length) {
          const closest = near.reduce((a, b) => (Math.abs(b.py - pointerNow.y) < Math.abs(a.py - pointerNow.y) ? b : a));
          bandHits = near.filter((s) => Math.abs(s.py - closest.py) <= 3);
        }
      }
      if (heat?.images.length) {
        g.save();
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        // With a band picked out, the rest steps back.
        if (bandHits.length) g.globalAlpha = 0.4;
        for (const image of heat.images) g.drawImage(image, 0, 0, heat.width, heat.height);
        g.restore();
      }

      // Volume at the foot, each bar the colour of its candle, on a square-root scale so one burst doesn't flatten the rest.
      let vmaxRaw = 1e-18;
      for (const b of cols) if (b.v > vmaxRaw) vmaxRaw = b.v;
      const vmax = Math.sqrt(vmaxRaw);
      const base = foot - 2;
      const vh = foot * VOL;
      for (const b of cols) {
        if (b.v <= 0) continue;
        const bh = Math.max(1, (Math.sqrt(b.v) / vmax) * vh);
        const bw = barWidth(colStepAt(b));
        g.fillStyle = rgba(b.c >= b.o ? PALETTE.up : PALETTE.down, 0.28);
        g.fillRect(x(b.i) - bw / 2, base - bh, bw, bh);
      }

      g.save();
      g.beginPath();
      g.rect(0, 0, plot, priceH + 2);
      g.clip();
      if (mode === 'candles') {
        for (const b of cols) {
          const bw = Math.max(1, Math.min(MAX_BAR, colStepAt(b) * 0.68));
          const col = rgba(b.c >= b.o ? PALETTE.up : PALETTE.down);
          const cx = Math.round(x(b.i)) + 0.5;
          g.strokeStyle = col;
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(cx, y(b.h));
          g.lineTo(cx, y(b.l));
          g.stroke();
          const top = y(Math.max(b.o, b.c));
          const bot = y(Math.min(b.o, b.c));
          g.fillStyle = col;
          g.fillRect(cx - bw / 2, top, bw, Math.max(1, bot - top));
        }
      } else {
        // One bar either side of the window, so the line runs to both edges.
        const a = Math.max(0, first - 1);
        const z = Math.min(n - 1, lastIdx + 1);
        const grad = g.createLinearGradient(0, 0, 0, priceH);
        grad.addColorStop(0, rgba(PALETTE.accent, 0.16));
        grad.addColorStop(1, rgba(PALETTE.accent, 0));
        const tail = rt.current && z === n - 1;
        const points = cut(a, z);
        const trace = () => {
          points.forEach((p, k) => {
            const px = x(p.i);
            const end = at_(p.end);
            if (k === 0) g.moveTo(px, y(end));
            else {
              // A column of many bars runs through their whole range, so a spike doesn't vanish between two pixels.
              if (p.hc !== p.lc) {
                g.lineTo(px, y(p.lc));
                g.lineTo(px, y(p.hc));
              }
              g.lineTo(px, y(end));
            }
          });
        };
        g.beginPath();
        trace();
        if (tail) g.lineTo(tipX, y(last));
        g.lineTo(tail ? tipX : x(points[points.length - 1]!.i), priceH);
        g.lineTo(x(points[0]!.i), priceH);
        g.closePath();
        g.fillStyle = grad;
        g.fill();
        g.beginPath();
        trace();
        if (tail) g.lineTo(tipX, y(last));
        g.strokeStyle = rgba(PALETTE.accent);
        g.lineWidth = 2;
        g.lineJoin = 'round';
        g.stroke();
      }
      // Indicators through the same columns and x mapping as the bars, so they follow both zones and every zoom.
      const on = indRef.current;
      const anyOn = !!on && (on.sma || on.ema || on.vwap);
      if (anyOn) {
        indicate();
        g.lineWidth = 1.25;
        g.lineJoin = 'round';
        for (const k of INDICATOR_KEYS) {
          if (!on[k]) continue;
          const style = INDICATOR_STYLE[k];
          g.strokeStyle = style.color;
          g.setLineDash(style.dash);
          g.beginPath();
          traceSeries(g, k === 'sma' ? ind.sma : k === 'ema' ? ind.emaS : ind.vwap, cols, x, y, first, lastIdx, n);
          g.stroke();
        }
        g.setLineDash([]);
      }
      g.restore();

      // Moves on the last candle that opened at or before each: buys under the candle, sells over it, one badge per candle,
      // kind and wallet, stacked so none hides another.
      badges.current = [];
      if (marks?.length) {
        const groups = new Map<string, Badge>();
        for (const m of marks) {
          if (m.t < bars[0]!.t) continue;
          const a = barAt(barTimes.current, m.t);
          if (a < first || a > lastIdx) continue;
          const key = `${a}-${m.who}-${m.name ?? ''}-${m.kind}`;
          const b = groups.get(key) ?? { i: a, key, items: [], x: 0, y: 0, w: 0 };
          b.items.push(m);
          groups.set(key, b);
        }
        const rank = { dev: 0, you: 1, tracked: 2 };
        const placed = [...groups.values()].sort((p, q) => rank[p.items[0]!.who] - rank[q.items[0]!.who]);
        const usedAbove = new Map<number, number>();
        const usedBelow = new Map<number, number>();
        g.font = `700 11px ${FONT}`;
        for (const b of placed) {
          const m = b.items[0]!;
          const bar = bars[b.i]!;
          const high = mode === 'candles' ? bar.h : bar.c;
          const low = mode === 'candles' ? bar.l : bar.c;
          const under = m.kind === 'buy';
          const used = under ? (usedBelow.get(b.i) ?? 0) : (usedAbove.get(b.i) ?? 0);
          const cy = under ? Math.min(priceH - 9, y(low) + 13 + used * 18) : Math.max(9, y(high) - 13 - used * 18);
          (under ? usedBelow : usedAbove).set(b.i, used + 1);
          const name = m.who === 'you' ? 'You' : m.who === 'tracked' ? (m.tag ?? '?') : BADGE_TEXT[m.kind];
          const text = name + (b.items.length > 1 ? ` ${b.items.length}` : '');
          const bw = Math.max(16, g.measureText(text).width + 10);
          b.x = x(b.i);
          b.y = cy;
          b.w = bw;
          const buy = m.kind === 'buy';
          const sell = m.kind === 'sell';
          // The creator's marks are solid, so they stand out. Yours are yellow. A followed wallet's are outlined in its direction.
          if (m.who === 'dev') g.fillStyle = buy ? rgba(PALETTE.up) : sell ? rgba(PALETTE.down) : m.kind === 'burn' ? rgba(PALETTE.accent) : rgba(PALETTE.muted);
          else if (m.who === 'you') g.fillStyle = rgba(PALETTE.accent);
          else g.fillStyle = rgba(PALETTE.card2);
          g.beginPath();
          g.roundRect(b.x - bw / 2, cy - 8, bw, 16, 8);
          g.fill();
          if (m.who === 'tracked') {
            g.strokeStyle = rgba(buy ? PALETTE.up : sell ? PALETTE.down : PALETTE.muted);
            g.lineWidth = 1;
            g.stroke();
          }
          g.fillStyle = m.who === 'tracked' ? rgba(PALETTE.ink) : '#000';
          g.textAlign = 'center';
          g.fillText(text, b.x, cy + 0.5);
          badges.current.push(b);
        }
        g.font = `500 12px ${FONT}`;
      }

      // Levels across the chart, each with its name at the left edge.
      const named: number[] = [];
      for (const level of levels ?? []) {
        const ly_ = Math.round(y(level.price)) + 0.5;
        if (ly_ < 0 || ly_ > priceH) continue;
        g.setLineDash(level.tone === 'quiet' ? [2, 5] : [6, 5]);
        g.strokeStyle = level.tone === 'order' ? rgba(PALETTE.accent, 0.8) : level.tone === 'entry' ? rgba(PALETTE.ink, 0.5) : rgba(PALETTE.ink, 0.25);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(0, ly_);
        g.lineTo(plot, ly_);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = level.tone === 'order' ? rgba(PALETTE.accent) : rgba(PALETTE.muted);
        g.textAlign = 'left';
        let labelY = ly_ - 9;
        while (named.some((n) => Math.abs(n - labelY) < 13)) labelY -= 13;
        named.push(labelY);
        // On a dark plate, so a candle passing behind it doesn't eat the words.
        const textY = Math.max(10, labelY);
        const plate = g.measureText(level.label).width + 10;
        const ink = g.fillStyle;
        g.fillStyle = rgba(PALETTE.card, 0.88);
        g.beginPath();
        g.roundRect(EDGE, textY - 9, plate, 18, 5);
        g.fill();
        g.fillStyle = ink;
        g.fillText(level.label, EDGE + 5, textY);
      }

      // Lines drawn by hand, solid across the plot. The one under the pointer or selected is brighter and has its remove button.
      const pointerAt = drag.current ? null : hover.current;
      const draft = lineDraft.current;
      let hotLine: string | null = draft?.id ?? null;
      if (!hotLine && pointerAt && pointerAt.y <= priceH + LINE_GRAB && onLinesRef.current) {
        let bestD = LINE_GRAB + 1;
        for (const l of linesRef.current) {
          const d = Math.abs(y(l.price) - pointerAt.y);
          if (d < bestD && (pointerAt.x <= plot || d <= 10)) {
            hotLine = l.id;
            bestD = d;
          }
        }
      }
      for (const l of linesRef.current) {
        const price = draft?.id === l.id ? draft.price : l.price;
        const py = Math.round(y(price)) + 0.5;
        if (py < 0 || py > priceH) continue;
        const lit = l.id === hotLine || l.id === selectedLine.current;
        g.strokeStyle = rgba(PALETTE.ink, lit ? 0.9 : 0.5);
        g.lineWidth = lit ? 1.5 : 1;
        g.beginPath();
        g.moveTo(0, py);
        g.lineTo(plot, py);
        g.stroke();
        if (lit && onLinesRef.current) {
          const bx = plot - LINE_X - 4;
          g.fillStyle = rgba(PALETTE.card2);
          g.beginPath();
          g.roundRect(bx, py - LINE_X / 2, LINE_X, LINE_X, 4);
          g.fill();
          g.strokeStyle = rgba(PALETTE.ink, 0.85);
          g.lineWidth = 1.25;
          g.beginPath();
          g.moveTo(bx + 5, py - 3);
          g.lineTo(bx + LINE_X - 5, py + 3);
          g.moveTo(bx + LINE_X - 5, py - 3);
          g.lineTo(bx + 5, py + 3);
          g.stroke();
        }
      }

      // What each indicator stands at now, in its colour, along the top of the plot.
      if (anyOn) {
        g.font = `500 11px ${FONT}`;
        g.textAlign = 'left';
        let lx = EDGE + 4;
        for (const k of INDICATOR_KEYS) {
          if (!on[k]) continue;
          const value = (k === 'sma' ? ind.sma : k === 'ema' ? ind.emaS : ind.vwap)[n - 1];
          const text = value !== undefined && value === value ? `${INDICATOR_STYLE[k].name} ${label(value)}` : INDICATOR_STYLE[k].name;
          const tw = g.measureText(text).width;
          g.fillStyle = rgba(PALETTE.card, 0.8);
          g.fillRect(lx - 3, 3, tw + 6, 16);
          g.fillStyle = INDICATOR_STYLE[k].color;
          g.fillText(text, lx, 11.5);
          lx += tw + 14;
        }
        g.font = `500 12px ${FONT}`;
      }

      // Limit orders that are off the top or bottom of the view, so they aren't forgotten.
      if (heat && (heat.above || heat.below)) {
        g.font = `500 12px ${FONT}`;
        g.fillStyle = rgba(PALETTE.accent, 0.85);
        g.textAlign = 'right';
        if (heat.above) g.fillText(`${heat.above} ${heat.above === 1 ? 'order' : 'orders'} above`, plot - 8, 12);
        if (heat.below) g.fillText(`${heat.below} ${heat.below === 1 ? 'order' : 'orders'} below`, plot - 8, priceH - 8);
      }

      // Beams draw only what waits now. With nothing waiting but past orders in the book, say so, or it looks like they went missing.
      if (heatStyle === 'beams' && book?.length && !book.some((o) => o.end === null && o.left_zro > 0)) {
        g.font = `500 12px ${FONT}`;
        g.fillStyle = rgba(PALETTE.ink, 0.55);
        g.textAlign = 'right';
        g.fillText(plot > 520 ? 'The heatmap shows orders waiting now, and none are' : 'No orders waiting now', plot - 8, 12);
      }

      // The band under the pointer, lit along its whole length, from nothing at its start to nothing at its end.
      for (const s of bandHits) {
        const py = Math.round(s.py) + 0.5;
        const span = Math.max(1, s.xb - s.xa);
        const edge = Math.min(0.45, HEAT_FADE / span);
        const hot = lightOf(s.order);
        const light = g.createLinearGradient(s.xa, 0, s.xb, 0);
        light.addColorStop(0, rgba(hot, 0));
        light.addColorStop(edge, rgba(hot, 1));
        light.addColorStop(1 - edge, rgba(hot, 1));
        light.addColorStop(1, rgba(hot, 0));
        g.save();
        g.shadowColor = rgba(hot, 0.9);
        g.shadowBlur = 16;
        g.strokeStyle = light;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(s.xa, py);
        g.lineTo(s.xb, py);
        g.stroke();
        g.restore();
      }

      const ly = Math.round(y(last)) + 0.5;
      g.setLineDash([3, 4]);
      g.strokeStyle = rgba(color, 0.5);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(Math.min(plot, Math.max(0, tipX)), ly);
      g.lineTo(plot, ly);
      g.stroke();
      g.setLineDash([]);
      if (mode === 'line' && tipX <= plot) {
        g.fillStyle = rgba(PALETTE.accent);
        g.beginPath();
        g.arc(tipX, y(last), 3.5, 0, Math.PI * 2);
        g.fill();
      }

      const at = drag.current ? null : hover.current;
      const zone = at ? zoneOf(at, plot, h) : 'plot';
      // A badge under the pointer opens its tooltip; anywhere else closes it.
      const hit = at ? badges.current.find((b) => Math.abs(at.x - b.x) <= b.w / 2 + 2 && Math.abs(at.y - b.y) <= 10) : undefined;
      const key = hit ? hit.key : '';
      if (key !== tipKey.current) {
        tipKey.current = key;
        setTip(
          hit && describe
            ? {
                x: hit.x,
                y: hit.y,
                below: hit.y < 120,
                side: hit.x < 130 ? 'left' : hit.x > plot - 130 ? 'right' : 'mid',
                rows: hit.items.slice(-6).map((m) => describe(m, bars[hit.i]!.c)),
              }
            : undefined,
        );
      }

      // The strips that stretch the chart show themselves when the pointer is on them.
      if (at && zone === 'edge') {
        g.fillStyle = rgba(PALETTE.ink, 0.05);
        g.fillRect(0, 0, EDGE, foot);
      }

      let card: HoverCard | null = null;
      let cardX = 0;
      let cardY = 0;
      if (at && at.x >= 0 && at.x <= plot && at.y <= foot) {
        const under = start + (at.x - 4) / step - 0.5;
        const pos = zoned ? (at.x >= 4 + leftW ? tipAt - (4 + plotW - at.x) / step + LIVE_ROOM - 0.5 : ((at.x - 4) / leftW) * (joint + 1.5) - 1.5) : under >= liveFrom ? under + shift : under;
        const i = Math.max(0, Math.min(n - 1, Math.round(pos)));
        const b = bars[i]!;
        const i0 = Math.max(0, Math.min(n - 2, Math.floor(pos)));
        const t = Math.max(0, Math.min(1, pos - i0));
        const between = bars[i0]!.c + (bars[Math.min(n - 1, i0 + 1)]!.c - bars[i0]!.c) * t;
        const inPrice = at.y <= priceH;
        const bh = Math.max(1, (Math.sqrt(b.v) / vmax) * vh);

        // A bar answers only with the pointer on it. The slack is for wicks and thin bars, too narrow to hit exactly.
        const onColumn = Math.abs(at.x - x(i)) <= Math.max(barWidth(step) / 2 + 2, Math.min(step / 2, 5));
        const onVolume = !inPrice && onColumn && at.y >= base - bh - 3;
        // On a heatmap band, the band is what's being read.
        const bandCard = bandHits.length && describeBand ? describeBand(bandHits) : null;
        const onCandle = !bandCard && mode === 'candles' && inPrice && onColumn && at.y >= y(b.h) - 5 && at.y <= y(b.l) + 5;
        const onLine = !bandCard && mode === 'line' && inPrice && pos >= 0 && pos <= n - 1 && Math.abs(at.y - y(between)) <= 12;

        if (onCandle || onLine || onVolume) {
          g.fillStyle = rgba(PALETTE.ink, 0.035);
          const band = Math.min(step, MAX_BAR + 8);
          g.fillRect(x(i) - band / 2, 0, band, foot);
          g.fillStyle = rgba(b.c >= b.o ? PALETTE.up : PALETTE.down, 0.8);
          g.fillRect(x(i) - barWidth(step) / 2, base - bh, barWidth(step), bh);
        }

        g.strokeStyle = rgba(PALETTE.ink, 0.28);
        g.lineWidth = 1;
        g.setLineDash([4, 4]);
        g.beginPath();
        g.moveTo(Math.round(at.x) + 0.5, 0);
        g.lineTo(Math.round(at.x) + 0.5, foot);
        if (inPrice) {
          g.moveTo(0, Math.round(at.y) + 0.5);
          g.lineTo(plot, Math.round(at.y) + 0.5);
        }
        g.stroke();
        g.setLineDash([]);
        if (onLine) {
          g.fillStyle = rgba(PALETTE.ink);
          g.beginPath();
          g.arc(at.x, y(between), 3.5, 0, Math.PI * 2);
          g.fill();
        }
        g.restore();

        const tone: Tone = b.c >= b.o ? 'up' : 'down';
        if (bandCard) {
          card = bandCard;
          cardX = at.x;
          cardY = bandHits[0]!.py;
        } else if (onCandle) {
          const change = b.o > 0 ? b.c / b.o - 1 : 0;
          card = {
            title: when(b.t, interval < 60),
            rows: [
              { k: 'Open', v: label(b.o) },
              { k: 'High', v: label(b.h) },
              { k: 'Low', v: label(b.l) },
              { k: 'Close', v: label(b.c), tone },
              { k: 'Change', v: `${change >= 0 ? '+' : ''}${(change * 100).toFixed(Math.abs(change) >= 1 ? 0 : 2)}%`, tone },
              { k: 'Volume', v: volume(b.v) },
            ],
          };
          cardX = x(i);
          cardY = y(b.c);
        } else if (onLine) {
          card = { title: when(b.t, interval < 60), rows: [{ k: valueName, v: label(between), tone }, { k: 'Volume', v: volume(b.v) }] };
          cardX = at.x;
          cardY = y(between);
        }
        if (onVolume) volBubble(g, x(i), base - bh, `Vol ${volume(b.v)}`, plot, rgba(b.c >= b.o ? PALETTE.up : PALETTE.down));
        if (bandHits.length) tag(g, label(bandHits[0]!.order.price), plot + 3, bandHits[0]!.py, AXIS - 5, rgba(lightOf(bandHits[0]!.order)), '#000');
        else if (inPrice) {
          const level = Math.max(0, lo + (1 - (at.y - PAD) / (priceH - PAD)) * (hi - lo));
          tag(g, label(level), plot + 3, at.y, AXIS - 5, rgba(PALETTE.card2), rgba(PALETTE.ink));
        }
        // The time under the pointer, on the time axis, counted on past either end of the bars.
        const pointerTime = pos > n - 1 ? bars[n - 1]!.t + Math.round(pos - (n - 1)) * interval : pos < 0 ? bars[0]!.t + Math.round(pos) * interval : b.t;
        timeTag(g, when(pointerTime, interval < 60), Math.round(at.x), h, plot);
      } else {
        g.restore();
        if (at && zone === 'price' && at.y <= priceH) {
          // On the scale: this is where a click puts a limit order.
          g.strokeStyle = rgba(PALETTE.accent, 0.6);
          g.setLineDash([4, 4]);
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(0, Math.round(at.y) + 0.5);
          g.lineTo(plot, Math.round(at.y) + 0.5);
          g.stroke();
          g.setLineDash([]);
          const level = Math.max(0, lo + (1 - (at.y - PAD) / (priceH - PAD)) * (hi - lo));
          const drawing = toolRef.current === 'line';
          if (onPick || drawing) {
            g.font = `500 12px ${FONT}`;
            const hint = drawing ? 'Click to add a line, drag to stretch' : 'Click for a limit order, drag to stretch';
            const hw = g.measureText(hint).width + 14;
            g.fillStyle = rgba(PALETTE.card2);
            g.beginPath();
            g.roundRect(plot - hw - 6, at.y - 10, hw, 20, 5);
            g.fill();
            g.fillStyle = rgba(PALETTE.muted);
            g.textAlign = 'left';
            g.fillText(hint, plot - hw + 1, at.y + 0.5);
          }
          tag(g, label(level), plot + 3, at.y, AXIS - 5, rgba(PALETTE.accent), '#000');
        }
      }

      showCard(hit ? null : card, cardX, cardY);

      if (at && zone === 'time') {
        g.fillStyle = rgba(PALETTE.ink, 0.04);
        g.fillRect(0, foot, plot, TIME);
      }

      if (entry) tag(g, label(entry), plot + 3, Math.round(y(entry)) + 0.5, AXIS - 5, rgba(PALETTE.card2), rgba(PALETTE.ink));
      for (const level of levels ?? []) {
        if (level.tone !== 'order') continue;
        const py = Math.round(y(level.price)) + 0.5;
        if (py > 0 && py < priceH) tag(g, label(level.price), plot + 3, py, AXIS - 5, rgba(PALETTE.accent, 0.9), '#000');
      }
      for (const l of linesRef.current) {
        const price = draft?.id === l.id ? draft.price : l.price;
        const py = Math.round(y(price)) + 0.5;
        const lit = l.id === hotLine || l.id === selectedLine.current;
        if (py > 0 && py < priceH) tag(g, label(price), plot + 3, py, AXIS - 5, rgba(PALETTE.ink, lit ? 0.95 : 0.75), '#000');
      }
      if (ly > 0 && ly < priceH) tag(g, label(last), plot + 3, ly, AXIS - 5, rgba(color), '#000');
    };
    draw.current();

    // On second-sized candles the chart redraws every frame, and the tip eases to the latest trade's price. On the others it only
    // has to notice a new candle starting.
    let raf = 0;
    let clock: ReturnType<typeof setInterval> | undefined;
    if (bars.length) {
      if (realtime) {
        const tick = () => {
          roll();
          const st = rt.current;
          const c = bars[bars.length - 1]!.c;
          if (st) st.shown = st.shown === null ? c : st.shown + (c - st.shown) * 0.16;
          draw.current();
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } else {
        clock = setInterval(() => {
          const was = bars.length;
          roll();
          if (bars.length !== was) draw.current();
        }, 1000);
      }
    }
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(clock);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, interval, live, label, mode, entry, volume, marks, describe, book, heatStyle, levels, describeBand, valueName, resetKey, onPick]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ro = new ResizeObserver(() => draw.current());
    ro.observe(c);
    // The wheel zooms the chart, not the page, so it's taken before the page can scroll.
    const wheel = (e: WheelEvent) => {
      const n = count.current;
      if (n < 1) return;
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const { step, plot, lo, hi } = drawn.current;
      const v = view.current ?? fit(n);
      const px = e.clientX - r.left;
      // Over the price scale the wheel stretches the price, around the middle of what's on screen.
      if (px > plot) {
        const mid = ((v.hi ?? hi) + (v.lo ?? lo)) / 2;
        const half = (((v.hi ?? hi) - (v.lo ?? lo)) / 2) * Math.exp(e.deltaY * 0.0015);
        view.current = { ...v, lo: mid - half, hi: mid + half };
        setMoved(true);
        redraw();
        return;
      }
      // A sideways swipe on a trackpad moves through time.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        view.current = clampView({ ...v, end: v.end + e.deltaX / step }, n);
        setMoved(true);
        redraw();
        return;
      }
      const at = Math.min(plot, Math.max(0, px));
      const under = v.end - v.span + (at - 4) / step;
      const span = Math.max(MIN_BARS, Math.min(n * 2, v.span * Math.exp(e.deltaY * 0.0015)));
      // Keep the bar under the pointer where it is. On second-sized candles with the newest bar in view, zoom keeps that bar in view
      // instead, or the chart would stop moving with the clock for no reason anyone could see.
      const live = rt.current;
      const end = live && v.end >= n - 1 + live.grow ? v.end : under + (v.span - (at - 4) / step) * (span / v.span);
      view.current = clampView({ ...v, span, end }, n);
      setMoved(true);
      redraw();
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => {
      ro.disconnect();
      c.removeEventListener('wheel', wheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const n = count.current;
    if (n < 1 || e.button !== 0) return;
    const p = point(e);
    const v = view.current ?? fit(n);
    // A drawn line under the pointer is taken before anything else: its remove button, or the line itself to move it.
    const chosen = linesRef.current.find((l) => l.id === selectedLine.current);
    const grabbed = chosen && onLineX(p, chosen) ? chosen : lineAt(p);
    // Without a mouse nothing hovers, so the button is only there once the line is selected.
    if (grabbed && onLineX(p, grabbed) && (e.pointerType === 'mouse' || grabbed.id === selectedLine.current)) {
      removeLine(grabbed.id);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const zone = zoneOf(p, drawn.current.plot, drawn.current.height);
    e.currentTarget.style.cursor = grabbed ? 'ns-resize' : cursorOf(zone) || (toolRef.current ? 'crosshair' : 'grabbing');
    drag.current = { x: p.x, y: p.y, view: { ...v, lo: v.lo ?? drawn.current.lo, hi: v.hi ?? drawn.current.hi }, zone, moved: false, line: grabbed?.id };
  };

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const hit = lineAt({ x: e.clientX - r.left, y: e.clientY - r.top });
    if (!hit) return;
    e.preventDefault();
    removeLine(hit.id);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = point(e);
    if (!drag.current) {
      const zone = zoneOf(p, drawn.current.plot, drawn.current.height);
      const near = count.current > 0 ? lineAt(p) : null;
      e.currentTarget.style.cursor = near ? (onLineX(p, near) ? 'pointer' : 'ns-resize') : toolRef.current && zone === 'plot' ? 'crosshair' : cursorOf(zone);
    }
    hover.current = count.current > 0 ? p : null;
    const d = drag.current;
    if (d?.line) {
      if (Math.abs(p.y - d.y) > 2) d.moved = true;
      if (d.moved) lineDraft.current = { id: d.line, price: Math.max(0, priceAtY(Math.min(drawn.current.priceH, Math.max(0, p.y)))) };
    } else if (d) {
      const { step, priceH, plot } = drawn.current;
      const n = count.current;
      const range = d.view.hi! - d.view.lo!;
      const dx = p.x - d.x;
      const dy = p.y - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
      if (d.zone === 'price') {
        // On the scale: drag up to stretch the price range, down to squeeze it, about its middle.
        const mid = (d.view.hi! + d.view.lo!) / 2;
        const half = (range / 2) * Math.exp(dy * 0.008);
        view.current = { ...d.view, lo: mid - half, hi: mid + half };
      } else if (d.zone === 'time' || d.zone === 'edge') {
        // On the time axis, the side you grabbed follows the pointer and the other side stays put. The strip on the left edge
        // does the same for the left side, and up and down stretches the price as the scale does.
        const fromLeft = d.zone === 'edge' || d.x < plot / 2;
        let span: number;
        let end: number;
        if (fromLeft) {
          const before = Math.max(12, plot - d.x);
          const after = Math.max(12, plot - p.x);
          span = d.view.span * (before / after);
          end = d.view.end;
        } else {
          const start = d.view.end - d.view.span;
          span = d.view.span * (Math.max(12, d.x) / Math.max(12, p.x));
          end = start + span;
        }
        const next: View = { ...d.view, span, end };
        if (d.zone === 'edge') {
          const mid = (d.view.hi! + d.view.lo!) / 2;
          const half = (range / 2) * Math.exp(dy * 0.008);
          next.lo = mid - half;
          next.hi = mid + half;
        }
        view.current = clampView(next, n);
      } else {
        const perPx = range / Math.max(1, priceH - PAD);
        view.current = clampView({ ...d.view, end: d.view.end - dx / step, lo: d.view.lo! + dy * perPx, hi: d.view.hi! + dy * perPx }, n);
      }
      if (d.moved) setMoved(true);
    }
    redraw();
  };

  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    e.currentTarget.style.cursor = '';
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const cancelled = e.type === 'pointercancel';
    const draft = lineDraft.current;
    lineDraft.current = null;
    if (d?.line) {
      if (draft && !cancelled) {
        selectedLine.current = draft.id;
        onLinesRef.current?.(linesRef.current.map((l) => (l.id === draft.id ? draft : l)));
      } else if (!d.moved && !cancelled) {
        const line = linesRef.current.find((l) => l.id === d.line);
        // A click on a line's tag on the scale still picks that level for a limit order; on the plot it selects the line.
        if (d.zone === 'price' && onPick && line && !toolRef.current) {
          clearTimeout(pickTimer.current);
          pickTimer.current = setTimeout(() => onPick(line.price), 230);
        } else selectedLine.current = selectedLine.current === d.line ? null : d.line;
      }
      redraw();
      return;
    }
    const p = point(e);
    if (d && !d.moved && !cancelled && toolRef.current === 'line' && (d.zone === 'plot' || d.zone === 'price') && p.y <= drawn.current.priceH) {
      // Waits out a double click, which fits the view and shouldn't leave two lines behind.
      const price = priceAtY(p.y);
      clearTimeout(addTimer.current);
      if (price > 0) {
        addTimer.current = setTimeout(() => {
          const line = { id: lineId(), price };
          selectedLine.current = line.id;
          onLinesRef.current?.([...linesRef.current, line]);
        }, 230);
      }
    } else if (d && !d.moved && !cancelled && d.zone === 'plot') {
      selectedLine.current = null;
    } else if (d && !d.moved && d.zone === 'price' && onPick) {
      // A click on the scale, not a drag: that's a level picked.
      const { lo, hi, priceH } = drawn.current;
      if (p.y <= priceH) {
        const level = lo + (1 - (p.y - PAD) / (priceH - PAD)) * (hi - lo);
        // Below zero there's no level to order at.
        if (level > 0) {
          clearTimeout(pickTimer.current);
          pickTimer.current = setTimeout(() => onPick(level), 230);
        }
      }
    }
    redraw();
  };

  const reset = () => {
    view.current = null;
    setMoved(false);
    redraw();
  };

  // Double click fits everything; on a scale, only that scale.
  const doubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    clearTimeout(pickTimer.current);
    clearTimeout(addTimer.current);
    const r = e.currentTarget.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    const zone = zoneOf(p, drawn.current.plot, drawn.current.height);
    const v = view.current;
    if (!v || zone === 'plot') return reset();
    if (zone === 'price') view.current = { end: v.end, span: v.span };
    else view.current = { ...fit(count.current), lo: v.lo, hi: v.hi };
    redraw();
  };

  const markBars = () => {
    const t = barTimes.current;
    const out: number[] = [];
    for (const m of marks ?? []) {
      if (!t.length || m.t < t[0]!) continue;
      out.push(barAt(t, m.t));
    }
    return out;
  };

  if (api) {
    api.current = {
      reset,
      zoom(factor) {
        const n = count.current;
        if (n < 1) return;
        const v = view.current ?? fit(n);
        // Toward the newest bars, which is where a trader is usually looking.
        view.current = clampView({ ...v, span: v.span * factor }, n);
        setMoved(true);
        redraw();
      },
      marksInView() {
        const n = barTimes.current.length;
        const v = view.current ?? fit(n);
        return markBars().some((i) => i >= v.end - v.span - 0.5 && i <= v.end + 0.5);
      },
      showMarks() {
        const at = markBars();
        const n = barTimes.current.length;
        if (!at.length || !n) return;
        const low = Math.min(...at);
        const high = Math.max(...at);
        const room = Math.max(6, (high - low) * 0.12);
        view.current = clampView({ end: high + room, span: high - low + room * 2 }, n);
        setMoved(true);
        redraw();
      },
      ordersInView() {
        const { lo, hi } = drawn.current;
        return (book ?? []).some((o) => o.end === null && o.price >= lo && o.price <= hi);
      },
      showOrders() {
        const open = (book ?? []).filter((o) => o.end === null);
        if (!open.length) return;
        const { lo, hi } = drawn.current;
        const prices = open.map((o) => o.price);
        const low = Math.min(lo, ...prices);
        const high = Math.max(hi, ...prices);
        if (low === lo && high === hi) return; // all on screen already, so the view stays as it is
        const room = (high - low) * 0.08;
        const n = count.current;
        view.current = { ...(view.current ?? fit(n)), lo: Math.max(0, low - room), hi: high + room };
        setMoved(true);
        redraw();
      },
    };
  }

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={ref}
        className="block h-full w-full"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={doubleClick}
        onContextMenu={onContextMenu}
        onPointerLeave={() => {
          hover.current = null;
          redraw();
        }}
      />
      <div ref={hoverEl} className="chart-card" style={{ display: 'none' }} />
      {tip && (
        <div
          className="chart-card"
          style={{
            left: tip.x,
            top: tip.y,
            transform: `translate(${tip.side === 'mid' ? '-50%' : tip.side === 'left' ? '-12%' : '-88%'}, ${tip.below ? '16px' : 'calc(-100% - 14px)'})`,
          }}
        >
          {tip.rows.map((r, k) => (
            <div key={k} className={k > 0 ? 'chart-card-more' : undefined}>
              <div className={`chart-card-title tone-${r.tone ?? 'ink'}`}>{r.title}</div>
              {r.rows.map((row) => (
                <div key={row.k} className="chart-card-row">
                  <span className="chart-card-k">{row.k}</span>
                  <span className={`chart-card-v tone-${row.tone ?? 'ink'}`}>{row.v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function zoneOf(p: { x: number; y: number }, plot: number, height: number): Zone {
  if (p.x > plot) return 'price';
  if (p.y > height - TIME) return 'time';
  if (p.x < EDGE) return 'edge';
  return 'plot';
}

function cursorOf(zone: Zone): string {
  return zone === 'price' ? 'ns-resize' : zone === 'time' || zone === 'edge' ? 'ew-resize' : '';
}

/** The last bar that opened at or before a moment. */
function barAt(times: number[], t: number): number {
  let a = 0;
  let z = times.length - 1;
  while (a < z) {
    const mid = (a + z + 1) >> 1;
    if (times[mid]! <= t) a = mid;
    else z = mid - 1;
  }
  return a;
}

/** The view before any drag: every bar, or a window of MIN_VIEW bars ending a little past the last one when there are fewer. */
function fitted(n: number): View {
  if (n < MIN_VIEW) return { end: n + 2, span: MIN_VIEW };
  return { end: n + 2, span: n + 2 };
}

const barWidth = (step: number) => Math.max(1, Math.min(MAX_BAR, step * 0.7));

/** What one column of the chart draws: one bar, or `per` of them as one. `i` is where it sits and `end` the last bar in it. */
interface Column extends Bar {
  i: number;
  end: number;
  /** The highest and lowest close inside it, which is what a line runs through. */
  hc: number;
  lc: number;
}

/** Grouped on round indexes, not from the window's edge, so bars keep to the same columns as the view moves. */
function columns(bars: Bar[], from: number, to: number, per: number): Column[] {
  const out: Column[] = [];
  if (from > to) return out;
  if (per <= 1) {
    for (let i = from; i <= to; i++) {
      const b = bars[i]!;
      out.push({ ...b, i, end: i, hc: b.c, lc: b.c });
    }
    return out;
  }
  for (let g = Math.floor(from / per) * per; g <= to; g += per) {
    const a = Math.max(g, from);
    const z = Math.min(g + per - 1, to);
    const head = bars[a]!;
    const col: Column = { ...head, i: (a + z) / 2, end: z, hc: head.c, lc: head.c };
    for (let i = a + 1; i <= z; i++) {
      const b = bars[i]!;
      if (b.h > col.h) col.h = b.h;
      if (b.l < col.l) col.l = b.l;
      if (b.c > col.hc) col.hc = b.c;
      if (b.c < col.lc) col.lc = b.c;
      col.v += b.v;
    }
    col.c = bars[z]!.c;
    out.push(col);
  }
  return out;
}

/**
 * One indicator along the columns on screen, plus a bar either side so it runs to both edges. A column of many bars takes the
 * value at its last bar. Gaps (the warm-up before a series has a value) lift the pen.
 */
function traceSeries(g: CanvasRenderingContext2D, data: number[], cols: Column[], x: (i: number) => number, y: (p: number) => number, first: number, last: number, n: number) {
  let pen = false;
  for (let k = -1; k <= cols.length; k++) {
    const i = k < 0 ? first - 1 : k === cols.length ? last + 1 : cols[k]!.end;
    if (i < 0 || i >= n) continue;
    const v = data[i];
    if (v === undefined || v !== v) {
      pen = false;
      continue;
    }
    const px = x(k < 0 || k === cols.length ? i : cols[k]!.i);
    if (pen) g.lineTo(px, y(v));
    else {
      g.moveTo(px, y(v));
      pen = true;
    }
  }
}

/** Never wider than twice the bars, and never panned so far that no bar is left on screen. */
function clampView(v: View, n: number): View {
  const span = Math.max(MIN_BARS, Math.min(Math.max(n * 2, MIN_VIEW * 1.5), v.span));
  const end = Math.max(Math.min(span, n) * 0.25, Math.min(n + span * RIGHT_ROOM, v.end));
  return { ...v, span, end };
}

/** The card's insides as plain nodes with text set as text, so nothing a token calls itself can become markup. */
function cardNodes(card: HoverCard): HTMLElement[] {
  const node = (className: string, text?: string) => {
    const el = document.createElement('div');
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  return [
    node(`chart-card-title tone-${card.tone ?? 'ink'}`, card.title),
    ...card.rows.map((r) => {
      const row = node('chart-card-row');
      row.append(node('chart-card-k', r.k), node(`chart-card-v tone-${r.tone ?? 'ink'}`, r.v));
      return row;
    }),
  ];
}

/** A bar's volume, just over the bar, centred on it and kept inside the plot. */
function volBubble(g: CanvasRenderingContext2D, cx: number, top: number, text: string, plot: number, colour: string) {
  g.font = `700 12px ${FONT}`;
  const w = g.measureText(text).width + 14;
  const bx = Math.max(2, Math.min(plot - w - 2, cx - w / 2));
  const by = top - 26;
  g.fillStyle = rgba(PALETTE.card2);
  g.beginPath();
  g.roundRect(bx, by, w, 20, 5);
  g.fill();
  g.fillStyle = colour;
  g.textAlign = 'left';
  g.fillText(text, bx + 7, by + 10.5);
  g.font = `500 12px ${FONT}`;
}

/** A figure in a filled box on the scale, the way terminals mark a level. */
function tag(g: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, bg: string, fg: string) {
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(x, y - 10, w, 20, 5);
  g.fill();
  g.fillStyle = fg;
  g.textAlign = 'left';
  g.font = `600 12px ${FONT}`;
  g.fillText(text, x + 5, y + 0.5);
  g.font = `500 12px ${FONT}`;
}

/** The time under the pointer, in a box on the time axis. */
function timeTag(g: CanvasRenderingContext2D, text: string, x: number, height: number, plot: number) {
  g.font = `600 12px ${FONT}`;
  const w = g.measureText(text).width + 12;
  const bx = Math.max(2, Math.min(plot - w - 2, x - w / 2));
  g.fillStyle = rgba(PALETTE.card2);
  g.beginPath();
  g.roundRect(bx, height - TIME + 2, w, TIME - 4, 5);
  g.fill();
  g.fillStyle = rgba(PALETTE.ink);
  g.textAlign = 'left';
  g.fillText(text, bx + 6, height - TIME / 2);
  g.font = `500 12px ${FONT}`;
}

/** A candle's time, to the second on second-sized candles. */
function when(ts: number, seconds = false): string {
  const d = new Date(ts * 1000);
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });
  return Date.now() - d.getTime() > 86_400_000 ? `${d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} ${hm}` : hm;
}
