'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { encodeFunctionData, formatEther, parseEther, type Address } from 'viem';
import { getDeployment, useLive } from '@/lib/api';
import { COPY_VAULT_ABI, ROUTER_ABI } from '@/lib/config';
import { age, zro, cn, compact, short, usdText } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { withSlippage } from '@/lib/prep';
import type { CopyRules, VaultInfo } from '@/lib/insight';
import { useFormat } from '@/lib/money';
import { nameOf, useTracked } from '@/lib/tracked';
import { send } from '@/lib/tx';
import { publicClient, useWallet } from '@/lib/wallet';
import { Avatar, Empty } from '@/components/bits';
import { Switch } from '@/components/TrackedPanel';

const BPS = 10_000;
/** Left in the wallet when depositing everything, for the gas of this and the next few transactions. */
const GAS_RESERVE = parseEther('1');
const isAddr = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v.trim());

const toWei = (text: string) => {
  try {
    return text && Number(text) > 0 ? parseEther(text as `${number}`) : 0n;
  } catch {
    return 0n;
  }
};
const fromWei = (wei: bigint | string | number) => Number(formatEther(BigInt(wei)));
const decimal = (v: string) => /^\d*[.,]?\d*$/.test(v);

const AGES: Array<[number, string]> = [
  [0, 'Any age'],
  [600, 'Under 10 min'],
  [3600, 'Under 1 hour'],
  [86400, 'Under 1 day'],
];
const ageLabel = (s: number) => AGES.find(([v]) => v === s)?.[1] ?? (s < 3600 ? `Under ${Math.round(s / 60)} min` : s < 86400 ? `Under ${Math.round(s / 3600)} h` : `Under ${Math.round(s / 86400)} d`);

interface Form {
  leader: string;
  perTrade: string;
  perToken: string;
  perDay: string;
  size: string;
  slippage: string;
  chase: string;
  minSell: string;
  copySells: boolean;
  buyOnce: boolean;
  maxAge: number;
}

const DEFAULTS: Form = { leader: '', perTrade: '20', perToken: '80', perDay: '200', size: '100', slippage: '10', chase: '15', minSell: '50', copySells: true, buyOnce: false, maxAge: 0 };

const pct = (bps: number | string) => String(Number(bps) / 100);

function formOf(leader: string, r: CopyRules): Form {
  return {
    leader,
    perTrade: formatEther(BigInt(r.perTrade)),
    perToken: formatEther(BigInt(r.perToken)),
    perDay: formatEther(BigInt(r.perDay)),
    size: pct(r.sizeBps),
    slippage: pct(r.slippageBps),
    chase: pct(r.chaseBps),
    minSell: pct(r.minSellBps),
    copySells: Boolean(r.copySells),
    buyOnce: Boolean(r.buyOnce),
    maxAge: Number(r.maxAge),
  };
}

function rulesSummary(r: CopyRules): string {
  const size = Number(r.sizeBps);
  const parts = [
    `Up to ${zro(fromWei(r.perTrade))} ZRO a trade, ${zro(fromWei(r.perToken))} per token, ${zro(fromWei(r.perDay))} a day`,
    size === BPS ? 'Same size as theirs' : `${size / 100}% of their size`,
    r.copySells ? 'Sells when they sell' : 'Doesn’t copy sales',
  ];
  if (r.buyOnce) parts.push('First buy of each token only');
  if (Number(r.maxAge)) parts.push(`Tokens ${ageLabel(Number(r.maxAge)).toLowerCase()} old`);
  return `${parts.join('. ')}.`;
}

/** Checks what the contract would refuse, since its errors have no plain text on the confirmation card. */
function rulesFrom(f: Form, me: string): { leader: Address; rules: Parameters<typeof followData>[1] } | string {
  const leader = f.leader.trim();
  if (!isAddr(leader)) return 'Enter a wallet address, 0x...';
  if (leader.toLowerCase() === me.toLowerCase()) return 'You can’t copy your own wallet';
  const perTrade = toWei(f.perTrade);
  const perToken = toWei(f.perToken);
  const perDay = toWei(f.perDay);
  if (!perTrade || !perToken || !perDay) return 'Set the limits per trade, per token and per day above zero';
  const size = Math.round(Number(f.size) * 100);
  const slippage = Math.round(Number(f.slippage) * 100);
  const chase = Math.round(Number(f.chase) * 100);
  const minSell = Math.round(Number(f.minSell) * 100);
  if (!(size >= 1 && size <= 60_000)) return 'Size can be from 0.01% to 600% of theirs';
  if (!(slippage >= 0 && slippage <= 5_000)) return 'Slippage can be up to 50%';
  if (!(chase >= 0 && chase <= BPS)) return 'The price limit can be up to 100%';
  if (!(minSell >= 0 && minSell <= BPS)) return 'The sale floor can be up to 100% of cost';
  return {
    leader: leader as Address,
    rules: { perTrade, perToken, perDay, sizeBps: size, slippageBps: slippage, chaseBps: chase, minSellBps: minSell, buyOnce: f.buyOnce, copySells: f.copySells, maxAge: f.maxAge },
  };
}

function followData(leader: Address, rules: { perTrade: bigint; perToken: bigint; perDay: bigint; sizeBps: number; slippageBps: number; chaseBps: number; minSellBps: number; buyOnce: boolean; copySells: boolean; maxAge: number }) {
  return encodeFunctionData({ abi: COPY_VAULT_ABI, functionName: 'follow', args: [leader, rules] });
}

/** A number box with its unit, the way the rest of the terminal's settings look. */
function NumberField({ label, value, onChange, unit, hint }: { label: string; value: string; onChange: (v: string) => void; unit: string; hint?: string }) {
  return (
    <label className="block">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="mt-0.5 flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 focus-within:bg-white/[.08]">
        <input inputMode="decimal" value={value} onChange={(e) => decimal(e.target.value) && onChange(e.target.value.replace(',', '.'))} className="num h-9 w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-faint" />
        <span className="shrink-0 whitespace-nowrap text-[12px] text-faint">{unit}</span>
      </span>
      {hint && <span className="mt-0.5 block text-[11px] leading-snug text-faint">{hint}</span>}
    </label>
  );
}

function Toggle({ label, hint, on, onClick }: { label: string; hint?: string; on: boolean; onClick: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 leading-snug">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="text-[11px] text-faint">{hint}</div>}
      </div>
      <Switch on={on} onClick={onClick} label={label} />
    </div>
  );
}

function BalanceCard({ vault, balance, onChange }: { vault: Address; balance: bigint; onChange: () => void }) {
  const account = useWallet((s) => s.account)!;
  const { usd } = useFormat();
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wei = toWei(amount);
  const shown = fromWei(balance);

  const max = async () => {
    if (mode === 'withdraw') return setAmount(formatEther(balance));
    const have = await publicClient.getBalance({ address: account.address }).catch(() => 0n);
    setAmount(have > GAS_RESERVE ? formatEther(have - GAS_RESERVE) : '0');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!wei) return setError('Enter an amount');
    if (mode === 'withdraw' && wei > balance) return setError('That is more than you have here');
    setBusy(true);
    try {
      if (mode === 'deposit') {
        await send({ label: `Add ${zro(fromWei(wei))} ZRO to copy trading`, to: vault, value: wei, data: encodeFunctionData({ abi: COPY_VAULT_ABI, functionName: 'deposit' }) });
      } else {
        await send({ label: `Take out ${zro(fromWei(wei))} ZRO`, to: vault, data: encodeFunctionData({ abi: COPY_VAULT_ABI, functionName: 'withdraw', args: [wei, account.address] }) });
      }
      setAmount('');
      onChange();
    } catch {
      // the confirmation card says what went wrong
    }
    setBusy(false);
  };

  return (
    <section className="panel p-5">
      <div className="text-[13px] text-muted">For copying</div>
      <div className="num mt-0.5 text-[32px] font-bold leading-none tracking-tight">
        {zro(shown)} <span className="text-[16px] font-semibold text-muted">ZRO</span>
      </div>
      {usd && shown > 0 && <div className="num mt-1 text-muted">{usdText(shown * usd)}</div>}

      <div className="mt-4 flex gap-0.5">
        {(['deposit', 'withdraw'] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setAmount('');
              setError(null);
            }}
            className={cn('pill', mode === m && 'pill-on')}
          >
            {m === 'deposit' ? 'Deposit' : 'Withdraw'}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="mt-2 flex gap-1.5">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-white/5 px-2.5 focus-within:bg-white/[.08]">
          <input inputMode="decimal" value={amount} onChange={(e) => decimal(e.target.value) && setAmount(e.target.value.replace(',', '.'))} placeholder="0.0" className="num h-10 w-full min-w-0 bg-transparent outline-none placeholder:text-faint" aria-label="Amount in ZRO" />
          <button type="button" onClick={() => void max()} className="text-[12px] font-semibold text-accent">
            Max
          </button>
        </span>
        <button disabled={busy || !wei} className="btn btn-accent h-10 px-4">
          {busy ? 'Sending' : mode === 'deposit' ? 'Deposit' : 'Withdraw'}
        </button>
      </form>
      {error && <p className="mt-1.5 text-[13px] text-down">{error}</p>}
      <p className="mt-2 text-[12px] leading-snug text-faint">Each copy pays 0.04 ZRO from this balance to whoever runs it. Withdraw sends to your wallet.</p>
    </section>
  );
}

function FollowForm({ vault, form, setForm, editing, onCancel, onDone }: { vault: Address; form: Form; setForm: (f: Form) => void; editing: boolean; onCancel: () => void; onDone: () => void }) {
  const me = useWallet((s) => s.account?.address) ?? '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm({ ...form, [k]: v });
  const ages = AGES.some(([v]) => v === form.maxAge) ? AGES : [...AGES, [form.maxAge, ageLabel(form.maxAge)] as [number, string]];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const checked = rulesFrom(form, me);
    if (typeof checked === 'string') return setError(checked);
    setError(null);
    setBusy(true);
    try {
      await send({ label: `${editing ? 'Update' : 'Copy'} ${nameOf(checked.leader)}`, to: vault, data: followData(checked.leader, checked.rules) });
      onDone();
    } catch {
      // the confirmation card says what went wrong
    }
    setBusy(false);
  };

  return (
    <section id="add" className="panel p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">{editing ? `Edit ${nameOf(form.leader)}` : 'Add a wallet'}</h2>
        {editing && (
          <button onClick={onCancel} className="text-[13px] text-muted transition-colors hover:text-ink">
            Cancel
          </button>
        )}
      </div>
      <form onSubmit={submit} className="mt-2.5 space-y-3">
        <input value={form.leader} onChange={(e) => set('leader')(e.target.value)} readOnly={editing} placeholder="Wallet address, 0x..." className="field num h-10 w-full text-[13px]" aria-label="Wallet to copy" />
        {!editing && <FollowedPicker onPick={set('leader')} current={form.leader} />}
        <div className="grid grid-cols-3 gap-2">
          <NumberField label="Per trade" value={form.perTrade} onChange={set('perTrade')} unit="ZRO" />
          <NumberField label="Per token" value={form.perToken} onChange={set('perToken')} unit="ZRO" />
          <NumberField label="Per day" value={form.perDay} onChange={set('perDay')} unit="ZRO" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Size compared to theirs" value={form.size} onChange={set('size')} unit="%" hint="100% buys as much as they do, within your limits" />
          <NumberField label="Slippage" value={form.slippage} onChange={set('slippage')} unit="%" hint="How far the price may move while the copy goes through" />
          <NumberField label="Price worse than theirs, at most" value={form.chase} onChange={set('chase')} unit="%" hint="Skips a copy that would buy much higher or sell much lower than they did. The higher this is, the more a leader can sell to you above their own price" />
          <NumberField label="Never sell below, share of cost" value={form.minSell} onChange={set('minSell')} unit="%" hint="A copied sale won’t fetch less than this share of what it cost" />
        </div>
        <div>
          <div className="text-[12px] text-muted">Token age</div>
          <div className="mt-1 flex flex-wrap gap-0.5">
            {ages.map(([v, label]) => (
              <button key={v} type="button" onClick={() => set('maxAge')(v)} className={cn('pill', form.maxAge === v && 'pill-on')}>
                {label}
              </button>
            ))}
          </div>
          {form.maxAge > 0 && <p className="mt-1 text-[11px] text-faint">With an age set, only tokens launched here are copied.</p>}
        </div>
        <div className="space-y-2.5 border-t border-white/[.06] pt-3">
          <Toggle label="Sell when they sell" hint="Sells the same share of your position as they sold of theirs" on={form.copySells} onClick={() => set('copySells')(!form.copySells)} />
          <Toggle label="Only their first buy of each token" on={form.buyOnce} onClick={() => set('buyOnce')(!form.buyOnce)} />
        </div>
        {error && <p className="text-[13px] text-down">{error}</p>}
        <button disabled={busy} className="btn btn-accent h-11 w-full">
          {busy ? 'Sending' : editing ? 'Save' : 'Start copying'}
        </button>
      </form>
    </section>
  );
}

function ExitForm({ vault, current, onDone }: { vault: Address; current: { takeProfitBps: number; stopLossBps: number; slippageBps: number } | null; onDone: () => void }) {
  const [takeProfit, setTakeProfit] = useState('0');
  const [stopLoss, setStopLoss] = useState('0');
  const [slippage, setSlippage] = useState('10');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = current ? `${current.takeProfitBps}:${current.stopLossBps}:${current.slippageBps}` : '';
  useEffect(() => {
    if (!current) return;
    setTakeProfit(pct(current.takeProfitBps));
    setStopLoss(pct(current.stopLossBps));
    if (current.slippageBps) setSlippage(pct(current.slippageBps));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const tp = Math.round(Number(takeProfit || 0) * 100);
    const sl = Math.round(Number(stopLoss || 0) * 100);
    const slip = Math.round(Number(slippage || 0) * 100);
    if (!(tp >= 0 && tp <= 65_535)) return setError('Take profit can be up to 655%');
    if (!(sl >= 0 && sl < BPS)) return setError('Stop loss has to be under 100%');
    if (!(slip >= 0 && slip <= 5_000)) return setError('Slippage can be up to 50%');
    setError(null);
    setBusy(true);
    try {
      await send({ label: 'Set take profit and stop loss', to: vault, data: encodeFunctionData({ abi: COPY_VAULT_ABI, functionName: 'setExit', args: [{ takeProfitBps: tp, stopLossBps: sl, slippageBps: slip }] }) });
      onDone();
    } catch {
      // the confirmation card says what went wrong
    }
    setBusy(false);
  };

  return (
    <section className="panel p-4">
      <h2 className="font-semibold">Take profit and stop loss</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">Sells all of a token here once it is up or down this much against what it cost, with your browser closed too. 0 turns it off.</p>
      <form onSubmit={submit} className="mt-2.5 space-y-2.5">
        <div className="grid grid-cols-3 gap-2">
          <NumberField label="Take profit when up by" value={takeProfit} onChange={setTakeProfit} unit="%" />
          <NumberField label="Stop loss when down by" value={stopLoss} onChange={setStopLoss} unit="%" />
          <NumberField label="Slippage" value={slippage} onChange={setSlippage} unit="%" />
        </div>
        {error && <p className="text-[13px] text-down">{error}</p>}
        <button disabled={busy} className="btn btn-soft h-10 w-full">
          {busy ? 'Sending' : 'Save'}
        </button>
      </form>
    </section>
  );
}

function Follows({ vault, info, onEdit, onChange }: { vault: Address; info: VaultInfo | null; onEdit: (leader: string, r: CopyRules) => void; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (leader: string, label: string, data: `0x${string}`) => {
    setBusy(leader);
    try {
      await send({ label, to: vault, data });
      onChange();
    } catch {
      // the confirmation card says what went wrong
    }
    setBusy(null);
  };
  const follows = info?.follows ?? [];
  return (
    <section className="panel p-4">
      <h2 className="font-semibold">
        Wallets you copy {follows.length > 0 && <span className="num font-medium text-faint">{follows.filter((f) => f.active).length}</span>}
      </h2>
      {info && !follows.length && <Empty title="No wallets yet" body="Add one with the form, or press Copy on a trader’s page." />}
      <ul className="mt-1">
        {follows.map((f) => (
          <li key={f.leader} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-white/[.05] py-3 first:border-t-0">
            <Link href={`/traders/${f.leader}`} className="flex min-w-0 items-center gap-2.5 transition-colors hover:text-accent">
              <Avatar address={f.leader} size={30} />
              <span className="min-w-0 leading-snug">
                <span className="block truncate font-semibold">{nameOf(f.leader)}</span>
                <span className={cn('block text-[12px]', f.active ? 'text-up' : 'text-faint')}>{f.active ? 'Copying' : 'Stopped'}</span>
              </span>
            </Link>
            <span className="ml-auto flex shrink-0 gap-1.5">
              <button onClick={() => onEdit(f.leader, f.rules)} className="btn btn-soft h-8 px-3 text-[13px]">
                Edit
              </button>
              {f.active ? (
                <button onClick={() => void run(f.leader, `Stop copying ${nameOf(f.leader)}`, encodeFunctionData({ abi: COPY_VAULT_ABI, functionName: 'unfollow', args: [f.leader as Address] }))} disabled={busy === f.leader} className="btn btn-soft h-8 px-3 text-[13px]">
                  {busy === f.leader ? 'Working' : 'Stop'}
                </button>
              ) : (
                <button
                  onClick={() => {
                    const checked = rulesFrom(formOf(f.leader, f.rules), '');
                    if (typeof checked !== 'string') void run(f.leader, `Copy ${nameOf(f.leader)} again`, followData(checked.leader, checked.rules));
                    else onEdit(f.leader, f.rules);
                  }}
                  disabled={busy === f.leader}
                  className="btn btn-soft h-8 px-3 text-[13px]"
                >
                  {busy === f.leader ? 'Working' : 'Start again'}
                </button>
              )}
            </span>
            <p className="w-full text-[12px] leading-snug text-muted">{rulesSummary(f.rules)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

type OnChain = Map<string, { tokens: bigint; cost: bigint }>;

function Positions({ vault, info, onchain, onChange }: { vault: Address; info: VaultInfo | null; onchain: OnChain; onChange: () => void }) {
  const me = useWallet((s) => s.account?.address)!;
  const slippageBps = useWallet((s) => s.slippageBps);
  const { money } = useFormat();
  const [busy, setBusy] = useState<string | null>(null);
  // The indexer names the tokens; the vault itself says how many are really there.
  const rows = (info?.positions ?? []).map((p) => ({ ...p, held: onchain.get(p.token.toLowerCase()) })).filter((p) => p.held && p.held.tokens > 0n);

  const sell = async (token: Address, symbol: string, held: bigint, share: number) => {
    setBusy(token);
    try {
      const tokens = share === 100 ? held : (held * BigInt(share)) / 100n;
      const { router } = await getDeployment();
      await send({
        label: `Sell ${share}% of ${symbol}`,
        to: vault,
        build: async () => {
          const quote = await publicClient.readContract({ address: router, abi: ROUTER_ABI, functionName: 'quoteSell', args: [token, tokens] });
          return { data: encodeFunctionData({ abi: COPY_VAULT_ABI, functionName: 'sell', args: [token, tokens, withSlippage(quote, slippageBps)] }) };
        },
      });
      onChange();
    } catch {
      // the confirmation card says what went wrong
    }
    setBusy(null);
  };
  const move = async (token: Address, symbol: string, held: bigint) => {
    setBusy(token);
    try {
      await send({ label: `Move ${symbol} to your wallet`, to: vault, data: encodeFunctionData({ abi: COPY_VAULT_ABI, functionName: 'withdrawTokens', args: [token, held, me] }) });
      onChange();
    } catch {
      // the confirmation card says what went wrong
    }
    setBusy(null);
  };

  return (
    <section className="panel p-4">
      <h2 className="font-semibold">Positions</h2>
      {info && !rows.length && <Empty title="Nothing bought yet" body="What copies buy waits here until it is sold, by a copy, by your take profit or stop loss, or by you." />}
      <ul className="mt-1">
        {rows.map((p) => {
          const held = p.held!;
          const amount = fromWei(held.tokens);
          const cost = fromWei(held.cost);
          const value = p.tokens > 0 ? (p.value / p.tokens) * amount : 0;
          const change = cost > 0 ? value / cost - 1 : 0;
          const token = p.token as Address;
          const working = busy === p.token;
          return (
            <li key={p.token} className="border-t border-white/[.05] py-3 first:border-t-0">
              <div className="flex items-center gap-2.5">
                <Link href={`/tokens/${p.token}`} className="flex min-w-0 flex-1 items-center gap-2.5 transition-colors hover:text-accent">
                  <Avatar address={p.token} uri={p.uri} size={30} />
                  <span className="min-w-0 leading-snug">
                    <span className="block truncate font-semibold">{p.symbol}</span>
                    <span className="num block truncate text-[12px] text-faint">{compact(amount)} tokens</span>
                  </span>
                </Link>
                <span className="num shrink-0 text-right leading-snug">
                  <span className="block">{money(value)}</span>
                  <span className={cn('block text-[12px]', change > 0 ? 'text-up' : change < 0 ? 'text-down' : 'text-faint')}>
                    {cost > 0 ? `${change > 0 ? '+' : ''}${(change * 100).toFixed(1)}% on ${money(cost)}` : 'No cost recorded'}
                  </span>
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] text-muted">Sell</span>
                {[25, 50, 100].map((s) => (
                  <button key={s} onClick={() => void sell(token, p.symbol, held.tokens, s)} disabled={working} className="pill num">
                    {s}%
                  </button>
                ))}
                <button onClick={() => void move(token, p.symbol, held.tokens)} disabled={working} className="ml-auto text-[13px] text-muted transition-colors hover:text-ink disabled:opacity-50">
                  {working ? 'Working' : 'Move to my wallet'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const EVENT_TEXT: Record<string, string> = {
  deposit: 'Deposited',
  withdraw: 'Withdrew',
  copy_buy: 'Copied a buy of',
  copy_sell: 'Copied a sale of',
  exit: 'Take profit or stop loss sold',
  sell: 'You sold',
  tokens_out: 'Moved to your wallet:',
};

function History({ info }: { info: VaultInfo | null }) {
  const now = useNow(10_000);
  const { money } = useFormat();
  const symbols = useMemo(() => new Map(info?.positions.map((p) => [p.token.toLowerCase(), p.symbol])), [info]);
  const events = info?.events ?? [];
  return (
    <section className="panel p-4">
      <h2 className="font-semibold">History</h2>
      {info && !events.length && <Empty title="Nothing yet" body="Deposits, copies and sales show up here." />}
      <ul className="mt-1 text-[13px]">
        {events.map((e, i) => (
          <li key={`${e.tx_hash}${i}`} className="flex min-h-[34px] items-center gap-3 border-t border-white/[.05] py-1.5 first:border-t-0">
            <span className="num w-9 shrink-0 text-faint">{age(e.ts, now)}</span>
            <span className="min-w-0 flex-1 leading-snug">
              {EVENT_TEXT[e.kind] ?? e.kind}{' '}
              {e.token && (
                <Link href={`/tokens/${e.token}`} className="font-semibold transition-colors hover:text-accent">
                  {symbols.get(e.token.toLowerCase()) ?? short(e.token)}
                </Link>
              )}
              {e.leader && (
                <>
                  {' '}
                  <span className="text-muted">from</span>{' '}
                  <Link href={`/traders/${e.leader}`} className="transition-colors hover:text-accent">
                    {nameOf(e.leader)}
                  </Link>
                </>
              )}
            </span>
            <span className="num shrink-0 text-right text-muted">{e.zro > 0 ? money(e.zro) : e.tokens > 0 ? `${compact(e.tokens)} tokens` : ''}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CopyVault({ vault, owner }: { vault: Address; owner: Address }) {
  const { data: info, refresh: refreshInfo } = useLive<VaultInfo>(`/api/v1/vault/${owner.toLowerCase()}`, (t) => t === 'trade', 3000);
  const [balance, setBalance] = useState(0n);
  const [exit, setExit] = useState<{ takeProfitBps: number; stopLossBps: number; slippageBps: number } | null>(null);
  const [onchain, setOnchain] = useState<OnChain>(new Map());
  const [form, setForm] = useState<Form>(DEFAULTS);
  const [editing, setEditing] = useState(false);
  const reset = () => {
    setForm(DEFAULTS);
    setEditing(false);
  };
  const tokens = info?.positions.map((p) => p.token.toLowerCase()).join() ?? '';

  useEffect(() => {
    const leader = new URLSearchParams(window.location.search).get('leader');
    if (leader && isAddr(leader)) setForm((f) => ({ ...f, leader }));
  }, []);

  const readChain = useCallback(async () => {
    const at = { address: vault, abi: COPY_VAULT_ABI } as const;
    const list = tokens ? (tokens.split(',') as Address[]) : [];
    try {
      const [bal, ex, held] = await Promise.all([
        publicClient.readContract({ ...at, functionName: 'balanceOf', args: [owner] }),
        publicClient.readContract({ ...at, functionName: 'exits', args: [owner] }),
        Promise.all(list.map((t) => publicClient.readContract({ ...at, functionName: 'positions', args: [owner, t] }))),
      ]);
      setBalance(bal);
      setExit({ takeProfitBps: ex[0], stopLossBps: ex[1], slippageBps: ex[2] });
      setOnchain(new Map(list.map((t, i) => [t, { tokens: held[i]![0], cost: held[i]![1] }])));
    } catch {}
  }, [vault, owner, tokens]);

  useEffect(() => {
    void readChain();
    const id = setInterval(() => void readChain(), 10_000);
    return () => clearInterval(id);
  }, [readChain]);

  // The chain has it the moment the receipt is in; the indexer a moment later.
  const changed = () => {
    void readChain();
    void refreshInfo();
    setTimeout(() => {
      void readChain();
      void refreshInfo();
    }, 2000);
  };

  return (
    <div className="mx-auto grid w-full max-w-[1200px] items-start gap-2 lg:grid-cols-[380px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-2 lg:sticky lg:top-0 lg:self-start">
        <section className="panel p-5">
          <h1 className="text-[22px] font-bold tracking-tight">Copy trading</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Pick wallets to copy and set your limits. When one of them trades, our server copies it from the balance below within 30 seconds, even with this tab closed. The ZRO and tokens here stay yours, and you can take them out at any time.
          </p>
        </section>
        <BalanceCard vault={vault} balance={balance} onChange={changed} />
        <FollowForm
          vault={vault}
          form={form}
          setForm={setForm}
          editing={editing}
          onCancel={reset}
          onDone={() => {
            reset();
            changed();
          }}
        />
        <ExitForm vault={vault} current={exit} onDone={changed} />
      </aside>
      <div className="flex min-w-0 flex-col gap-2">
        <Follows
          vault={vault}
          info={info}
          onEdit={(leader, r) => {
            setForm(formOf(leader, r));
            setEditing(true);
            document.getElementById('add')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          onChange={changed}
        />
        <Positions vault={vault} info={info} onchain={onchain} onChange={changed} />
        <History info={info} />
      </div>
    </div>
  );
}

/** The wallets this user already follows, one click from being copied. */
function FollowedPicker({ onPick, current }: { onPick: (v: string) => void; current: string }) {
  const list = useTracked();
  if (!list.length) return <p className="text-[12px] text-faint">Paste a wallet&apos;s address, or press Copy trades on a wallet&apos;s page or in the Radar.</p>;
  return (
    <div>
      <div className="mb-1 text-[12px] text-muted">Or pick one you follow</div>
      <div className="flex flex-wrap gap-1">
        {list.map((t) => (
          <button key={t.address} type="button" onClick={() => onPick(t.address)} className={cn('pill text-[12px]', current.toLowerCase() === t.address && 'pill-on')}>
            {nameOf(t.address, list)}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CopyPage() {
  const { account, create, ready } = useWallet();
  const [vault, setVault] = useState<Address | null | undefined>(undefined);

  useEffect(() => {
    getDeployment()
      .then((d) => setVault(d.copyVault ?? null))
      .catch(() => setVault(null));
  }, []);

  if (ready && !account) {
    return (
      <div className="mx-auto max-w-md px-3 pt-16">
        <section className="panel p-8 text-center">
          <h1 className="text-[24px] font-bold tracking-tight">No wallet yet</h1>
          <p className="mt-1.5 text-muted">Copy trading needs a wallet. It takes one click, with no seed phrase and no extension.</p>
          <button onClick={create} className="btn btn-accent mt-5 h-12 w-full text-[15px]">
            Create wallet
          </button>
        </section>
      </div>
    );
  }

  if (vault === null) {
    return (
      <div className="mx-auto max-w-md px-3 pt-16">
        <section className="panel p-8 text-center">
          <h1 className="text-[24px] font-bold tracking-tight">Copy trading</h1>
          <p className="mt-1.5 text-muted">Copy trading isn&apos;t on this network yet.</p>
        </section>
      </div>
    );
  }

  if (!account || !vault) return null;
  return <CopyVault vault={vault} owner={account.address} />;
}
