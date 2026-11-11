'use client';

import { useEffect, useState } from 'react';
import { encodeFunctionData, formatEther, parseEther, type Address } from 'viem';
import { getDeployment, useLive, type TokenDetail, type WalletData } from '@/lib/api';
import { LIMITS_ABI, ORDER_KIND, POOL_CAP, ROUTER_ABI } from '@/lib/config';
import { deadline, withSlippage } from '@/lib/prep';
import { quoteBuy } from '@/lib/trade';
import { zro, cn } from '@/lib/format';
import { useFormat } from '@/lib/money';
import { ensureAllowance, tokenBalance } from '@/lib/trade';
import { send } from '@/lib/tx';
import { publicClient, useWallet } from '@/lib/wallet';

type Tab = 'exits' | 'events' | 'dca' | 'wallets';
const DAY = 86400;
const wei = (v: number) => parseEther((v > 0 ? v : 0).toFixed(18) as `${number}`);

/**
 * Orders that sell or buy on their own, kept on the chain and filled by anyone, so they work with the browser closed: take
 * profit and stop loss on the same tokens, a trailing stop, selling when the token moves to its pool or when its creator
 * sells, buying when it moves to its pool, and buying a little at a time.
 */
export function Automation({ token, embedded = false }: { token: TokenDetail; embedded?: boolean }) {
  const account = useWallet((s) => s.account);
  const { money, usd } = useFormat();
  const [tab, setTab] = useState<Tab>('exits');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [runFee, setRunFee] = useState(0.04);
  const [held, setHeld] = useState(0n);
  const address = token.address as Address;
  const ours = token.source === 'terminal';
  const fee = token.fee_bps / 10_000;
  const { data: wallet } = useLive<WalletData>(account ? `/api/v1/wallet/${account.address.toLowerCase()}` : null, (t, d) => t === 'trade' && d.token === token.address, 800);
  const holding = wallet?.holdings.find((h) => h.token === token.address);
  // Entry as a market cap: what was paid per token on the buys, times the supply.
  const entryCap = holding && holding.bought > 0 ? (holding.spent / holding.bought) * token.total_supply : 0;

  useEffect(() => {
    getDeployment()
      .then(({ limitOrders }) => publicClient.readContract({ address: limitOrders, abi: LIMITS_ABI, functionName: 'runFee' }))
      .then((v) => setRunFee(Number(formatEther(v))), () => {});
  }, []);
  useEffect(() => {
    if (account) tokenBalance(address, account.address).then(setHeld, () => {});
  }, [account, address, wallet]);

  // Exits
  const [share, setShare] = useState(100);
  const [tp1, setTp1] = useState('100');
  const [tp1Share, setTp1Share] = useState(50);
  const [tp2, setTp2] = useState('');
  const [sl, setSl] = useState('40');
  const [trail, setTrail] = useState('');
  // Events
  const [onPool, setOnPool] = useState(true);
  const [devSell, setDevSell] = useState('50');
  const [buyOnPool, setBuyOnPool] = useState('');
  // DCA
  const [dcaTotal, setDcaTotal] = useState('');
  const [dcaSlices, setDcaSlices] = useState('5');
  const [dcaMinutes, setDcaMinutes] = useState('10');
  const [dcaMaxCap, setDcaMaxCap] = useState('');

  const heldNum = Number(formatEther(held));
  const amount = (held * BigInt(share)) / 100n;
  const amountNum = Number(formatEther(amount));
  const price = token.price;
  const base = entryCap > 0 ? entryCap / token.total_supply : price; // levels are set from the entry when there is one
  const capText = (pricePer: number) => money(pricePer * token.total_supply);

  const run = async (label: string, fn: (limits: Address) => Promise<unknown>) => {
    setNote(null);
    setBusy(true);
    try {
      const { limitOrders } = await getDeployment();
      await fn(limitOrders);
      setNote({ ok: true, text: `${label} placed. It waits on the chain and fills even with this tab closed.` });
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  /** A sale leg for `tokens` (wei) that must fetch at least `atPrice` per token, after fees, before the keeper's share. */
  const floorFor = (tokens: bigint, atPrice: number) => wei(Math.max(Number(formatEther(tokens)) * atPrice * (1 - fee) - runFee, 1e-12));

  const placeExits = () =>
    run('Exits', async (limits) => {
      const legs: Array<{ kind: number; share: bigint; minOut: bigint; trigger: bigint; trailBps: number }> = [];
      const t1 = Number(tp1);
      const t2 = Number(tp2);
      const stop = Number(sl);
      const trailing = Number(trail);
      if (t1 > 0) {
        const part = (amount * BigInt(tp2 ? tp1Share : 100)) / 100n;
        legs.push({ kind: ORDER_KIND.limit, share: part, minOut: floorFor(part, base * (1 + t1 / 100)), trigger: 0n, trailBps: 0 });
      }
      if (t2 > 0) {
        const rest = amount - (amount * BigInt(tp1Share)) / 100n;
        legs.push({ kind: ORDER_KIND.limit, share: rest, minOut: floorFor(rest, base * (1 + t2 / 100)), trigger: 0n, trailBps: 0 });
      }
      if (stop > 0 && stop < 100) {
        const level = base * (1 - stop / 100);
        // Fires once the market falls to the level; never sells for less than half of it, so a crash can't empty it for nothing.
        legs.push({ kind: ORDER_KIND.stop, share: amount, minOut: floorFor(amount, level * 0.5), trigger: wei(amountNum * level * (1 - fee)), trailBps: 0 });
      }
      if (trailing > 0 && trailing < 100) legs.push({ kind: ORDER_KIND.trailing, share: amount, minOut: floorFor(amount, price * 0.3), trigger: 0n, trailBps: Math.round(trailing * 100) });
      if (!legs.length) throw new Error('Set at least one level');
      await ensureAllowance(address, token.symbol, limits, amount);
      await send({ label: `Exits for ${token.symbol}`, to: limits, data: encodeFunctionData({ abi: LIMITS_ABI, functionName: 'placeSellLegs', args: [address, amount, Math.floor(Date.now() / 1000) + 30 * DAY, legs] }) });
    });

  const placeEvents = () =>
    run('Event orders', async (limits) => {
      const legs: Array<{ kind: number; share: bigint; minOut: bigint; trigger: bigint; trailBps: number }> = [];
      if (onPool && ours && !token.graduated) legs.push({ kind: ORDER_KIND.onGraduation, share: amount, minOut: floorFor(amount, price * 0.5), trigger: 0n, trailBps: 0 });
      const dev = Number(devSell);
      if (dev > 0 && dev <= 100 && ours) legs.push({ kind: ORDER_KIND.onDevSell, share: amount, minOut: floorFor(amount, price * 0.3), trigger: 0n, trailBps: Math.round(dev * 100) });
      if (legs.length) {
        await ensureAllowance(address, token.symbol, limits, amount);
        await send({ label: `Event sales for ${token.symbol}`, to: limits, data: encodeFunctionData({ abi: LIMITS_ABI, functionName: 'placeSellLegs', args: [address, amount, Math.floor(Date.now() / 1000) + 30 * DAY, legs] }) });
      }
      const spend = Number(buyOnPool);
      if (spend > 0 && ours && !token.graduated) {
        // At the pool the price starts where the curve ended. Paying up to twice that leaves room for the first rush.
        const poolPrice = POOL_CAP / token.total_supply;
        const minOut = wei(((spend - runFee) * (1 - fee)) / (poolPrice * 2));
        await send({ label: `Buy ${token.symbol} when it moves to a pool`, to: limits, value: wei(spend), data: encodeFunctionData({ abi: LIMITS_ABI, functionName: 'placeBuyIf', args: [address, minOut, Math.floor(Date.now() / 1000) + 30 * DAY, ORDER_KIND.onGraduation, 0, 0] }) });
      }
      if (!legs.length && !(spend > 0)) throw new Error('Pick at least one');
    });

  const placeDca = () =>
    run('DCA', async (limits) => {
      const total = Number(dcaTotal);
      const slices = Math.round(Number(dcaSlices));
      const minutes = Number(dcaMinutes);
      const maxCap = Number(dcaMaxCap) || token.market_cap * (usd ?? 1) * 3;
      if (!(total > 0) || slices < 2 || slices > 100 || !(minutes > 0)) throw new Error('Set the amount, 2 to 100 parts and the minutes between them');
      const capInZro = usd ? maxCap / usd : maxCap;
      const minOut = wei(((total - runFee) * (1 - fee)) / (capInZro / token.total_supply));
      await send({ label: `DCA into ${token.symbol}`, to: limits, value: wei(total), data: encodeFunctionData({ abi: LIMITS_ABI, functionName: 'placeBuyIf', args: [address, minOut, 0, ORDER_KIND.dca, Math.round(minutes * 60), slices] }) });
    });

  // Several wallets at once
  const wallets = useWallet((s) => s.wallets);
  const accountsFor = useWallet((s) => s.accountsFor);
  const slippageBps = useWallet((s) => s.slippageBps);
  const [picked, setPicked] = useState<string[]>([]);
  const [each, setEach] = useState('');
  const buyFromMany = () =>
    run('Buys', async () => {
      const spend = Number(each);
      if (!(spend > 0) || !picked.length) throw new Error('Pick wallets and an amount for each');
      const { router } = await getDeployment();
      const value = wei(spend);
      // One after another, each signed by its own wallet. Each one's minimum is its own fresh quote less the slippage.
      for (const signer of accountsFor(picked)) {
        const quote = await quoteBuy(address, value);
        if (!quote) throw new Error('No venue quotes this token right now');
        const minOut = withSlippage(quote, slippageBps);
        await send({ as: signer, label: `Buy ${token.symbol} from ${signer.address.slice(0, 6)}`, to: router, value, data: encodeFunctionData({ abi: ROUTER_ABI, functionName: 'buy', args: [address, minOut, signer.address, deadline()] }) });
      }
    });

  if (!account || !token.tradable) return null;
  const field = 'field num h-9 w-full text-[14px]';
  const label = 'text-[12px] text-muted';

  return (
    <section className={embedded ? 'mt-2.5' : 'panel mt-2 p-3'}>
      <div className="mb-2 flex items-center gap-1">
        {!embedded && <h2 className="mr-auto text-[14px] font-semibold">Automation</h2>}
        {(['exits', 'events', 'dca', 'wallets'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn('pill text-[12px]', tab === t && 'pill-on')}>
            {t === 'exits' ? 'TP and SL' : t === 'events' ? 'On events' : t === 'dca' ? 'DCA' : 'Wallets'}
          </button>
        ))}
      </div>

      {(tab === 'exits' || tab === 'events') && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-[12px] text-muted">
            <span>Of what you hold</span>
            <span className="num">
              {zro(amountNum)} of {zro(heldNum)} {token.symbol}
            </span>
          </div>
          <div className="mt-1 flex gap-1">
            {[25, 50, 100].map((p) => (
              <button key={p} onClick={() => setShare(p)} className={cn('pill num flex-1 text-[12px]', share === p && 'pill-on')}>
                {p}%
              </button>
            ))}
          </div>
          {entryCap > 0 && <div className="num mt-1 text-[12px] text-faint">Levels count from your entry at {money(entryCap)} cap</div>}
        </div>
      )}

      {tab === 'exits' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className={label}>
              Take profit at +%
              <input value={tp1} onChange={(e) => setTp1(e.target.value.replace(/[^0-9.]/g, ''))} className={field} inputMode="decimal" placeholder="None" />
              {Number(tp1) > 0 && <span className="num text-[11px] text-faint">{capText(base * (1 + Number(tp1) / 100))} cap</span>}
            </label>
            <label className={label}>
              Second take profit +%
              <input value={tp2} onChange={(e) => setTp2(e.target.value.replace(/[^0-9.]/g, ''))} className={field} inputMode="decimal" placeholder="None" />
              {Number(tp2) > 0 && <span className="num text-[11px] text-faint">{capText(base * (1 + Number(tp2) / 100))} cap</span>}
            </label>
          </div>
          {Number(tp2) > 0 && (
            <div className="flex items-center gap-2 text-[12px] text-muted">
              First sells
              {[25, 50, 75].map((p) => (
                <button key={p} onClick={() => setTp1Share(p)} className={cn('pill num text-[12px]', tp1Share === p && 'pill-on')}>
                  {p}%
                </button>
              ))}
              the second the rest
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className={label}>
              Stop loss at -%
              <input value={sl} onChange={(e) => setSl(e.target.value.replace(/[^0-9.]/g, ''))} className={field} inputMode="decimal" placeholder="None" />
              {Number(sl) > 0 && Number(sl) < 100 && <span className="num text-[11px] text-faint">{capText(base * (1 - Number(sl) / 100))} cap</span>}
            </label>
            <label className={label}>
              Trailing stop, % drop
              <input value={trail} onChange={(e) => setTrail(e.target.value.replace(/[^0-9.]/g, ''))} className={field} inputMode="decimal" placeholder="None" />
            </label>
          </div>
          <p className="text-[12px] leading-snug text-faint">They share the same tokens: whichever fills first sells its part, and the rest carry on with what's left. Cancelling one cancels them all and returns the tokens.</p>
          <button onClick={placeExits} disabled={busy || amount === 0n} className="btn btn-accent h-10 w-full">
            {busy ? 'Working' : amount === 0n ? `No ${token.symbol} to protect` : 'Place exits'}
          </button>
        </div>
      )}

      {tab === 'events' && (
        <div className="space-y-2">
          {ours && !token.graduated && (
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={onPool} onChange={(e) => setOnPool(e.target.checked)} />
              Sell when it moves to a pool
            </label>
          )}
          {ours && (
            <label className={label}>
              Sell when the dev has sold this % of what they hold now
              <input value={devSell} onChange={(e) => setDevSell(e.target.value.replace(/[^0-9.]/g, ''))} className={field} inputMode="decimal" placeholder="None" />
            </label>
          )}
          {ours && !token.graduated && (
            <label className={label}>
              Buy when it moves to a pool, ZRO
              <input value={buyOnPool} onChange={(e) => setBuyOnPool(e.target.value.replace(/[^0-9.]/g, ''))} className={field} inputMode="decimal" placeholder="None" />
            </label>
          )}
          {!ours && <p className="text-[13px] text-muted">Event orders work on tokens launched here, where the chain can tell when they move to a pool and what the dev holds.</p>}
          <button onClick={placeEvents} disabled={busy || !ours} className="btn btn-accent h-10 w-full">
            {busy ? 'Working' : 'Place event orders'}
          </button>
        </div>
      )}

      {tab === 'dca' && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <label className={label}>
              Total, ZRO
              <input value={dcaTotal} onChange={(e) => setDcaTotal(e.target.value.replace(/[^0-9.]/g, ''))} className={field} inputMode="decimal" placeholder="0" />
            </label>
            <label className={label}>
              Parts
              <input value={dcaSlices} onChange={(e) => setDcaSlices(e.target.value.replace(/[^0-9]/g, ''))} className={field} inputMode="numeric" />
            </label>
            <label className={label}>
              Every, min
              <input value={dcaMinutes} onChange={(e) => setDcaMinutes(e.target.value.replace(/[^0-9.]/g, ''))} className={field} inputMode="decimal" />
            </label>
          </div>
          <label className={label}>
            Never buy above this cap, {usd ? 'USD' : 'ZRO'}
            <input value={dcaMaxCap} onChange={(e) => setDcaMaxCap(e.target.value.replace(/[^0-9.]/g, ''))} className={field} inputMode="decimal" placeholder={`${Math.round(token.market_cap * (usd ?? 1) * 3)}`} />
          </label>
          {Number(dcaTotal) > 0 && Number(dcaSlices) >= 2 && (
            <p className="num text-[12px] text-faint">
              {zro(Number(dcaTotal) / Number(dcaSlices))} ZRO every {dcaMinutes} min, {dcaSlices} times
            </p>
          )}
          <button onClick={placeDca} disabled={busy || !(Number(dcaTotal) > 0)} className="btn btn-accent h-10 w-full">
            {busy ? 'Working' : 'Start DCA'}
          </button>
        </div>
      )}

      {tab === 'wallets' && (
        <div className="space-y-2">
          {wallets.length < 2 ? (
            <p className="text-[13px] text-muted">Add more wallets in Portfolio to buy from several at once.</p>
          ) : (
            <>
              <ul className="space-y-1">
                {wallets.map((w) => (
                  <li key={w.address}>
                    <label className="flex items-center gap-2 text-[13px]">
                      <input type="checkbox" checked={picked.includes(w.address)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, w.address] : p.filter((a) => a !== w.address)))} />
                      <span className="flex-1 truncate">{w.name}</span>
                      <span className="num text-faint">{w.address.slice(0, 6)}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <label className="text-[12px] text-muted">
                ZRO from each
                <input value={each} onChange={(e) => setEach(e.target.value.replace(/[^0-9.]/g, ''))} className="field num h-9 w-full text-[14px]" inputMode="decimal" placeholder="0" />
              </label>
              <button onClick={buyFromMany} disabled={busy || !picked.length || !(Number(each) > 0)} className="btn btn-accent h-10 w-full">
                {busy ? 'Working' : `Buy from ${picked.length} wallets`}
              </button>
            </>
          )}
        </div>
      )}

      {note && <p className={cn('mt-2 rounded-lg px-2.5 py-1.5 text-[13px] leading-snug', note.ok ? 'bg-up/10 text-up' : 'bg-down/10 text-down')}>{note.text}</p>}
    </section>
  );
}
