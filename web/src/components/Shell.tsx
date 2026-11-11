'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type JSX } from 'react';
import { get } from '@/lib/api';
import { startAutocopy } from '@/lib/autocopy';
import { IS_LOCAL } from '@/lib/config';
import { zro, cn, short } from '@/lib/format';
import { useLayout, type ListTab } from '@/lib/layout';
import { SUBMARINE_PATH, SUBMARINE_VIEWBOX } from '@/lib/submarine';
import { useMoney } from '@/lib/money';
import { useNetwork } from '@/lib/network';
import { warmUp } from '@/lib/prep';
import { openToken, useSelection } from '@/lib/selection';
import { useSocial } from '@/lib/social';
import { useWallet } from '@/lib/wallet';
import { KeyBackup } from './KeyBackup';
import { SearchBox } from './SearchBox';
import RefCapture from './RefCapture';
import { PinSetup, Unlock } from './Wallets';
import { AlertWatcher } from './Alerts';
import { Tips } from './Tips';
import { WalletPic } from './WalletPic';
import { useProfile } from '@/lib/profiles';
import { Ladder } from './Ladder';
import { TrackedAlerts } from './TrackedAlerts';
import { WalletDrawer } from './WalletDrawer';

/** Submarine's mark: the split S, in the text colour. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox={SUBMARINE_VIEWBOX} className={className} aria-hidden="true">
      <path fill="currentColor" fillRule="evenodd" d={SUBMARINE_PATH} />
    </svg>
  );
}

function CurrencySwitch() {
  const { currency, zroUsd, setCurrency } = useMoney();
  if (!zroUsd) return null;
  return (
    <div className="hidden h-10 items-center rounded-xl bg-white/5 p-1 sm:flex" role="radiogroup" aria-label="Show amounts in">
      {(['usd', 'zro'] as const).map((c) => (
        <button key={c} role="radio" aria-checked={currency === c} onClick={() => setCurrency(c)} className={cn('h-8 rounded-[6px] px-2.5 text-[13px] font-semibold transition-colors duration-150', currency === c ? 'bg-white/[.12] text-ink' : 'text-muted hover:text-ink')}>
          {c === 'usd' ? '$' : 'ZRO'}
        </button>
      ))}
    </div>
  );
}

function WalletChip() {
  const { account, balance, ready, create } = useWallet();
  const profile = useProfile(account?.address);
  if (!ready) return <div className="h-10 w-32" />;
  if (!account) {
    return (
      <button onClick={create} className="btn btn-accent h-10 whitespace-nowrap">
        Create wallet
      </button>
    );
  }
  return (
    <Link href="/portfolio" className="flex h-10 items-center gap-2.5 whitespace-nowrap rounded-xl bg-white/5 pl-1.5 pr-3.5 transition-colors hover:bg-white/10" title="Your wallet, its profile and its holdings">
      <WalletPic address={account.address} size={28} />
      <span className="num font-semibold">{zro(balance)} ZRO</span>
      <span className="hidden max-w-[140px] truncate text-[13px] text-muted xl:inline">{profile?.name ?? short(account.address)}</span>
    </Link>
  );
}

const icon = 'h-[21px] w-[21px]';
const Stroke = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ICONS = {
  tokens: <Stroke d="M4 18l5-6 4 3 7-9M4 21h16" />,
  feed: <Stroke d="M4 6h16M4 12h10M4 18h13" />,
  leaders: <Stroke d="M8 21v-7M12 21V5M16 21v-11M4 21h16" />,
  tracked: <Stroke d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z" />,
  launch: <Stroke d="M12 21v-9M12 12c0-4 2.5-7.5 6.5-9 .5 4.5-1.5 8-6.5 9zM12 15c0-3-2-5.5-6.5-6.5C5 12 7.5 15 12 15z" />,
  portfolio: <Stroke d="M4 8.500A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.500v9a2.5 2.5 0 0 1-2.5 2.500h-11A2.5 2.5 0 0 1 4 17.500zM16 13h.01M4 10h16" />,
  stats: <Stroke d="M4 4v16h16M8 16v-4M12 16V8M16 16v-6" />,
  bridge: <Stroke d="M3 16c3-6 6-8 9-8s6 2 9 8M3 16h18M7 16v-3.500M12 16V8M17 16v-3.5" />,
  docs: <Stroke d="M6 3.500h8l4 4V20a.5.5 0 0 1-.5.500h-11A.5.5 0 0 1 6 20zM14 3.500V8h4M9 13h6M9 16.500h6" />,
  pulse: <Stroke d="M3 12h4l2.5-6 4 12 2.5-6H21" />,
  copy: <Stroke d="M9 9h10v10H9zM5 15V5h10" />,
  radar: <Stroke d="M12 12l6-6M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8" />,
  multi: <Stroke d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  points: <Stroke d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />,
};

const LISTS: Array<{ tab: ListTab; label: string; icon: JSX.Element }> = [
  { tab: 'tokens', label: 'Tokens', icon: ICONS.tokens },
  { tab: 'feed', label: 'Feed', icon: ICONS.feed },
  { tab: 'leaders', label: 'Leaders', icon: ICONS.leaders },
  { tab: 'tracked', label: 'Tracked', icon: ICONS.tracked },
];
const PAGES = [
  { href: '/pulse', label: 'Pulse', icon: ICONS.pulse },
  { href: '/multi', label: 'Multi', icon: ICONS.multi },
  { href: '/radar', label: 'Radar', icon: ICONS.radar },
  { href: '/copy', label: 'Copy', icon: ICONS.copy },
  { href: '/launch', label: 'Launch', icon: ICONS.launch },
  { href: '/portfolio', label: 'Portfolio', icon: ICONS.portfolio },
  { href: '/points', label: 'Points', icon: ICONS.points },
  { href: '/stats', label: 'Stats', icon: ICONS.stats },
  { href: '/docs', label: 'Docs', icon: ICONS.docs },
];

/** The pages shown in the top bar on every wide screen; the rest join them on a very wide one and wait under More before that. */
const MAIN_PAGES = new Set(['/pulse', '/radar', '/copy', '/launch', '/portfolio']);

const navItem = 'flex h-9 shrink-0 items-center rounded-lg px-3 text-[14px] font-medium transition-colors duration-150';
const navOn = 'bg-white/[.08] text-ink';
const navOff = 'text-muted hover:text-ink';

/** The way around, as words in the top bar. Trade is the one screen with the lists, chart and trade card. */
function TopNav({ onTrade }: { onTrade: boolean }) {
  const path = usePathname();
  const more = useRef<HTMLDetailsElement>(null);
  const rest = PAGES.filter((p) => !MAIN_PAGES.has(p.href));
  useEffect(() => {
    if (more.current) more.current.open = false;
  }, [path]);
  // A click anywhere else closes More, as a menu should.
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (more.current?.open && !more.current.contains(e.target as Node)) more.current.open = false;
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  return (
    <nav className="hidden shrink-0 items-center gap-0.5 lg:flex" aria-label="Main">
      <Link href="/" aria-current={onTrade ? 'page' : undefined} className={cn(navItem, onTrade ? navOn : navOff)}>
        Trade
      </Link>
      {PAGES.map((p) => (
        <Link key={p.href} href={p.href} aria-current={path === p.href ? 'page' : undefined} className={cn(navItem, path === p.href ? navOn : navOff, !MAIN_PAGES.has(p.href) && 'hidden 2xl:flex')}>
          {p.label}
        </Link>
      ))}
      <details ref={more} className="relative 2xl:hidden">
        <summary className={cn(navItem, 'cursor-pointer list-none gap-1 [&::-webkit-details-marker]:hidden', rest.some((p) => p.href === path) ? navOn : navOff)}>
          More
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </summary>
        <div className="panel absolute left-0 top-11 z-50 w-52 p-1 shadow-[0_18px_50px_rgb(0_0_0_/_.6)]">
          {rest.map((p) => (
            <Link key={p.href} href={p.href} className={cn('flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-[14px] transition-colors', path === p.href ? 'bg-white/[.07] text-ink' : 'text-muted hover:bg-white/[.05] hover:text-ink')}>
              {p.icon}
              {p.label}
            </Link>
          ))}
        </div>
      </details>
    </nav>
  );
}

/** The same places on a phone, where the rail would take a fifth of the screen. */
function PhoneNav({ onTrade }: { onTrade: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const tab = useLayout((s) => s.tab);
  const setTab = useLayout((s) => s.setTab);
  return (
    <nav className="flex flex-wrap gap-1 px-3 pb-2 lg:hidden" aria-label="Main">
      {LISTS.map((l) => (
        <button
          key={l.tab}
          onClick={() => {
            setTab(l.tab);
            if (!onTrade || path !== '/') router.push('/');
          }}
          className={cn('pill', onTrade && tab === l.tab && 'pill-on')}
        >
          {l.label}
        </button>
      ))}
      {PAGES.map((p) => (
        <Link key={p.href} href={p.href} className={cn('pill', path === p.href && 'pill-on')}>
          {p.label}
        </Link>
      ))}
    </nav>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const hydrate = useWallet((s) => s.hydrate);
  const refresh = useWallet((s) => s.refreshBalance);
  const start = useNetwork((s) => s.start);
  const connected = useNetwork((s) => s.connected);
  const ordered = useNetwork((s) => s.ordered);
  const once = useRef(false);
  const [notDeployed, setNotDeployed] = useState(false);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    // Only a clear answer from the indexer counts: if it's unreachable, that's a different problem from "not deployed".
    get<{ deployment: unknown }>('/health')
      .then((h) => setNotDeployed(!h.deployment))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    hydrate();
    useMoney.getState().hydrate();
    useSocial.getState().hydrate();
    useLayout.getState().hydrate();
    startAutocopy();
    void start();
    warmUp();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [hydrate, refresh, start]);

  // One poll that failed isn't a lost connection: say so only if it stays down.
  useEffect(() => {
    if (connected || ordered === 0) {
      setLost(false);
      return;
    }
    const id = setTimeout(() => setLost(true), 4000);
    return () => clearTimeout(id);
  }, [connected, ordered]);

  const onTrade = path === '/' || path.startsWith('/tokens/');

  return (
    <div className="flex min-h-screen flex-col lg:h-dvh lg:min-h-0">
      {IS_LOCAL && <div className="shrink-0 bg-white/5 px-4 py-1 text-center text-[13px] text-muted">Demo on a local test chain. Tokens, traders and prices are generated. No real money.</div>}
      {notDeployed && <div className="shrink-0 bg-white/5 px-4 py-1 text-center text-[13px] text-muted">Live test network. Launching and trading turn on once the contracts are deployed here.</div>}
      {lost && <div className="shrink-0 bg-down/15 px-4 py-1 text-center text-[13px] text-down">Connection to the network was lost. Reconnecting.</div>}
      <header className="z-30 flex h-14 shrink-0 items-center gap-2 border-b border-white/[.06] px-2">
        <Link href="/" className="flex h-10 shrink-0 items-center px-3 text-ink" aria-label="Submarine, home" title="Submarine">
          {/* The mark alone, no name beside it, with the same space on its left as between it and the menu. The S is balanced
              top to bottom, so it centres on the menu's centre line. */}
          <Mark className="h-7 w-auto" />
        </Link>
        <TopNav onTrade={onTrade} />
        <div className="flex min-w-0 flex-1 justify-center lg:px-2">
          <SearchBox />
        </div>
        {!IS_LOCAL && (
          <span className="hidden h-8 shrink-0 items-center rounded-lg bg-accent/10 px-2.5 text-[13px] font-medium text-accent sm:flex" title="A test network. Everything here uses test coins with no value, and the network can be reset.">
            Devnet
          </span>
        )}
        <div className="flex shrink-0 justify-end gap-2">
          <CurrencySwitch />
          <WalletChip />
        </div>
      </header>
      <PhoneNav onTrade={onTrade} />
      <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2 pt-2">
        <main className="no-scrollbar min-w-0 flex-1 lg:h-full lg:overflow-y-auto">{children}</main>
      </div>
      <Ladder />
      <TrackedAlerts />
      <WalletDrawer />
      <KeyBackup />
      <Unlock />
      <PinSetup />
      <AlertWatcher />
      <Tips />
      <RefCapture />
    </div>
  );
}
