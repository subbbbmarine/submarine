'use client';

import Link from 'next/link';
import { useState } from 'react';
import { encodeFunctionData } from 'viem';
import { getDeployment, useLive, type Order, type OrderFill } from '@/lib/api';
import { LIMITS_ABI } from '@/lib/config';
import { age, zro, cn, compact } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { useFormat } from '@/lib/money';
import { send } from '@/lib/tx';
import { Avatar, Empty } from './bits';

async function cancelOrder(id: number) {
  const { limitOrders } = await getDeployment();
  await send({ label: `Cancel order ${id}`, to: limitOrders, data: encodeFunctionData({ abi: LIMITS_ABI, functionName: 'cancel', args: [BigInt(id)] }) });
}

const STATUS: Record<Order['status'], string> = {
  open: 'Open',
  partial: 'Partly filled',
  filled: 'Filled',
  cancelled: 'Cancelled',
  expired: 'Expired',
  unfilled_expired: 'Past its time',
};

/** How far the market is from the order's level, read the way the order waits for it. */

/** What kind of order it is, in a few words. */
export function kindName(o: Order): string {
  const side = o.is_buy ? 'buy' : 'sell';
  switch (o.kind) {
    case 'stop':
      return 'Stop loss';
    case 'trailing':
      return `Trailing stop ${(o.trail_bps ?? 0) / 100}%`;
    case 'on_graduation':
      return o.is_buy ? 'Buy on pool' : 'Sell on pool';
    case 'on_dev_sell':
      return 'Sell when dev sells';
    case 'dca':
      return `DCA in ${o.slices ?? 0} parts`;
    default:
      return o.group !== null && o.group !== undefined ? 'Take profit' : `Limit ${side}`;
  }
}

/** For orders with no price level: what they wait for. */
export function kindWhen(o: Order): string {
  if (o.kind === 'on_graduation') return 'when it moves to a pool';
  if (o.kind === 'on_dev_sell') return `when the dev sells ${(o.trail_bps ?? 0) / 100}%`;
  return 'waiting';
}

function distance(o: Order): string {
  if (!o.price || !o.limit_price) return '';
  const away = o.is_buy ? o.price / o.limit_price - 1 : o.limit_price / o.price - 1;
  if (away <= 0.002) return 'At your price';
  return `${away >= 1 ? (away * 100).toFixed(0) : (away * 100).toFixed(1)}% away`;
}

function timeLeft(expiry: number, now: number): string {
  if (!expiry) return 'No expiry';
  const s = expiry - now / 1000;
  if (s <= 0) return 'Expired';
  if (s < 3600) return `${Math.ceil(s / 60)}m left`;
  if (s < 86400) return `${Math.floor(s / 3600)}h left`;
  return `${Math.floor(s / 86400)}d left`;
}

export function FillBar({ share, className }: { share: number; className?: string }) {
  return (
    <span className={cn('block h-1 overflow-hidden rounded-full bg-white/10', className)} role="progressbar" aria-valuenow={Math.round(share * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span className="block h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${Math.max(share * 100, share > 0 ? 3 : 0)}%` }} />
    </span>
  );
}

function Fills({ order }: { order: Order }) {
  const { money } = useFormat();
  const now = useNow();
  const { data } = useLive<{ fills: OrderFill[] }>(`/api/v1/orders/${order.id}/fills`, (t, d) => t === 'order' && d.id === order.id, 500);
  if (!data) return <div className="h-8" />;
  if (!data.fills.length) return <p className="py-1.5 text-[13px] text-faint">Nothing filled yet.</p>;
  return (
    <ul className="animate-fade py-1 text-[13px]">
      {data.fills.map((f) => (
        <li key={f.tx_hash + f.ts} className="flex h-7 items-center gap-3">
          <span className="num w-10 text-faint">{age(f.ts, now)}</span>
          <span className="num flex-1">
            {compact(f.tokens)} {order.symbol} for {zro(f.zro)} ZRO
          </span>
          <span className="num text-muted">{money((f.zro / f.tokens) * order.total_supply)} cap</span>
        </li>
      ))}
    </ul>
  );
}

/** One limit order the way an exchange shows it: its level, its size, how much of it has filled and at what average. */
export function OrderRow({ order: o, compactRow, onChange }: { order: Order; compactRow?: boolean; onChange?: () => void }) {
  const { money } = useFormat();
  const now = useNow(10_000);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = o.status === 'open' || o.status === 'partial' || o.status === 'unfilled_expired';
  const unit = o.is_buy ? 'ZRO' : o.symbol;
  const cap = o.limit_price * o.total_supply;
  const average = o.filled_num > 0 ? (o.is_buy ? o.filled_num / o.filled_out_num : o.filled_out_num / o.filled_num) * o.total_supply : 0;
  const cancel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    try {
      await cancelOrder(o.id);
      onChange?.();
    } catch {
      // the confirmation card says what went wrong
    }
    setBusy(false);
  };
  const action = live && (
    <button onClick={cancel} disabled={busy} className="shrink-0 rounded-lg bg-white/[.06] px-2 py-1 text-[12px] font-medium transition-colors hover:bg-white/[.11] disabled:opacity-50">
      {busy ? 'Working' : o.status === 'unfilled_expired' ? 'Get back' : 'Cancel'}
    </button>
  );

  if (compactRow) {
    return (
      <li>
        <div role="button" tabIndex={0} onClick={() => setOpen((v) => !v)} onKeyDown={(e) => e.key === 'Enter' && setOpen((v) => !v)} className="w-full cursor-pointer text-left">
          <div className="flex items-center gap-2 text-[13px]">
            <span className={cn('font-medium', o.is_buy ? 'text-up' : 'text-down')}>{kindName(o)}</span>
            <span className="num min-w-0 flex-1 truncate">{cap > 0 ? `at ${money(cap)} cap` : kindWhen(o)}</span>
            {action}
          </div>
          <FillBar share={o.filled_share} className="mt-1.5" />
          <div className="num mt-1 flex justify-between text-[12px] text-muted">
            <span>
              {compact(o.amount_num - o.filled_num)} of {compact(o.amount_num)} {unit} left
            </span>
            <span className={o.filled_share > 0 ? 'text-accent' : ''}>{Math.round(o.filled_share * 100)}% filled</span>
          </div>
          <div className="num mt-0.5 flex justify-between text-[12px] text-faint">
            <span>{distance(o)}</span>
            <span>{timeLeft(o.expiry, now)}</span>
          </div>
        </div>
        {open && <Fills order={o} />}
      </li>
    );
  }

  return (
    <li className="border-t border-white/[.05] first:border-t-0">
      <div role="button" tabIndex={0} onClick={() => setOpen((v) => !v)} onKeyDown={(e) => e.key === 'Enter' && setOpen((v) => !v)} className="grid cursor-pointer grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 text-[13px] transition-colors hover:bg-white/[.02] sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
        <Link href={`/tokens/${o.token}`} onClick={(e) => e.stopPropagation()} className="flex min-w-0 items-center gap-2.5 transition-colors hover:text-accent">
          <Avatar address={o.token} uri={o.uri} size={28} />
          <span className="min-w-0 leading-snug">
            <span className="block truncate font-semibold">{o.symbol}</span>
            <span className={cn('block text-[12px]', o.is_buy ? 'text-up' : 'text-down')}>{kindName(o)}</span>
          </span>
        </Link>
        <span className="num min-w-0 leading-snug">
          <span className="block truncate">{money(cap)} cap</span>
          <span className="block truncate text-[12px] text-faint">{live ? distance(o) : STATUS[o.status]}</span>
        </span>
        <span className="num hidden min-w-0 leading-snug sm:block">
          <span className="block truncate">
            {compact(o.amount_num)} {unit}
          </span>
          <span className="block truncate text-[12px] text-faint">{live ? timeLeft(o.expiry, now) : `${age(o.closed_at ?? o.created_at, now)} ago`}</span>
        </span>
        <span className="num hidden min-w-0 sm:block">
          <span className="flex justify-between text-[12px]">
            <span className={o.filled_share > 0 ? 'text-accent' : 'text-muted'}>{Math.round(o.filled_share * 100)}%</span>
            <span className="truncate pl-2 text-faint">{average ? `avg ${money(average)}` : ''}</span>
          </span>
          <FillBar share={o.filled_share} className="mt-1" />
        </span>
        <span className="flex justify-end">{action}</span>
        <span className="col-span-full sm:hidden">
          <span className="num flex justify-between text-[12px]">
            <span className={o.filled_share > 0 ? 'text-accent' : 'text-muted'}>{Math.round(o.filled_share * 100)}% of {compact(o.amount_num)} {unit}</span>
            <span className="text-faint">{average ? `avg ${money(average)}` : ''}</span>
          </span>
          <FillBar share={o.filled_share} className="mt-1" />
        </span>
      </div>
      {open && (
        <div className="pb-2 pl-[38px]">
          <Fills order={o} />
        </div>
      )}
    </li>
  );
}

/** Every limit order a wallet has: what's waiting, and how the rest ended. */
export function OrdersPanel({ address }: { address: string }) {
  const [tab, setTab] = useState<'open' | 'history'>('open');
  const { data: openData, refresh: refreshOpen } = useLive<{ orders: Order[] }>(`/api/v1/orders?owner=${address}&open=1`, (t) => t === 'order' || t === 'trade', 800);
  const { data: closedData, refresh: refreshClosed } = useLive<{ orders: Order[] }>(`/api/v1/orders?owner=${address}&open=0`, (t) => t === 'order', 500);
  const [busy, setBusy] = useState(false);
  const opened = openData?.orders ?? [];
  const closed = closedData?.orders ?? [];
  const locked = opened.reduce((s, o) => s + o.left_zro, 0);
  const { money } = useFormat();
  const refresh = () => {
    void refreshOpen();
    void refreshClosed();
  };
  const cancelAll = async () => {
    setBusy(true);
    for (const o of opened) {
      try {
        await cancelOrder(o.id);
      } catch {
        break;
      }
    }
    refresh();
    setBusy(false);
  };
  const shown = tab === 'open' ? opened : closed;
  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="font-semibold">Limit orders</h2>
        <div className="flex gap-0.5">
          <button onClick={() => setTab('open')} className={cn('pill num', tab === 'open' && 'pill-on')}>
            Open {opened.length}
          </button>
          <button onClick={() => setTab('history')} className={cn('pill num', tab === 'history' && 'pill-on')}>
            History {closed.length}
          </button>
        </div>
        {tab === 'open' && opened.length > 0 && (
          <div className="ml-auto flex items-center gap-3 text-[13px]">
            <span className="num text-muted">{money(locked)} waiting</span>
            {opened.length > 1 && (
              <button onClick={cancelAll} disabled={busy} className="text-muted transition-colors hover:text-ink disabled:opacity-50">
                {busy ? 'Working' : 'Cancel all'}
              </button>
            )}
          </div>
        )}
      </div>
      {shown.length > 0 && (
        <div className="mt-2 hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_52px] gap-x-3 text-[12px] text-faint sm:grid">
          <span>Token</span>
          <span>At</span>
          <span>Size</span>
          <span>Filled</span>
          <span />
        </div>
      )}
      {shown.length === 0 && openData && <Empty title={tab === 'open' ? 'No open orders' : 'No finished orders yet'} body={tab === 'open' ? 'Pick Limit on the trade card, or click a level on a chart’s price scale.' : undefined} />}
      <ul>
        {shown.map((o) => (
          <OrderRow key={o.id} order={o} onChange={refresh} />
        ))}
      </ul>
    </section>
  );
}
