'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { get, useLive } from '@/lib/api';
import { cn, short } from '@/lib/format';
import { nameOf } from '@/lib/tracked';
import { openWallet } from '@/lib/selection';
import { useWallet } from '@/lib/wallet';
import { WalletPic } from '@/components/WalletPic';
import { Empty } from '@/components/bits';

interface Rules {
  perZroTraded: number;
  perZroOnYourCoins: number;
  perZroElsewhere: number;
  minVolume: number;
}
interface Score {
  address: string;
  points: number;
  traded: number;
  onCoins: number;
  elsewhere: number;
  live: boolean;
  place?: number | null;
}
interface Mine extends Score {
  wallets: number;
  total: number;
  share: number;
  rules: Rules;
}

const points = (n: number) => Math.round(n).toLocaleString('en-US');
const zros = (n: number) => (n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 1 ? n.toFixed(2) : n.toFixed(3));

/** What one wallet has, for any address: nothing to connect and nothing to sign. */
function Lookup({ initial }: { initial: string }) {
  const [draft, setDraft] = useState(initial);
  const [shown, setShown] = useState(initial);
  const [data, setData] = useState<Mine | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (initial && !shown) {
      setDraft(initial);
      setShown(initial);
    }
  }, [initial, shown]);
  useEffect(() => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(shown)) return setData(null);
    let live = true;
    setError('');
    get<Mine>(`/api/v1/points/${shown.toLowerCase()}`)
      .then((d) => live && setData(d))
      .catch(() => live && setError("Points can't be read right now. Try again in a moment."));
    return () => {
      live = false;
    };
  }, [shown]);

  const need = data && !data.live ? Math.max(data.rules.minVolume - data.traded, 0) : 0;
  return (
    <section className="panel p-5">
      <h2 className="text-[17px] font-semibold">What an address has</h2>
      <form
        className="mt-3 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^0x[0-9a-fA-F]{40}$/.test(draft.trim())) setShown(draft.trim());
          else setError('That is not a wallet address.');
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="0x..." spellCheck={false} className="field num h-11 min-w-0 flex-1 text-[14px]" aria-label="Wallet address" />
        <button className="btn btn-accent h-11 px-5">Check</button>
      </form>
      {error && <p className="mt-2 text-[13px] text-down">{error}</p>}

      {data && (
        <div className="animate-fade mt-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[13px] text-muted">{data.live ? `Place ${data.place} of ${data.wallets}` : 'Not counting yet'}</div>
              <div className="num mt-0.5 text-[40px] font-semibold leading-none tracking-tight">{points(data.points)}</div>
              <div className="mt-1 text-[13px] text-muted">points</div>
            </div>
            {data.live && data.share > 0 && (
              <div className="text-right">
                <div className="text-[13px] text-muted">Share of all points</div>
                <div className="num mt-0.5 text-[20px] font-semibold">{`${(data.share * 100).toFixed(data.share < 0.01 ? 3 : 2)}%`}</div>
              </div>
            )}
          </div>
          {!data.live && <p className="mt-3 rounded-[9px] bg-accent/10 px-3.5 py-2.5 text-[13px] leading-snug text-ink">{`Trade ${zros(need)} ZRO more through the terminal and these points start to count.`}</p>}
          <dl className="mt-4 grid gap-1.5 sm:grid-cols-3">
            {[
              ['Trading here', data.traded, data.rules.perZroTraded],
              ['Your coins', data.onCoins, data.rules.perZroOnYourCoins],
              ['Elsewhere on Zero', data.elsewhere, data.rules.perZroElsewhere],
            ].map(([label, v, per]) => (
              <div key={label as string} className="rounded-[9px] bg-white/[.04] px-3.5 py-3">
                <dt className="text-[12.5px] text-muted">{label}</dt>
                <dd className="num mt-1 text-[17px] font-semibold">{points((v as number) * (per as number))}</dd>
                <dd className="num text-[12px] text-faint">{`${zros(v as number)} ZRO`}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}

function Leaders() {
  const { data } = useLive<{ total: number; wallets: number; leaders: Score[] }>('/api/v1/points/leaders?limit=50', (t) => t === 'trade', 5000);
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-4 pb-2 pt-4">
        <h2 className="text-[17px] font-semibold">Most points</h2>
        {data && <span className="num text-[13px] text-muted">{`${data.wallets} wallets counting`}</span>}
      </div>
      {!data ? (
        <div className="h-64 animate-pulse" />
      ) : data.leaders.length === 0 ? (
        <Empty title="Nobody has points yet" body="The first trade through the terminal starts the list." />
      ) : (
        <table className="w-full text-[13px]">
          <thead className="text-left text-[12px] text-faint">
            <tr>
              <th className="w-12 px-4 py-2 font-medium">Place</th>
              <th className="py-2 font-medium">Wallet</th>
              <th className="hidden py-2 text-right font-medium sm:table-cell">Traded</th>
              <th className="px-4 py-2 text-right font-medium">Points</th>
            </tr>
          </thead>
          <tbody>
            {data.leaders.map((s) => (
              <tr key={s.address} onClick={() => openWallet(s.address)} className="cursor-pointer border-t border-white/[.05] transition-colors hover:bg-white/[.03]">
                <td className={cn('num px-4 py-2.5', (s.place ?? 99) <= 3 ? 'font-semibold text-accent' : 'text-muted')}>{s.place}</td>
                <td className="py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <WalletPic address={s.address} size={22} />
                    <span className="num truncate">{nameOf(s.address) || short(s.address, 6, 4)}</span>
                  </span>
                </td>
                <td className="num hidden py-2.5 text-right text-muted sm:table-cell">{`${zros(s.traded)} ZRO`}</td>
                <td className="num px-4 py-2.5 text-right font-semibold">{points(s.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function PointsPage() {
  const me = useWallet((s) => s.account?.address) ?? '';
  const [rules, setRules] = useState<Rules | null>(null);
  useEffect(() => {
    get<{ rules: Rules }>('/api/v1/points/rules')
      .then((d) => setRules(d.rules))
      .catch(() => {});
  }, []);

  return (
    <div className="mx-auto grid max-w-[1180px] gap-2 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="flex min-w-0 flex-col gap-2">
        <section className="panel p-5 sm:p-6">
          <h1 className="text-[30px] font-bold leading-tight tracking-tight">Points</h1>
          <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-muted">
            Every trade through the terminal and every coin you launch here earns points, counted straight from the chain. They go toward a reward for the people who use the terminal early. What the reward is and when it comes gets announced later.
          </p>
          {rules && (
            <ul className="mt-5 grid gap-1.5 sm:grid-cols-3">
              <li className="rounded-[9px] bg-accent/10 px-3.5 py-3">
                <div className="num text-[22px] font-bold text-accent">{rules.perZroTraded}</div>
                <div className="text-[13px] font-medium">points per ZRO you trade here</div>
                <div className="mt-1 text-[12px] leading-snug text-muted">Buys and sales, on any coin the terminal trades.</div>
              </li>
              <li className="rounded-[9px] bg-white/[.04] px-3.5 py-3">
                <div className="num text-[22px] font-bold">{rules.perZroOnYourCoins}</div>
                <div className="text-[13px] font-medium">per ZRO others trade on your coins</div>
                <div className="mt-1 text-[12px] leading-snug text-muted">
                  For every coin you <Link href="/launch" className="text-accent hover:underline">launch</Link> here.
                </div>
              </li>
              <li className="rounded-[9px] bg-white/[.04] px-3.5 py-3">
                <div className="num text-[22px] font-bold">{rules.perZroElsewhere}</div>
                <div className="text-[13px] font-medium">per ZRO on other launchpads</div>
                <div className="mt-1 text-[12px] leading-snug text-muted">Traded on them directly, anywhere on Zero.</div>
              </li>
            </ul>
          )}
          {rules && <p className="mt-3 text-[13px] text-faint">{`Points start to count once a wallet has traded ${rules.minVolume} ZRO through the terminal. The board is live and every trade can move it.`}</p>}
        </section>
        <Leaders />
      </div>
      <aside className="flex flex-col gap-2 lg:sticky lg:top-0 lg:self-start">
        <Lookup initial={me} />
      </aside>
    </div>
  );
}
