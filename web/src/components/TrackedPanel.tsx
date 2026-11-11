'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Address } from 'viem';
import { useLive, type Trade, type WalletData, type WalletStats } from '@/lib/api';
import { autocopy, useAutocopy, useAutoEvents } from '@/lib/autocopy';
import { age, zro, cn } from '@/lib/format';
import { useFlip, useNow } from '@/lib/hooks';
import { useFormat } from '@/lib/money';
import { openToken, openWallet } from '@/lib/selection';
import { prepareBuy, prepareSell } from '@/lib/prep';
import { marketBuy, sellShare } from '@/lib/trade';
import { nameOf, tracked, useTracked } from '@/lib/tracked';
import { useWallet } from '@/lib/wallet';
import { Avatar, Empty } from './bits';
import { Inflow } from './Inflow';
import { WalletPic } from './WalletPic';

/** The share of its holding a wallet sold in one trade, against what it holds now: that's the share a copy sells of yours. */
export function shareSold(t: Trade): number {
  const held = t.held ?? 0;
  return t.amount + held > 0 ? Math.max(1, Math.min(100, Math.round((t.amount / (t.amount + held)) * 100))) : 100;
}

/** One click to do what they did. A buy spends your quick size. A sale sells the share they sold, if you hold any. */
export function CopyChip({ trade, holds }: { trade: Trade; holds: boolean }) {
  const size = useWallet((s) => s.quickSize);
  const [busy, setBusy] = useState(false);
  if (!trade.tradable) return null;
  if (!trade.is_buy && !holds) return null;
  const share = shareSold(trade);
  const run = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const { account, create } = useWallet.getState();
    if (!account) return create();
    setBusy(true);
    try {
      const who = nameOf(trade.trader);
      const symbol = trade.symbol ?? 'token';
      if (trade.is_buy) await marketBuy(trade.token as Address, symbol, size, `Copy ${who}: buy ${symbol}`);
      else await sellShare(trade.token as Address, symbol, share, `Copy ${who}: sell ${share}% of ${symbol}`);
    } catch {
      // the confirmation card already says what went wrong
    }
    setBusy(false);
  };
  return (
    <button
      onClick={run}
      onPointerEnter={() => void (trade.is_buy ? prepareBuy(trade.token as Address, size) : prepareSell(trade.token as Address))}
      disabled={busy}
      title={trade.is_buy ? `Buy ${size} ZRO of ${trade.symbol}` : `Sell ${share}% of your ${trade.symbol}`}
      className={cn('num h-7 shrink-0 whitespace-nowrap rounded-lg px-2 text-[12px] font-semibold transition-colors duration-150', trade.is_buy ? 'bg-accent/15 text-accent hover:bg-accent/25' : 'bg-white/[.08] text-ink hover:bg-white/[.14]')}
    >
      {busy ? 'Sending' : trade.is_buy ? `Copy ${size}` : `Sell ${share}%`}
    </button>
  );
}

function AddWallet({ onDone }: { onDone: () => void }) {
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const valid = /^0x[0-9a-fA-F]{40}$/.test(address.trim());
  return (
    <form
      className="animate-fade flex flex-col gap-1.5 px-2.5 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        tracked.add(address.trim(), label);
        setAddress('');
        setLabel('');
        onDone();
      }}
    >
      <input autoFocus value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Wallet address, 0x..." className="field num h-9 text-[13px]" aria-label="Wallet address" />
      <div className="flex gap-1.5">
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={24} placeholder="Name, optional" className="field h-9 min-w-0 flex-1 text-[13px]" aria-label="Name for this wallet" />
        <button disabled={!valid} className="btn btn-accent h-9 px-3 text-[13px]">
          Follow
        </button>
      </div>
    </form>
  );
}

/** What copying on its own does and how far it may go. In the wallet's own drawer the buy size is for that wallet alone. */
export function AutoFields({ wallet }: { wallet?: string }) {
  const auto = useAutocopy();
  const field = (value: string, onChange: (v: string) => void, label: string, placeholder?: string) => (
    <label className="block">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="mt-0.5 flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 focus-within:bg-white/[.08]">
        <input inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => /^\d*[.,]?\d*$/.test(e.target.value) && onChange(e.target.value.replace(',', '.'))} className="num h-8 w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-faint" />
        <span className="text-[12px] text-faint">ZRO</span>
      </span>
    </label>
  );
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        {wallet ? field(auto.sizes[wallet] ?? '', (v) => autocopy.setSizeFor(wallet, v), 'Each buy, this wallet', auto.size) : field(auto.size, autocopy.setSize, 'Each buy')}
        {field(auto.limit, autocopy.setLimit, 'Most in a day, all wallets')}
        {field(auto.minTheirs, autocopy.setMinTheirs, 'Skip their buys under')}
        <div>
          <span className="text-[12px] text-muted">Spent today</span>
          <div className="num mt-0.5 flex h-8 items-center">{zro(autocopy.spentToday())} ZRO</div>
        </div>
      </div>
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-muted">Copy their sales too</span>
        <Switch on={auto.sells} onClick={() => autocopy.setSells(!auto.sells)} label="Copy their sales" />
      </div>
      <p className="text-[11px] leading-snug text-faint">Works while a tab of the terminal is open. It won&apos;t copy a trade older than a minute, buys a token at most once a minute, keeps a little ZRO for gas, and leaves a token alone if a test sale reverts or loses 15% or more.</p>
    </div>
  );
}

function AutoPanel({ onClose }: { onClose: () => void }) {
  const auto = useAutocopy();
  const events = useAutoEvents();
  const now = useNow();
  return (
    <div className="animate-fade space-y-2.5 border-t border-white/[.06] px-3 py-3">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold">Copy settings</h3>
        <button onClick={onClose} className="text-[13px] text-muted transition-colors hover:text-ink">
          Close
        </button>
      </div>
      <p className="text-[12px] leading-snug text-muted">The Copy button on a trade spends your quick size below. To copy a wallet by itself, click it above and switch on Copy on its own.</p>
      <AutoFields />
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-muted">Pop up their trades anywhere</span>
        <Switch on={auto.alerts} onClick={() => autocopy.setAlerts(!auto.alerts)} label="Pop up their trades" />
      </div>
      {events.length > 0 && (
        <ul className="soft-scroll max-h-32 space-y-1 border-t border-white/[.06] pt-2 text-[12px]">
          {events.map((e) => (
            <li key={`${e.at}${e.note}`} className="flex gap-1.5 leading-snug">
              <span className="num w-7 shrink-0 text-faint">{age(e.at / 1000, now)}</span>
              <span className={cn('min-w-0', e.done ? 'text-ink' : 'text-muted')}>
                <b className="font-semibold">{e.symbol}</b> {e.note}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={onClick} className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150', on ? 'bg-accent' : 'bg-white/[.14]')}>
      <span className={cn('absolute left-0.5 top-0.5 h-4 w-4 rounded-full transition-transform duration-150', on ? 'translate-x-4 bg-black' : 'bg-ink')} />
    </button>
  );
}

function WalletRow({ address, stats, now, filtered, onFilter }: { address: string; stats?: WalletStats; now: number; filtered: boolean; onFilter: () => void }) {
  const { signed } = useFormat();
  const auto = useAutocopy();
  const list = useTracked();
  const on = auto.wallets.includes(address);
  const pnl = stats?.pnl ?? 0;
  return (
    <div role="button" tabIndex={0} onClick={() => openWallet(address)} onKeyDown={(e) => e.key === 'Enter' && openWallet(address)} className="group flex h-[50px] cursor-pointer items-center gap-2.5 rounded-xl px-2.5 transition-colors duration-150 hover:bg-white/[.04]">
      <WalletPic address={address} size={30} />
      <div className="min-w-0 flex-1 leading-snug">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-semibold">{nameOf(address, list)}</span>
          {on && <span className="shrink-0 rounded bg-accent/15 px-1 text-[10px] font-semibold text-accent">Auto</span>}
        </div>
        <div className="num truncate text-[12px] text-faint">{stats?.last_ts ? `last trade ${age(stats.last_ts, now)} ago` : 'no trades seen'}</div>
      </div>
      <div className="shrink-0 text-right leading-snug">
        <div className={cn('num', pnl > 0 ? 'text-up' : pnl < 0 ? 'text-down' : 'text-muted')}>{signed(pnl)}</div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFilter();
          }}
          className={cn('text-[12px] transition-colors', filtered ? 'text-accent' : 'text-faint hover:text-ink')}
        >
          {filtered ? 'Show all' : 'Only this'}
        </button>
      </div>
    </div>
  );
}

/** The wallets you follow, each one's record at a glance, and every trade they make, with the chart still open beside it. */
export function TrackedPanel({ tools }: { tools?: ReactNode }) {
  const list = useTracked();
  const now = useNow();
  const { money } = useFormat();
  const auto = useAutocopy();
  const me = useWallet((s) => s.account?.address.toLowerCase());
  const [adding, setAdding] = useState(false);
  const [showAuto, setShowAuto] = useState(false);
  const [only, setOnly] = useState<string | null>(null);
  const [view, setView] = useState<'trades' | 'inflow'>('trades');
  const keys = list.map((t) => t.address).join(',');
  useEffect(() => {
    if (only && !keys.includes(only)) setOnly(null);
  }, [keys, only]);

  const { data: wallets } = useLive<{ wallets: WalletStats[] }>(keys ? `/api/v1/wallets?addresses=${keys}` : null, (t, d) => t === 'trade' && keys.includes(d.trader), 1500, true);
  const tradesPath = keys ? `/api/v1/market/trades?limit=80&traders=${only ?? keys}` : null;
  const { data: feed } = useLive<{ trades: Trade[] }>(tradesPath, (t, d) => t === 'trade' && keys.includes(d.trader), 300, true);
  const { data: mine } = useLive<WalletData>(me ? `/api/v1/wallet/${me}` : null, (t, d) => t === 'trade' && d.trader === me, 800);
  const held = useMemo(() => new Set(mine?.holdings.map((h) => h.token)), [mine]);
  const stats = useMemo(() => new Map(wallets?.wallets.map((w) => [w.address, w])), [wallets]);
  const trades = keys ? feed?.trades : [];
  const container = useFlip(trades?.map((t) => t.tx_hash + t.log_index).join() ?? '', tradesPath ?? '');

  return (
    <>
      <div className="flex shrink-0 items-center justify-between px-3.5 pb-2 pt-3.5">
        <h2 className="text-[15px] font-semibold">
          Tracked {list.length > 0 && <span className="num font-medium text-faint">{list.length}</span>}
        </h2>
        <div className="flex items-center gap-1">
          <button onClick={() => setAdding((v) => !v)} className="btn btn-soft h-8 rounded-[7px] px-2.5 text-[13px]">
            {adding ? 'Cancel' : 'Add wallet'}
          </button>
          {tools}
        </div>
      </div>
      {adding && <AddWallet onDone={() => setAdding(false)} />}
      <div ref={container} className="soft-scroll relative min-h-0 flex-1 px-1.5 pb-1.5">
        {list.length === 0 ? (
          <Empty title="Nobody followed yet" body="Click any wallet in a token's trades, in Leaders or in Holders, and press Follow. Its trades show up here the moment they land, one click away from copying." />
        ) : (
          <>
            <div className="mb-1 border-b border-white/[.06] pb-1">
              {list.map((t) => (
                <WalletRow key={t.address} address={t.address} stats={stats.get(t.address)} now={now} filtered={only === t.address} onFilter={() => setOnly((v) => (v === t.address ? null : t.address))} />
              ))}
            </div>
            <div className="mb-1 flex gap-0.5 px-1" role="tablist" aria-label="Their trades or where their money went">
              <button role="tab" aria-selected={view === 'trades'} onClick={() => setView('trades')} className={cn('pill py-1 text-[12px]', view === 'trades' && 'pill-on')}>
                Trades
              </button>
              <button role="tab" aria-selected={view === 'inflow'} onClick={() => setView('inflow')} className={cn('pill py-1 text-[12px]', view === 'inflow' && 'pill-on')}>
                Inflow
              </button>
            </div>
            {view === 'inflow' && <Inflow />}
            {view === 'trades' && trades && !trades.length && <Empty title="No trades from them yet" />}
            {view === 'trades' && trades?.map((t) => (
              <div key={t.tx_hash + t.log_index} data-flip={t.tx_hash + t.log_index} role="button" tabIndex={0} onClick={() => openToken(t.token)} onKeyDown={(e) => e.key === 'Enter' && openToken(t.token)} className="flex h-[52px] cursor-pointer items-center gap-2.5 rounded-xl px-2.5 transition-colors duration-150 hover:bg-white/[.04]">
                <Avatar address={t.token} uri={t.uri} size={30} />
                <div className="min-w-0 flex-1 leading-snug">
                  <div className="truncate">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openWallet(t.trader);
                      }}
                      className="font-medium transition-colors hover:text-accent"
                    >
                      {nameOf(t.trader, list)}
                    </button>{' '}
                    <span className={t.is_buy ? 'text-up' : 'text-down'}>{t.is_buy ? 'bought' : 'sold'}</span> <span className="font-semibold">{t.symbol}</span>
                  </div>
                  <div className="num truncate text-[12px] text-faint">
                    {money(t.zro)}, {age(t.ts, now)} ago
                  </div>
                </div>
                <CopyChip trade={t} holds={held.has(t.token)} />
              </div>
            ))}
          </>
        )}
      </div>
      {showAuto ? (
        <AutoPanel onClose={() => setShowAuto(false)} />
      ) : (
        <button onClick={() => setShowAuto(true)} className="flex shrink-0 items-center justify-between gap-2 border-t border-white/[.06] px-3 py-2.5 text-[13px] transition-colors hover:bg-white/[.03]">
          <span className="font-medium">Copy settings</span>
          <span className={cn('num', auto.wallets.length ? 'text-accent' : 'text-faint')}>{auto.wallets.length ? `${auto.wallets.length} on its own, ${zro(autocopy.spentToday())} of ${auto.limit} ZRO today` : 'By hand only'}</span>
        </button>
      )}
    </>
  );
}
