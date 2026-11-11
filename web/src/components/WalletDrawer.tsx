'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLive, type WalletData } from '@/lib/api';
import { autocopy, useAutocopy } from '@/lib/autocopy';
import { age, cn, short } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { useFormat } from '@/lib/money';
import { openToken, openWallet, useSelection } from '@/lib/selection';
import { nameOf, tracked, useTracked } from '@/lib/tracked';
import { useWallet } from '@/lib/wallet';
import { Avatar, Empty } from './bits';
import { WalletPic } from './WalletPic';
import { profileOf } from '@/lib/profiles';
import { AutoFields, CopyChip, Switch } from './TrackedPanel';
import { RankCard } from './RankCard';

/** A name you can change where it stands: Enter or leaving the field keeps it, Escape doesn't. */
function NameField({ address }: { address: string }) {
  const list = useTracked();
  const [editing, setEditing] = useState(false);
  const label = list.find((t) => t.address === address)?.label ?? '';
  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={label}
        maxLength={24}
        placeholder={short(address, 4, 3)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          tracked.rename(address, e.currentTarget.value);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="field h-8 w-full text-[15px] font-semibold"
        aria-label="Name for this wallet"
      />
    );
  }
  return (
    <button onClick={() => setEditing(true)} title="Rename" className="group flex max-w-full items-center gap-1.5 text-left">
      <span className="num truncate text-[18px] font-bold tracking-tight">{nameOf(address, list)}</span>
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-faint transition-colors group-hover:text-ink" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.5 3l2.5 2.500L5.5 13H3v-2.500z" />
      </svg>
    </button>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-white/[.045] px-3 py-2 leading-snug">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={cn('num truncate text-[16px] font-semibold', tone)}>{value}</div>
    </div>
  );
}

/** Any wallet, read the way a trader sizes someone up, beside what's on screen: click a wallet anywhere and this opens. */
export function WalletDrawer() {
  const address = useSelection((s) => s.wallet);
  const now = useNow();
  const { money, signed } = useFormat();
  const list = useTracked();
  const auto = useAutocopy();
  const me = useWallet((s) => s.account?.address.toLowerCase());
  const { data } = useLive<WalletData>(address ? `/api/v1/wallet/${address}` : null, (t, d) => t === 'trade' && d.trader === address, 500);
  const { data: own } = useLive<WalletData>(address && me ? `/api/v1/wallet/${me}` : null, (t, d) => t === 'trade' && d.trader === me, 800);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!address) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') openWallet(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [address]);

  if (!address) return null;
  const following = list.some((t) => t.address === address);
  const mine = address === me;
  const s = data?.stats;
  const decided = s ? s.wins + s.losses : 0;
  const autoOn = auto.wallets.includes(address);
  const held = new Set(own?.holdings.map((h) => h.token));

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 lg:bg-transparent" onClick={() => openWallet(null)} aria-hidden="true" />
      <aside className="animate-slide soft-scroll fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col gap-3 border-l border-white/10 bg-card p-4 shadow-[-20px_0_60px_rgb(0_0_0_/_.5)]" role="dialog" aria-label="Wallet">
        <div className="flex items-start gap-3">
          <WalletPic address={address} size={44} />
          <div className="min-w-0 flex-1">
            {following ? <NameField address={address} /> : <div className="num truncate text-[18px] font-bold tracking-tight">{mine ? 'You' : (profileOf(address)?.name ?? short(address, 4, 4))}</div>}
            <button
              onClick={() => {
                void navigator.clipboard.writeText(address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
              className="num text-[12px] text-muted transition-colors hover:text-ink"
              title="Copy address"
            >
              {copied ? 'Copied' : short(address, 8, 6)}
            </button>
          </div>
          <button onClick={() => openWallet(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-muted transition-colors hover:text-ink" aria-label="Close">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4 4l8 8m0-8l-8 8" />
            </svg>
          </button>
        </div>

        <RankCard address={address} own={mine} className="bg-white/[.03]" />

        {!mine && (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => {
                if (!following) return tracked.add(address);
                tracked.remove(address);
                if (autocopy.isOn(address)) autocopy.toggle(address);
              }}
              className={cn('btn h-10', following ? 'btn-soft' : 'btn-accent')}
            >
              {following ? 'Following' : 'Follow'}
            </button>
            <Link href={`/traders/${address}`} onClick={() => openWallet(null)} className="btn btn-soft h-10">
              Full profile
            </Link>
            <Link href={`/copy?leader=${address}`} onClick={() => openWallet(null)} className="btn btn-soft col-span-2 h-10" title="Repeat its trades automatically, even with the browser closed">
              Copy its trades automatically
            </Link>
          </div>
        )}

        {!mine && (
          <section className="rounded-xl bg-white/[.045] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="leading-snug">
                <div className="font-semibold">Copy on its own</div>
                <div className="text-[12px] text-muted">{autoOn ? 'On. Its trades copy by themselves' : 'Or press Copy on any trade below'}</div>
              </div>
              <Switch
                on={autoOn}
                onClick={() => {
                  if (!autoOn && !following) tracked.add(address);
                  autocopy.toggle(address);
                }}
                label="Copy this wallet on its own"
              />
            </div>
            {autoOn && (
              <div className="animate-fade mt-2.5">
                <AutoFields wallet={address} />
              </div>
            )}
          </section>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          <Figure label="Worth now" value={s ? money(s.worth) : '...'} />
          <Figure label="Profit" value={s ? signed(s.pnl) : '...'} tone={s ? (s.pnl > 0 ? 'text-up' : s.pnl < 0 ? 'text-down' : '') : ''} />
          <Figure label="Win rate" value={decided ? `${Math.round(((s?.wins ?? 0) / decided) * 100)}%, ${s?.wins} of ${decided}` : '...'} />
          <Figure label="Volume" value={s ? money(s.volume) : '...'} />
          <Figure label="Trades" value={s ? `${s.buys} buys, ${s.sells} sells` : '...'} />
          <Figure label="Last trade" value={s?.last_ts ? `${age(s.last_ts, now)} ago` : '...'} />
        </div>

        <section>
          <h3 className="mb-1 font-semibold">Holding {!!data?.holdings.length && <span className="num font-medium text-faint">{data.holdings.length}</span>}</h3>
          {data && !data.holdings.length && <p className="text-[13px] text-faint">Nothing held</p>}
          <ul>
            {data?.holdings.slice(0, 8).map((h) => {
              const result = h.value + h.received - h.spent;
              return (
                <li key={h.token}>
                  <button onClick={() => openToken(h.token)} className="flex h-10 w-full items-center gap-2.5 rounded-lg px-1 text-left transition-colors hover:bg-white/[.04]">
                    <Avatar address={h.token} uri={h.uri} size={26} />
                    <span className="min-w-0 flex-1 truncate font-semibold">{h.symbol}</span>
                    <span className="num text-muted">{money(h.value)}</span>
                    <span className={cn('num w-[74px] text-right', result > 0 ? 'text-up' : result < 0 ? 'text-down' : 'text-muted')}>{signed(result)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h3 className="mb-1 font-semibold">Last trades</h3>
          {data && !data.trades.length && <Empty title="No trades yet" />}
          <ul>
            {data?.trades.slice(0, 12).map((t) => (
              <li key={`${t.tx_hash}${t.log_index}`}>
                <div role="button" tabIndex={0} onClick={() => openToken(t.token)} onKeyDown={(e) => e.key === 'Enter' && openToken(t.token)} className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-1 text-left text-[13px] transition-colors hover:bg-white/[.04]">
                  <span className={cn('w-8 shrink-0', t.is_buy ? 'text-up' : 'text-down')}>{t.is_buy ? 'Buy' : 'Sell'}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{t.symbol}</span>
                  <span className="num w-[62px] text-right">{money(t.zro)}</span>
                  <span className="num w-7 text-right text-faint">{age(t.ts, now)}</span>
                  {!mine && (
                    <span className="flex w-[66px] justify-end">
                      <CopyChip trade={t} holds={held.has(t.token)} />
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </>
  );
}
