'use client';

import { cn } from '@/lib/format';
import { LABEL_NAMES, type Label, type Risk } from '@/lib/insight';

/** Above these a share reads as a warning. Where GMGN and Banana draw the line, near enough. */
export const WARN: Record<'dev' | 'top10' | 'snipers' | 'bundles' | 'insiders', number> = { dev: 0.1, top10: 0.5, snipers: 0.15, bundles: 0.15, insiders: 0.1 };

export const pct = (v: number) => `${v < 0.1 && v > 0 ? (v * 100).toFixed(1) : Math.round(v * 100)}%`;

const CHIPS: Array<{ key: keyof typeof WARN; label: string; title: string }> = [
  { key: 'dev', label: 'Dev', title: 'What the creator holds' },
  { key: 'top10', label: 'Top 10', title: 'What the ten biggest holders hold' },
  { key: 'snipers', label: 'Snipers', title: 'What wallets that bought in the first 5 seconds still hold' },
  { key: 'bundles', label: 'Bundle', title: 'What wallets that bought in the launch block still hold' },
  { key: 'insiders', label: 'Insiders', title: 'What wallets the dev sent coins to hold' },
];

/** The shares of supply a trader checks before buying, red where they're high. */
export function RiskChips({ risk, className }: { risk: Risk | null | undefined; className?: string }) {
  if (!risk) return null;
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {CHIPS.map((c) => {
        const v = risk[c.key];
        const bad = v > WARN[c.key];
        return (
          <span key={c.key} title={c.title} className={cn('num rounded-md px-1.5 py-px text-[11px]', bad ? 'bg-down/15 text-down' : 'bg-white/[.05] text-muted')}>
            {c.label} {pct(v)}
          </span>
        );
      })}
      {risk.smart_holders > 0 && (
        <span title="Wallets with a strong 30 day record that hold it" className="num rounded-md bg-accent/15 px-1.5 py-px text-[11px] text-accent">
          Smart {risk.smart_holders}
        </span>
      )}
    </div>
  );
}

const TONE: Partial<Record<Label, string>> = {
  dev: 'bg-accent/15 text-accent',
  smart: 'bg-accent/15 text-accent',
  insider: 'bg-down/15 text-down',
  sniper: 'bg-down/15 text-down',
  bundle: 'bg-down/15 text-down',
  bot: 'bg-down/15 text-down',
};

/** What a wallet looks like on this token, as small tags with the reason on hover. */
export function LabelChips({ labels, skip = [] }: { labels: Label[] | undefined; skip?: Label[] }) {
  if (!labels?.length) return null;
  return (
    <>
      {labels
        .filter((l) => !skip.includes(l))
        .map((l) => (
          <span key={l} title={LABEL_NAMES[l].long} className={cn('shrink-0 rounded px-1 text-[10px] font-semibold', TONE[l] ?? 'bg-white/[.07] text-muted')}>
            {LABEL_NAMES[l].short}
          </span>
        ))}
    </>
  );
}

type Tone = 'good' | 'near' | 'bad' | 'plain';
const TONE_TEXT: Record<Tone, string> = { good: 'text-up', near: 'text-accent', bad: 'text-down', plain: 'text-ink' };

/** Line icons for the safety strip, drawn on a 16 unit square. */
const ICONS: Record<string, React.ReactNode> = {
  top10: <path d="M2.5 12.5h11M3 11.2 2 5l3.6 2.6L8 3l2.4 4.6L14 5l-1 6.2" />,
  dev: (
    <>
      <circle cx="8" cy="5.4" r="2.6" />
      <path d="M3 13.6c.8-2.7 2.7-4.1 5-4.1s4.2 1.4 5 4.1" />
    </>
  ),
  snipers: (
    <>
      <circle cx="8" cy="8" r="5" />
      <circle cx="8" cy="8" r="1.2" />
      <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
    </>
  ),
  bundles: <path d="M2.5 5 8 2.5 13.5 5v6L8 13.5 2.5 11zM2.5 5 8 7.5 13.5 5M8 7.5v6" />,
  insiders: (
    <>
      <circle cx="5.6" cy="8" r="3" />
      <circle cx="10.4" cy="8" r="3" />
    </>
  ),
  fresh: <path d="M8 14V8.5m0 0c0-3.2 2.1-5.3 5.3-5.3 0 3.2-2.1 5.3-5.3 5.3zm0 1.8C8 8.2 6.5 6.7 3.8 6.7c0 2.1 1.5 3.6 4.2 3.6z" />,
  holders: (
    <>
      <circle cx="6" cy="5.6" r="2.2" />
      <path d="M1.8 13c.6-2.3 2.2-3.5 4.2-3.5s3.6 1.2 4.2 3.5" />
      <path d="M10.6 3.6a2.2 2.2 0 0 1 0 4.2M12 9.7c1.1.5 1.9 1.6 2.2 3.3" />
    </>
  ),
  smart: <path d="M8 1.8 9.4 6.6 14.2 8 9.4 9.4 8 14.2 6.6 9.4 1.8 8l4.8-1.4z" />,
};

const STRIP: Array<{ key: keyof typeof WARN | 'fresh'; label: string; what: string; warn: number }> = [
  { key: 'top10', label: 'Top 10', what: 'What the ten biggest holders hold', warn: WARN.top10 },
  { key: 'dev', label: 'Dev', what: 'What the creator holds', warn: WARN.dev },
  { key: 'snipers', label: 'Snipers', what: 'What wallets that bought in the first 5 seconds still hold', warn: WARN.snipers },
  { key: 'bundles', label: 'Bundle', what: 'What wallets that bought in the launch block still hold', warn: WARN.bundles },
  { key: 'insiders', label: 'Insiders', what: 'What wallets the dev sent coins to hold', warn: WARN.insiders },
];

const toneOf = (v: number, warn: number): Tone => (v > warn ? 'bad' : v > warn / 2 ? 'near' : 'good');

function Cell({ icon, value, label, tone, tip }: { icon: string; value: string; label: string; tone: Tone; tip: string }) {
  return (
    // The icon is as tall as the value and its label together, so the two read as one block, top and bottom aligned.
    <div title={tip} className="flex min-w-0 items-stretch gap-1.5 rounded-lg px-1 py-0.5 transition-colors hover:bg-white/[.05]">
      <svg viewBox="0 0 16 16" className={cn('h-[28px] w-[28px] shrink-0', TONE_TEXT[tone])} fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICONS[icon]}
      </svg>
      <div className="flex h-[28px] flex-col justify-between">
        <div className={cn('num text-[13px] font-semibold leading-[14px]', TONE_TEXT[tone])}>{value}</div>
        <div className="whitespace-nowrap text-[10.5px] leading-[11px] text-faint">{label}</div>
      </div>
    </div>
  );
}

/**
 * The token's safety at a glance, for its header: a verdict first, then each share of supply a trader checks with its own
 * icon, green when it's low, yellow when it's getting there and red past the line. The full reasons are on the hover.
 */
export function RiskStrip({ risk }: { risk: Risk | null | undefined }) {
  if (!risk) return <div className="h-[34px]" aria-hidden="true" />;
  const checks = STRIP.map((c) => ({ ...c, v: risk[c.key], tone: toneOf(risk[c.key], c.warn) }));
  const bad = checks.filter((c) => c.tone === 'bad');
  const verdict = bad.length
    ? { text: `${bad.length} ${bad.length === 1 ? 'warning' : 'warnings'}`, cls: 'bg-down/15 text-down', tip: bad.map((c) => `${c.label} holds ${pct(c.v)}, over ${pct(c.warn)}`).join('\n') }
    : { text: 'Looks clean', cls: 'bg-up/15 text-up', tip: 'No share of supply is past its warning line' };
  return (
    <div className="grid w-full max-w-[700px] items-center gap-x-0.5 gap-y-1 [grid-template-columns:repeat(auto-fill,minmax(72px,1fr))]" aria-label="Safety">
      <span title={verdict.tip} className={cn('col-span-2 mr-1 flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[12.5px] font-semibold', verdict.cls)}>
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 1.8 13 3.6v4c0 3.1-2.1 5.4-5 6.6-2.9-1.2-5-3.5-5-6.6v-4z" />
          {bad.length ? <path d="M8 5.2v3.4M8 10.6v.1" strokeLinecap="round" /> : <path d="m5.6 8 1.7 1.7 3.2-3.4" strokeLinecap="round" />}
        </svg>
        {verdict.text}
      </span>
      {checks.map((c) => (
        <Cell key={c.key} icon={c.key} value={pct(c.v)} label={c.label} tone={c.tone} tip={`${c.what}.\nA warning above ${pct(c.warn)}.`} />
      ))}
      {risk.smart_holders > 0 && <Cell icon="smart" value={String(risk.smart_holders)} label="Smart" tone="near" tip="Wallets with a strong 30 day record that hold it" />}
    </div>
  );
}
