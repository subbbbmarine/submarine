import { B, Bullets, Doc, Go, H2, H3, L, P, Table } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('discovery');

export default function Page() {
  return (
    <Doc
      slug="discovery"
      lead={
        <>
          Three pages help you find tokens early. <B>Pulse</B> shows launches as they happen, <B>Radar</B> finds wallets that keep getting in
          early, and <B>Multi</B> puts up to four charts side by side with a trade panel each.
        </>
      }
      toc={[
        ['lists', 'The lists beside the chart'],
        ['pulse', 'Pulse'],
        ['filters', 'Pulse filters'],
        ['trending', 'Trending'],
        ['radar', 'Radar'],
        ['multi', 'Multi'],
        ['stats', 'Stats and trader pages'],
      ]}
    >
      <H2 id="lists">The lists beside the chart</H2>
      <P>On the trading screen, the column on the left switches between four lists, with the chart staying open:</P>
      <Table
        cols={['List', 'Shows']}
        rows={[
          ['Tokens', 'Tabs for New, Hot, Near (close to a pool), Pools, and Other launchpads'],
          ['Feed', 'Every trade on the chain as it lands'],
          ['Leaders', 'Traders by profit'],
          ['Tracked', 'Wallets you follow and their latest trades. See Copy trading'],
        ]}
      />

      <H2 id="pulse">Pulse</H2>
      <P>
        <Go to="/pulse">Pulse</Go> is three columns that update by themselves, every 10 seconds and 1.5 seconds after any trade:
      </P>
      <Table
        cols={['Column', 'Tokens in it']}
        rows={[
          ['New', 'Just launched, still on their curve, newest first'],
          ['Close to pool', '40% or more of the way to their pool, furthest first'],
          ['In a pool', 'Moved to a pool, most recent first'],
        ]}
      />
      <Bullets
        items={[
          'A column stops moving while your pointer is over it, so a card doesn\'t jump away as you click.',
          'Each column has its own buy amount, so one click buys that much.',
          'Each card shows the risk figures: dev, top 10, snipers, bundles, insiders.',
        ]}
      />

      <H2 id="filters">Pulse filters</H2>
      <P>Every column has its own filters, all optional:</P>
      <Table
        cols={['Filter', 'Kind']}
        rows={[
          ['Age', 'From and up to, in minutes'],
          ['Market cap', 'Least and most, in ZRO'],
          ['Holders', 'Least and most'],
          ['Progress', 'How far along its curve'],
          ['Volume', 'Least in 24 hours'],
          ['Dev, top 10, snipers, bundles, insiders', 'The most each may hold, as a share of supply'],
          ['Smart holders', 'The least number of smart wallets holding it'],
          ['Has socials', 'Only tokens with a website or social link'],
          ['Launchpad', 'Only tokens from one launchpad'],
        ]}
      />

      <H2 id="trending">Trending</H2>
      <P>
        Pulse also ranks what is moving over 1 minute, 5 minutes, 1 hour, 6 hours or 24 hours, by volume, gainers or number of trades.
      </P>

      <H2 id="radar">Radar</H2>
      <P>
        Pick up to 10 tokens that did well. <Go to="/radar">Radar</Go> lists the wallets that were among the first 30 buyers of at least two
        of them. A wallet that keeps showing up early is worth a look, and you can follow it from there. With nothing picked, it uses
        today&apos;s five busiest tokens.
      </P>
      <H3>Reading it carefully</H3>
      <P>
        Being early twice can be luck, a bot, or the creators&apos; own wallets. Open the wallet&apos;s record before following it: its profit,
        win rate, holding time and flags.
      </P>

      <H2 id="multi">Multi</H2>
      <P>
        <Go to="/multi">Multi</Go> shows four charts, or two larger ones. Each has a fast trade panel: buy amounts of 5, 50, 200 and 500
        ZRO, which you can change and which every cell shares, and sales of 25%, 50% or 100%.
      </P>

      <H2 id="stats">Stats and trader pages</H2>
      <P>
        <Go to="/stats">Stats</Go> shows Submarine&apos;s own figures over 24 hours, 7 days, 30 days or all time: revenue, volume, launches,
        traders, the treasury, limit orders, where trades went, the most traded tokens, the top creators and every launchpad.
      </P>
      <P>
        A trader&apos;s page shows their record over 7 or 30 days: profit, win rate, holding time, buy sizes, and flags such as selling more
        than they bought or selling within 10 seconds of buying. Holder labels such as smart and sniper are in the{' '}
        <L to="glossary">Glossary</L>.
      </P>
    </Doc>
  );
}
