'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { encodeFunctionData, formatEther, numberToHex, parseEther, type Address } from 'viem';
import { getDeployment, useLive, type WalletData } from '@/lib/api';
import { HOLDER_TOKEN_ABI, IS_LOCAL, LAUNCHPAD_ABI } from '@/lib/config';
import { zro, usdText } from '@/lib/format';
import { useFormat } from '@/lib/money';
import { send } from '@/lib/tx';
import { isExtension, publicClient, useWallet } from '@/lib/wallet';
import { Empty } from '@/components/bits';
import { OrdersPanel } from '@/components/Orders';
import { Referrals } from '@/components/Referrals';
import { WalletActivity } from '@/components/WalletActivity';
import { AccountTabs } from '@/components/Wallets';
import { AlertSettings } from '@/components/Alerts';
import { RankCard } from '@/components/RankCard';

function WalletCard() {
  const { account, balance, exportKey, importKey, forget, refreshBalance, hasPin, checkPin } = useWallet();
  const { usd } = useFormat();
  const [reveal, setReveal] = useState<string | null>(null);
  // With a PIN set, the key shows only after the PIN is typed again, so an unlocked tab left open doesn't hand it over.
  const [asking, setAsking] = useState(false);
  const [pin, setPin] = useState('');
  const [pinWrong, setPinWrong] = useState(false);
  const [importing, setImporting] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!account) return null;

  const faucet = async () => {
    const current = await publicClient.getBalance({ address: account.address });
    await publicClient.request({ method: 'anvil_setBalance' as never, params: [account.address, numberToHex(current + parseEther('40000'))] as never });
    await refreshBalance();
  };

  return (
    <section className="panel p-5">
      <div className="text-[13px] text-muted">Balance</div>
      <div className="num mt-0.5 text-[36px] font-bold leading-none tracking-tight">
        {zro(balance)} <span className="text-[18px] font-semibold text-muted">ZRO</span>
      </div>
      {usd && balance > 0 && <div className="num mt-1 text-muted">{usdText(balance * usd)}</div>}

      {IS_LOCAL ? (
        <button onClick={faucet} className="btn btn-accent mt-4 h-11 w-full">
          Get 40,000 test ZRO
        </button>
      ) : (
        <p className="mt-4 text-[13px] leading-snug text-muted">Send ZRO on Zero to the address below to start trading.</p>
      )}

      <div className="mt-4 text-[13px] text-muted">Your address</div>
      <button onClick={() => navigator.clipboard.writeText(account.address)} className="num mt-0.5 break-all text-left text-[13px] transition-colors hover:text-accent" title="Copy address">
        {account.address}
      </button>

      {isExtension(account) ? (
        <p className="mt-4 rounded-xl bg-white/[.04] p-3.5 text-[13px] leading-relaxed text-muted">This wallet lives in your browser extension. Every trade asks it to confirm. Pick one of your wallets below to trade without popups.</p>
      ) : (
      <div className="mt-4 rounded-xl bg-white/[.04] p-3.5">
        <p className="text-[13px] leading-relaxed text-muted">The key to this wallet is kept only in this browser and only for this address of the site, so trades sign themselves. Anyone with access to this browser can use it. Back it up and keep only trading money here.</p>
        {reveal ? (
          <div className="animate-fade mt-2.5">
            <code className="block break-all rounded-lg bg-black/40 p-2.5 text-xs text-accent">{reveal}</code>
            <button onClick={() => setReveal(null)} className="btn btn-soft mt-2 h-9 w-full">
              Hide key
            </button>
          </div>
        ) : (
          <div className="mt-2.5 grid grid-cols-2 gap-1.5">
            <button onClick={() => (hasPin ? setAsking((v) => !v) : setReveal(exportKey()))} className="btn btn-soft h-9 px-2">
              Show key
            </button>
            <button onClick={() => setImporting((v) => !v)} className="btn btn-soft h-9 px-2">
              Use another key
            </button>
          </div>
        )}
        {asking && !reveal && (
          <form
            className="animate-fade mt-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await checkPin(pin)) {
                setReveal(exportKey());
                setAsking(false);
                setPin('');
                setPinWrong(false);
              } else setPinWrong(true);
            }}
          >
            <div className="flex gap-1.5">
              <input type="password" autoComplete="current-password" autoFocus value={pin} onChange={(e) => (setPin(e.target.value), setPinWrong(false))} placeholder="Your PIN" className="field h-9 min-w-0 flex-1 text-[13px]" />
              <button className="btn btn-soft h-9 px-3">Show</button>
            </div>
            {pinWrong && <p className="mt-1.5 text-[12px] text-down">That PIN doesn't open this browser's keys.</p>}
          </form>
        )}
        {importing && (
          <form
            className="animate-fade mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              try {
                importKey(draft);
                setDraft('');
                setImporting(false);
                setError(null);
              } catch {
                setError('That is not a valid private key');
              }
            }}
          >
            <input type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} className="field h-9 min-w-0 flex-1 text-[13px]" placeholder="Private key" />
            <button className="btn btn-soft h-9">Use</button>
          </form>
        )}
        {importing && <p className="mt-1.5 text-[13px] leading-snug text-muted">It joins your other wallets here and becomes the one in use. This is a test network. Don&apos;t paste a key that holds real money.</p>}
        {error && <p className="mt-1.5 text-[13px] text-down">{error}</p>}
      </div>
      )}
      <button
        onClick={() => {
          if (window.confirm('Remove this wallet from the browser? Without a backup of the key, its funds are gone for good.')) forget();
        }}
        className="mt-3 text-[13px] text-faint transition-colors hover:text-down"
      >
        Remove wallet from this browser
      </button>
    </section>
  );
}

/** What this wallet can claim from tokens that pay their holders. It stays claimable after selling, so it's listed from what it ever traded. */
function HolderRewards() {
  const account = useWallet((s) => s.account);
  const owner = account?.address;
  const { data } = useLive<WalletData>(owner ? `/api/v1/wallet/${owner.toLowerCase()}` : null, (t) => t === 'trade', 2000);
  const list = data?.reward_tokens;
  const key = list?.map((t) => t.token).join() ?? '';
  const [owed, setOwed] = useState<Array<{ token: string; symbol: string; amount: bigint }>>([]);
  const load = useCallback(async () => {
    if (!owner || !list?.length) return;
    const found = await Promise.all(
      list.map(async (t) => ({ ...t, amount: await publicClient.readContract({ address: t.token as Address, abi: HOLDER_TOKEN_ABI, functionName: 'rewardOf', args: [owner] }).catch(() => 0n) })),
    );
    setOwed(found.filter((t) => t.amount > 0n));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, key]);
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 8000);
    return () => clearInterval(id);
  }, [load]);
  if (!owed.length) return null;
  return (
    <section className="panel p-4">
      <div className="text-[13px] text-muted">Rewards from holding</div>
      <ul className="mt-1.5 space-y-1.5">
        {owed.map((t) => (
          <li key={t.token} className="flex items-center justify-between gap-3">
            <Link href={`/tokens/${t.token}`} className="min-w-0 truncate font-medium transition-colors hover:text-accent">
              {t.symbol}
            </Link>
            <span className="num ml-auto font-semibold">{zro(Number(formatEther(t.amount)))} ZRO</span>
            <button
              onClick={async () => {
                try {
                  await send({ label: `Claim ${t.symbol} rewards`, to: t.token as Address, data: encodeFunctionData({ abi: HOLDER_TOKEN_ABI, functionName: 'claim' }) });
                  await load();
                } catch {}
              }}
              className="btn btn-accent h-8 px-3 text-[13px]"
            >
              Claim
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CreatorFees() {
  const account = useWallet((s) => s.account);
  const [fees, setFees] = useState(0n);
  const load = useCallback(async () => {
    if (!account) return;
    try {
      const { launchpad } = await getDeployment();
      setFees(await publicClient.readContract({ address: launchpad, abi: LAUNCHPAD_ABI, functionName: 'creatorFees', args: [account.address] }));
    } catch {}
  }, [account]);
  useEffect(() => {
    void load();
  }, [load]);
  if (fees === 0n) return null;
  const claim = async () => {
    const { launchpad } = await getDeployment();
    try {
      await send({ label: 'Claim creator fees', to: launchpad, data: encodeFunctionData({ abi: LAUNCHPAD_ABI, functionName: 'claimCreatorFees' }) });
      await load();
    } catch {}
  };
  return (
    <section className="panel flex items-center justify-between gap-3 p-4">
      <div className="leading-snug">
        <div className="text-[13px] text-muted">Earned from your tokens</div>
        <div className="num font-semibold">{zro(Number(formatEther(fees)))} ZRO</div>
      </div>
      <button onClick={claim} className="btn btn-accent h-9 px-3.5">
        Claim
      </button>
    </section>
  );
}

export default function PortfolioPage() {
  const { account, create, ready } = useWallet();
  const address = account?.address.toLowerCase();

  if (ready && !account) {
    return (
      <div className="mx-auto max-w-md px-3 pt-16">
        <section className="panel p-8 text-center">
          <h1 className="text-[24px] font-bold tracking-tight">No wallet yet</h1>
          <p className="mt-1.5 text-muted">It takes one click. No seed phrase, no extension and no popups when you trade.</p>
          <button onClick={create} className="btn btn-accent mt-5 h-12 w-full text-[15px]">
            Create wallet
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="grid gap-2 lg:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-2 lg:sticky lg:top-0 lg:self-start">
        <WalletCard />
        {address && <RankCard address={address} own />}
        <AccountTabs alerts={<AlertSettings />} />
        <CreatorFees />
        <HolderRewards />
      </aside>
      {address && (
        <WalletActivity
          address={address}
          emptyHoldings={
            <Empty title="Nothing here yet" body="Buy something and it shows up here.">
              <Link href="/" className="btn btn-soft mt-3 h-10">
                Go to trade
              </Link>
            </Empty>
          }
        >
          <OrdersPanel address={address} />
        </WalletActivity>
      )}
      <div className="lg:col-start-2">
        <Referrals />
      </div>
    </div>
  );
}
