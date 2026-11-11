'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn, percent, short } from '@/lib/format';
import { LABEL_NAMES, walletRecord, type WalletRecord } from '@/lib/insight';
import { useFormat } from '@/lib/money';
import { tracked, useTracked } from '@/lib/tracked';
import { useWallet } from '@/lib/wallet';
import { Avatar, Empty } from '@/components/bits';
import { WalletPic } from '@/components/WalletPic';
import { profileOf } from '@/lib/profiles';
import { WalletActivity } from '@/components/WalletActivity';
import { RankCard } from '@/components/RankCard';

function duration(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
  return `${(s / 86400).toFixed(1)}d`;
}

const SIZES: Array<[keyof WalletRecord['sizes'], string]> = [
  ['under_0_01', 'Under 5 ZRO'],
  ['to_0_1', '5 to 50 ZRO'],
  ['to_1', '50 to 500 ZRO'],
  ['over_1', '500 ZRO or more'],
];

/** How the wallet did over the last 7 or 30 days, what it buys at, and anything in its trading that looks off. */
function RecordSection({ address }: { address: string }) {
  const { money, signed } = useFormat();
  const [days, setDays] = useState<7 | 30>(30);
  const [record, setRecord] = useState<WalletRecord | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    walletRecord(address, days)
      .then((r) => live && setRecord(r))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [address, days]);

  // Keep the last answer on screen while the other period loads, only dimmed.
  const stale = record !== null && record.days !== days;
  const r = record;
  const tone = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : '');
  const figures: Array<[string, string, string]> = r
    ? [
        ['Profit and loss', signed(r.pnl), tone(r.pnl)],
        ['Realized', signed(r.realized), tone(r.realized)],
        ['Return', percent(r.roi), tone(r.roi)],
        ['Tokens traded', String(r.tokens), ''],
        ['Win rate', `${Math.round(r.win_rate * 100)}%`, ''],
        ['Average hold', r.avg_hold_seconds > 0 ? duration(r.avg_hold_seconds) : 'None closed', ''],
      ]
    : [];
  const mostBuys = r ? Math.max(1, ...SIZES.map(([k]) => r.sizes[k])) : 1;
  const totalBuys = r ? SIZES.reduce((s, [k]) => s + r.sizes[k], 0) : 0;

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="font-semibold">Record</h2>
          {r?.labels.map((l) => (
            <span key={l} title={LABEL_NAMES[l].long} className={cn('rounded px-1.5 text-[11px] font-semibold', l === 'smart' ? 'bg-accent/15 text-accent' : 'bg-white/[.08] text-ink')}>
              {LABEL_NAMES[l].short}
            </span>
          ))}
        </div>
        <div className="flex gap-0.5" role="radiogroup" aria-label="Period">
          {([7, 30] as const).map((d) => (
            <button key={d} role="radio" aria-checked={days === d} onClick={() => setDays(d)} className={cn('pill', days === d && 'pill-on')}>
              {d} days
            </button>
          ))}
        </div>
      </div>

      {!r && (failed ? <Empty title="Can't load the record" body="The indexer isn't answering. Try again in a moment." /> : <div className="mt-3 h-24 animate-pulse rounded-xl bg-white/[.03]" />)}

      {r && (
        <div className={cn('transition-opacity', stale && 'opacity-50')}>
          <p className="mt-0.5 text-[13px] text-muted">
            {r.tokens ? `Spent ${money(r.spent)} on ${r.tokens} ${r.tokens === 1 ? 'token' : 'tokens'}, ${r.wins} in profit.` : `No trades in the last ${r.days} days.`}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
            {figures.map(([k, v, t]) => (
              <div key={k}>
                <dt className="text-[13px] text-muted">{k}</dt>
                <dd className={cn('num mt-0.5 truncate text-[18px] font-bold tracking-tight', t)}>{v}</dd>
              </div>
            ))}
          </dl>

          {(r.flags.sold_more_than_bought > 0 || r.flags.quick_flips > 0) && (
            <ul className="mt-3 space-y-1 rounded-xl bg-white/[.04] px-3 py-2 text-[13px] leading-snug">
              {r.flags.sold_more_than_bought > 0 && (
                <li>
                  Sold more than it bought on <span className="num">{r.flags.sold_more_than_bought}</span> {r.flags.sold_more_than_bought === 1 ? 'token' : 'tokens'}, so some of those coins came from another wallet.
                </li>
              )}
              {r.flags.quick_flips > 0 && (
                <li>
                  <span className="num">{r.flags.quick_flips}</span> {r.flags.quick_flips === 1 ? 'sale came' : 'sales came'} within 10 seconds of buying.
                </li>
              )}
            </ul>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-1.5 text-[13px] text-muted">Buy sizes</h3>
              {totalBuys === 0 ? (
                <p className="text-[13px] text-faint">No buys in this period.</p>
              ) : (
                <ul className="space-y-1.5">
                  {SIZES.map(([k, label]) => (
                    <li key={k} className="grid grid-cols-[112px_minmax(0,1fr)_36px] items-center gap-2 text-[13px]">
                      <span className="num text-muted">{label}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-white/[.06]">
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${(r.sizes[k] / mostBuys) * 100}%` }} />
                      </span>
                      <span className="num text-right">{r.sizes[k]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-0.5 text-[13px] text-muted">Best tokens</h3>
              {r.best.length === 0 ? (
                <p className="text-[13px] text-faint">Nothing traded in this period.</p>
              ) : (
                <ul className="text-[14px]">
                  {r.best.map((b) => (
                    <li key={b.token}>
                      <Link href={`/tokens/${b.token}`} className="flex h-9 items-center gap-2.5 transition-colors hover:text-accent">
                        <Avatar address={b.token} size={24} />
                        <span className="font-semibold">{b.symbol}</span>
                        <span className="num hidden truncate text-[13px] text-muted sm:inline">
                          paid {money(b.spent)}, worth {money(b.received + b.value)}
                        </span>
                        <span className={cn('num ml-auto', tone(b.pnl) || 'text-muted')}>{signed(b.pnl)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default function TraderPage() {
  const address = String(useParams().address).toLowerCase();
  const valid = /^0x[0-9a-f]{40}$/.test(address);
  const list = useTracked();
  const me = useWallet((s) => s.account?.address.toLowerCase());
  const following = list.some((t) => t.address === address);
  // Your own name for it if you follow it, otherwise the one it gave itself.
  const name = list.find((t) => t.address === address)?.label ?? profileOf(address)?.name ?? undefined;

  if (!valid) {
    return (
      <div className="mx-auto max-w-md px-3 pt-16">
        <section className="panel">
          <Empty title="That isn't a wallet address" />
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <section className="panel flex items-center gap-4 p-4">
        <WalletPic address={address} size={52} />
        <div className="min-w-0 flex-1 leading-snug">
          <h1 className="num truncate text-[20px] font-bold tracking-tight">{address === me ? 'You' : name || short(address, 6, 6)}</h1>
          <button onClick={() => navigator.clipboard.writeText(address)} className="num max-w-full truncate text-[13px] text-muted transition-colors hover:text-ink" title="Copy address">
            {address}
          </button>
        </div>
        {address !== me && (
          <div className="flex shrink-0 gap-1.5">
            <button onClick={() => (following ? tracked.remove(address) : tracked.add(address))} className={following ? 'btn btn-soft h-10' : 'btn btn-accent h-10'}>
              {following ? 'Following' : 'Follow'}
            </button>
            <Link href={`/copy?leader=${address}`} className="btn btn-soft h-10" title="Repeat its trades automatically, with your own limits">
              Copy trades
            </Link>
          </div>
        )}
      </section>
      <RankCard address={address} own={address === me} />
      <RecordSection key={address} address={address} />
      <WalletActivity address={address} />
    </div>
  );
}
