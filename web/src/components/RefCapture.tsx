'use client';

import { useEffect, useState } from 'react';
import { short } from '@/lib/format';
import { captureRef, dismissRef, linkReferrer, readReferrer, storedRef, useStoredRef } from '@/lib/referral';
import { useWallet } from '@/lib/wallet';

/** Keeps a ?ref= link's referrer, and offers to link to it while this wallet has no referrer on chain. */
export default function RefCapture() {
  const account = useWallet((s) => s.account);
  const balance = useWallet((s) => s.balance);
  const { ref: kept, dismissed } = useStoredRef();
  const ref = storedRef(kept);
  const [unlinked, setUnlinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    captureRef();
  }, []);

  useEffect(() => {
    setUnlinked(false);
    if (!account || !ref) return;
    let live = true;
    readReferrer(account.address)
      .then((referrer) => live && setUnlinked(referrer === null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [account, ref]);

  if (!account || !ref || !unlinked || dismissed === ref) return null;

  const link = async () => {
    setBusy(true);
    setError(null);
    try {
      await linkReferrer(ref);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="animate-fade panel fixed bottom-3 right-3 z-40 w-[calc(100%-1.5rem)] max-w-[340px] p-4 shadow-[0_20px_60px_rgb(0_0_0_/_.5)]" role="status">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold">You were invited</p>
        <button onClick={dismissRef} className="text-[13px] text-muted transition-colors hover:text-ink">
          Close
        </button>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Link to <span className="num text-ink">{short(ref)}</span> and get 10% of the platform&apos;s cut of your trades back as cashback. A wallet links once, for good.
      </p>
      <button onClick={link} disabled={busy || balance <= 0} className="btn btn-accent mt-3 h-10 w-full">
        {busy ? 'Linking' : 'Link and get cashback'}
      </button>
      {balance <= 0 && <p className="mt-1.5 text-[12px] text-faint">Linking costs a little gas. Add ZRO first.</p>}
      {error && <p className="mt-1.5 text-[13px] text-down">{error}</p>}
    </div>
  );
}
