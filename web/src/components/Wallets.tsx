'use client';

import { useEffect, useRef, useState } from 'react';
import { encodeFunctionData, formatEther, isAddress, parseEther, parseUnits, type Address } from 'viem';
import { useLive, type WalletData } from '@/lib/api';
import { ERC20_ABI } from '@/lib/config';
import { zro, cn, short } from '@/lib/format';
import { tokenBalance } from '@/lib/trade';
import { send } from '@/lib/tx';
import { isExtension, MIN_PIN, publicClient, useWallet } from '@/lib/wallet';
import { publishProfile, squarePicture, useProfile } from '@/lib/profiles';
import { WalletPic } from './WalletPic';

/**
 * A wallet's public profile: the name and picture everyone sees next to it, on trades, holders, leaderboards and its own
 * page. The wallet signs the change itself, which costs nothing and sends no transaction.
 */
function ProfileEditor({ address, onSaved, onClose }: { address: string; onSaved: (name: string) => void; onClose: () => void }) {
  const current = useProfile(address);
  const [name, setName] = useState(current?.name ?? '');
  const [picture, setPicture] = useState<string | null | 'same'>('same');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (current?.name && !name) setName(current.name);
    // only when the saved profile first arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.name]);
  const shown = picture === 'same' ? current?.image ?? null : picture;
  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      await publishProfile(address, name, picture);
      setPicture('same');
      onSaved(name.trim());
      setNote({ ok: true, text: 'Published. Everyone sees it now.' });
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message.split('\n')[0]! });
    }
    setBusy(false);
  };
  return (
    <div className="mt-1 space-y-2.5 rounded-xl bg-white/[.04] p-3">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => file.current?.click()} className="group relative shrink-0 rounded-full" title="Choose a picture">
          {shown ? <img src={shown} alt="" className="h-14 w-14 rounded-full object-cover" /> : <WalletPic address={address} size={56} />}
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-[11px] font-semibold opacity-0 transition-opacity group-hover:opacity-100">Change</span>
        </button>
        <label className="min-w-0 flex-1">
          <span className="text-[12px] text-muted">Public name</span>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} placeholder="How others see this wallet" className="field mt-0.5 h-9 w-full text-[13px]" />
        </label>
      </div>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            setPicture(await squarePicture(f));
          } catch (err) {
            setNote({ ok: false, text: (err as Error).message });
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        <button type="button" onClick={() => file.current?.click()} className="btn btn-soft h-8 px-2.5">
          Choose picture
        </button>
        {(shown || current?.image) && (
          <button type="button" onClick={() => setPicture(null)} className="btn btn-soft h-8 px-2.5 text-muted">
            Use the pattern
          </button>
        )}
        <span className="ml-auto" />
        <button type="button" onClick={onClose} className="btn btn-soft h-8 px-2.5 text-muted">
          Close
        </button>
        <button type="button" onClick={save} disabled={busy} className="btn btn-accent h-8 px-3">
          {busy ? 'Signing' : 'Publish'}
        </button>
      </div>
      <p className="text-[11.5px] leading-snug text-faint">Everyone sees this name and picture next to this wallet. The wallet signs the change, free and with no transaction. Up to 24 letters or digits.</p>
      {note && <p className={cn('text-[12px]', note.ok ? 'text-up' : 'text-down')}>{note.text}</p>}
    </div>
  );
}

function ProfileName({ address, fallback }: { address: string; fallback: string }) {
  const profile = useProfile(address);
  return <>{profile?.name ?? fallback}</>;
}

/** Several wallets in one browser: switch, name, add, bring a key or a browser extension, and lock them all with a PIN. */
export function Wallets() {
  const { account, wallets, switchTo, rename, createNamed, importKey, connectExtension } = useWallet();
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState<'new' | 'import' | null>(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const me = account?.address.toLowerCase();
  const key = wallets.map((w) => w.address).join();

  useEffect(() => {
    let live = true;
    Promise.all(wallets.map(async (w) => [w.address, Number(formatEther(await publicClient.getBalance({ address: w.address as Address })))] as const))
      .then((list) => live && setBalances(Object.fromEntries(list)))
      .catch(() => {});
    return () => {
      live = false;
    };
    // the list of addresses is what matters, not the array's identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, account]);

  const say = (ok: boolean, text: string) => setNote({ ok, text });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Your wallets</h2>
        <span className="text-[12px] text-faint">{wallets.length} in this browser</span>
      </div>
      <ul className="space-y-1">
        {wallets.map((w) => (
          <li key={w.address}>
          <div className={cn('flex items-center gap-2.5 rounded-xl px-2.5 py-2', w.address === me ? 'bg-accent/10' : 'bg-white/[.03]')}>
            <WalletPic address={w.address} size={34} />
            <div className="min-w-0 flex-1">
              {editing === w.address ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename(w.address, name);
                    setEditing(null);
                  }}
                >
                  <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setEditing(null)} className="field h-7 w-full text-[13px]" />
                </form>
              ) : (
                <button onClick={() => (setEditing(w.address), setName(w.name))} className="truncate text-left font-medium hover:text-accent" title="Rename it in this browser only. Profile sets the name everyone sees">
                  <ProfileName address={w.address} fallback={w.name} />
                </button>
              )}
              <div className="num text-[12px] text-faint">
                {short(w.address, 6, 4)} · {zro(balances[w.address] ?? 0)} ZRO
              </div>
            </div>
            <button onClick={() => setProfileFor(profileFor === w.address ? null : w.address)} className={cn('btn btn-soft h-8 px-2.5 text-[13px]', profileFor === w.address && 'bg-white/10')}>
              Profile
            </button>
            {w.address === me ? (
              <span className="text-[12px] font-medium text-accent">In use</span>
            ) : (
              <button onClick={() => switchTo(w.address)} className="btn btn-soft h-8 px-3 text-[13px]">
                Use
              </button>
            )}
          </div>
          {profileFor === w.address && <ProfileEditor address={w.address} onSaved={(n) => n && rename(w.address, n)} onClose={() => setProfileFor(null)} />}
          </li>
        ))}
        {account && isExtension(account) && (
          <li>
          <div className="flex items-center gap-2.5 rounded-xl bg-accent/10 px-2.5 py-2">
            <WalletPic address={account.address} size={34} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                <ProfileName address={account.address} fallback="Browser extension" />
              </div>
              <div className="num text-[12px] text-faint">{short(account.address, 6, 4)}</div>
            </div>
            <button onClick={() => setProfileFor(profileFor === account.address ? null : account.address)} className="btn btn-soft h-8 px-2.5 text-[13px]">
              Profile
            </button>
            <span className="text-[12px] font-medium text-accent">In use</span>
          </div>
          {profileFor === account.address && <ProfileEditor address={account.address} onSaved={() => {}} onClose={() => setProfileFor(null)} />}
          </li>
        )}
      </ul>

      <div className="grid grid-cols-3 gap-1.5">
        <button onClick={() => setAdding(adding === 'new' ? null : 'new')} className={cn('btn btn-soft h-9 px-2 text-[13px]', adding === 'new' && 'bg-white/10')}>
          New
        </button>
        <button onClick={() => setAdding(adding === 'import' ? null : 'import')} className={cn('btn btn-soft h-9 px-2 text-[13px]', adding === 'import' && 'bg-white/10')}>
          Bring a key
        </button>
        <button onClick={() => connectExtension().then(() => say(true, 'Connected. Trades now ask the extension to confirm.'), (e: Error) => say(false, e.message))} className="btn btn-soft h-9 px-2 text-[13px]">
          MetaMask
        </button>
      </div>
      {adding === 'new' && (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            createNamed(draft.trim());
            setDraft('');
            setAdding(null);
          }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Name, optional" className="field h-9 min-w-0 flex-1 text-[13px]" />
          <button className="btn btn-accent h-9">Make it</button>
        </form>
      )}
      {adding === 'import' && (
        <form
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              importKey(draft);
              setDraft('');
              setAdding(null);
              say(true, 'Added next to your other wallets, and in use now.');
            } catch {
              say(false, 'That is not a valid private key');
            }
          }}
        >
          <div className="flex gap-1.5">
            <input type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Private key" className="field h-9 min-w-0 flex-1 text-[13px]" />
            <button className="btn btn-soft h-9">Add</button>
          </div>
          <p className="text-[12px] leading-snug text-faint">It joins the list. Your other wallets stay. This is a test network: don&apos;t paste a key that holds real money.</p>
        </form>
      )}

      {note && <p className={cn('rounded-lg px-2.5 py-1.5 text-[13px]', note.ok ? 'bg-up/10 text-up' : 'bg-down/10 text-down')}>{note.text}</p>}
    </section>
  );
}

/** The PIN that seals every key here. There is always one once a wallet is made; only keys from an earlier version lack it. */
export function PinLock() {
  const { hasPin, setPin } = useWallet();
  const [pin, setPinDraft] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const say = (ok: boolean, text: string) => setNote({ ok, text });
  return (
    <section className="space-y-2.5">
      <div>
        <div className="leading-snug">
          <div className="text-[13px] font-semibold">{hasPin ? 'Locked with a PIN' : 'Lock with a PIN'}</div>
          <div className="text-[12px] text-muted">
            {hasPin
              ? 'The keys are stored encrypted. A new tab or a restarted browser asks for the PIN.'
              : 'Encrypts the keys in this browser. Forget the PIN and only a saved key gets them back.'}
          </div>
        </div>
        {!hasPin && (
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              setPin(pin).then(
                () => (setPinDraft(''), say(true, 'Locked. Save your keys too: the PIN alone can not bring them back if this browser loses its data.')),
                (err: Error) => say(false, err.message),
              );
            }}
          >
            <input type="password" autoComplete="new-password" value={pin} onChange={(e) => setPinDraft(e.target.value)} placeholder={`PIN, ${MIN_PIN} or more`} className="field h-9 min-w-0 flex-1 text-[13px]" />
            <button className="btn btn-soft h-9">Set</button>
          </form>
        )}
      </div>
      {note && <p className={cn('rounded-lg px-2.5 py-1.5 text-[13px]', note.ok ? 'bg-up/10 text-up' : 'bg-down/10 text-down')}>{note.text}</p>}
    </section>
  );
}

const TABS = ['Wallets', 'Send', 'Alerts', 'PIN'] as const;

/** The account's own settings in one panel, a tab at a time, rather than a long column of boxes. */
export function AccountTabs({ alerts }: { alerts: React.ReactNode }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Wallets');
  return (
    <section className="panel p-4">
      <div className="mb-3 grid grid-cols-4 gap-1 rounded-xl bg-white/5 p-1" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('h-8 rounded-[6px] text-[13px] font-medium transition-colors', tab === t ? 'bg-white/[.11] text-ink' : 'text-muted hover:text-ink')}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Wallets' && <Wallets />}
      {tab === 'Send' && <SendFunds />}
      {tab === 'Alerts' && alerts}
      {tab === 'PIN' && <PinLock />}
    </section>
  );
}

/** Moves ZRO or a token out: to another of your wallets, or anywhere else. */
export function SendFunds() {
  const { account, wallets, balance, refreshBalance } = useWallet();
  const me = account?.address.toLowerCase();
  const { data } = useLive<WalletData>(me ? `/api/v1/wallet/${me}` : null, (t, d) => t === 'trade' && d.trader === me, 1500);
  const [asset, setAsset] = useState('zro');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [held, setHeld] = useState(0n);
  const token = data?.holdings.find((h) => h.token === asset);

  useEffect(() => {
    if (account && asset !== 'zro') tokenBalance(asset as Address, account.address).then(setHeld, () => setHeld(0n));
  }, [account, asset]);
  if (!account) return null;

  const others = wallets.filter((w) => w.address !== me);
  const max = asset === 'zro' ? Math.max(0, balance - 0.2) : Number(formatEther(held));
  const submit = async () => {
    setNote(null);
    if (!isAddress(to)) return setNote({ ok: false, text: 'That address is not valid' });
    if (to.toLowerCase() === me) return setNote({ ok: false, text: 'That is this wallet' });
    const n = Number(amount);
    if (!(n > 0) || n > max + 1e-12) return setNote({ ok: false, text: 'Enter an amount you have' });
    setBusy(true);
    try {
      if (asset === 'zro') {
        await send({ label: `Send ${amount} ZRO to ${short(to)}`, to: to as Address, value: parseEther(amount as `${number}`), data: '0x' });
      } else {
        const value = Math.abs(n - max) < 1e-12 ? held : parseUnits(amount, 18);
        await send({ label: `Send ${token?.symbol ?? 'tokens'} to ${short(to)}`, to: asset as Address, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [to as Address, value] }) });
      }
      setAmount('');
      setNote({ ok: true, text: 'Sent.' });
      void refreshBalance();
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2.5">
      <p className="text-[13px] text-muted">ZRO or a token, to another of your wallets or anywhere else.</p>
      <select value={asset} onChange={(e) => (setAsset(e.target.value), setAmount(''))} className="field h-10 w-full text-[14px]" aria-label="What to send">
        <option value="zro">ZRO, {zro(balance)}</option>
        {data?.holdings.map((h) => (
          <option key={h.token} value={h.token}>
            {h.symbol}
          </option>
        ))}
      </select>
      <div className="flex gap-1.5">
        <input value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="To address" className="field num h-10 min-w-0 flex-1 text-[13px]" />
        {others.length > 0 && (
          <select value="" onChange={(e) => e.target.value && setTo(e.target.value)} className="field h-10 w-28 text-[13px]" aria-label="One of your wallets">
            <option value="">Mine</option>
            {others.map((w) => (
              <option key={w.address} value={w.address}>
                {w.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex gap-1.5">
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="Amount" className="field num h-10 min-w-0 flex-1 text-[14px]" />
        <button onClick={() => setAmount(String(+max.toFixed(8)))} className="btn btn-soft h-10 px-3 text-[13px]">
          Max
        </button>
      </div>
      <button onClick={submit} disabled={busy || !to || !amount} className="btn btn-accent h-10 w-full">
        {busy ? 'Sending' : 'Send'}
      </button>
      {note && <p className={cn('rounded-lg px-2.5 py-1.5 text-[13px]', note.ok ? 'bg-up/10 text-up' : 'bg-down/10 text-down')}>{note.text}</p>}
    </section>
  );
}

/** Asks for the PIN when the keys are sealed. Nothing that needs a key can run until then. */
export function Unlock() {
  const { locked, resuming, unlock } = useWallet();
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  if (!locked || resuming) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Unlock your wallets">
      <form
        className="panel w-full max-w-sm space-y-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void unlock(pin).then((ok) => {
            setWrong(!ok);
            if (ok) setPin('');
          });
        }}
      >
        <h2 className="text-[18px] font-bold">Unlock your wallets</h2>
        <p className="text-[13px] text-muted">They&apos;re encrypted with your PIN in this browser.</p>
        <input autoFocus type="password" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" className="field h-11 w-full text-[16px]" />
        {wrong && <p className="text-[13px] text-down">That PIN doesn&apos;t open them</p>}
        <button className="btn btn-accent h-11 w-full">Unlock</button>
      </form>
    </div>
  );
}

const PIN_TEXT = {
  create: { title: 'Choose a PIN', body: 'Your new wallet\'s key is encrypted with it in this browser and never stored open. A new tab or a restarted browser asks for it.', go: 'Create wallet' },
  import: { title: 'Choose a PIN', body: 'The key is encrypted with it in this browser and never stored open. A new tab or a restarted browser asks for it.', go: 'Add wallet' },
  protect: { title: 'Lock your wallets with a PIN', body: 'An earlier version kept your keys in this browser unencrypted. Choose a PIN and they are encrypted with it, and the open copies deleted.', go: 'Lock' },
} as const;

/** The PIN every key here is sealed with, asked for before the first wallet is made or added. */
export function PinSetup() {
  const { askPin, submitPin, cancelPin } = useWallet();
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!askPin) return null;
  const text = PIN_TEXT[askPin];
  const close = () => (setPin(''), setAgain(''), setError(''), cancelPin());
  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="pin-setup-title">
      <form
        className="panel w-full max-w-sm space-y-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (pin.length < MIN_PIN) return setError(`Use at least ${MIN_PIN} digits or letters`);
          if (pin !== again) return setError('The two PINs are different');
          setBusy(true);
          submitPin(pin).then(
            () => (setPin(''), setAgain(''), setError(''), setBusy(false)),
            (err: Error) => (setError(err.message), setBusy(false)),
          );
        }}
      >
        <h2 id="pin-setup-title" className="text-[18px] font-bold">
          {text.title}
        </h2>
        <p className="text-[13px] leading-snug text-muted">{text.body}</p>
        <input autoFocus type="password" autoComplete="new-password" value={pin} onChange={(e) => (setPin(e.target.value), setError(''))} placeholder={`PIN, ${MIN_PIN} or more`} className="field h-11 w-full text-[16px]" />
        <input type="password" autoComplete="new-password" value={again} onChange={(e) => (setAgain(e.target.value), setError(''))} placeholder="The same PIN again" className="field h-11 w-full text-[16px]" />
        {error && <p className="text-[13px] text-down">{error}</p>}
        <p className="text-[12px] leading-snug text-faint">There is no reset. Forget the PIN and only the saved key gets the wallet back.</p>
        <div className={cn('grid gap-2', askPin === 'protect' ? 'grid-cols-1' : 'grid-cols-2')}>
          {askPin !== 'protect' && (
            <button type="button" onClick={close} className="btn btn-soft h-11">
              Cancel
            </button>
          )}
          <button disabled={busy} className="btn btn-accent h-11">
            {busy ? 'Encrypting' : text.go}
          </button>
        </div>
      </form>
    </div>
  );
}
