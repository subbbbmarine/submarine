'use client';

import { useEffect, useRef, useState } from 'react';
import { get, useStream, type Order, type TokenDetail } from '@/lib/api';
import { askForSystemNotifications, notify, useAlerts } from '@/lib/alerts';
import { cn } from '@/lib/format';
import { useFormat } from '@/lib/money';
import { nameOf, tracked, useTracked } from '@/lib/tracked';
import { useWallet } from '@/lib/wallet';

/**
 * Watches the live feed for every alert, on every page: market caps crossing their levels, the user's orders filling, and
 * followed wallets trading while the tab is in the background. Also keeps the unread count on the tab's title.
 */
export function AlertWatcher() {
  const { hydrate, unread, read } = useAlerts();
  const me = useWallet((s) => s.account?.address.toLowerCase());
  const list = useTracked();
  const seen = useRef(new Map<number, string>());
  const base = useRef('');

  useEffect(hydrate, [hydrate]);
  useEffect(() => {
    const onFocus = () => read();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [read]);
  useEffect(() => {
    if (!base.current || !document.title.startsWith('(')) base.current = document.title;
    document.title = unread ? `(${unread}) ${base.current}` : base.current;
  }, [unread]);

  // The user's orders, as they stood, so a change of status can be told.
  useEffect(() => {
    seen.current.clear();
    if (!me) return;
    get<{ orders: Order[] }>(`/api/v1/orders?owner=${me}`).then((r) => r.orders.forEach((o) => seen.current.set(o.id, o.status)), () => {});
  }, [me]);

  useStream((type, d) => {
    if (type === 'trade') {
      const { alerts, remove, prefs } = useAlerts.getState();
      for (const a of alerts) {
        if (a.token !== d.token) continue;
        const cap = Number(d.price) * a.supply;
        if ((a.side === 'above' && cap >= a.cap) || (a.side === 'below' && cap <= a.cap)) {
          remove(a.id);
          notify(`${a.symbol} is ${a.side} your level`, `Market cap ${a.side === 'above' ? 'rose to' : 'fell to'} ${cap.toFixed(2)} ZRO`, `/tokens/${a.token}`);
        }
      }
      if (prefs.tracked && document.hidden && tracked.has(d.trader)) {
        notify(`${nameOf(d.trader, list)} ${d.isBuy ? 'bought' : 'sold'}`, `${Number(d.zro).toFixed(4)} ZRO`, `/tokens/${d.token}`);
      }
    }
    if (type === 'order' && me) {
      get<{ orders: Order[] }>(`/api/v1/orders?owner=${me}`).then(
        (r) =>
          r.orders.forEach((o) => {
            const before = seen.current.get(o.id);
            seen.current.set(o.id, o.status);
            if (before && before !== o.status && (o.status === 'filled' || o.status === 'partial')) {
              notify(`${o.is_buy ? 'Buy' : 'Sale'} of ${o.symbol} ${o.status === 'filled' ? 'filled' : 'partly filled'}`, `${Math.round(o.filled_share * 100)}% done`, `/tokens/${o.token}`);
            }
          }),
        () => {},
      );
    }
  });
  return null;
}

/** The bell on a token's header: add a market cap alert, see this token's alerts. */
/** `small` sits in a row of small icons, like the one by a token's name, and opens its card to the right. */
export function AlertButton({ token, small = false }: { token: TokenDetail; small?: boolean }) {
  const { alerts, add, remove } = useAlerts();
  const { money, usd } = useFormat();
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<'above' | 'below'>('above');
  const [level, setLevel] = useState('');
  const mine = alerts.filter((a) => a.token === token.address);
  const submit = () => {
    const n = Number(level);
    if (!(n > 0)) return;
    add({ token: token.address, symbol: token.symbol, side, cap: usd ? n / usd : n, supply: token.total_supply });
    setLevel('');
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} title="Alerts" aria-label="Alerts" className={cn('flex items-center gap-1 transition-colors', small ? 'h-6 min-w-6 justify-center rounded-md px-1.5 text-[12px]' : 'h-9 rounded-xl px-2.5 text-[13px]', mine.length ? 'bg-accent/15 text-accent' : 'bg-white/5 text-muted hover:text-ink')}>
        <svg viewBox="0 0 16 16" className={small ? 'h-3.5 w-3.5' : 'h-4 w-4'} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3zM6.5 14h3" />
        </svg>
        {mine.length > 0 && <span className="num">{mine.length}</span>}
      </button>
      {open && (
        <div className={cn('panel absolute z-30 w-64 space-y-2 p-3 shadow-2xl', small ? 'left-0 top-8' : 'right-0 top-11')} role="dialog" aria-label="Alerts">
          <div className="text-[13px] font-semibold">Tell me when the cap goes</div>
          <div className="flex gap-1">
            {(['above', 'below'] as const).map((s) => (
              <button key={s} onClick={() => setSide(s)} className={cn('pill flex-1 text-[12px] capitalize', side === s && 'pill-on')}>
                {s}
              </button>
            ))}
          </div>
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input value={level} onChange={(e) => setLevel(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder={usd ? 'USD' : 'ZRO'} className="field num h-8 min-w-0 flex-1 text-[13px]" />
            <button className="btn btn-accent h-8 px-3 text-[13px]">Add</button>
          </form>
          {mine.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-[13px]">
              <span className="num">
                {a.side === 'above' ? 'Above' : 'Below'} {money(a.cap)}
              </span>
              <button onClick={() => remove(a.id)} className="text-faint hover:text-down">
                Remove
              </button>
            </div>
          ))}
          <p className="text-[11px] text-faint">Works while this site is open in any tab. For alerts with the browser closed, use the Telegram bot.</p>
        </div>
      )}
    </div>
  );
}

/** Every alert and how they reach you, for Portfolio. */
export function AlertSettings() {
  const { alerts, prefs, setPrefs, remove } = useAlerts();
  const { money } = useFormat();
  const row = 'flex items-center justify-between gap-2 text-[13px]';
  const [blocked, setBlocked] = useState(false);
  useEffect(() => setBlocked(typeof Notification !== 'undefined' && Notification.permission === 'denied'), []);
  return (
    <section className="space-y-2.5">
      <label className={row}>
        Ring a sound
        <input type="checkbox" checked={prefs.sound} onChange={(e) => setPrefs({ sound: e.target.checked })} />
      </label>
      <label className={row}>
        System notifications when the tab is in the background
        <input
          type="checkbox"
          checked={prefs.system}
          onChange={(e) => (e.target.checked ? void askForSystemNotifications().then((ok) => setBlocked(!ok && typeof Notification !== 'undefined' && Notification.permission === 'denied')) : setPrefs({ system: false }))}
        />
      </label>
      {blocked && (
        <p className="rounded-lg bg-down/10 px-2.5 py-1.5 text-[12px] leading-snug text-down">
          The browser blocks notifications for this site. Click the icon left of the address bar, open Site settings, set Notifications to Allow, then reload and tick this again.
        </p>
      )}
      <label className={row}>
        Trades by wallets you follow, in the background
        <input type="checkbox" checked={prefs.tracked} onChange={(e) => setPrefs({ tracked: e.target.checked })} />
      </label>
      {alerts.length ? (
        <ul className="space-y-1">
          {alerts.map((a) => (
            <li key={a.id} className={row}>
              <span className="num">
                {a.symbol} {a.side} {money(a.cap)}
              </span>
              <button onClick={() => remove(a.id)} className="text-faint hover:text-down">
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-faint">No price alerts. Add one with the bell on a token.</p>
      )}
    </section>
  );
}
