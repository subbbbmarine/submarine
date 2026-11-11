'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';
import { encodeFunctionData, formatEther, parseEther, parseEventLogs, type Address } from 'viem';
import { getDeployment } from '@/lib/api';
import { BASE_FEE_BPS, CREATOR_BASE_BPS, CURVE, DEV_FEE_CHOICES, LAUNCHPAD_ABI, OPENING_CAP, POOL_CAP, SNIPE_SECONDS, SNIPE_START_BPS, SUPPLY_CHOICES, SUPPLY_MAX, SUPPLY_MIN } from '@/lib/config';
import { zro, cn, compact } from '@/lib/format';
import { encodePad, launchedToken, launchFeeOf, useLaunchpads } from '@/lib/launchpads';
import { pictureToData, saveMeta, type TokenMeta } from '@/lib/meta';
import { useFormat } from '@/lib/money';
import { deadline } from '@/lib/prep';
import { readyToSell } from '@/lib/trade';
import { send } from '@/lib/tx';
import { publicClient, useWallet } from '@/lib/wallet';
import { Price } from '@/components/bits';
import { FeeSplit, type Split } from './FeeSplit';

const NAME_MAX = 48;
const SYMBOL_MAX = 16;
const ABOUT_MAX = 600;
const LINKS: Array<{ key: 'website' | 'twitter' | 'telegram' | 'discord'; label: string }> = [
  { key: 'website', label: 'Website' },
  { key: 'twitter', label: 'Twitter' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'discord', label: 'Discord' },
];
const FIRST_BUYS = ['50', '200', '500', '2000'];
const percent = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

/** One step of the form: its number on the left, then its title and everything in it. */
function Step({ n, title, note, children }: { n: number; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="grid gap-x-4 sm:grid-cols-[44px_minmax(0,1fr)]">
      <span className="num hidden text-[34px] font-bold leading-[1.1] text-white/15 sm:block">{n}</span>
      <div>
        <h2 className="flex items-baseline gap-2 text-[22px] font-bold leading-snug tracking-tight">
          {title}
          {note && <span className="text-[13px] font-normal tracking-normal text-faint">{note}</span>}
        </h2>
        <div className="mt-3.5 space-y-3.5">{children}</div>
      </div>
    </section>
  );
}

function Label({ text, count, max, htmlFor }: { text: string; count?: number; max?: number; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between text-[13px] text-muted">
      <span>{text}</span>
      {max !== undefined && <span className={cn('num text-[12px]', count === max ? 'text-accent' : 'text-faint')}>{`${count ?? 0}/${max}`}</span>}
    </label>
  );
}

function Fact({ k, children, tone }: { k: string; children: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[5px] text-[13px]">
      <dt className="text-muted">{k}</dt>
      <dd className={cn('num text-right', tone)}>{children}</dd>
    </div>
  );
}

/** A row of choices, one of them on. */
function Choices<T extends string | number>({ value, options, onChange, label }: { value: T | null; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-white/5 p-1" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={cn('num h-9 rounded-[6px] text-[14px] font-medium transition-colors duration-150', value === o.value ? 'bg-white/[.14] text-ink' : 'text-muted hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function LaunchPage() {
  const router = useRouter();
  const { account, balance, create } = useWallet();
  const { money, usd } = useFormat();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [about, setAbout] = useState('');
  const [links, setLinks] = useState<Record<string, string>>({});
  const [firstBuy, setFirstBuy] = useState('');
  const [picture, setPicture] = useState<string | null>(null);
  const [pictureLink, setPictureLink] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [launchFee, setLaunchFee] = useState(0n);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The terms of the token, for one launched on our own launchpad.
  const [supplyText, setSupplyText] = useState(String(SUPPLY_CHOICES[0]!.whole));
  // The creator's own fee on top of the 1% base, which every token pays.
  const [devBps, setDevBps] = useState(DEV_FEE_CHOICES[0]!);
  const feeBps = BASE_FEE_BPS + devBps;
  // Shares of the creator's own fee, in percent, always adding up to 100.
  const [split, setSplit] = useState<Split>({ holders: 0, burn: 0, creator: 100 });
  const [antiSnipe, setAntiSnipe] = useState(false);

  // Ours, then every launchpad whose file says how to launch on it.
  const pads = useLaunchpads().filter((p) => p.builtin || p.launch);
  const [padId, setPadId] = useState('terminal');
  const pad = pads.find((p) => p.id === padId);
  const other = pad && !pad.builtin ? pad : null;
  const fields = other?.launch?.fields ?? ['name', 'symbol', 'image', 'description', 'links', 'firstBuy'];

  useEffect(() => {
    let live = true;
    setLaunchFee(0n);
    const read = other ? launchFeeOf(other) : getDeployment().then(({ launchpad }) => publicClient.readContract({ address: launchpad, abi: LAUNCHPAD_ABI, functionName: 'launchFee' }));
    read.then((fee) => live && setLaunchFee(fee)).catch((err) => live && setError((err as Error).message));
    return () => {
      live = false;
    };
  }, [other?.id]);

  const takeFile = async (file: File | undefined | null) => {
    if (!file) return;
    setError(null);
    try {
      setPicture(await pictureToData(file));
      setPictureLink('');
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void takeFile(e.dataTransfer.files[0]);
  };
  const onPaste = (e: ClipboardEvent) => {
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      void takeFile(file);
    }
  };

  const wholeSupply = Number(supplyText);
  const supplyOk = Number.isInteger(wholeSupply) && wholeSupply >= SUPPLY_MIN && wholeSupply <= SUPPLY_MAX;

  const firstNum = fields.includes('firstBuy') ? Number(firstBuy) || 0 : 0;
  const firstWei = firstNum > 0 ? parseEther(firstBuy as `${number}`) : 0n;
  const total = firstWei + launchFee;
  // The opening math from Launchpad.sol. The first buy pays the plain fee, even with anti-snipe on.
  const supply = other ? other.curve?.supply : supplyOk ? wholeSupply : undefined;
  const vTokens = (supply ?? 0) * CURVE.virtualShare;
  const net = Math.min(firstNum * (1 - feeBps / 10_000), CURVE.raiseTarget);
  const tokens = net > 0 ? vTokens - (CURVE.virtualZro * vTokens) / (CURVE.virtualZro + net) : 0;
  const startCap = other ? other.curve?.startCap : OPENING_CAP;
  const shownPicture = picture ?? (/^https?:\/\//.test(pictureLink) ? pictureLink : null);

  const missing = [!name.trim() && 'name', !symbol.trim() && 'symbol', !other && !supplyOk && 'a supply in range'].filter(Boolean) as string[];
  const tooMuch = Number(formatEther(total)) > balance;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const upper = symbol.trim().toUpperCase();
      const meta: TokenMeta = {
        ...(picture ? { image: picture } : pictureLink.trim() ? { imageUrl: pictureLink.trim() } : {}),
        ...(about.trim() ? { description: about.trim() } : {}),
        ...Object.fromEntries(LINKS.map(({ key }) => [key, links[key]?.trim() ?? '']).filter(([, v]) => v)),
      };
      // Saved first, so a failure here costs nothing. What's on the chain is only its address.
      const saved = Object.keys(meta).length ? await saveMeta(meta) : { uri: '', image: '' };
      let token: string | null = null;
      if (other) {
        const receipt = await send({
          label: `Launch ${upper} on ${other.name}`,
          to: other.contract,
          value: total,
          data: encodePad(other.launch!, { name: name.trim(), symbol: upper, uri: saved.uri, image: saved.image ?? '', description: about.trim(), firstBuy: firstWei, minOut: 0n, to: account!.address, deadline: deadline() }),
        });
        token = launchedToken(other, receipt.logs);
      } else {
        const { launchpad } = await getDeployment();
        const receipt = await send({
          label: `Launch ${upper}`,
          to: launchpad,
          value: total,
          data: encodeFunctionData({
            abi: LAUNCHPAD_ABI,
            functionName: 'launch',
            args: [name.trim(), upper, saved.uri, 0n, BigInt(wholeSupply), devBps, devBps > 0 ? split.holders * 100 : 0, devBps > 0 ? split.burn * 100 : 0, antiSnipe],
          }),
        });
        const [launched] = parseEventLogs({ abi: LAUNCHPAD_ABI, eventName: 'TokenLaunched', logs: receipt.logs });
        token = launched ? launched.args.token.toLowerCase() : null;
      }
      if (token) {
        if (firstWei > 0n) void readyToSell(token as Address, upper);
        router.push(`/tokens/${token}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  let step = 0;

  return (
    <div className="mx-auto max-w-[1180px] pb-4">
      <header className="px-1 pb-3 pt-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-tight">Launch a token</h1>
        <p className="mt-0.5 text-muted">{other ? `One transaction creates it on ${other.name}, from here.` : 'One transaction creates it, and your first buy goes in before anyone else can.'}</p>
      </header>

      <div className="grid items-start gap-2 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="panel space-y-9 p-5 sm:p-7">
          {pads.length > 1 && (
            <Step n={++step} title="Where">
              <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label="Launchpad">
                {pads.map((p) => {
                  const on = p.id === padId;
                  return (
                    <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => setPadId(p.id)} className={cn('rounded-xl px-3.5 py-3 text-left transition-colors duration-150', on ? 'bg-accent/10 ring-1 ring-accent/60' : 'bg-white/5 hover:bg-white/[.08]')}>
                      <span className="flex items-center gap-1.5">
                        <span className={cn('truncate font-semibold', on && 'text-accent')}>{p.name}</span>
                        {p.test && <span className="shrink-0 rounded bg-white/10 px-1 text-[10px] font-medium text-muted">Test</span>}
                      </span>
                      {p.description && <span className="mt-0.5 block text-[13px] leading-snug text-muted">{p.description}</span>}
                    </button>
                  );
                })}
              </div>
              {other && <p className="text-[13px] leading-snug text-muted">{other.name} is run by someone else and sets its own curve, fees and what happens at the end. We don&apos;t run it, check it or add a fee.</p>}
            </Step>
          )}

          <Step n={++step} title="Identity">
            <div className="grid grid-cols-[minmax(0,1fr)_144px] gap-2">
              <div>
                <Label text="Name" count={name.length} max={NAME_MAX} htmlFor="launch-name" />
                <input id="launch-name" value={name} onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))} className="field h-11 w-full text-[15px]" placeholder="Token name" />
              </div>
              <div>
                <Label text="Symbol" count={symbol.length} max={SYMBOL_MAX} htmlFor="launch-symbol" />
                <input id="launch-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value.replace(/\s/g, '').slice(0, SYMBOL_MAX))} className="field h-11 w-full text-[15px] uppercase placeholder:normal-case" placeholder="Ticker" />
              </div>
            </div>

            {fields.includes('image') && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onPaste={onPaste}
                className={cn('flex items-center gap-4 rounded-xl p-2 transition-colors duration-150', dragging ? 'bg-accent/10 ring-1 ring-accent/60' : 'bg-white/[.03]')}
              >
                <button type="button" onClick={() => fileInput.current?.click()} aria-label="Choose a picture" className="flex h-[92px] w-[92px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/5 text-faint transition-colors hover:text-ink">
                  {shownPicture ? (
                    <img src={shownPicture} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-6M3 16l4.5-4.5a2 2 0 0 1 2.8 0L18 19M14 14l1.5-1.5a2 2 0 0 1 2.8 0L21 15M18 3v6M15 6h6" />
                    </svg>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-muted">Picture</div>
                  <div className="text-[13px] leading-snug text-faint">PNG, JPEG, WebP or GIF, up to 2 MB. Square looks best.</div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <button type="button" onClick={() => fileInput.current?.click()} className="btn btn-soft h-9 px-3 text-[13px]">
                      {picture ? 'Choose another' : 'Choose image'}
                    </button>
                    {picture ? (
                      <button type="button" onClick={() => setPicture(null)} className="text-[13px] text-faint transition-colors hover:text-ink">
                        Remove
                      </button>
                    ) : (
                      <input
                        value={pictureLink}
                        onChange={(e) => setPictureLink(e.target.value.slice(0, 300))}
                        onPaste={onPaste}
                        aria-label="Or a link to a picture"
                        className="field h-9 min-w-[150px] flex-1 text-[13px]"
                        placeholder="or drop, paste, or a link"
                      />
                    )}
                  </div>
                </div>
                <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => void takeFile(e.target.files?.[0])} />
              </div>
            )}

            {fields.includes('description') && (
              <div>
                <Label text="Description" count={about.length} max={ABOUT_MAX} htmlFor="launch-about" />
                <textarea id="launch-about" value={about} onChange={(e) => setAbout(e.target.value.slice(0, ABOUT_MAX))} rows={3} className="field w-full resize-y py-2.5 text-[14px] leading-snug" placeholder="What is this, and why should anyone hold it?" />
              </div>
            )}

            {fields.includes('links') && (
              <div>
                <Label text="Links, optional" />
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {LINKS.map(({ key, label }) => (
                    <label key={key} className="relative block">
                      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] text-faint">{label}</span>
                      <input value={links[key] ?? ''} onChange={(e) => setLinks((l) => ({ ...l, [key]: e.target.value.slice(0, 300) }))} className="field h-10 w-full pl-[84px] text-[13px]" placeholder="https://" aria-label={label} />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </Step>

          {!other && (
            <Step n={++step} title="The market">
              <div>
                <Label text="Paired with" />
                <div className="flex h-11 items-center rounded-xl bg-white/5 px-3.5 font-semibold">ZRO</div>
              </div>
              <div>
                <Label text="Supply" htmlFor="launch-supply" />
                <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                  <input id="launch-supply" value={supplyText ? Number(supplyText).toLocaleString('en-US') : ''} onChange={(e) => setSupplyText(e.target.value.replace(/[^0-9]/g, '').slice(0, 17))} inputMode="numeric" className={cn('field num h-[44px] w-full text-[15px]', !supplyOk && 'text-down')} aria-label="Supply, in whole coins" />
                  <Choices value={SUPPLY_CHOICES.find((s) => s.whole === wholeSupply)?.whole ?? null} options={SUPPLY_CHOICES.map((s) => ({ value: s.whole, label: s.label }))} onChange={(v) => setSupplyText(String(v))} label="Supply" />
                </div>
                <p className="mt-1.5 text-[13px] leading-snug text-faint">Whole coins, one billion to one quadrillion. It changes how many coins there are and not what they&apos;re worth: every token opens at the same market cap.</p>
              </div>
            </Step>
          )}

          {!other && (
            <Step n={++step} title="Fees">
              <div>
                <Label text="Your fee on top" />
                <Choices value={devBps} options={DEV_FEE_CHOICES.map((f) => ({ value: f, label: f === 0 ? 'None' : percent(f) }))} onChange={setDevBps} label="Your fee on top" />
              </div>

              <div>
                <Label text={devBps > 0 ? 'Who the fee pays' : 'Where the fee goes'} />
                <FeeSplit devBps={devBps} split={split} onChange={setSplit} />
                <dl className="mt-3 grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px] leading-snug">
                  <dt className="text-faint">Fixed</dt>
                  <dd className="text-muted">Set once at launch and never changes</dd>
                  <dt className="text-faint">On the pool</dt>
                  <dd className="text-muted">The same split on every trade, whoever makes it</dd>
                  <dt className="text-faint">Liquidity</dt>
                  <dd className="text-muted">Locked for good when it moves to the pool</dd>
                </dl>
              </div>
            </Step>
          )}

          {!other && (
            <Step n={++step} title="Anti-snipe" note="Optional">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[14px]">Charge buys more just after launch</span>
                <div className="w-[116px] shrink-0">
                  <Choices value={antiSnipe ? 'on' : 'off'} options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]} onChange={(v) => setAntiSnipe(v === 'on')} label="Anti-snipe" />
                </div>
              </div>
              <p className="text-[13px] leading-snug text-faint">{`Buys pay ${percent(SNIPE_START_BPS)} at launch, falling steadily to your fee per trade over ${SNIPE_SECONDS} seconds. Sales never pay it, and neither does your first buy. The extra goes where your own fee goes, and buyers see the rate before they buy.`}</p>
            </Step>
          )}

          {fields.includes('firstBuy') && (
            <Step n={++step} title="First buy" note="Optional">
              <div className="rounded-xl bg-white/5 px-3.5 py-3 transition-colors focus-within:bg-white/[.08]">
                <label htmlFor="launch-first" className="flex items-baseline justify-between text-[13px] text-muted">
                  <span>Amount</span>
                  <span className="num text-faint">{account ? `You have ${zro(balance)} ZRO` : ''}</span>
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <input id="launch-first" value={firstBuy} onChange={(e) => setFirstBuy(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0" className="num w-full min-w-0 bg-transparent text-[26px] font-semibold outline-none placeholder:text-faint" />
                  <span className="shrink-0 font-semibold">ZRO</span>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {FIRST_BUYS.map((v) => (
                  <button key={v} type="button" onClick={() => setFirstBuy(v)} className="btn-soft num h-8 rounded-[7px] text-[13px] transition-colors duration-150">
                    {v}
                  </button>
                ))}
              </div>
              <p className="text-[13px] leading-snug text-faint">{other ? `It goes in the launch transaction itself, at ${other.name}'s opening price, so no bot gets in first.` : 'It goes in the launch transaction itself, at the opening price, so no bot gets in first. Without one you start with none: all of the supply is on the curve or set aside for the pool.'}</p>
            </Step>
          )}
        </div>

        <aside className="panel p-5 lg:sticky lg:top-0">
          <h2 className="font-semibold">Preview</h2>
          <div className="mt-3 flex items-center gap-3">
            <span className="flex h-[76px] w-[76px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[.06] text-[26px] font-bold text-muted">{shownPicture ? <img src={shownPicture} alt="" className="h-full w-full object-cover" /> : (symbol || '?').slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 leading-snug">
              <div className="flex items-baseline gap-1.5">
                <span className="truncate text-[13px] text-muted">{name.trim() || 'Your token'}</span>
                <span className="shrink-0 text-[12px] uppercase text-faint">{symbol || 'Symbol'}</span>
              </div>
              <div className="num mt-0.5 text-[24px] font-bold tracking-tight">{startCap ? money(startCap) : 'Not known'}</div>
              <div className="text-[13px] text-faint">market cap at launch</div>
            </div>
          </div>

          <dl className="mt-3 border-t border-white/[.06] pt-2">
            {supply && startCap ? (
              <Fact k="Price">
                {usd ? '$' : ''}
                <Price value={(startCap / supply) * (usd ?? 1)} />
                {usd ? '' : ' ZRO'}
              </Fact>
            ) : null}
            {other ? (
              <Fact k="Fees and rules">Set by {other.name}</Fact>
            ) : (
              <>
                <Fact k="Trading fee">{percent(feeBps)}</Fact>
                <Fact k="Your share">{devBps > 0 ? `${percent(CREATOR_BASE_BPS + (devBps * split.creator) / 100)} of each trade` : `${percent(CREATOR_BASE_BPS)} of each trade`}</Fact>
                {devBps > 0 && split.holders > 0 && <Fact k="To holders">{`${percent((devBps * split.holders) / 100)} of each trade`}</Fact>}
                {devBps > 0 && split.burn > 0 && <Fact k="Buyback">{`${percent((devBps * split.burn) / 100)} of each trade`}</Fact>}
                {antiSnipe && <Fact k="Anti-snipe">{`${percent(SNIPE_START_BPS)}, falling for ${SNIPE_SECONDS} s`}</Fact>}
                <Fact k="Moves to a pool at">{`${money(POOL_CAP)} cap`}</Fact>
                <Fact k="Pool">{`${CURVE.raiseTarget} ZRO, locked`}</Fact>
              </>
            )}
            {supply ? <Fact k="Supply">{compact(supply)}</Fact> : null}
            {fields.includes('firstBuy') && <Fact k="You get">{firstNum <= 0 ? 'No first buy' : other || !supply ? 'From its curve' : `${compact(tokens)}, ${((tokens / supply) * 100).toFixed(1)}%`}</Fact>}
            {launchFee > 0n && <Fact k="Launch fee">{`${zro(Number(formatEther(launchFee)))} ZRO`}</Fact>}
          </dl>

          <div className="mt-2 flex items-baseline justify-between border-t border-white/[.06] pt-3">
            <span className="font-medium">You send</span>
            <span className="num text-[22px] font-bold tracking-tight">{zro(Number(formatEther(total)))} ZRO</span>
          </div>

          {!account ? (
            <button onClick={create} className="btn btn-accent mt-3 h-12 w-full text-[15px]">
              Create wallet
            </button>
          ) : (
            <button onClick={submit} disabled={missing.length > 0 || busy || tooMuch} className="btn btn-accent mt-3 h-12 w-full text-[15px]">
              {busy ? 'Launching' : tooMuch ? 'Not enough ZRO' : 'Launch'}
            </button>
          )}
          {missing.length > 0 && <p className="mt-2 text-[13px] text-muted">Missing: {missing.join(', ')}.</p>}
          {error && <p className="animate-fade mt-2 text-[13px] leading-snug text-down">{error}</p>}
          <p className="mt-3 text-[12px] leading-snug text-faint">{other ? `Your wallet sends this straight to ${other.name}'s contract.` : `${launchFee > 0n ? '' : 'Free to launch. '}A plain token: no owner, no minting, no tax, no pause.`}</p>
        </aside>
      </div>
    </div>
  );
}
