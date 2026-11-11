// Alerts in the browser: a token's market cap crossing a level, your own orders filling, and trades by wallets you follow
// while the tab is in the background. Each one can ring, show a system notification, and count on the tab's title.
import { create } from 'zustand';

export interface PriceAlert {
  id: string;
  token: string;
  symbol: string;
  side: 'above' | 'below';
  /** In ZRO of market cap. */
  cap: number;
  supply: number;
  created: number;
}

interface Prefs {
  sound: boolean;
  system: boolean;
  /** Trades by followed wallets, while the tab isn't in front. */
  tracked: boolean;
}

interface AlertState {
  alerts: PriceAlert[];
  prefs: Prefs;
  unread: number;
  hydrate: () => void;
  add: (a: Omit<PriceAlert, 'id' | 'created'>) => void;
  remove: (id: string) => void;
  setPrefs: (p: Partial<Prefs>) => void;
  read: () => void;
}

const STORAGE = 'terminal.alerts.v1';
const save = (alerts: PriceAlert[], prefs: Prefs) => {
  try {
    localStorage.setItem(STORAGE, JSON.stringify({ alerts, prefs }));
  } catch {
    // private mode: alerts last as long as the tab
  }
};

export const useAlerts = create<AlertState>((set, get) => ({
  alerts: [],
  prefs: { sound: true, system: false, tracked: false },
  unread: 0,
  hydrate: () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null') as { alerts?: PriceAlert[]; prefs?: Prefs } | null;
      if (saved) set({ alerts: saved.alerts ?? [], prefs: { ...get().prefs, ...saved.prefs } });
    } catch {
      // a damaged entry starts over
    }
  },
  add: (a) => {
    const alerts = [...get().alerts, { ...a, id: Math.random().toString(36).slice(2), created: Date.now() }];
    set({ alerts });
    save(alerts, get().prefs);
  },
  remove: (id) => {
    const alerts = get().alerts.filter((a) => a.id !== id);
    set({ alerts });
    save(alerts, get().prefs);
  },
  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p };
    set({ prefs });
    save(get().alerts, prefs);
  },
  read: () => set({ unread: 0 }),
}));

let audio: AudioContext | null = null;
/** Two short tones. Made in place, so there's no file to load. */
function chime() {
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    for (const [i, f] of [880, 1320].entries()) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.15, t + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.18);
      o.connect(g).connect(audio.destination);
      o.start(t + i * 0.12);
      o.stop(t + i * 0.12 + 0.2);
    }
  } catch {
    // no audio here
  }
}

/** Rings, notifies and counts, as the owner chose. `href` opens where the alert is about. */
export function notify(title: string, body: string, href?: string) {
  const { prefs } = useAlerts.getState();
  if (prefs.sound) chime();
  if (document.hidden) useAlerts.setState((s) => ({ unread: s.unread + 1 }));
  if (prefs.system && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
    const n = new Notification(title, { body, tag: href });
    n.onclick = () => {
      window.focus();
      if (href) window.location.href = href;
    };
  }
}

export async function askForSystemNotifications(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  const answer = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  useAlerts.getState().setPrefs({ system: answer === 'granted' });
  return answer === 'granted';
}
