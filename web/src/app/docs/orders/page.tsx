import { B, Bullets, Doc, H2, H3, L, Note, P, Table } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('orders');

export default function Page() {
  return (
    <Doc
      slug="orders"
      lead={
        <>
          An order locks your ZRO or tokens in a contract until its condition comes, then trades through the router at the best price. Every
          order names the least it must get, and no condition can override that. You can cancel at any time and get back whatever hasn&apos;t
          filled.
        </>
      }
      toc={[
        ['kinds', 'Every kind of order'],
        ['limit', 'Limit orders'],
        ['tpsl', 'Take profit and stop loss'],
        ['trailing', 'Trailing stops'],
        ['events', 'Orders on events'],
        ['dca', 'DCA'],
        ['groups', 'Sale groups'],
        ['fills', 'Who fills, and partial fills'],
        ['manage', 'Seeing and cancelling'],
        ['heatmap', 'The heatmap'],
      ]}
    >
      <H2 id="kinds">Every kind of order</H2>
      <Table
        cols={['Order', 'Side', 'Fills when']}
        rows={[
          ['Limit', 'Buy or sell', 'The market pays at least your minimum, after fees'],
          ['Take profit', 'Sell', 'A limit sale above the price now'],
          ['Stop loss', 'Sell', 'A sale would fetch your level or less, and still at least your floor'],
          ['Trailing stop', 'Sell', 'The value has dropped your chosen share below the highest it reached'],
          ['Buy on pool / Sell on pool', 'Buy or sell', 'The token moves from its curve to its pool'],
          ['Sell when dev sells', 'Sell', 'The creator has sold the share of their holding you chose'],
          ['DCA', 'Buy', 'In equal parts, a set time apart'],
        ]}
      />
      <P>
        Orders work for tokens launched here, on the curve and on their pool. Pick <B>Limit</B> or <B>TP / SL</B> on the trade card, or
        open the automation panel for the rest.
      </P>

      <H2 id="limit">Limit orders</H2>
      <P>
        Set the level as a market cap and an amount. A buy locks your ZRO, a sale locks your tokens. It lasts 1 hour, 1 day or 7 days, a day
        if you don&apos;t choose. Click a level on the chart&apos;s price scale to start an order there.
      </P>
      <H3>A worked example</H3>
      <P>
        A token is at a market cap of 12,000 ZRO. You place a limit buy of 400 ZRO at 8,000 ZRO. The contract locks 400 ZRO and works out the
        least number of tokens 400 ZRO must buy at that level, after fees and the 0.04 ZRO run fee. Nothing happens until the market falls
        far enough that 399.96 ZRO buys at least that many. Then anyone may fill it, and the tokens go straight to your wallet.
      </P>
      <P>
        A buy has to be more than twice the run fee, so more than 0.08 ZRO.
      </P>

      <H2 id="tpsl">Take profit and stop loss</H2>
      <P>On a token you hold, the TP / SL tab sets ways out of a share of your holding, 25%, 50% or 100%:</P>
      <Table
        cols={['Setting', 'Default', 'What it does']}
        rows={[
          ['Take profit 1', '+100%', 'Sells when the tokens are worth double'],
          ['Take profit 2', 'off', 'A second level. Then the first sells 25%, 50% or 75% of the share, 50% if you don\'t choose'],
          ['Stop loss', '−40%', 'Sells when they are worth 40% less. It never sells below half that level'],
          ['Trailing', 'off', 'A drop from the high, in percent. See below'],
        ]}
      />
      <P>
        Example: your tokens would sell for 40 ZRO now. A stop loss at −40% fires once a sale would fetch 24 ZRO or less, and its floor
        means it never sells for less than 12 ZRO. If the price crashes through the floor in one move, the order waits rather than selling
        at any price.
      </P>
      <Note title="A stop is judged by what the sale really fetches.">
        The contract checks the stop after selling, against the ZRO that actually came back. A fake price can&apos;t trigger it, and it
        can&apos;t sell below your floor.
      </Note>

      <H2 id="trailing">Trailing stops</H2>
      <P>
        A trailing stop remembers the most your tokens were worth since you placed it, and sells once they are worth your chosen share less.
        With a 20% trail, tokens that rise to 200 ZRO and fall back to 160 ZRO sell. The high is raised on chain by whoever runs the keeper,
        at most every ten seconds, so a spike shorter than that may not count.
      </P>

      <H2 id="events">Orders on events</H2>
      <Table
        cols={['Order', 'Default', 'Fires when']}
        rows={[
          ['Sell on pool', 'on', 'The token graduates. Many traders sell at the move'],
          ['Sell when dev sells', '50%', 'The creator holds half or less of what they held when you placed it'],
          ['Buy on pool', 'up to 2× the pool price', 'The token graduates, buying at no more than twice the price its pool opens at'],
        ]}
      />
      <P>These only work for tokens launched here, because only their curve and creator are known to the contract.</P>

      <H2 id="dca">DCA</H2>
      <P>
        Spreads a buy over time. Set a total, a number of parts from 2 to 100 (5 if you don&apos;t choose), how many minutes apart (10 by
        default), and the highest market cap you&apos;ll pay (three times today&apos;s by default). Each part is held to its share of your
        minimum. A DCA order has no expiry.
      </P>
      <P>Example: 400 ZRO in 5 parts, 10 minutes apart, buys 80 ZRO at a time over 40 minutes. A part waits while the cap is above your limit.</P>
      <H3>Buying from several wallets</H3>
      <P>The Wallets tab buys with several of your own wallets at once, each its own trade.</P>

      <H2 id="groups">Sale groups</H2>
      <P>
        Take profits, a stop loss and a trailing stop on the same tokens share one escrow. Your tokens are locked once, and whichever leg
        fills first takes its part from the group. The others carry on with what is left. When nothing is left, every leg closes.
      </P>
      <Bullets
        items={[
          'The site builds a group of up to 4 legs. The contract allows 5.',
          'A group from the TP / SL tab lasts 30 days.',
          'Cancelling any leg ends the whole group and returns the tokens left, because they belong to the group, not to one leg.',
        ]}
      />

      <H2 id="fills">Who fills, and partial fills</H2>
      <P>
        Anyone can fill an order and earn the run fee, 0.04 ZRO per order, so no single service has to be trusted. The contract checks the
        condition and your minimum itself. Submarine runs a keeper that does this, and anyone else may too. See{' '}
        <L to="keepers">Run a keeper</L>.
      </P>
      <P>
        An order can fill in parts. Each part is held to its share of your minimum and pays its share of the run fee, rounded up. Every buy
        moves the price against the next, so a big order at a level close to the market fills as far as its level allows and waits for the
        rest, as it would on an exchange.
      </P>
      <P>
        Example: a 400 ZRO order fills 240 ZRO now and 160 ZRO later. The fillers get 0.024 and 0.016 ZRO. Portfolio shows how much has
        filled and at what average.
      </P>

      <H2 id="manage">Seeing and cancelling</H2>
      <Bullets
        items={[
          'Portfolio lists your orders, with how much has filled, the status, and a Cancel button. Cancel all cancels every open one.',
          'An order past its expiry that still holds funds shows Get back, which returns them.',
          'If your wallet refuses the ZRO an order pays out, the contract holds it for you to withdraw to any address.',
          'Each order keeps the fees it was placed under, even if the owner changes them later.',
          <>A fill trades through the router in your name, so it adds to your volume and <L to="fees" at="ranks">rank</L>, gets your rank&apos;s discount, shares with your referrer and earns you <L to="points">points</L>, like a trade you made yourself.</>,
        ]}
      />

      <H2 id="heatmap">The heatmap</H2>
      <P>
        The chart can show what has waited at each level and for how long: buys in green, sales in red, brighter the more ZRO. It covers
        limit orders on Submarine only, not the liquidity in a curve or a pool. Orders waiting on an event have no level, so they
        aren&apos;t drawn. More on <L to="chart" at="heatmap">The chart</L>.
      </P>
    </Doc>
  );
}
