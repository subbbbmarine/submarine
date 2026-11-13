'use client';

import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { IS_LOCAL, type Deployment } from '@/lib/config';
import { CopyButton } from './CopyButton';
import { OLD_CHAIN_ID, ZERO_DEPLOYMENT } from './deployment';

const ROWS: Array<[keyof Deployment, string, string]> = [
  ['launchpad', 'Launchpad', 'Launches tokens and runs their curves'],
  ['pools', 'ZroInfinityPools', 'The hook of every graduated token\'s pool'],
  ['poolVenue', 'ZroInfinityVenue', 'How the router trades the pools'],
  ['infinityVault', 'Infinity Vault', 'Holds every pool\'s ZRO and tokens'],
  ['poolManager', 'Infinity CLPoolManager', 'Runs the pools'],
  ['router', 'Router', 'Best price across venues, volume ranks'],
  ['limitOrders', 'LimitOrders', 'Orders, TP and SL, trailing, DCA'],
  ['vault', 'BuybackVault', 'The treasury, which can only buy and burn'],
  ['copyVault', 'CopyVault', 'Copy trading with the browser closed'],
  ['agentVaultFactory', 'AgentVaultFactory', 'Makes agent vaults, each owned by whoever makes it'],
  ['referrals', 'Referrals', 'Links and referral earnings'],
];

export function Addresses() {
  const [live, setLive] = useState<Deployment | null | undefined>(undefined);
  useEffect(() => {
    // The docs on their own come before launch, with no API to ask.
    if (process.env.NEXT_PUBLIC_DOCS_ONLY === '1') return setLive(null);
    get<{ chainId?: number; deployment: Deployment | null }>('/health')
      // An API still serving the earlier test chain's deployment is not Submarine on Zero, so its addresses are never shown here.
      .then((h) => setLive(h.chainId === OLD_CHAIN_ID ? null : h.deployment))
      .catch(() => setLive(null));
  }, []);
  const shown: Partial<Deployment> = live ?? (IS_LOCAL ? {} : ZERO_DEPLOYMENT ?? {});
  const any = ROWS.some(([k]) => shown[k]);
  return (
    <div className="mt-4">
      <p className="text-[13px] text-faint">
        {live === undefined
          ? 'Checking the live deployment…'
          : live
            ? IS_LOCAL
              ? 'Live, from the API. These are on the local demo chain only.'
              : 'Live, from the API.'
            : any
              ? 'The API did not answer, so this is the list these docs were built with.'
              : 'Not deployed on Zero yet. Addresses appear here once it is.'}
      </p>
      {any && (
        <div className="mt-2 divide-y divide-white/[.06] rounded-xl border border-white/[.06]">
          {ROWS.filter(([k]) => shown[k]).map(([k, name, what]) => (
            <div key={k} className="flex flex-col gap-1 px-3.5 py-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="sm:w-[190px] sm:shrink-0">
                <p className="font-semibold text-ink">{name}</p>
                <p className="text-[13px] leading-snug text-muted">{what}</p>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <code className="num min-w-0 flex-1 break-all text-[13px] text-ink/90">{shown[k]}</code>
                <CopyButton text={String(shown[k])} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
