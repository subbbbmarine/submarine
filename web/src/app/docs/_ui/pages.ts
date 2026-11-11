import type { Metadata } from 'next';

/** Every docs page, in reading order. The sidebar, the index and the previous and next links all come from this list. */
export type DocGroup = 'start' | 'traders' | 'builders';

export interface DocEntry {
  slug: string;
  title: string;
  blurb: string;
  group: DocGroup;
}

export const GROUPS: Array<{ id: DocGroup; title: string }> = [
  { id: 'start', title: 'Start here' },
  { id: 'traders', title: 'For traders' },
  { id: 'builders', title: 'For builders' },
];

export const DOCS: DocEntry[] = [
  { slug: '', title: 'Overview', blurb: 'What Submarine is, the numbers that matter, and where to go next.', group: 'start' },
  { slug: 'getting-started', title: 'Getting started on Zero', blurb: 'ZRO for gas and trading, and what comes before mainnet.', group: 'start' },
  { slug: 'wallets', title: 'Wallets', blurb: 'Keys in this browser, the PIN, MetaMask, several wallets and public profiles.', group: 'start' },

  { slug: 'trading', title: 'Trading and the curve', blurb: 'How a price is made, from 2,000 ZRO virtual to a pool at 6,000 ZRO raised.', group: 'traders' },
  { slug: 'launching', title: 'Launching a token', blurb: 'Supply, fee, who earns it, anti-snipe and the first buy.', group: 'traders' },
  { slug: 'fees', title: 'Fees', blurb: 'The fixed 1% base, the creator\'s own fee, volume ranks, and where every part goes.', group: 'traders' },
  { slug: 'holder-rewards', title: 'Holder rewards', blurb: 'Tokens that pay their holders in ZRO, and how a share is counted.', group: 'traders' },
  { slug: 'buyback-and-burn', title: 'Buyback and burn', blurb: 'The token\'s own burn share, and the treasury that can only buy and burn.', group: 'traders' },
  { slug: 'orders', title: 'Limit orders and automation', blurb: 'Limits, take profit, stop loss, trailing stops, DCA and sale groups.', group: 'traders' },
  { slug: 'copy-trading', title: 'Copy trading', blurb: 'Copy in the browser, or in the copy vault with the tab closed.', group: 'traders' },
  { slug: 'referrals', title: 'Referrals', blurb: '40% of Submarine\'s cut, split 75 to the referrer and 25 back to the trader.', group: 'traders' },
  { slug: 'points', title: 'Points', blurb: 'Points for trading and launching on Submarine, counted from the chain, toward a reward for early users.', group: 'traders' },
  { slug: 'alerts', title: 'Alerts and the Telegram bot', blurb: 'Price, wallet and token alerts in the browser and in Telegram.', group: 'traders' },
  { slug: 'chart', title: 'The chart', blurb: 'Styles, intervals, markers, drawings and the order heatmap.', group: 'traders' },
  { slug: 'discovery', title: 'Pulse, Radar and Multi', blurb: 'Finding tokens early, wallets that keep being early, and many charts at once.', group: 'traders' },
  { slug: 'keyboard', title: 'Keyboard', blurb: 'Every key Submarine listens to.', group: 'traders' },
  { slug: 'risks', title: 'Risks and who controls what', blurb: 'What can go wrong, and what the owner can and cannot do.', group: 'traders' },
  { slug: 'glossary', title: 'Glossary', blurb: 'The words used across Submarine, one line each.', group: 'traders' },
  { slug: 'faq', title: 'Questions', blurb: 'Short answers to what people ask most.', group: 'traders' },

  { slug: 'contracts', title: 'Contract addresses', blurb: 'Where every contract lives on Zero, once it is deployed.', group: 'builders' },
  { slug: 'reference', title: 'Contract reference', blurb: 'Every function, constant and error, contract by contract.', group: 'builders' },
  { slug: 'events', title: 'Events to index', blurb: 'Every event the indexer reads, with its fields.', group: 'builders' },
  { slug: 'api', title: 'Public API', blurb: 'Every route, its parameters and what it answers.', group: 'builders' },
  { slug: 'keepers', title: 'Run a keeper', blurb: 'Fill orders and run copies for anyone, and earn the run fees.', group: 'builders' },
  { slug: 'launch-from-code', title: 'Launch and trade from code', blurb: 'Launch, quote, buy and sell with viem.', group: 'builders' },
  { slug: 'mcp', title: 'MCP server', blurb: 'Market data and live quotes for AI agents.', group: 'builders' },
];

export const href = (slug: string) => (slug ? `/docs/${slug}` : '/docs');

export function neighbours(slug: string): { prev: DocEntry | null; next: DocEntry | null } {
  const i = DOCS.findIndex((d) => d.slug === slug);
  return { prev: i > 0 ? DOCS[i - 1]! : null, next: i >= 0 && i < DOCS.length - 1 ? DOCS[i + 1]! : null };
}

export const entry = (slug: string) => DOCS.find((d) => d.slug === slug)!;

export function docMeta(slug: string): Metadata {
  const d = entry(slug);
  return { title: slug ? `${d.title} · Docs · Submarine` : 'Docs · Submarine', description: d.blurb };
}
