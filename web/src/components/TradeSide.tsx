'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { encodeFunctionData, formatEther, parseEther, type Address } from 'viem';
import { getDeployment, useLive, useStream, type DevInfo, type Holder, type Order, type TokenDetail, type Trade, type WalletData } from '@/lib/api';
import { buyFeeNow, CURVE, ERC20_ABI, feeParts, HOLDER_TOKEN_ABI, LIMITS_ABI, pctOf, SNIPE_SECONDS } from '@/lib/config';
import { useRank } from '@/lib/rank';
import { checkExit, LOSSY, type Exit } from '@/lib/exit';
import { age, zro, cn, compact, short, usdText } from '@/lib/format';
import { useNow, everyBlock } from '@/lib/hooks';
import { useFormat } from '@/lib/money';
import { openWallet, useTicket } from '@/lib/selection';
import { useLaunchpads } from '@/lib/launchpads';
import { AUTO_SLIPPAGE_BPS, prepareBuy, prepareToken } from '@/lib/prep';
import { ensureAllowance, marketBuy, marketSell, quoteBuy, quoteSell } from '@/lib/trade';
import { send } from '@/lib/tx';
import { publicClient, useWallet } from '@/lib/wallet';
import { Automation } from './Automation';
import { Change, Progress } from './bits';
import { OrderRow } from './Orders';
import { ShareButton, ShareSheet } from './ShareSheet';

type Mode = 'market' | 'limit' | 'auto';

function safeParse(v: string): bigint {
  try {
    return Number(v) > 0 ? parseEther(v as `${number}`) : 0n;
  } catch {
    return 0n;
  }
}

function useTokenBalance(token: Address) {
  const account = useWallet((s) => s.account);
  const [balance, setBalance] = useState(0n);
  const refresh = useCallback(async () => {
    if (!account) return setBalance(0n);
    try {
      setBalance(await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }));
    } catch {}
  }, [account, token]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useStream((type, d) => {
    if (type === 'trade' && d.token === token) void refresh();
  });
  return { balance, refresh };
}

const EXPIRIES = [
  { label: '1 hour', s: 3600 },
  { label: '1 day', s: 86400 },
  { label: '7 days', s: 604800 },
];

/** Every card here is built from these three, so labels share one left edge and figures one right edge. */
function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn('panel p-4', className)}>{children}</section>;
}

function CardHead({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="min-w-0 truncate text-[14px] font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Row({ k, hint, tone, children }: { k: string; hint?: string; tone?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[24px] items-center justify-between gap-3 text-[13px]">
      <dt className="min-w-0 truncate text-muted" title={hint}>
        {k}
      </dt>
      <dd className={cn('num shrink-0 text-right', tone)}>{children}</dd>
    </div>
  );
}

function TradeCard({ token, onTraded }: { token: TokenDetail; onTraded: () => void }) {
  const address = token.address as Address;
  const { account, balance: zroBalance, create, slippageBps, setSlippageBps } = useWallet();
  const { balance: tokenBalance, refresh: refreshToken } = useTokenBalance(address);
  // The wallet's volume rank takes part of the terminal's cut off every trade through it.
  const rank = useRank(account?.address);
  const rankOff = (rank?.rank.offBps ?? 0) / 10_000;
  const { usd, unit: moneyUnit, money } = useFormat();

  const [mode, setMode] = useState<Mode>('market');
  const [isBuy, setIsBuy] = useState(true);
  const [amount, setAmount] = useState('');
  const [targetCap, setTargetCap] = useState('');
  const [expiry, setExpiry] = useState(86400);
  const [quote, setQuote] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A level clicked on the chart's price scale: below the market that's a buy, above it a sale.
  const ticket = useTicket((s) => s.nonce);
  const ticketPrice = useTicket((s) => s.price);
  const seenTicket = useRef(ticket);
  useEffect(() => {
    if (ticket === seenTicket.current) return;
    seenTicket.current = ticket;
    setMode('limit');
    setIsBuy(ticketPrice < token.price);
    const cap = ticketPrice * token.total_supply * (usd ?? 1);
    setTargetCap(cap >= 100 ? cap.toFixed(0) : cap.toPrecision(4));
    document.getElementById('limit-cap')?.focus();
  }, [ticket, ticketPrice, token.price, token.total_supply, usd]);

  // A different token starts with a clean form.
  useEffect(() => {
    setAmount('');
    setTargetCap('');
    setError(null);
  }, [address]);

  // Limit orders trade through our router, so another launchpad's tokens can't have them.
  const canLimit = token.source === 'terminal' || token.has_pool;
  useEffect(() => {
    if (!canLimit) setMode('market');
  }, [canLimit]);

  const wei = safeParse(amount);

  // Getting ready for the click, the moment the token opens: see prep.ts.
  const hasWallet = !!account;
  useEffect(() => {
    if (!hasWallet) return;
    prepareToken(address);
    return everyBlock(() => prepareToken(address), 1000);
  }, [address, hasWallet]);

  // Quotes come from the chain through the router, so what's shown is what the contracts would do right now.
  // One is kept fresh while an amount is typed in, so pressing the button doesn't have to wait for another.
  useEffect(() => {
    let live = true;
    if (wei === 0n) {
      setQuote(null);
      return;
    }
    const ask = () => (isBuy ? quoteBuy(address, wei) : quoteSell(address, wei));
    const id = setTimeout(async () => {
      try {
        const q = await ask();
        if (live) setQuote(q);
        if (live && isBuy && mode === 'market') void prepareBuy(address, formatEther(wei));
      } catch {
        if (live) setQuote(0n);
      }
    }, 120);
    // A new block can move the price, so the quote follows each one: what the button shows is what it would send.
    const stopFresh = everyBlock(() => void ask().then((q) => live && setQuote(q), () => {}), 300);
    return () => {
      live = false;
      clearTimeout(id);
      stopFresh();
    };
  }, [wei, isBuy, address, token.price, mode]);

  // What selling straight after this buy would bring back, tried on the chain as it is now, with nothing spent.
  const [exit, setExit] = useState<Exit>();
  useEffect(() => {
    setExit(undefined);
    if (!isBuy || mode !== 'market' || wei === 0n) return;
    let live = true;
    const read = () => void checkExit(address, wei).then((v) => live && setExit(v));
    const first = setTimeout(read, 300);
    const stopPoll = everyBlock(read, 3000, 12_000);
    return () => {
      live = false;
      clearTimeout(first);
      stopPoll();
    };
  }, [address, isBuy, mode, wei]);

  // The share of a holding that pays back what it cost: sell that and ride the rest for free.
  const { data: walletData } = useLive<WalletData>(account ? `/api/v1/wallet/${account.address.toLowerCase()}` : null, (t, d) => t === 'trade' && d.token === address, 600);
  const holding = walletData?.holdings.find((h) => h.token === address);
  const paidIn = holding ? holding.spent - holding.received : 0;
  const initials = holding && paidIn > 0 && holding.value > paidIn ? Math.min(100, Math.ceil((paidIn / holding.value) * 100)) : null;

  const out = quote === null ? null : Number(formatEther(quote));
  const inNum = Number(amount) || 0;
  // The buy that fills the curve only pays for what was left, and the rest comes back.
  const room = token.source === 'terminal' && !token.graduated ? CURVE.raiseTarget - token.raised : Infinity;
  // What this token's creator chose, and for its first minute, with anti-snipe, what a buy pays on top. It runs out on its own.
  const clock = useNow(token.anti_snipe ? 1000 : 60_000);
  const ours = token.source === 'terminal';
  const tradeFee = token.fee_bps / 10_000;
  const buyFee = ours && !token.graduated ? buyFeeNow(token.fee_bps, token.anti_snipe, token.created_at, clock / 1000) : tradeFee;
  const snipeLeft = ours && !token.graduated && token.anti_snipe ? Math.ceil(token.created_at + SNIPE_SECONDS - clock / 1000) : 0;
  const usedNum = isBuy && inNum * (1 - buyFee) >= room ? room / (1 - buyFee) : inNum;
  // Impact is what the trade itself does to the price. The fee has its own row, so it's taken out here to not count twice.
  const feeNow = ours ? (isBuy ? buyFee : tradeFee) : 0;
  const execPrice = out && inNum ? (isBuy ? (usedNum * (1 - feeNow)) / out : out / (1 - feeNow) / inNum) : 0;
  const impact = execPrice && token.price ? (isBuy ? execPrice / token.price - 1 : 1 - execPrice / token.price) : 0;

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      setAmount('');
      setTargetCap('');
      await refreshToken();
      onTraded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitMarket = () => run(() => (isBuy ? marketBuy(address, token.symbol, amount) : marketSell(address, token.symbol, wei)));

  // Limit prices are typed as a market cap, in the currency on screen: 12.5 means something, 0.0000000125 doesn't.
  const capNum = Number(targetCap) || 0;
  const targetPrice = (usd ? capNum / usd : capNum) / token.total_supply;
  // What the keeper is paid per order, read once. On a small order it matters as much as the price.
  const [runFee, setRunFee] = useState(0.04);
  useEffect(() => {
    getDeployment()
      .then(({ limitOrders }) => publicClient.readContract({ address: limitOrders, abi: LIMITS_ABI, functionName: 'runFee' }))
      .then((v) => setRunFee(Number(formatEther(v))))
      .catch(() => {});
  }, []);
  // The level is the market's price, so the minimum is what that price pays after fees. Otherwise an order sits at its own
  // level unfilled, waiting for the market to go far enough past it to cover them.
  const limitOut = targetPrice > 0 && inNum > 0 ? Math.max(0, isBuy ? ((inNum - runFee) * (1 - tradeFee)) / targetPrice : inNum * targetPrice * (1 - tradeFee) - runFee) : 0;
  // The contract refuses a buy of up to twice the keeper's fee, and a sale that wouldn't cover it brings nothing.
  const limitTooSmall = mode === 'limit' && inNum > 0 && targetPrice > 0 && (isBuy ? inNum <= runFee * 2 : limitOut <= 0);

  const submitLimit = () =>
    run(async () => {
      const { limitOrders } = await getDeployment();
      const until = Math.floor(Date.now() / 1000) + expiry;
      const minOut = parseEther(limitOut.toFixed(18) as `${number}`);
      if (isBuy) {
        await send({ label: `Limit buy ${token.symbol}`, to: limitOrders, value: wei, data: encodeFunctionData({ abi: LIMITS_ABI, functionName: 'placeBuy', args: [address, minOut, until] }) });
      } else {
        await ensureAllowance(address, token.symbol, limitOrders, wei);
        await send({ label: `Limit sell ${token.symbol}`, to: limitOrders, data: encodeFunctionData({ abi: LIMITS_ABI, functionName: 'placeSell', args: [address, wei, minOut, until] }) });
      }
    });

  const noRoute = mode === 'market' && quote === 0n && wei > 0n;
  const tooMuch = isBuy ? inNum > zroBalance : wei > tokenBalance;
  const unit = isBuy ? 'ZRO' : token.symbol;
  const available = isBuy ? `${zro(zroBalance)} ZRO` : `${compact(Number(formatEther(tokenBalance)))} ${token.symbol}`;

  return (
    <Card>
      <div className="relative grid grid-cols-2 rounded-xl bg-white/5 p-1">
        <span className={cn('absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-[6px] transition-all duration-200 ease-out', isBuy ? 'translate-x-0 bg-accent' : 'translate-x-full bg-ink')} />
        <button onClick={() => setIsBuy(true)} className={cn('relative h-9 font-semibold transition-colors duration-200', isBuy ? 'text-black' : 'text-muted hover:text-ink')}>
          Buy
        </button>
        <button onClick={() => setIsBuy(false)} className={cn('relative h-9 font-semibold transition-colors duration-200', !isBuy ? 'text-black' : 'text-muted hover:text-ink')}>
          Sell
        </button>
      </div>

      <div className="mt-2.5 flex items-center justify-between">
        <div className="flex gap-0.5">
          {(canLimit ? (['market', 'limit', 'auto'] as Mode[]) : (['market'] as Mode[])).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cn('pill', mode === m && 'pill-on')} title={m === 'auto' ? 'Take profit, stop loss, trailing stop, orders on events, DCA' : undefined}>
              {m === 'market' ? 'Market' : m === 'limit' ? 'Limit' : 'TP / SL'}
            </button>
          ))}
        </div>
        <button onClick={() => setAmount(isBuy ? String(Math.max(zroBalance - 0.5, 0)) : formatEther(tokenBalance))} className="num truncate pl-2 text-[13px] text-muted transition-colors hover:text-ink" title="Use everything">
          {available}
        </button>
      </div>

      {mode === 'auto' ? (
        <Automation token={token} embedded />
      ) : (
        <>
      <label className="mt-2 flex items-center gap-2 rounded-xl bg-white/5 px-3.5 py-3 transition-colors focus-within:bg-white/[.08]">
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0" className="num w-full min-w-0 bg-transparent text-[24px] font-semibold outline-none placeholder:text-faint" disabled={busy} aria-label={isBuy ? 'Amount of ZRO to pay' : `Amount of ${token.symbol} to sell`} />
        <span className="max-w-[90px] shrink-0 truncate text-right leading-tight text-muted">
          {unit}
          {isBuy && usd && inNum > 0 && <span className="num block text-[12px] text-faint">{usdText(inNum * usd)}</span>}
        </span>
      </label>

      <div className="mt-1.5 grid grid-cols-5 gap-1">
        {isBuy ? (
          <>
            {['50', '200', '500', '2000'].map((v) => (
              <button key={v} onClick={() => setAmount(v)} className="btn-soft num h-8 rounded-[7px] text-[13px] transition-colors duration-150">
                {v}
              </button>
            ))}
            <button onClick={() => setAmount(String(Math.max(zroBalance - 1, 0)))} disabled={zroBalance <= 1} className="btn-soft h-8 rounded-[7px] text-[13px] transition-colors duration-150 disabled:opacity-40" title="Everything but a little for gas">
              Max
            </button>
          </>
        ) : (
          <>
            {[25, 50, 75, 100].map((p) => (
              <button key={p} onClick={() => setAmount(formatEther((tokenBalance * BigInt(p)) / 100n))} className="btn-soft num h-8 rounded-[7px] text-[13px] transition-colors duration-150">
                {p === 100 ? 'All' : `${p}%`}
              </button>
            ))}
            <button onClick={() => initials && setAmount(formatEther((tokenBalance * BigInt(initials)) / 100n))} disabled={!initials} className="btn-soft h-8 rounded-[7px] text-[12px] transition-colors duration-150 disabled:opacity-40" title="Sell what you paid in, keep the rest">
              Paid in
            </button>
          </>
        )}
      </div>

      {mode === 'limit' && (
        <div className="animate-fade mt-3">
          <label className="flex items-center justify-between text-[13px] text-muted" htmlFor="limit-cap">
            <span>{isBuy ? 'Buy when market cap is at or below' : 'Sell when market cap is at or above'}</span>
          </label>
          <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-white/5 px-3.5 py-2.5 transition-colors focus-within:bg-white/[.08]">
            <input id="limit-cap" value={targetCap} onChange={(e) => setTargetCap(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder={compact(usd ? token.market_cap * usd : token.market_cap)} className="num w-full min-w-0 bg-transparent text-[16px] font-semibold outline-none placeholder:text-faint" disabled={busy} />
            <span className="shrink-0 text-muted">{moneyUnit}</span>
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {EXPIRIES.map((e) => (
              <button key={e.s} onClick={() => setExpiry(e.s)} className={cn('h-8 rounded-[7px] text-[13px] font-medium transition-colors duration-150', expiry === e.s ? 'bg-white/[.14] text-ink' : 'bg-white/[.05] text-muted hover:text-ink')}>
                {e.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <dl className="mt-2.5">
        {mode === 'market' ? (
          <>
            {usedNum < inNum && (
              <Row k="Used of this" hint="This buy moves the token to a pool. It only pays for what was left on the curve, and the rest comes back to you.">
                {zro(usedNum)} ZRO
              </Row>
            )}
            <Row k="You get about">{out === null ? '0' : isBuy ? `${compact(out)} ${token.symbol}` : usd ? `${zro(out)} ZRO, ${money(out)}` : `${zro(out)} ZRO`}</Row>
            <Row k="Price impact" tone={impact > 0.05 ? 'text-down' : ''}>
              {quote ? `${(Math.max(impact, 0) * 100).toFixed(2)}%` : '0%'}
            </Row>
            {ours && (
              <Row
                k="Fee"
                hint={rankOff > 0 ? `The 1% base and what this token's creator added, less ${pctOf(rankOff * 100)} for your ${rank!.rank.name} rank.` : "The 1% base and what this token's creator added, taken on every trade. Trade more to rank up and pay less."}
                tone={isBuy && snipeLeft > 0 ? 'text-down' : rankOff > 0 ? 'text-up' : ''}
              >
                {isBuy && snipeLeft > 0 ? `${((buyFee - rankOff) * 100).toFixed(1)}%` : pctOf(((isBuy ? buyFee : tradeFee) - rankOff) * 100)}
              </Row>
            )}
            {isBuy && wei > 0n && (
              <Row k="Sell right after" hint="Tried on the chain's current state, with nothing spent" tone={exit?.kind === 'stuck' || (exit?.kind === 'ok' && exit.lossPct >= LOSSY) ? 'text-down' : ''}>
                {exit === undefined ? '...' : exit.kind === 'ok' ? `${zro(Number(formatEther(exit.back)))} ZRO, -${exit.lossPct.toFixed(1)}%` : exit.kind === 'stuck' ? 'Sale reverted' : 'Not tested'}
              </Row>
            )}
            <Row k="Max slippage" hint={`Auto lets the price slip ${AUTO_SLIPPAGE_BPS / 100}% at most: blocks on Zero come in a fraction of a second, so a fresh quote hardly moves, and a tight limit leaves sandwich bots nothing to take.`}>
              {/* The last choice's figure sits on the same right edge as every other figure. */}
              <span className="-mr-1.5 flex gap-0.5">
                {[0, 300, 1000].map((b) => (
                  <button key={b} onClick={() => setSlippageBps(b)} className={cn('num rounded-md px-1.5 py-0.5 text-[13px] transition-colors duration-150', slippageBps === b ? 'bg-white/[.12] text-ink' : 'text-muted hover:text-ink')}>
                    {b === 0 ? 'Auto' : `${b / 100}%`}
                  </button>
                ))}
              </span>
            </Row>
          </>
        ) : (
          <>
            <Row k="Fills for at least">{limitOut ? (isBuy ? `${compact(limitOut)} ${token.symbol}` : `${zro(limitOut)} ZRO`) : '0'}</Row>
            <Row k="Fee to whoever fills it" hint="Paid per order, in parts as it fills. It's taken out before the figure above.">{`${zro(runFee)} ZRO`}</Row>
          </>
        )}
      </dl>

      {isBuy && snipeLeft > 0 && <p className="animate-fade mt-2 rounded-lg bg-down/10 px-2.5 py-1.5 text-[13px] leading-snug text-down">Anti-snipe is on: a buy pays {(buyFee * 100).toFixed(1)}% now, falling to {(tradeFee * 100).toFixed(0)}% in {snipeLeft} s. Sales pay the normal fee.</p>}
      {isBuy && mode === 'market' && exit?.kind === 'stuck' && <p className="animate-fade mt-2 rounded-lg bg-down/10 px-2.5 py-1.5 text-[13px] leading-snug text-down">A test sale of this token reverted. You may not be able to sell it.</p>}
      {isBuy && mode === 'market' && exit?.kind === 'ok' && exit.lossPct >= LOSSY && <p className="animate-fade mt-2 rounded-lg bg-down/10 px-2.5 py-1.5 text-[13px] leading-snug text-down">Selling at once loses {exit.lossPct.toFixed(1)}%. This size is heavy for the market, or the token taxes its trades.</p>}

      {!account ? (
        <button onClick={create} className="btn btn-accent mt-3 h-12 w-full text-[15px]">
          Create wallet
        </button>
      ) : (
        <button onClick={mode === 'market' ? submitMarket : submitLimit} disabled={busy || wei === 0n || tooMuch || noRoute || limitTooSmall || (mode === 'limit' && !limitOut)} className={cn('btn mt-3 h-12 w-full text-[15px]', isBuy ? 'btn-accent' : 'bg-ink text-black hover:bg-white disabled:bg-white/[.06] disabled:text-faint')}>
          {busy ? 'Working' : tooMuch ? `Not enough ${unit}` : noRoute ? 'No venue for this token yet' : limitTooSmall ? 'Too small to cover its fee' : mode === 'limit' ? `Place limit ${isBuy ? 'buy' : 'sell'}` : `${isBuy ? 'Buy' : 'Sell'} ${token.symbol}`}
        </button>
      )}
      {error && <p className="animate-fade mt-2 text-[13px] leading-snug text-down">{error}</p>}
        </>
      )}
    </Card>
  );
}

function OpenOrders({ token }: { token: TokenDetail }) {
  const account = useWallet((s) => s.account);
  const { data, refresh } = useLive<{ orders: Order[] }>(account ? `/api/v1/orders?owner=${account.address}&token=${token.address}&open=1` : null, (t, d) => t === 'order' || (t === 'trade' && d.token === token.address), 400);
  if (!account || !data?.orders.length) return null;
  return (
    <Card className="animate-fade">
      <CardHead
        title={
          <>
            Your open orders <span className="num font-medium text-faint">{data.orders.length}</span>
          </>
        }
      />
      <ul className="mt-2.5 space-y-3">
        {data.orders.map((o) => (
          <OrderRow key={o.id} order={o} compactRow onChange={refresh} />
        ))}
      </ul>
    </Card>
  );
}

function Position({ token }: { token: TokenDetail }) {
  const account = useWallet((s) => s.account);
  const { money, signed, usd } = useFormat();
  const { data } = useLive<WalletData>(account ? `/api/v1/wallet/${account.address.toLowerCase()}` : null, (t, d) => t === 'trade' && d.token === token.address, 500);
  const [sharing, setSharing] = useState(false);
  const h = data?.holdings.find((x) => x.token === token.address);
  // A token that pays its holders: what this wallet can claim, read from the token itself.
  const paysHolders = token.fee_route === 'holders' && token.source === 'terminal';
  const [reward, setReward] = useState(0n);
  const [claiming, setClaiming] = useState(false);
  const owner = account?.address;
  const readReward = useCallback(async () => {
    if (!paysHolders || !owner) return;
    try {
      setReward(await publicClient.readContract({ address: token.address as Address, abi: HOLDER_TOKEN_ABI, functionName: 'rewardOf', args: [owner] }));
    } catch {}
  }, [paysHolders, owner, token.address]);
  useEffect(() => {
    void readReward();
    const id = setInterval(() => void readReward(), 5000);
    return () => clearInterval(id);
  }, [readReward]);
  const claim = async () => {
    setClaiming(true);
    try {
      await send({ label: `Claim ${token.symbol} rewards`, to: token.address as Address, data: encodeFunctionData({ abi: HOLDER_TOKEN_ABI, functionName: 'claim' }) });
      await readReward();
    } catch {
    } finally {
      setClaiming(false);
    }
  };
  if (!h) return null;
  const pnl = h.value + h.received - h.spent;
  const cost = h.spent - h.received;
  const pct = h.spent > 0 ? pnl / h.spent : 0;
  const entryCap = h.bought > 0 ? (h.spent / h.bought) * token.total_supply : 0;
  return (
    <Card className="animate-fade">
      <CardHead title="Your position">
        <span className={cn('num text-[13px]', pnl > 0 ? 'text-up' : pnl < 0 ? 'text-down' : 'text-muted')}>
          {signed(pnl)}, {pct >= 0 ? '+' : ''}
          {(pct * 100).toFixed(1)}%
        </span>
      </CardHead>
      <div className="mt-1 flex items-center justify-between gap-3">
        <div className="num text-[22px] font-bold leading-tight tracking-tight">{money(h.value)}</div>
        {h.spent > 0 && <ShareButton onPress={() => setSharing(true)} className="-mr-1.5" />}
      </div>
      <dl className="mt-1.5">
        <Row k="Holding">
          {compact(h.amount)} {token.symbol}
        </Row>
        <Row k="Entry cap">{entryCap ? money(entryCap) : '...'}</Row>
        <Row k="Cost left">{money(Math.max(cost, 0))}</Row>
        {paysHolders && <Row k="Your rewards">{`${zro(Number(formatEther(reward)))} ZRO`}</Row>}
      </dl>
      {paysHolders && reward > 0n && (
        <button onClick={claim} disabled={claiming} className="btn btn-soft mt-2 h-9 w-full text-[13px]">
          {claiming ? 'Claiming' : 'Claim rewards'}
        </button>
      )}
      {sharing && (
        <ShareSheet
          onClose={() => setSharing(false)}
          load={async () => ({ symbol: token.symbol, token: token.address, image: token.uri ?? null, invested: h.spent, out: h.value + h.received, profit: pnl, ratio: pct, open: true, ts: Math.floor(Date.now() / 1000), usd })}
        />
      )}
    </Card>
  );
}

/** The creator in big figures right under the buy button, so it's read before the click and not found after it. */
function DevCard({ token }: { token: TokenDetail }) {
  const { money } = useFormat();
  const [open, setOpen] = useState(false);
  const { data: d } = useLive<DevInfo>(`/api/v1/tokens/${token.address}/dev`, (t, x) => (t === 'dev' && x.token === token.address) || (t === 'trade' && x.token === token.address && x.trader === token.creator), 500);
  if (!d?.creator) return null;
  const holds = d.share + d.linked_share;
  const sold = d.sold + d.linked_sold;
  const people = d.linked.filter((l) => !l.contract);
  // Holding a lot is the worst of it, having taken out more than it put in comes next.
  const tone = holds >= 0.15 ? 'text-down' : sold > d.bought ? 'text-accent' : 'text-up';
  const pct = (v: number) => `${(v * 100).toFixed(v >= 0.1 ? 1 : 2)}%`;
  return (
    <Card>
      <button onClick={() => setOpen((v) => !v)} className="w-full text-left" aria-expanded={open}>
        <CardHead title={people.length ? `Dev and ${people.length} linked ${people.length === 1 ? 'wallet' : 'wallets'}` : 'Dev'}>
          <span className="shrink-0 text-[13px] text-muted">{open ? 'Less' : 'More'}</span>
        </CardHead>
        <div className="mt-1.5 flex items-start justify-between gap-3 leading-tight">
          <div>
            <div className={cn('num text-[22px] font-bold tracking-tight', tone)}>{pct(holds)}</div>
            <div className="mt-0.5 text-[13px] text-muted">{people.length ? 'hold' : 'holds'}</div>
          </div>
          <div className="text-right">
            <div className={cn('num text-[22px] font-bold tracking-tight', sold > 0 ? tone : '')}>{sold > 0 ? money(sold) : 'None'}</div>
            <div className="mt-0.5 text-[13px] text-muted">sold</div>
          </div>
        </div>
      </button>
      {open && (
        <div className="animate-fade mt-3 border-t border-white/[.06] pt-2">
          <dl>
            <Row k="Created by">
              <button onClick={() => openWallet(d.creator!)} className="transition-colors hover:text-accent">
                {short(d.creator)}
              </button>
            </Row>
            <Row k="Dev holds">{pct(d.share)}</Row>
            <Row k="Dev bought">{d.bought > 0 ? money(d.bought) : 'None'}</Row>
            <Row k="Dev sold" tone={d.sold > 0 ? 'text-down' : ''}>
              {d.sold > 0 ? money(d.sold) : 'None'}
            </Row>
            <Row k="Others in the launch block">{d.launch_block}</Row>
            <Row k="Launched by this wallet">{d.launched}</Row>
            <Row k="Of those, reached a pool">{d.graduated}</Row>
          </dl>
          {d.linked.length > 0 && (
            <dl className="mt-2 border-t border-white/[.06] pt-2">
              <div className="min-h-[24px] text-[13px] font-medium">Got coins from the dev</div>
              {d.linked.slice(0, 6).map((l) => (
                <div key={l.address} className="flex min-h-[24px] items-center justify-between gap-3 text-[13px]">
                  <dt className="min-w-0 truncate">
                    <button onClick={() => openWallet(l.address)} className="num text-muted transition-colors hover:text-accent">
                      {short(l.address)} {l.contract && <span className="text-faint">contract</span>}
                    </button>
                  </dt>
                  <dd className="num shrink-0 text-right">{pct(l.share)}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-2 text-[12px] leading-snug text-faint">Linked means the wallet received this token straight from the dev. Wallets funded some other way look like anyone else.</p>
        </div>
      )}
    </Card>
  );
}

/** Who is winning the last trades: buy and sell volume side by side, and how many wallets on each. */
function Flow({ token }: { token: TokenDetail }) {
  const { money, signed } = useFormat();
  const { data } = useLive<{ trades: Trade[] }>(`/api/v1/tokens/${token.address}/trades?limit=50`, (t, d) => t === 'trade' && d.token === token.address, 800, true);
  const trades = data?.trades ?? [];
  if (!trades.length) return null;
  const buys = trades.filter((t) => t.is_buy);
  const sells = trades.filter((t) => !t.is_buy);
  const buyVolume = buys.reduce((s, t) => s + t.zro, 0);
  const sellVolume = sells.reduce((s, t) => s + t.zro, 0);
  const total = buyVolume + sellVolume || 1;
  const wallets = (list: Trade[]) => new Set(list.map((t) => t.trader)).size;
  const net = buyVolume - sellVolume;
  return (
    <Card>
      <CardHead title={`Last ${trades.length} trades`}>
        <span className={cn('num shrink-0 text-[13px]', net > 0 ? 'text-up' : net < 0 ? 'text-down' : 'text-muted')}>{signed(net)} net</span>
      </CardHead>
      <div className="mt-2.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        <span className="h-full rounded-full bg-up transition-[width] duration-500" style={{ width: `${(buyVolume / total) * 100}%` }} />
        <span className="h-full flex-1 rounded-full bg-down" />
      </div>
      <div className="mt-2 flex justify-between gap-3 text-[13px] leading-snug">
        <div className="min-w-0">
          <div className="num font-semibold text-up">{money(buyVolume)}</div>
          <div className="num text-muted">{buys.length} buys, {wallets(buys)} wallets</div>
        </div>
        <div className="min-w-0 text-right">
          <div className="num font-semibold text-down">{money(sellVolume)}</div>
          <div className="num text-muted">{sells.length} sells, {wallets(sells)} wallets</div>
        </div>
      </div>
    </Card>
  );
}

/** Who holds it, in the figures that decide whether a click is safe: how concentrated the top wallets are, and how many there are. */
function Health({ token }: { token: TokenDetail }) {
  const now = useNow();
  const { data } = useLive<{ holders: Holder[] }>(`/api/v1/tokens/${token.address}/holders?limit=10`, (t, d) => t === 'trade' && d.token === token.address, 2000, true);
  const holders = data?.holders ?? [];
  const pct = (v: number) => (v / token.total_supply) * 100;
  const top10 = holders.reduce((s, h) => s + pct(h.amount), 0);
  const largest = holders[0] ? pct(holders[0].amount) : 0;
  const tone = (v: number, good: number, bad: number) => (v <= good ? 'text-up' : v >= bad ? 'text-down' : '');
  return (
    <Card>
      <CardHead title="Holders and safety" />
      <dl className="mt-1.5">
        <Row k="Top 10 hold" tone={tone(top10, 20, 40)}>{`${top10.toFixed(1)}%`}</Row>
        <Row k="Largest holds" tone={tone(largest, 4, 10)}>{`${largest.toFixed(1)}%`}</Row>
        <Row k="Holders">{token.holders}</Row>
        <Row k="Trades, 24 hours">{token.trades_24h}</Row>
        <Row k="Age">{age(token.created_at, now)}</Row>
      </dl>
    </Card>
  );
}

function SplitBar({ left, right, leftLabel, rightLabel }: { left: number; right: number; leftLabel: string; rightLabel: string }) {
  const total = left + right;
  const pct = total > 0 ? (left / total) * 100 : 50;
  return (
    <div>
      <div className="mb-1 flex justify-between text-[13px]">
        <span className="num">{leftLabel}</span>
        <span className="num">{rightLabel}</span>
      </div>
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        <span className={cn('h-full rounded-full transition-[width] duration-500', total ? 'bg-up' : 'bg-white/10')} style={{ width: `${pct}%` }} />
        <span className={cn('h-full flex-1 rounded-full', total ? 'bg-down' : 'bg-white/10')} />
      </div>
    </div>
  );
}

/** Where each trade's fee goes, in percent of the trade, as its creator set it at launch. */
const feeGoesTo = (t: TokenDetail) => {
  const f = feeParts(t.fee_bps, t.holders_bps ?? (t.fee_route === 'holders' ? 10_000 : 0), t.burn_bps ?? 0);
  const parts = [`${pctOf(f.creator)} creator`, f.holders && `${pctOf(f.holders)} holders`, f.burn && `${pctOf(f.burn)} burned`, `${pctOf(f.terminal)} terminal`].filter(Boolean);
  return parts.join(', ');
};

const LINK_NAMES: Array<[string, string]> = [
  ['website', 'Website'],
  ['twitter', 'Twitter'],
  ['telegram', 'Telegram'],
  ['discord', 'Discord'],
];

function About({ token }: { token: TokenDetail }) {
  const now = useNow();
  const { money } = useFormat();
  const pad = useLaunchpads().find((p) => p.id === token.launchpad);
  return (
    <Card className="space-y-3">
      <CardHead title={`About ${token.symbol}`} />
      {token.description && <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink/90">{token.description}</p>}
      {token.links && (
        <div className="flex flex-wrap gap-1">
          {LINK_NAMES.filter(([key]) => /^https?:\/\//i.test(token.links![key] ?? '')).map(([key, name]) => (
            <a key={key} href={token.links![key]} target="_blank" rel="noopener noreferrer nofollow" className="btn-soft rounded-lg px-2.5 py-1 text-[13px] font-medium transition-colors duration-150">
              {name}
            </a>
          ))}
        </div>
      )}

      {token.source === 'terminal' && !token.graduated && (
        <div>
          <dl>
            <Row k="Raised on the launchpad">
              {zro(token.raised)} of {CURVE.raiseTarget} ZRO
            </Row>
          </dl>
          <Progress value={token.progress} className="mt-1" />
          <p className="mt-2 text-[13px] leading-snug text-muted">At {CURVE.raiseTarget} ZRO it moves to a pool with locked liquidity.</p>
        </div>
      )}
      {token.graduated && !token.launchpad && <p className="text-[13px] leading-snug text-muted">Trades on a pool. Its liquidity is locked for good.</p>}
      {token.source === 'terminal' && (
        <dl>
          <Row k="Fee per trade">{pctOf(token.fee_bps / 100)}</Row>
          <Row k="Fee goes to">{feeGoesTo(token)}</Row>
          {token.anti_snipe && <Row k="Anti-snipe">On at launch</Row>}
        </dl>
      )}
      {pad && (
        <div>
          {!token.graduated && Boolean(pad.curve?.target) && (
            <>
              <dl>
                <Row k={`Raised on ${pad.name}`}>
                  {zro(token.raised)} of {pad.curve!.target} ZRO
                </Row>
              </dl>
              <Progress value={token.progress} className="mb-2 mt-1" />
            </>
          )}
          <p className="text-[13px] leading-snug text-muted">
            {token.graduated ? `It finished on ${pad.name}, so it trades wherever they moved it, and not from here yet.` : `Launched on ${pad.name} and trades on its contract, so its own fees and rules apply. Limit orders aren't available. Nothing there is checked or endorsed by us.`}
            {pad.site && (
              <>
                {' '}
                <a href={pad.site} target="_blank" rel="noreferrer" className="text-ink transition-colors hover:text-accent">
                  Its site
                </a>
              </>
            )}
          </p>
        </div>
      )}
      {token.source === 'external' && !pad && (
        <p className="text-[13px] leading-snug text-muted">Launched outside this terminal{token.factory ? ` through ${short(token.factory)}` : ''}. It becomes tradable here once it has a pool or its launchpad is connected. Nothing here is checked or endorsed.</p>
      )}

      {token.price > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          {([['5m', token.change_5m], ['1h', token.change_1h], ['6h', token.change_6h], ['24h', token.change_24h]] as const).map(([k, v]) => (
            <div key={k} className="rounded-[7px] bg-white/[.045] py-1.5 text-center leading-snug">
              <div className="text-[12px] text-muted">{k}</div>
              <Change value={v} className="block text-[13px]" />
            </div>
          ))}
        </div>
      )}

      {token.trades_24h > 0 && (
        <div className="space-y-2.5">
          <SplitBar left={token.buys_24h} right={token.sells_24h} leftLabel={`${token.buys_24h} buys`} rightLabel={`${token.sells_24h} sells`} />
          <SplitBar left={token.buy_volume_24h} right={token.sell_volume_24h} leftLabel={`${money(token.buy_volume_24h)} in`} rightLabel={`${money(token.sell_volume_24h)} out`} />
        </div>
      )}

      <dl>
        <Row k="Launched">{age(token.created_at, now)} ago</Row>
        {token.creator && (
          <Row k="Created by">
            <button onClick={() => openWallet(token.creator!)} className="transition-colors hover:text-accent">
              {short(token.creator)}
            </button>
          </Row>
        )}
      </dl>
    </Card>
  );
}

export function TradeSide({ token, onTraded }: { token: TokenDetail; onTraded: () => void }) {
  const canTrade = token.tradable;
  return (
    <div className="soft-scroll flex min-h-0 flex-col gap-2 lg:h-full">
      {canTrade && <TradeCard token={token} onTraded={onTraded} />}
      {(canTrade || token.launchpad) && <Position token={token} />}
      {canTrade && <OpenOrders token={token} />}
      <DevCard token={token} />
      <Flow token={token} />
      <Health token={token} />
      <About token={token} />
    </div>
  );
}
