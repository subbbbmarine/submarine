'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLive, type WalletData } from '@/lib/api';
import { saleCard, type TradeCard } from '@/lib/shareCard';
import { age, cn, compact } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { useFormat } from '@/lib/money';
import { openToken } from '@/lib/selection';
import { Avatar, Empty } from './bits';
import { Calendar } from './Calendar';
import { ShareButton, ShareSheet } from './ShareSheet';

/** What a wallet holds and has done. The same view for your own portfolio and for any trader's profile. */
export function WalletActivity({ address, emptyHoldings, children }: { address: string; emptyHoldings?: React.ReactNode; children?: React.ReactNode }) {
  const now = useNow();
  const { money, signed, usd } = useFormat();
  const [share, setShare] = useState<(() => Promise<TradeCard>) | null>(null);
  const { data } = useLive<WalletData>(`/api/v1/wallet/${address}`, (t, d) => t === 'trade' || (t === 'launch' && d.creator === address), 500);

  const value = data?.holdings.reduce((s, h) => s + h.value, 0) ?? 0;
  const pnl = data ? value + data.totals.received - data.totals.spent : 0;
  const volume = data ? data.totals.spent + data.totals.received : 0;

  const decided = data ? data.stats.wins + data.stats.losses : 0;
  const stats: Array<[string, string, string]> = [
    ['Holdings', money(value), ''],
    ['Profit and loss', signed(pnl), pnl > 0 ? 'text-up' : pnl < 0 ? 'text-down' : ''],
    ['Win rate', decided ? `${Math.round(((data?.stats.wins ?? 0) / decided) * 100)}%` : '0%', ''],
    ['Volume', money(volume), ''],
    ['Trades', String(data?.totals.trades ?? 0), ''],
  ];

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {share && <ShareSheet load={share} onClose={() => setShare(null)} />}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {stats.map(([k, v, tone]) => (
          <div key={k} className="panel px-4 py-3">
            <dt className="text-[13px] text-muted">{k}</dt>
            <dd className={cn('num mt-0.5 truncate text-[20px] font-bold tracking-tight', tone)}>{v}</dd>
          </div>
        ))}
      </dl>

      <section className="panel p-4">
        <h2 className="mb-1 font-semibold">Holdings</h2>
        {data && !data.holdings.length && (emptyHoldings ?? <Empty title="No holdings" />)}
        {!!data?.holdings.length && (
          <table className="w-full text-[14px]">
            <thead className="text-[13px] text-faint">
              <tr>
                <th className="py-1.5 text-left font-normal">Token</th>
                <th className="hidden py-1.5 text-right font-normal sm:table-cell">Amount</th>
                <th className="py-1.5 text-right font-normal">Value</th>
                <th className="py-1.5 text-right font-normal">Result</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="num">
              {data.holdings.map((h) => {
                const result = h.value + h.received - h.spent;
                return (
                  <tr key={h.token}>
                    <td className="py-1.5">
                      <Link href={`/tokens/${h.token}`} className="flex items-center gap-2.5 font-semibold transition-colors hover:text-accent">
                        <Avatar address={h.token} uri={h.uri} size={28} />
                        {h.symbol}
                      </Link>
                    </td>
                    <td className="hidden py-1.5 text-right text-muted sm:table-cell">{compact(h.amount)}</td>
                    <td className="py-1.5 text-right">{money(h.value)}</td>
                    <td className={cn('py-1.5 text-right', result > 0 ? 'text-up' : result < 0 ? 'text-down' : 'text-muted')}>{signed(result)}</td>
                    <td className="py-1.5 pl-1 text-right">
                      {h.spent > 0 && (
                        <ShareButton
                          className="ml-auto"
                          onPress={() => setShare(() => async () => ({ symbol: h.symbol, token: h.token, image: h.uri ?? null, invested: h.spent, out: h.value + h.received, profit: result, ratio: result / h.spent, open: true, ts: Math.floor(Date.now() / 1000), usd }))}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {children}

      <Calendar address={address} />

      {!!data?.closed.length && (
        <section className="panel p-4">
          <h2 className="mb-1 font-semibold">
            Closed <span className="num font-medium text-faint">{data.closed.length}</span>
          </h2>
          <ul className="text-[14px]">
            {data.closed.slice(0, 12).map((c) => {
              const result = c.received - c.spent;
              return (
                <li key={c.token}>
                  <div role="button" tabIndex={0} onClick={() => openToken(c.token)} onKeyDown={(e) => e.key === 'Enter' && openToken(c.token)} className="flex h-10 w-full cursor-pointer items-center gap-2.5 text-left transition-colors hover:text-accent">
                    <Avatar address={c.token} uri={c.uri} size={28} />
                    <span className="font-semibold">{c.symbol}</span>
                    <span className="num hidden text-[13px] text-muted sm:inline">
                      paid {money(c.spent)}, took out {money(c.received)}
                    </span>
                    <span className="num ml-auto text-[13px] text-faint">{age(c.closed_at, now)} ago</span>
                    <span className={cn('num w-[84px] text-right', result > 0 ? 'text-up' : result < 0 ? 'text-down' : 'text-muted')}>{signed(result)}</span>
                    {c.spent > 0 ? <ShareButton onPress={() => setShare(() => async () => ({ symbol: c.symbol, token: c.token, image: c.uri ?? null, invested: c.spent, out: c.received, profit: result, ratio: result / c.spent, open: false, ts: c.closed_at, usd }))} /> : <span className="w-7" />}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!!data?.launched.length && (
        <section className="panel p-4">
          <h2 className="mb-1 font-semibold">Launched</h2>
          <ul className="text-[14px]">
            {data.launched.map((t) => (
              <li key={t.address}>
                <Link href={`/tokens/${t.address}`} className="flex h-10 items-center gap-2.5 transition-colors hover:text-accent">
                  <Avatar address={t.address} uri={t.uri} size={28} />
                  <span className="font-semibold">{t.symbol}</span>
                  <span className="num ml-auto text-muted">{t.graduated ? 'On a pool' : `${compact(t.raised)} of 15 ZRO raised`}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel p-4">
        <h2 className="mb-1 font-semibold">History</h2>
        {data && !data.trades.length && <Empty title="No trades yet" />}
        <ul className="text-[14px]">
          {data?.trades.map((t) => (
            <li key={`${t.tx_hash}${t.log_index}`}>
              <div className="flex h-10 items-center gap-1">
                <Link href={`/tokens/${t.token}`} className="flex min-w-0 flex-1 items-center gap-2.5 transition-colors hover:text-accent">
                  <Avatar address={t.token} uri={t.uri} size={28} />
                  <span className={cn('w-8', t.is_buy ? 'text-up' : 'text-down')}>{t.is_buy ? 'Buy' : 'Sell'}</span>
                  <span className="font-semibold">{t.symbol}</span>
                  <span className="num text-muted">{money(t.zro)}</span>
                  <span className="num ml-auto text-faint">{age(t.ts, now)} ago</span>
                </Link>
                {!t.is_buy ? <ShareButton onPress={() => setShare(() => () => saleCard(address, { token: t.token, symbol: t.symbol ?? '', uri: t.uri, ts: t.ts, zro: t.zro, amount: t.amount }, usd))} /> : <span className="w-7" />}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
