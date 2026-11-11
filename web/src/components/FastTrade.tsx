'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import { useLive, type TokenDetail, type WalletData } from '@/lib/api';
import { cn, compact } from '@/lib/format';
import { useFormat } from '@/lib/money';
import { marketBuy, sellShare } from '@/lib/trade';
import { useWallet } from '@/lib/wallet';

const BUYS_KEY = 'terminal.fast.v1';
const DEFAULT_BUYS = ['5', '50', '200', '500'];
const SELLS = [25, 50, 100];

const savedBuys = () => {
  try {
    const v = JSON.parse(localStorage.getItem(BUYS_KEY) ?? 'null') as string[] | null;
    return v?.length === 4 ? v : DEFAULT_BUYS;
  } catch {
    return DEFAULT_BUYS;
  }
};

/**
 * A small trade panel for a chart that isn't the trading screen, like each cell of Multi: buy at one of four sizes, sell a
 * share, and the position in this token, so trading several charts never needs a page change. Double click a buy size to
 * change it; the four are shared by every panel.
 */
export function FastTrade({ token, onClose }: { token: TokenDetail; onClose: () => void }) {
  const account = useWallet((s) => s.account);
  const create = useWallet((s) => s.create);
  const { money, signed } = useFormat();
  const [buys, setBuys] = useState<string[]>(savedBuys);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const me = account?.address.toLowerCase();
  const { data } = useLive<WalletData>(me ? `/api/v1/wallet/${me}` : null, (t, d) => t === 'trade' && (d.trader === me || d.token === token.address), 600);
  const h = data?.holdings.find((x) => x.token === token.address);
  const value = h ? h.amount * token.price : 0;
  const result = h ? value + h.received - h.spent : 0;
  const address = token.address as Address;

  // Dragged by its title, and kept inside the chart's own card: it never covers the charts next to it.
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const clamp = (x: number, y: number) => {
    const el = box.current;
    const card = el?.offsetParent as HTMLElement | null;
    if (!el || !card) return { x, y };
    return { x: Math.min(Math.max(0, x), card.clientWidth - el.offsetWidth), y: Math.min(Math.max(0, y), card.clientHeight - el.offsetHeight) };
  };
  useLayoutEffect(() => {
    const el = box.current;
    const card = el?.offsetParent as HTMLElement | null;
    if (el && card && !at) setAt(clamp(card.clientWidth - el.offsetWidth - 8, 40));
    // placed once, where the old fixed corner was
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const drag = (e: React.PointerEvent) => {
    if (!at || (e.target as HTMLElement).closest('button')) return;
    const start = { px: e.clientX, py: e.clientY, x: at.x, y: at.y };
    const move = (m: PointerEvent) => setAt(clamp(start.x + m.clientX - start.px, start.y + m.clientY - start.py));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const run = async (key: string, fn: () => Promise<unknown>) => {
    if (!account) return create();
    setBusy(key);
    try {
      await fn();
    } catch {
      // the confirmation card says what went wrong
    }
    setBusy(null);
  };
  const saveBuy = (i: number, v: string) => {
    const n = Number(v);
    const next = buys.map((b, j) => (j === i && n > 0 ? String(n) : b));
    setBuys(next);
    try {
      localStorage.setItem(BUYS_KEY, JSON.stringify(next));
    } catch {}
    setEditing(null);
  };

  return (
    <div
      ref={box}
      style={at ? { left: at.x, top: at.y } : { right: 8, top: 40 }}
      className="absolute z-30 w-[260px] space-y-2 rounded-xl border border-white/10 bg-[#1a1a1d] p-2.5 shadow-[0_14px_40px_rgb(0_0_0_/_.6)]"
      role="dialog"
      aria-label={`Trade ${token.symbol}`}
    >
      <div onPointerDown={drag} className="-m-1 flex cursor-move touch-none select-none items-center justify-between rounded-lg p-1" title="Drag to move it anywhere on this chart">
        <span className="text-[13px] font-semibold">Trade {token.symbol}</span>
        <button onClick={onClose} className="text-[12px] text-faint hover:text-ink" aria-label="Close">
          Close
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {buys.map((b, i) =>
          editing === i ? (
            <input key={i} autoFocus defaultValue={b} onBlur={(e) => saveBuy(i, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveBuy(i, (e.target as HTMLInputElement).value)} inputMode="decimal" className="field num h-8 px-1 text-center text-[12px]" />
          ) : (
            <button key={i} onClick={() => run(`b${i}`, () => marketBuy(address, token.symbol, b))} onDoubleClick={() => setEditing(i)} disabled={!token.tradable || busy !== null} title="Double click to change" className="btn num h-8 rounded-[6px] bg-up/15 px-1 text-[12px] text-up hover:bg-up/25 disabled:opacity-40">
              {busy === `b${i}` ? '...' : b}
            </button>
          ),
        )}
      </div>
      <div className="grid grid-cols-3 gap-1">
        {SELLS.map((p) => (
          <button key={p} onClick={() => run(`s${p}`, () => sellShare(address, token.symbol, p))} disabled={!h || busy !== null} className="btn num h-8 rounded-[6px] bg-down/15 px-1 text-[12px] text-down hover:bg-down/25 disabled:opacity-40">
            {busy === `s${p}` ? '...' : `Sell ${p}%`}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 rounded-lg bg-white/[.04] px-2 py-1.5 text-[12px]">
        <span className="text-muted">Holding</span>
        <span className="num text-right">{h ? compact(h.amount) : '0'}</span>
        <span className="text-muted">Worth</span>
        <span className="num text-right">{money(value)}</span>
        <span className="text-muted">Cost left</span>
        <span className="num text-right">{money(h ? Math.max(h.spent - h.received, 0) : 0)}</span>
        <span className="text-muted">Profit</span>
        <span className={cn('num text-right', result > 0 ? 'text-up' : result < 0 ? 'text-down' : '')}>{h ? signed(result) : '-'}</span>
      </div>
      {!account && <p className="text-[12px] text-faint">A wallet is made on the first click.</p>}
    </div>
  );
}
