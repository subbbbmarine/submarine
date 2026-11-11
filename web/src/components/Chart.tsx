'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { get, useLive, useStream, type BookOrder, type Candle, type DevInfo, type TokenDetail, type Trade, type WalletData } from '@/lib/api';
import { CURVE } from '@/lib/config';
import { age, zro, cn, compact, priceText, short, usdText } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { useFormat } from '@/lib/money';
import { useTicket } from '@/lib/selection';
import { nameOf, useTracked } from '@/lib/tracked';
import { useWallet } from '@/lib/wallet';
import { Empty } from './bits';
import { useLines } from '@/lib/drawings';
import { ChartCanvas, INDICATOR_STYLE, isStop, type BandHit, type ChartApi, type ChartMode, type Describe, type DrawTool, type HeatStyle, type HoverCard, type Indicators, type Level, type Mark, type Tone } from './ChartCanvas';

const INTERVALS = [
  { s: 1, label: '1s' },
  { s: 5, label: '5s' },
  { s: 60, label: '1m' },
  { s: 300, label: '5m' },
  { s: 900, label: '15m' },
  { s: 3600, label: '1h' },
  { s: 14400, label: '4h' },
  { s: 86400, label: '1D' },
];
const PREFS = 'terminal.chart.v1';
const NO_CANDLES: Candle[] = [];
const HEAT_SWATCH = 'linear-gradient(90deg, rgb(var(--up)) 34%, rgb(var(--down)) 34% 67%, rgb(255 176 72) 67%)';

interface Prefs {
  interval: number;
  mode: ChartMode;
  axis: 'mcap' | 'price';
  dev: boolean;
  orders: boolean;
  tracked: boolean;
  heat: HeatStyle;
  sma: boolean;
  ema: boolean;
  vwap: boolean;
}
const DEFAULTS: Prefs = { interval: 60, mode: 'candles', axis: 'mcap', dev: true, orders: true, tracked: true, heat: 'beams', sma: false, ema: false, vwap: false };
const INDICATOR_TOGGLES: Array<{ key: keyof Indicators; title: string }> = [
  { key: 'sma', title: 'Simple moving average of the last 20 closes' },
  { key: 'ema', title: 'Exponential moving average of the last 50 closes' },
  { key: 'vwap', title: 'Volume weighted average price over all the history on the chart' },
];

function Segment<T extends string | number>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} className={cn('pill num px-2', value === o.value && 'pill-on')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, title, onClick, children }: { on: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} aria-pressed={on} className={cn('num flex h-[29px] items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2.5 text-[13px] font-medium transition-colors duration-150', on ? 'bg-accent/15 text-accent' : 'text-muted hover:text-ink')}>
      {children}
    </button>
  );
}

const iconButton = 'flex h-7 w-7 items-center justify-center rounded-lg bg-card2/90 text-muted backdrop-blur transition-colors hover:text-ink';

/** A trade from the stream folded into its candle, so the chart moves with the token between reads. */
function fold(cs: Candle[], ts: number, price: number, volume: number, interval: number): Candle[] {
  const at = Math.floor(ts / interval) * interval;
  const last = cs[cs.length - 1];
  if (last && last.t === at) return [...cs.slice(0, -1), { ...last, h: Math.max(last.h, price), l: Math.min(last.l, price), c: price, v: last.v + volume }];
  if (last && last.t > at) return cs;
  const open = last ? last.c : price;
  return [...cs, { t: at, o: open, h: Math.max(open, price), l: Math.min(open, price), c: price, v: volume }];
}

/** The indexer answers this many candles at a time, and the chart reads pages until it has them all. */
const PAGE = 4000;
/** Only to protect the browser from something enormous. At this size the oldest of a very busy token's second candles are left out. */
const MOST_BARS = 200_000;

/** Drawing and indicators, folded into one button so the toolbar stays one row on a narrow chart. */
function Tools({ active, drawing, lines, onDraw, indicators, onIndicator }: {
  active: number;
  drawing: boolean;
  lines: number;
  onDraw: () => void;
  indicators: Array<{ key: string; title: string; on: boolean; name: string; color: string }>;
  onIndicator: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState({ left: 0, top: 0 });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  return (
    <div ref={box} className="relative">
      <Toggle
        on={open || drawing}
        onClick={() => {
          // Placed against the window, since the toolbar scrolls sideways and would clip a menu hanging inside it.
          const r = box.current?.getBoundingClientRect();
          if (r) setSpot({ left: Math.min(r.left, window.innerWidth - 232), top: r.bottom + 6 });
          setOpen((v) => !v);
        }}
        title="Lines and indicators"
      >
        Tools{active > 0 && <span className="font-normal opacity-70">{active}</span>}
      </Toggle>
      {open && (
        <div style={spot} className="panel fixed z-50 w-56 space-y-1 p-2 shadow-[0_14px_40px_rgb(0_0_0_/_.6)]" role="menu">
          <Toggle on={drawing} onClick={() => (onDraw(), setOpen(false))} title="Click the chart or the price scale to add a horizontal line. Drag a line to move it; right click, its x or Delete removes it. Escape stops drawing">
            Draw line{lines > 0 && <span className="font-normal opacity-70">{lines}</span>}
          </Toggle>
          {indicators.map((x) => (
            <Toggle key={x.key} on={x.on} onClick={() => onIndicator(x.key)} title={x.title}>
              <span className="h-0.5 w-3 rounded-full" style={{ background: x.color }} aria-hidden="true" />
              {x.name}
            </Toggle>
          ))}
        </div>
      )}
    </div>
  );
}

/** The intervals folded into one button, for a toolbar too narrow to show all eight. */
function IntervalPick({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState({ left: 0, top: 0 });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  return (
    <div ref={box} className="relative shrink-0">
      <Toggle
        on={open}
        onClick={() => {
          const r = box.current?.getBoundingClientRect();
          if (r) setSpot({ left: Math.min(r.left, window.innerWidth - 200), top: r.bottom + 6 });
          setOpen((v) => !v);
        }}
        title="Candle interval"
      >
        <span className="text-ink">{INTERVALS.find((i) => i.s === value)?.label ?? '1m'}</span>
        <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M2 3.5l3 3 3-3" />
        </svg>
      </Toggle>
      {open && (
        <div style={spot} className="panel fixed z-50 grid w-[184px] grid-cols-4 gap-1 p-1.5 shadow-[0_14px_40px_rgb(0_0_0_/_.6)]" role="menu">
          {INTERVALS.map((i) => (
            <Toggle key={i.s} on={i.s === value} onClick={() => (onChange(i.s), setOpen(false))} title={`${i.label} candles`}>
              {i.label}
            </Toggle>
          ))}
        </div>
      )}
    </div>
  );
}

export function Chart({
  token,
  prefsKey = PREFS,
  trade = true,
}: {
  token: TokenDetail;
  /** Where this chart keeps its settings, so several charts on one page each keep their own. */
  prefsKey?: string;
  /** Off where no trade card is beside the chart: a click on the price scale then doesn't offer a limit order. */
  trade?: boolean;
}) {
  const address = token.address;
  const supply = token.total_supply;
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULTS);
  useEffect(() => {
    try {
      setPrefsState({ ...DEFAULTS, ...(JSON.parse(localStorage.getItem(prefsKey) ?? '{}') as Partial<Prefs>) });
    } catch {}
  }, [prefsKey]);
  const setPrefs = (next: Partial<Prefs>) =>
    setPrefsState((p) => {
      const merged = { ...p, ...next };
      try {
        localStorage.setItem(prefsKey, JSON.stringify(merged));
      } catch {}
      return merged;
    });
  const indicators = useMemo<Indicators>(() => ({ sma: prefs.sma, ema: prefs.ema, vwap: prefs.vwap }), [prefs.sma, prefs.ema, prefs.vwap]);

  // Lines drawn by hand, per token, and the tool that draws them. The tool stays on for several lines until pressed again or Escape.
  const [lines, setLines] = useLines(address);
  const [tool, setTool] = useState<DrawTool>(null);
  useEffect(() => {
    if (!tool) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTool(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool]);

  const { interval, mode, axis } = prefs;
  const { usd, money } = useFormat();
  const now = useNow(5000);
  const me = useWallet((s) => s.account?.address.toLowerCase());
  const list = useTracked();
  const api = useRef<ChartApi | null>(null);
  const [moved, setMoved] = useState(false);

  // The candles: all of them whatever their size, since the size only says how long each one is. The newest come first so the
  // chart is up at once, then the rest of the history page by page, then each trade folded in as it lands, with a slow read of
  // the latest to stay honest.
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loaded, setLoaded] = useState('');
  const key = `${address}:${interval}`;
  useEffect(() => {
    let alive = true;
    setCandles([]);
    setLoaded('');
    const path = `/api/v1/tokens/${address}/candles?interval=${interval}`;
    const readOlder = async (oldest: number) => {
      let at = oldest;
      for (let total = PAGE; alive && total < MOST_BARS; total += PAGE) {
        const { candles: page } = await get<{ candles: Candle[] }>(`${path}&limit=${PAGE}&before=${at}`);
        if (!alive || !page.length) return;
        setCandles((cs) => [...page, ...cs]);
        if (page.length < PAGE) return;
        at = page[0]!.t;
      }
    };
    let first = true;
    const read = () =>
      get<{ candles: Candle[] }>(`${path}&limit=${first ? PAGE : 300}`)
        .then((d) => {
          if (!alive) return;
          const from = d.candles[0]?.t ?? Infinity;
          setCandles((cs) => [...cs.filter((c) => c.t < from), ...d.candles]);
          setLoaded(key);
          if (first && d.candles.length === PAGE) void readOlder(from).catch(() => {});
          first = false;
        })
        .catch(() => {});
    void read();
    const id = setInterval(read, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [address, interval, key]);
  useStream((type, d) => {
    if (type === 'trade' && d.token === address) setCandles((cs) => fold(cs, d.ts, d.price, d.zro, interval));
  });

  const { data: devData } = useLive<DevInfo>(`/api/v1/tokens/${address}/dev`, (t, d) => (t === 'dev' && d.token === address) || (t === 'trade' && d.token === address && d.trader === token.creator), 500);
  const { data: bookData } = useLive<{ orders: BookOrder[] }>(`/api/v1/tokens/${address}/orderbook`, (t) => t === 'order', 400);
  const { data: mineData } = useLive<{ trades: Trade[] }>(me ? `/api/v1/tokens/${address}/trades?trader=${me}&limit=200` : null, (t, d) => t === 'trade' && d.token === address && d.trader === me, 400);
  const followed = list.map((t) => t.address).join(',');
  const { data: trackedData } = useLive<{ trades: Trade[] }>(followed ? `/api/v1/tokens/${address}/trades?traders=${followed}&limit=200` : null, (t, d) => t === 'trade' && d.token === address && followed.includes(d.trader), 500);
  const { data: wallet } = useLive<WalletData>(me ? `/api/v1/wallet/${me}` : null, (t, d) => t === 'trade' && d.token === address && d.trader === me, 600);

  const dev = devData?.creator ? devData : null;
  const book = bookData?.orders;
  const openOrders = useMemo(() => (book ?? []).filter((o) => o.end === null), [book]);
  const depth = openOrders.reduce((s, o) => s + o.left_zro, 0);

  const marks = useMemo<Mark[]>(() => {
    const out: Mark[] = [];
    if (prefs.dev) for (const m of dev?.moves ?? []) out.push({ ...m, who: 'dev' });
    for (const t of mineData?.trades ?? []) out.push({ t: t.ts, kind: t.is_buy ? 'buy' : 'sell', who: 'you', tokens: t.amount, zro: t.zro });
    if (prefs.tracked) {
      for (const t of trackedData?.trades ?? []) {
        if (t.trader === dev?.creator) continue; // the creator's badge already says it
        const named = list.find((x) => x.address === t.trader)?.label;
        out.push({ t: t.ts, kind: t.is_buy ? 'buy' : 'sell', who: 'tracked', name: nameOf(t.trader, list), tag: named ? named.slice(0, 3) : t.trader.slice(-3), tokens: t.amount, zro: t.zro });
      }
    }
    return out;
  }, [dev, mineData, trackedData, prefs.dev, prefs.tracked, list]);

  const label = useCallback(
    (p: number) => {
      const scale = usd ?? 1;
      if (axis === 'price') return `${usd ? '$' : ''}${priceText(p * scale)}`;
      const cap = p * supply * scale;
      return usd ? usdText(cap) : compact(cap);
    },
    [axis, supply, usd],
  );
  const volume = useCallback((v: number) => money(v), [money]);
  // A heatmap band in plain words: how much, on which side, where that is against the price, and whether it's still there.
  const tokenPrice = token.price;
  const describeBand = useCallback(
    (hits: BandHit[]): HoverCard => {
      const buys = hits.filter((h) => h.order.is_buy).reduce((s, h) => s + h.amount, 0);
      const stops = hits.filter((h) => isStop(h.order)).reduce((s, h) => s + h.amount, 0);
      const sells = hits.filter((h) => !h.order.is_buy && !isStop(h.order)).reduce((s, h) => s + h.amount, 0);
      const kinds = [buys, sells, stops].filter((v) => v > 0).length;
      const tone: Tone = kinds > 1 ? 'accent' : buys > 0 ? 'up' : stops > 0 ? 'stop' : 'down';
      const price = hits[0]!.order.price;
      const gap = tokenPrice > 0 ? price / tokenPrice - 1 : 0;
      const live = hits.every((h) => h.until === null);
      const clock = (t: number) => new Date(t * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const orders = new Set(hits.map((h) => h.order.id)).size;
      return {
        title: kinds > 1 ? 'Orders' : buys > 0 ? 'Limit buys' : stops > 0 ? 'Stop losses' : 'Limit sells',
        tone,
        rows: [
          { k: live ? 'Waiting' : 'Waited', v: money(buys + sells + stops), tone },
          ...(kinds > 1 && stops > 0 ? [{ k: 'Of it, stops', v: money(stops), tone: 'stop' as Tone }] : []),
          { k: axis === 'price' ? 'At price' : 'At cap', v: label(price) },
          { k: 'From now', v: `${Math.abs(gap * 100).toFixed(Math.abs(gap) >= 0.1 ? 0 : 1)}% ${gap < 0 ? 'below' : 'above'}` },
          { k: 'Orders', v: String(orders) },
          { k: 'Since', v: clock(Math.min(...hits.map((h) => h.order.start))) },
          ...(live ? [] : [{ k: 'Until', v: clock(Math.max(...hits.map((h) => h.until ?? 0))) }]),
        ],
      };
    },
    [money, label, axis, tokenPrice],
  );

  const describe = useCallback<Describe>(
    (m, close) => {
      const whenText = new Date(m.t * 1000).toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const who = m.who === 'dev' ? 'Dev' : m.who === 'you' ? 'You' : (m.name ?? 'Wallet');
      const verb = { buy: 'bought', sell: 'sold', transfer: 'transferred', burn: 'burned' }[m.kind];
      const tone: Tone = m.kind === 'buy' ? 'up' : m.kind === 'sell' ? 'down' : 'accent';
      const title = `${who} ${verb}`;
      const amount = { k: 'Amount', v: `${compact(m.tokens)} ${token.symbol}` };
      const time = { k: 'When', v: whenText };
      if (m.zro !== undefined) {
        const per = m.tokens > 0 ? m.zro / m.tokens : 0;
        return { title, tone, rows: [amount, { k: m.kind === 'buy' ? 'Paid' : 'Got', v: money(m.zro), tone }, { k: axis === 'price' ? 'At price' : 'At cap', v: label(per) }, time] };
      }
      return { title, tone, rows: [amount, { k: 'Worth', v: money(m.tokens * close), tone }, ...(m.kind === 'transfer' ? [{ k: 'To', v: short(m.to ?? '') }] : []), time] };
    },
    [token.symbol, money, label, axis],
  );

  // Where you got in, your own orders, and where the token moves to a pool.
  const holding = wallet?.holdings.find((h) => h.token === address);
  const entry = holding && holding.bought > 0 ? holding.spent / holding.bought : undefined;
  const levels = useMemo<Level[]>(() => {
    const out: Level[] = [];
    if (entry) out.push({ price: entry, label: 'Your entry', tone: 'entry' });
    // Your own orders are always on the chart, heatmap or not.
    if (me) {
      for (const o of openOrders) {
        if (o.owner !== me) continue;
        const partly = o.left_zro < o.size_zro * 0.999;
        if (!(o.price > 0)) continue;
        const what = o.kind === 'stop' ? 'Your stop loss' : o.kind === 'trailing' ? 'Your trailing stop' : o.kind === 'dca' ? 'Your DCA, up to' : o.group !== null && o.group !== undefined ? 'Your take profit' : `Your limit ${o.is_buy ? 'buy' : 'sell'}`;
        out.push({ price: o.price, tone: 'order', label: `${what}, ${zro(o.left_zro)} ZRO${partly ? ` of ${zro(o.size_zro)} left` : ''}` });
      }
    }
    if (token.source === 'terminal' && !token.graduated) out.push({ price: CURVE.raiseTarget / (token.total_supply * CURVE.lpShare), tone: 'quiet', label: 'Moves to a pool' });
    return out;
  }, [entry, me, openOrders, token.source, token.graduated, token.total_supply]);

  const setTicket = useTicket((s) => s.set);
  const onPick = useCallback((price: number) => setTicket(price), [setTicket]);

  // A press always switches. Switching on brings what it shows into view if it's elsewhere, and says so if there's nothing to show.
  const [note, setNote] = useState('');
  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const say = (text: string) => {
    clearTimeout(noteTimer.current);
    setNote(text);
    noteTimer.current = setTimeout(() => setNote(''), 2600);
  };
  useEffect(() => () => clearTimeout(noteTimer.current), []);
  const pressDev = () => {
    if (prefs.dev) return setPrefs({ dev: false });
    setPrefs({ dev: true });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!api.current?.marksInView()) api.current?.showMarks();
      }),
    );
  };
  const pressOrders = () => {
    if (prefs.orders) {
      setNote('');
      return setPrefs({ orders: false });
    }
    setPrefs({ orders: true });
    if (!openOrders.length) say('No limit orders are waiting on this token right now.');
    requestAnimationFrame(() => requestAnimationFrame(() => api.current?.showOrders()));
  };

  // A token nobody has traded yet still has a price: the chart shows it as one flat candle, never an empty canvas.
  const shown = useMemo<Candle[]>(() => {
    if (loaded !== key) return NO_CANDLES;
    if (candles.length) return candles;
    if (!(token.price > 0)) return NO_CANDLES;
    return [{ t: Math.floor(token.created_at / interval) * interval, o: token.price, h: token.price, l: token.price, c: token.price, v: 0 }];
  }, [loaded, key, candles, token.price, token.created_at, interval]);
  const isEmpty = loaded === key && shown.length === 0;
  const lastDev = dev?.moves[dev.moves.length - 1];

  // How far the toolbar is folded: 0 shows everything, each step frees room until nothing overflows. A wider chart starts again
  // from 0. Checked before paint, so the cut version never shows.
  const bar = useRef<HTMLDivElement>(null);
  const [tight, setTight] = useState(0);
  // Unfolds and fits again whenever what the toolbar says changes, and once the font has loaded: a fold made while the page
  // was still loading would otherwise stay.
  const toolbarText = `${interval}|${dev?.moves.length ?? 0}|${trackedData?.trades.length ?? 0}|${openOrders.length > 0 ? money(depth) : ''}|${list.length}`;
  useLayoutEffect(() => setTight(0), [toolbarText]);
  useEffect(() => {
    document.fonts?.ready.then(() => setTight(0)).catch(() => {});
  }, []);
  useLayoutEffect(() => {
    const el = bar.current;
    if (el && tight < 3 && el.scrollWidth > el.clientWidth + 1) setTight(tight + 1);
  });
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    let width = el.clientWidth;
    const watch = new ResizeObserver(() => {
      if (el.clientWidth > width) setTight(0);
      else if (el.scrollWidth > el.clientWidth + 1) setTight((t) => Math.min(3, t + 1));
      width = el.clientWidth;
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* One row whatever the width. When it doesn't fit, it folds step by step instead of cutting the last button:
          first the intervals become one button, then the heatmap's amount goes, then the heatmap keeps only its swatch. */}
      <div ref={bar} className="no-scrollbar flex shrink-0 items-center gap-x-2 overflow-x-auto px-2.5 pt-2.5">
        {tight >= 1 ? (
          <IntervalPick value={interval} onChange={(v) => setPrefs({ interval: v })} />
        ) : (
          <Segment value={interval} onChange={(v) => setPrefs({ interval: v })} options={INTERVALS.map((i) => ({ value: i.s, label: i.label }))} />
        )}
        <span className="mx-0.5 h-4 w-px shrink-0 bg-white/10" />
        <Toggle on={false} onClick={() => setPrefs({ mode: mode === 'candles' ? 'line' : 'candles' })} title="Switch between candles and a line">
          {mode === 'candles' ? 'Candles' : 'Line'}
        </Toggle>
        <Toggle on={false} onClick={() => setPrefs({ axis: axis === 'mcap' ? 'price' : 'mcap' })} title="Switch between market cap and price">
          {axis === 'mcap' ? 'Cap' : 'Price'}
        </Toggle>
        <Tools
          active={(tool === 'line' ? 1 : 0) + lines.length + INDICATOR_TOGGLES.filter(({ key: k }) => prefs[k]).length}
          drawing={tool === 'line'}
          lines={lines.length}
          onDraw={() => setTool(tool === 'line' ? null : 'line')}
          indicators={INDICATOR_TOGGLES.map(({ key: k, title }) => ({ key: k, title, on: Boolean(prefs[k]), name: INDICATOR_STYLE[k].name, color: INDICATOR_STYLE[k].color }))}
          onIndicator={(k) => setPrefs({ [k]: !prefs[k as keyof typeof prefs] })}
        />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {!!dev?.moves.length && (
            <Toggle on={prefs.dev} onClick={pressDev} title={`Show the creator's buys, sells, transfers and burns on the chart${lastDev ? `. Last one ${age(lastDev.t, now)} ago` : ''}`}>
              Dev {dev.moves.length}
            </Toggle>
          )}
          {list.length > 0 && !!trackedData?.trades.length && (
            <Toggle on={prefs.tracked} onClick={() => setPrefs({ tracked: !prefs.tracked })} title="Show the trades of wallets you follow on the chart">
              Tracked {trackedData.trades.length}
            </Toggle>
          )}
          <Toggle on={prefs.orders} onClick={pressOrders} title="Orders waiting in Submarine's contract: buys in green, sales in red, stop losses in amber, brighter the more ZRO. Point at a band to read it">
            <span className="h-1.5 w-5 rounded-full" style={{ background: HEAT_SWATCH }} aria-hidden="true" />
            {tight < 3 && 'Heatmap'} {tight < 2 && openOrders.length > 0 ? money(depth) : ''}
          </Toggle>
        </div>
      </div>
      <div className="group/chart relative min-h-0 flex-1">
        <ChartCanvas
          candles={shown}
          resetKey={key}
          interval={interval}
          live={token.price}
          label={label}
          mode={mode}
          entry={entry}
          volume={volume}
          marks={marks}
          describe={describe}
          book={prefs.orders ? book : undefined}
          heatStyle="beams"
          describeBand={describeBand}
          valueName={axis === 'price' ? 'Price' : 'Market cap'}
          levels={levels}
          api={api}
          onMoved={setMoved}
          onPick={trade && (token.source === 'terminal' || token.has_pool) ? onPick : undefined}
          lines={lines}
          onLines={setLines}
          tool={tool}
          indicators={indicators}
        />
        <div className="pointer-events-none absolute bottom-[28px] left-5 flex items-center gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/chart:opacity-100">
          <button onClick={() => api.current?.zoom(1.35)} className={cn(iconButton, 'pointer-events-auto')} aria-label="Zoom out" title="Zoom out">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M3.5 8h9" />
            </svg>
          </button>
          <button onClick={() => api.current?.zoom(0.74)} className={cn(iconButton, 'pointer-events-auto')} aria-label="Zoom in" title="Zoom in">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M3.5 8h9M8 3.5v9" />
            </svg>
          </button>
        </div>
        {note && (
          <div role="status" className="animate-fade pointer-events-none absolute right-[72px] top-2 rounded-lg bg-card2/90 px-2.5 py-1 text-[12px] text-muted backdrop-blur">
            {note}
          </div>
        )}
        {moved && (
          <button onClick={() => api.current?.reset()} className="absolute bottom-[28px] left-[86px] h-7 rounded-lg bg-card2/90 px-2.5 text-[12px] font-medium text-muted backdrop-blur transition-colors hover:text-ink">
            Reset view
          </button>
        )}
        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Empty title="No price yet" body="This token has no market here. The chart starts with its first trade." />
          </div>
        )}
      </div>
    </div>
  );
}
