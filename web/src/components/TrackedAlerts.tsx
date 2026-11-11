'use client';

import { useEffect, useRef, useState } from 'react';
import { get, useLive, useStream, type Token, type Trade, type WalletData } from '@/lib/api';
import { onLiveTrade, useAutocopy } from '@/lib/autocopy';
import { cn } from '@/lib/format';
import { useFormat } from '@/lib/money';
import { openToken, openWallet } from '@/lib/selection';
import { nameOf, tracked } from '@/lib/tracked';
import { useWallet } from '@/lib/wallet';
import { Avatar } from './bits';
import { CopyChip } from './TrackedPanel';

const SHOWN_MS = 8000;
const MOST = 3;

/**
 * The stream's trades by wallets you follow, wherever you are in the terminal: the wallet, what it did, and a button to do the
 * same. Also where the stream reaches the auto copy, so it runs on every page.
 */
export function TrackedAlerts() {
  const { alerts } = useAutocopy();
  const { money } = useFormat();
  const me = useWallet((s) => s.account?.address.toLowerCase());
  const [items, setItems] = useState<Array<Trade & { key: string }>>([]);
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;
  const { data: mine } = useLive<WalletData>(me ? `/api/v1/wallet/${me}` : null, (t, d) => t === 'trade' && d.trader === me, 1000);
  const held = new Set(mine?.holdings.map((h) => h.token));

  useStream((type, d) => {
    if (type !== 'trade' || !tracked.has(d.trader)) return;
    onLiveTrade(d);
    if (!alertsRef.current) return;
    const key = `${d.tx}:${d.idx}`;
    void get<Token>(`/api/v1/tokens/${d.token}`).then((t) => {
      const trade: Trade & { key: string } = {
        key,
        tx_hash: d.tx,
        log_index: d.idx,
        ts: d.ts,
        token: d.token,
        trader: d.trader,
        is_buy: Boolean(d.isBuy),
        zro: d.zro,
        amount: d.amount,
        price: d.price,
        venue: d.venue,
        symbol: t.symbol,
        uri: t.uri,
        source: t.source,
        has_pool: t.has_pool ? 1 : 0,
        tradable: t.tradable,
      };
      setItems((v) => (v.some((x) => x.key === key) ? v : [trade, ...v].slice(0, MOST)));
      setTimeout(() => setItems((v) => v.filter((x) => x.key !== key)), SHOWN_MS);
    }, () => {});
  });

  useEffect(() => {
    if (!alerts) setItems([]);
  }, [alerts]);

  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-40 flex w-[calc(100%-1.5rem)] max-w-[340px] flex-col gap-1.5 lg:left-[80px]" aria-live="polite">
      {items.map((t) => (
        <div key={t.key} role="button" tabIndex={0} onClick={() => openToken(t.token)} onKeyDown={(e) => e.key === 'Enter' && openToken(t.token)} className="animate-rise pointer-events-auto flex cursor-pointer items-center gap-2.5 rounded-2xl border border-white/10 bg-card2 px-3 py-2.5 shadow-[0_16px_40px_rgb(0_0_0_/_.6)]">
          <Avatar address={t.token} uri={t.uri} size={30} />
          <div className="min-w-0 flex-1 leading-snug">
            <div className="truncate text-[13px]">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openWallet(t.trader);
                }}
                className="font-semibold transition-colors hover:text-accent"
              >
                {nameOf(t.trader)}
              </button>{' '}
              <span className={cn(t.is_buy ? 'text-up' : 'text-down')}>{t.is_buy ? 'bought' : 'sold'}</span> <span className="font-semibold">{t.symbol}</span>
            </div>
            <div className="num text-[12px] text-muted">{money(t.zro)}</div>
          </div>
          <CopyChip trade={t} holds={held.has(t.token)} />
        </div>
      ))}
    </div>
  );
}
