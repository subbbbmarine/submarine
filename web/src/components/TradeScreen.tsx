'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import type { Address } from 'viem';
import { useLive, type TokenDetail } from '@/lib/api';
import { cn } from '@/lib/format';
import { useLayout } from '@/lib/layout';
import { useSelection } from '@/lib/selection';
import { marketBuy, sellShare } from '@/lib/trade';
import { useWallet } from '@/lib/wallet';
import { Empty } from './bits';
import { Splitter } from './Splitter';
import { TokenList } from './TokenList';
import { TokenView } from './TokenView';
import { TradeSide } from './TradeSide';

const SIZES = ['5', '50', '200', '500'];

/**
 * The one trading screen, for both / and /tokens/<address>. Picking a token only swaps the data, so the list keeps its place
 * and the chart redraws in place. On a phone the list and the token take turns.
 */
export function TradeScreen() {
  const path = usePathname();
  const fromUrl = path.startsWith('/tokens/') ? path.split('/')[2]!.toLowerCase() : null;
  const selected = useSelection((s) => s.address);
  const select = useSelection((s) => s.select);
  const address = fromUrl ?? selected;
  const sizes = useLayout((s) => s.sizes);
  const split = useLayout((s) => s.split);
  const listRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (fromUrl) select(fromUrl);
  }, [fromUrl, select]);

  const { data: token, error, refresh } = useLive<TokenDetail>(
    address ? `/api/v1/tokens/${address}` : null,
    (t, d) => (t === 'trade' || t === 'graduated') && d.token === address,
    200,
    true,
  );

  // Keys for hands that stay on the keyboard: 1 to 4 pick a quick size, B buys at it, S sells half, Shift S sells all. Never while typing.
  const tokenRef = useRef(token);
  tokenRef.current = token;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useWallet.getState().keyUnsaved) return;
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
      const t = tokenRef.current;
      const tradable = t?.tradable;
      if (/^[1-4]$/.test(e.key)) useWallet.getState().setQuickSize(SIZES[Number(e.key) - 1]!);
      else if ((e.key === 'b' || e.key === 'B') && t && tradable) {
        const wallet = useWallet.getState();
        if (!wallet.account) wallet.create();
        else void marketBuy(t.address as Address, t.symbol, wallet.quickSize).catch(() => {});
      }
      else if ((e.key === 's' || e.key === 'S') && t && tradable) {
        void sellShare(t.address as Address, t.symbol, e.shiftKey ? 100 : 50).catch(() => {});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const back = () => window.history.pushState(null, '', '/');

  return (
    <div
      className={cn(
        // The chart never gets narrower than about 400px: on a tight screen the list and the trade card give up some of their width
        // first, down to their own floors, so the chart's toolbar and the token's header always fit.
        'gap-2 lg:grid lg:h-full lg:[grid-template-columns:minmax(244px,var(--list-w,296px))_minmax(396px,1fr)_minmax(280px,var(--side-w,320px))]',
        // Two lists take their room from both sides of the chart, so the chart stays usable on a small laptop.
        split ? 'xl:[grid-template-columns:minmax(360px,var(--lists-w,clamp(500px,38vw,700px)))_minmax(420px,1fr)_minmax(280px,var(--side-w,clamp(290px,22vw,348px)))]' : 'xl:[grid-template-columns:minmax(240px,var(--list-w,328px))_minmax(420px,1fr)_minmax(290px,var(--side-w,348px))]',
      )}
      style={{ ...(sizes.list ? { '--list-w': `${sizes.list}px` } : {}), ...(sizes.lists ? { '--lists-w': `${sizes.lists}px` } : {}), ...(sizes.side ? { '--side-w': `${sizes.side}px` } : {}) } as React.CSSProperties}
    >
      <div ref={listRef} className={cn('relative min-h-0 lg:block', fromUrl && 'hidden')}>
        <TokenList />
        <Splitter part={split && typeof window !== 'undefined' && window.innerWidth >= 1280 ? 'lists' : 'list'} dir="x" className="-right-[8px]" measure={() => listRef.current?.getBoundingClientRect().width ?? 320} />
      </div>

      {token ? (
        <>
          <div className={cn('min-h-0 min-w-0 lg:block', !fromUrl && 'hidden')}>
            <TokenView token={token} onBack={back} />
          </div>
          <div ref={sideRef} id="trade" className={cn('relative mt-2 min-h-0 scroll-mt-2 lg:mt-0 lg:block', !fromUrl && 'hidden')}>
            <Splitter part="side" dir="x" sign={-1} className="-left-[8px]" measure={() => sideRef.current?.getBoundingClientRect().width ?? 340} />
            <TradeSide token={token} onTraded={refresh} />
          </div>
          {fromUrl && token.tradable && (
            <div className="pointer-events-none sticky bottom-2 z-20 mt-2 lg:hidden">
              <button onClick={() => document.getElementById('trade')?.scrollIntoView({ behavior: 'smooth' })} className="btn btn-accent pointer-events-auto h-12 w-full text-[15px] shadow-[0_8px_30px_rgb(0_0_0_/_.6)]">
                Trade {token.symbol}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className={cn('panel min-h-[50vh] lg:col-span-2 lg:block', !fromUrl && 'hidden')}>
          {error ? <Empty title="This token isn't in the index" body="It may be too new, or the address may be wrong." /> : address ? <div className="m-3 h-24 animate-pulse rounded-xl bg-white/[.04]" aria-hidden="true" /> : <Empty title="Pick a token from the list" />}
        </div>
      )}
    </div>
  );
}
