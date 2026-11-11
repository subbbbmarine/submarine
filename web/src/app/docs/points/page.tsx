import { B, Bullets, C, Code, Doc, Go, H2, L, Note, P, Table } from '../_ui/doc';
import { SUBMARINE_API } from '../_ui/deployment';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('points');

export default function Page() {
  return (
    <Doc
      slug="points"
      lead={
        <>
          Trading through Submarine and launching coins on it earns points. The <Go to="/points">Points</Go> page counts them from what is
          already on the chain, for any address, with nothing to sign or connect. They go toward a reward for early users, which will be
          announced later.
        </>
      }
      toc={[
        ['rules', 'How points are counted'],
        ['example', 'A worked example'],
        ['lookup', 'Looking up an address'],
        ['api', 'From code'],
        ['know', 'Good to know'],
      ]}
    >
      <H2 id="rules">How points are counted</H2>
      <Table
        cols={['What', 'Points per ZRO', 'Counted from']}
        numeric={[1]}
        rows={[
          ['Trading through Submarine', '10', 'Every buy and sale through the router, on any token it reaches'],
          ['Others trading coins you launched on Submarine', '1', 'Every trade by another wallet on a token you launched on Submarine\'s launchpad'],
          ['Trading on other launchpads on Zero', '5', 'Trades made straight on another launchpad\'s contract, not through Submarine'],
        ]}
        caption="Figure 1. The rules as the indexer applies them today."
      />
      <P>
        A wallet&apos;s points start to count once it has traded <B>40 ZRO</B> through Submarine. Before that the Points page shows what it has,
        marked as not counting yet, and how much more it needs to trade.
      </P>

      <H2 id="example">A worked example</H2>
      <P>
        A wallet trades 1,200 ZRO through Submarine, launched a coin that others traded for 8,000 ZRO, and traded 800 ZRO on another launchpad.
      </P>
      <Table
        cols={['Part', 'ZRO', 'Points']}
        numeric={[1, 2]}
        rows={[
          ['Trading here, 1,200 × 10', '1,200', '12,000'],
          ['Your coins, 8,000 × 1', '8,000', '8,000'],
          ['Elsewhere, 800 × 5', '800', '4,000'],
          ['In all', '', '24,000'],
        ]}
        caption="Figure 2. It has traded more than 40 ZRO through Submarine, so all 24,000 count."
      />

      <H2 id="lookup">Looking up an address</H2>
      <P>
        Paste any address on the <Go to="/points">Points</Go> page to see its points, each part with the ZRO behind it, its place on the
        board and its share of all points. The board lists the wallets with the most points and moves with every trade.
      </P>

      <H2 id="api">From code</H2>
      <Table
        cols={['Route', 'What it answers']}
        rows={[
          [<C key="1">GET /api/v1/points/rules</C>, 'The rules: perZroTraded, perZroOnYourCoins, perZroElsewhere and minVolume'],
          [<C key="2">GET /api/v1/points/leaders?limit=50</C>, 'The wallets whose points count, by points, up to 200, with the total and how many wallets there are'],
          [<C key="3">GET /api/v1/points/:address</C>, 'One address: points, each part, whether it counts yet, its place and its share of all points'],
        ]}
      />
      <Code
        lang="ts"
        code={`const me = await fetch('${SUBMARINE_API}/api/v1/points/0xYourAddress').then((r) => r.json());
console.log(me.points, me.live ? \`place \${me.place} of \${me.wallets}\` : 'not counting yet');`}
      />
      <P>
        The figures are worked out at most every 30 seconds. More routes are on <L to="api">Public API</L>.
      </P>

      <H2 id="know">Good to know</H2>
      <Bullets
        items={[
          'Points are counted by Submarine\'s indexer from chain events, not kept by a contract.',
          'Your own trades on a coin you launched count as trading, not as trading on your coins.',
          'Limit orders and copy-vault copies and exits count as your trading: those contracts trade through the router in your name. The contracts themselves never score.',
          <>Points and <L to="fees" at="ranks">volume ranks</L> are separate. Ranks are kept by the router and lower your fee. Points are only a count.</>,
        ]}
      />
      <Note title="Nothing is promised yet.">
        Points go toward a reward for early users. What it is, how much and when are not decided, and the rules may change before then.
      </Note>
    </Doc>
  );
}
