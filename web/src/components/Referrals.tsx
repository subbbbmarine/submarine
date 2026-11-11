'use client';

import { useCallback, useEffect, useState } from 'react';
import { encodeFunctionData, formatEther, zeroAddress } from 'viem';
import { getDeployment } from '@/lib/api';
import { REFERRALS_ABI } from '@/lib/config';
import { short } from '@/lib/format';
import { referralInfo, type ReferralInfo } from '@/lib/insight';
import { useFormat } from '@/lib/money';
import { captureRef, linkReferrer, storedRef, useStoredRef } from '@/lib/referral';
import { send } from '@/lib/tx';
import { publicClient, useWallet } from '@/lib/wallet';

interface Chain {
  contract: `0x${string}`;
  earned: bigint;
  referrer: string | null;
  count: number;
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-white/[.04] px-3 py-2.5">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={`num mt-0.5 font-semibold ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

/** A wallet's referral link and what it has brought in. What can be claimed is read from the contract, not the indexer. */
export function Referrals() {
  const account = useWallet((s) => s.account);
  const { money } = useFormat();
  const kept = useStoredRef((s) => s.ref);
  const pending = storedRef(kept);
  const [chain, setChain] = useState<Chain | null | undefined>(undefined);
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<'claim' | 'link' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const me = account?.address;

  const load = useCallback(async () => {
    if (!me) return;
    try {
      const { referrals } = await getDeployment();
      if (!referrals) return setChain(null);
      const at = { address: referrals, abi: REFERRALS_ABI, args: [me] } as const;
      const [earned, referrer, count] = await Promise.all([
        publicClient.readContract({ ...at, functionName: 'earned' }),
        publicClient.readContract({ ...at, functionName: 'referrerOf' }),
        publicClient.readContract({ ...at, functionName: 'referredCount' }),
      ]);
      setChain({ contract: referrals, earned, referrer: referrer === zeroAddress ? null : referrer.toLowerCase(), count: Number(count) });
    } catch {}
    referralInfo(me.toLowerCase())
      .then(setInfo)
      .catch(() => {});
  }, [me]);

  useEffect(() => {
    captureRef(); // harmless if RefCapture already did it, and makes a stored invite show here without it
    void load();
    const id = setInterval(() => void load(), 15_000);
    return () => clearInterval(id);
  }, [load]);

  if (!me || !chain) return null;

  const link = `${typeof window === 'undefined' ? '' : window.location.origin}/?ref=${me}`;
  const unclaimed = Number(formatEther(chain.earned));

  const copy = () => {
    void navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const claim = async () => {
    setBusy('claim');
    try {
      await send({ label: 'Claim referral earnings', to: chain.contract, data: encodeFunctionData({ abi: REFERRALS_ABI, functionName: 'claim' }) });
      await load();
    } catch {
      // the confirmation card says what went wrong
    }
    setBusy(null);
  };
  const linkTo = async (ref: string) => {
    setBusy('link');
    setError(null);
    try {
      await linkReferrer(ref);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(null);
  };

  return (
    <section className="panel p-4">
      <h2 className="font-semibold">Invite friends</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        When someone opens your link and links their wallet, 40% of the platform&apos;s cut of their trades is shared out: three quarters to you, one quarter back to them as cashback. It runs for as long as they trade.
      </p>

      <div className="mt-3 flex items-center gap-1.5">
        <code className="num min-w-0 flex-1 truncate rounded-lg bg-white/5 px-2.5 py-2 text-[13px]">{link}</code>
        <button onClick={copy} className="btn btn-soft h-9 shrink-0 px-3 text-[13px]">
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Figure label="Joined" value={String(Math.max(chain.count, info?.referred ?? 0))} />
        <Figure label="From referrals" value={money(info?.from_referrals ?? 0)} />
        <Figure label="Your cashback" value={money(info?.cashback ?? 0)} />
        <Figure label="Ready to claim" value={money(unclaimed)} tone={unclaimed > 0 ? 'text-accent' : undefined} />
      </div>
      <button onClick={claim} disabled={busy !== null || chain.earned === 0n} className="btn btn-accent mt-3 h-10 w-full">
        {busy === 'claim' ? 'Claiming' : 'Claim'}
      </button>

      <div className="mt-3 text-[13px] text-muted">
        {chain.referrer ? (
          <>
            Linked to <span className="num text-ink">{short(chain.referrer)}</span>, so you get cashback on your trades.
          </>
        ) : pending ? (
          <div className="flex items-center justify-between gap-3">
            <span>You were invited by {short(pending)}.</span>
            <button onClick={() => void linkTo(pending)} disabled={busy !== null} className="btn btn-soft h-8 shrink-0 px-3 text-[13px]">
              {busy === 'link' ? 'Linking' : `Link to ${short(pending)}`}
            </button>
          </div>
        ) : (
          'Not linked to anyone. Open a friend’s link to get cashback on your trades.'
        )}
      </div>
      {error && <p className="mt-1.5 text-[13px] text-down">{error}</p>}
    </section>
  );
}
