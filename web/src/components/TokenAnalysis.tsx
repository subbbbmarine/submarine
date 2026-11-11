'use client';

import { useEffect, useMemo, useState } from 'react';
import type { TokenDetail } from '@/lib/api';
import { useStream } from '@/lib/api';
import { age, cn, short } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { clusters as loadClusters, firstBuyers, labelledHolders, security as loadSecurity, tokenRisk, topTraders, type BuyerStatus, type Clusters, type FirstBuyer, type LabelledHolder, type Risk, type Security, type TopTrader } from '@/lib/insight';
import { useFormat } from '@/lib/money';
import { openWallet } from '@/lib/selection';
import { nameOf, useTracked } from '@/lib/tracked';
import { useWallet } from '@/lib/wallet';
import { Empty } from './bits';
import { LabelChips, RiskChips, RiskStrip, pct } from './Risk';

/** Loads once per token, then again after trades on it, at most every few seconds. */
function useTokenData<T>(token: string, load: (t: string) => Promise<T>, every = 4000) {
  const [data, setData] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => setData(null), [token]);
  useEffect(() => {
    let live = true;
    load(token).then((d) => live && setData(d), () => {});
    return () => {
      live = false;
    };
    // `load` is a module function, the same every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tick]);
  const [last, setLast] = useState(0);
  useStream((type, d) => {
    if (type !== 'trade' || d.token !== token || Date.now() - last < every) return;
    setLast(Date.now());
    setTick((n) => n + 1);
  });
  return data;
}

function Wallet({ address, me }: { address: string; me?: string }) {
  const list = useTracked();
  return (
    <button onClick={() => openWallet(address)} className={cn('num truncate text-left transition-colors hover:text-accent', address === me ? 'font-medium text-accent' : 'text-muted')}>
      {address === me ? 'You' : nameOf(address, list)}
    </button>
  );
}

const ROWS = 60;
const head = 'px-2 pb-1 text-[12px] text-faint';
const row = 'rounded-lg px-2 text-[13px] transition-colors duration-150 hover:bg-white/[.04]';

/** Holders with what they paid, what they made and what they look like. */
export function LabelledHolders({ token }: { token: TokenDetail }) {
  const me = useWallet((s) => s.account?.address.toLowerCase());
  const { money, signed } = useFormat();
  const holders = useTokenData<LabelledHolder[]>(token.address, (t) => labelledHolders(t, 200));
  const [rows, setRows] = useState(ROWS);
  if (holders && !holders.length) return <Empty title="No holders yet" />;
  const grid = 'grid grid-cols-[22px_minmax(0,1.6fr)_minmax(0,.6fr)_minmax(0,.8fr)_minmax(0,.8fr)] items-center gap-x-2';
  return (
    <>
      <div className={cn(grid, head)}>
        <span>#</span>
        <span>Wallet</span>
        <span className="text-right">Share</span>
        <span className="text-right">Value</span>
        <span className="text-right">Profit</span>
      </div>
      {(holders ?? []).slice(0, rows).map((h, i) => (
        <div key={h.address} className={cn(grid, row, 'min-h-8 py-1')}>
          <span className="num text-faint">{i + 1}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            <Wallet address={h.address} me={me} />
            <LabelChips labels={h.labels} skip={['top10']} />
          </span>
          <span className="num text-right">{pct(h.share)}</span>
          <span className="num truncate text-right text-muted">{money(h.amount * token.price)}</span>
          <span className={cn('num truncate text-right', h.pnl > 0 ? 'text-up' : h.pnl < 0 ? 'text-down' : 'text-faint')}>{h.spent > 0 ? signed(h.pnl) : 'Got it'}</span>
        </div>
      ))}
      {(holders?.length ?? 0) > rows && (
        <button onClick={() => setRows((r) => r + ROWS)} className="mt-1 h-8 w-full rounded-lg text-[13px] text-muted hover:bg-white/[.04] hover:text-ink">
          Show more
        </button>
      )}
    </>
  );
}

/** Everyone who traded it, by profit marked to today's price. */
export function TopTraders({ token }: { token: TokenDetail }) {
  const me = useWallet((s) => s.account?.address.toLowerCase());
  const { money, signed } = useFormat();
  const traders = useTokenData<TopTrader[]>(token.address, (t) => topTraders(t, 100));
  if (traders && !traders.length) return <Empty title="No trades yet" />;
  const grid = 'grid grid-cols-[minmax(0,1.6fr)_minmax(0,.8fr)_minmax(0,.8fr)_minmax(0,.9fr)] items-center gap-x-2';
  return (
    <>
      <div className={cn(grid, head)}>
        <span>Wallet</span>
        <span className="text-right">Bought</span>
        <span className="text-right">Sold</span>
        <span className="text-right">Profit</span>
      </div>
      {(traders ?? []).map((t) => (
        <div key={t.address} className={cn(grid, row, 'min-h-8 py-1')}>
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            <Wallet address={t.address} me={me} />
            <LabelChips labels={t.labels} skip={['top10']} />
          </span>
          <span className="num truncate text-right text-muted" title={`${t.buys} buys`}>
            {money(t.spent)}
          </span>
          <span className="num truncate text-right text-muted" title={`${t.sells} sales`}>
            {money(t.received)}
          </span>
          <span className={cn('num truncate text-right', t.pnl > 0 ? 'text-up' : t.pnl < 0 ? 'text-down' : 'text-faint')}>{signed(t.pnl)}</span>
        </div>
      ))}
    </>
  );
}

const STATUS: Record<BuyerStatus, { text: string; tone: string }> = {
  holding: { text: 'Holding', tone: 'text-up' },
  bought_more: { text: 'Bought more', tone: 'text-up' },
  sold_part: { text: 'Sold part', tone: 'text-accent' },
  sold_all: { text: 'Sold all', tone: 'text-down' },
  transferred: { text: 'Moved out', tone: 'text-muted' },
};

/** The first 70 buyers in order and what each has done since. Many still holding is strength; most gone is a warning. */
export function FirstBuyers({ token }: { token: TokenDetail }) {
  const me = useWallet((s) => s.account?.address.toLowerCase());
  const { money } = useFormat();
  const data = useTokenData(token.address, firstBuyers, 6000);
  if (data && !data.buyers.length) return <Empty title="No buyers yet" />;
  const s = data?.summary;
  return (
    <>
      {s && (
        <div className="mb-2 flex flex-wrap gap-1.5 px-2 text-[12px]">
          <span className="rounded-md bg-up/10 px-1.5 py-0.5 text-up">Holding {s.holding}</span>
          <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-accent">Sold part {s.sold_part}</span>
          <span className="rounded-md bg-down/10 px-1.5 py-0.5 text-down">Sold all {s.sold_all}</span>
          <span className="rounded-md bg-white/[.05] px-1.5 py-0.5 text-muted">Moved out {s.transferred}</span>
          <span className="num rounded-md bg-white/[.05] px-1.5 py-0.5 text-muted" title="Of the supply, what these first buyers still hold">
            Still hold {pct(s.still_held)}
          </span>
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1 px-1">
        {(data?.buyers ?? []).map((b: FirstBuyer, i: number) => (
          <div key={b.address} className="rounded-lg bg-white/[.03] px-2 py-1 text-[12px] leading-snug">
            <div className="flex items-center gap-1">
              <span className="num text-faint">{i + 1}</span>
              <Wallet address={b.address} me={me} />
            </div>
            <div className="flex items-center justify-between gap-1">
              <span className={STATUS[b.status].tone}>{STATUS[b.status].text}</span>
              <span className="num text-faint">{money(b.spent)}</span>
            </div>
            <div className="flex flex-wrap gap-0.5">
              <LabelChips labels={b.labels} skip={['top10', 'fresh']} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Holders as bubbles sized by their share, with the transfers between them. Linked wallets sit together. */
export function HolderMap({ token }: { token: TokenDetail }) {
  const data = useTokenData<Clusters>(token.address, loadClusters, 8000);
  const [hover, setHover] = useState<string | null>(null);
  const layout = useMemo(() => {
    if (!data) return null;
    // Each cluster gets a spot on a ring, biggest first; a cluster's wallets ring its spot. Simple, stable between refreshes.
    const groups = new Map<string, Clusters['nodes']>();
    for (const n of data.nodes) groups.set(n.cluster, [...(groups.get(n.cluster) ?? []), n]);
    const ordered = [...groups.values()].sort((a, b) => b.reduce((s, n) => s + n.share, 0) - a.reduce((s, n) => s + n.share, 0));
    const W = 640;
    const H = 360;
    const pos = new Map<string, { x: number; y: number; r: number }>();
    ordered.forEach((group, gi) => {
      const ring = gi === 0 ? 0 : 1 + Math.floor((gi - 1) / 10);
      const angle = gi === 0 ? 0 : ((gi - 1) % 10) * ((Math.PI * 2) / 10) + ring * 0.3;
      const cx = W / 2 + Math.cos(angle) * ring * 120;
      const cy = H / 2 + Math.sin(angle) * ring * 95;
      group.forEach((n, i) => {
        const r = Math.max(4, Math.sqrt(n.share) * 120);
        const a = (i / group.length) * Math.PI * 2;
        const spread = group.length > 1 ? 14 + group.length * 3 : 0;
        pos.set(n.address, { x: cx + Math.cos(a) * spread, y: cy + Math.sin(a) * spread, r });
      });
    });
    return { pos, W, H };
  }, [data]);
  if (data && !data.nodes.length) return <Empty title="No holders yet" />;
  if (!data || !layout) return <div className="p-4 text-[13px] text-faint">Loading</div>;
  const node = hover ? data.nodes.find((n) => n.address === hover) : null;
  return (
    <div className="space-y-2 px-1">
      <svg viewBox={`0 0 ${layout.W} ${layout.H}`} className="h-auto w-full" role="img" aria-label="Holders map">
        {data.edges.map((e, i) => {
          const a = layout.pos.get(e.from);
          const b = layout.pos.get(e.to);
          return a && b ? <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgb(var(--accent))" strokeOpacity={0.35} strokeWidth={1} /> : null;
        })}
        {data.nodes.map((n) => {
          const p = layout.pos.get(n.address)!;
          const linked = data.clusters.some((c) => c.id === n.cluster);
          return (
            <circle
              key={n.address}
              cx={p.x}
              cy={p.y}
              r={p.r}
              fill={n.labels.includes('dev') ? 'rgb(var(--accent))' : linked ? 'rgb(var(--down))' : 'rgb(255 255 255)'}
              fillOpacity={hover === n.address ? 0.9 : 0.35}
              stroke="rgb(255 255 255)"
              strokeOpacity={0.2}
              onPointerEnter={() => setHover(n.address)}
              onPointerLeave={() => setHover(null)}
              onClick={() => openWallet(n.address)}
              className="cursor-pointer"
            />
          );
        })}
      </svg>
      <div className="flex min-h-6 flex-wrap items-center gap-2 text-[12px] text-muted">
        {node ? (
          <>
            <span className="num">{short(node.address)}</span>
            <span className="num">{pct(node.share)}</span>
            <LabelChips labels={node.labels} />
          </>
        ) : data.clusters.length ? (
          data.clusters.slice(0, 6).map((c) => (
            <span key={c.id} className="num rounded-md bg-down/10 px-1.5 py-0.5 text-down">
              {c.wallets} linked wallets hold {pct(c.share)}
            </span>
          ))
        ) : (
          <span>No holders passed coins to each other. Yellow is the dev.</span>
        )}
      </div>
    </div>
  );
}

function Check({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-white/[.03] px-2.5 py-1.5 text-[13px]">
      <span className={cn('mt-0.5 h-2 w-2 shrink-0 rounded-full', ok === null ? 'bg-white/20' : ok ? 'bg-up' : 'bg-down')} />
      <div className="min-w-0">
        <div>{label}</div>
        {detail && <div className="text-[12px] text-faint">{detail}</div>}
      </div>
    </div>
  );
}

/** What the chain says about the contract, the holders and the first buyers, on one screen. */
export function Safety({ token }: { token: TokenDetail }) {
  const sec = useTokenData<Security>(token.address, loadSecurity, 30_000);
  const risk = useTokenData<{ risk: Risk | null; ath: { price: number; ts: number } | null }>(token.address, tokenRisk);
  const buyers = useTokenData(token.address, firstBuyers, 10_000);
  const { money } = useFormat();
  const now = useNow(10_000);
  const ath = risk?.ath;
  return (
    <div className="space-y-2 px-1">
      <RiskChips risk={risk?.risk} />
      <div className="grid gap-1.5 sm:grid-cols-2">
        {sec?.ours ? (
          <>
            <Check ok label="Launched on this terminal" detail="Fixed supply, no owner, no mint. Its terms can't change." />
            <Check ok={sec.lp_burned} label={sec.lp_burned ? 'Pool shares burned' : 'Still on its curve'} detail={sec.lp_burned ? 'The pool it moved to can never be pulled.' : 'It moves to a pool with burned shares at 15 ZRO.'} />
            <Check ok label={`Fee ${((sec.fee_bps ?? 0) / 100).toFixed(0)}% each way`} detail="Set at launch, the same forever." />
          </>
        ) : sec ? (
          <>
            <Check ok={sec.renounced} label={sec.renounced ? 'No owner' : 'The contract has an owner'} detail={sec.owner && !sec.renounced ? `Owner ${short(sec.owner)} may be able to change it.` : undefined} />
            <Check ok={null} label="Tax and mint can't be read" detail="Use Sell right after on the trade card to try a sale first." />
          </>
        ) : null}
        <Check ok={token.liquidity > 0} label={`Liquidity ${money(token.liquidity)}`} />
        {buyers && <Check ok={buyers.summary.sold_all <= buyers.buyers.length / 2} label={`${buyers.summary.sold_all} of the first ${buyers.buyers.length} buyers sold out`} />}
        {ath && ath.price > 0 && <Check ok={null} label={`Highest ${money(ath.price * token.total_supply)} market cap`} detail={`${age(ath.ts, now)} ago, now ${pct(token.price / ath.price)} of it`} />}
      </div>
      <p className="px-1 text-[11px] text-faint">Read from the chain and the index. A label means a wallet behaves like one, not that it is one.</p>
    </div>
  );
}

/** The header's line of risk figures, kept fresh. */
export function RiskLine({ token }: { token: TokenDetail }) {
  const data = useTokenData(token.address, tokenRisk, 5000);
  return <RiskStrip risk={data?.risk} />;
}


