'use client';

import { useState } from 'react';
import { useLive } from '@/lib/api';
import { age, cn } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import type { InflowToken, Window } from '@/lib/insight';
import { useFormat } from '@/lib/money';
import { openToken } from '@/lib/selection';
import { useTracked } from '@/lib/tracked';
import { Avatar, Empty } from './bits';

const WINDOWS: Array<{ key: Window; label: string }> = [
  { key: '5m', label: '5m' },
  { key: '1h', label: '1h' },
  { key: '6h', label: '6h' },
  { key: '24h', label: '24h' },
];

const SPANS: Record<string, string> = { '5m': '5 minutes', '1h': 'hour', '6h': '6 hours', '24h': '24 hours' };

/** Where the wallets you follow put their ZRO over a window, most money in first, and where several of them went in together. */
export function Inflow() {
  const list = useTracked();
  const now = useNow();
  const { signed } = useFormat();
  const [span, setSpan] = useState<Window>('1h');
  const keys = list.map((t) => t.address).join(',');
  const { data } = useLive<{ tokens: InflowToken[] }>(keys ? `/api/v1/inflow?wallets=${keys}&window=${span}` : null, (t, d) => t === 'trade' && keys.includes(d.trader), 1500, true);
  const tokens = keys ? data?.tokens : [];

  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-2.5 pb-1">
        <span className="text-[12px] text-faint">Net in from wallets you follow</span>
        <div className="flex gap-0.5" role="radiogroup" aria-label="Window">
          {WINDOWS.map((w) => (
            <button key={w.key} role="radio" aria-checked={span === w.key} onClick={() => setSpan(w.key)} className={cn('pill num px-2 py-1 text-[12px]', span === w.key && 'pill-on')}>
              {w.label}
            </button>
          ))}
        </div>
      </div>
      {tokens && !tokens.length && <Empty title={`Nothing bought or sold by them in the last ${SPANS[span]}`} />}
      {tokens?.map((t) => (
        <div key={t.token} role="button" tabIndex={0} onClick={() => openToken(t.token)} onKeyDown={(e) => e.key === 'Enter' && openToken(t.token)} className="flex h-[52px] cursor-pointer items-center gap-2.5 rounded-xl px-2.5 transition-colors duration-150 hover:bg-white/[.04]">
          <Avatar address={t.token} uri={t.uri} size={30} />
          <div className="min-w-0 flex-1 leading-snug">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-semibold">{t.symbol}</span>
              {t.together && (
                <span className="shrink-0 rounded bg-accent/15 px-1 text-[10px] font-semibold text-accent" title={`${t.buyers} of the wallets you follow bought it in this window`}>
                  Together
                </span>
              )}
            </div>
            <div className="num truncate text-[12px] text-faint">
              {t.buyers === 1 ? '1 wallet bought' : t.buyers ? `${t.buyers} wallets bought` : 'only sales'}, {age(t.last_ts, now)} ago
            </div>
          </div>
          <span className={cn('num shrink-0', t.net > 0 ? 'text-up' : t.net < 0 ? 'text-down' : 'text-muted')}>{signed(t.net)}</span>
        </div>
      ))}
    </div>
  );
}
