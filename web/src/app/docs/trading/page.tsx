import { B, Bullets, C, Doc, Go, H2, H3, L, Note, P, Stats, Steps, Table } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('trading');

export default function Page() {
  return (
    <Doc
      slug="trading"
      lead={
        <>
          Every token launched here starts on a bonding curve: a contract that sells the token and buys it back at a price set by one formula.
          Each buy lifts the price and each sale lowers it. At 6,000 ZRO raised the token moves to a pool on its own, at the same price.
        </>
      }
      toc={[
        ['glance', 'At a glance'],
        ['curve', 'How the curve sets a price'],
        ['example', 'A worked example'],
        ['path', 'From launch to pool'],
        ['graduation', 'Moving to a pool'],
        ['after', 'Trading on a pool'],
        ['router', 'Best price and slippage'],
        ['sandwich', 'Sandwich protection'],
        ['card', 'The trade card'],
        ['progress', 'What happens after you press buy'],
        ['other', 'Tokens from other launchpads'],
      ]}
    >
      <H2 id="glance">At a glance</H2>
      <Stats
        items={[
          ['Opens at', '1,875 ZRO', 'Market cap, about $3K, whatever the supply'],
          ['Moves to a pool at', '6,000 ZRO raised', 'A market cap of 30,000 ZRO'],
          ['Sold on the curve', '80%', 'Of the supply. 20% opens the pool'],
          ['Virtual reserve', '2,000 ZRO', 'Sets the starting price'],
          ['Pool liquidity', 'Locked', 'Nobody can ever remove it'],
          ['Fee per trade', '1% base', 'Plus up to 10% the creator may add at launch'],
        ]}
      />

      <H2 id="curve">How the curve sets a price</H2>
      <P>
        The curve is a constant product, like a classic AMM pool, except one side starts with ZRO that isn&apos;t there: a virtual 2,000 ZRO. The other
        side holds 16/15 of the supply in virtual tokens. Multiply the two sides and you get a number that no trade can change. A buy adds
        ZRO, so fewer tokens are left, and each one costs more.
      </P>
      <P>
        Those two numbers are chosen so that every token opens at a market cap of <B>1,875 ZRO</B> and reaches <B>30,000 ZRO</B> exactly when
        it has sold 80% of its supply for 6,000 ZRO. A token with 1 trillion coins and one with 1 billion follow the same path in market cap. Only
        the price per coin differs.
      </P>
      <Table
        cols={['Raised', 'Share of supply sold', 'Market cap', 'Price, 1B supply']}
        numeric={[0, 1, 2, 3]}
        rows={[
          ['0 ZRO', '0%', '1,875 ZRO', '0.0000019 ZRO'],
          ['400 ZRO', '17.8%', '2,700 ZRO', '0.0000027 ZRO'],
          ['800 ZRO', '30.5%', '3,675 ZRO', '0.0000037 ZRO'],
          ['2,000 ZRO', '53.3%', '7,500 ZRO', '0.0000075 ZRO'],
          ['4,000 ZRO', '71.1%', '16,875 ZRO', '0.0000169 ZRO'],
          ['6,000 ZRO', '80.0%', '30,000 ZRO', '0.00003 ZRO'],
        ]}
        caption="Figure 1. The same curve for every token. Market cap is (2,000 + raised)² × 3 / 6,400 ZRO."
      />
      <P>
        Early buyers pay much less than late ones: the first 400 ZRO buys almost 18% of the supply, and the last 400 ZRO buys about 1.4%.
      </P>

      <H2 id="example">A worked example</H2>
      <P>A fresh token with the default terms: a supply of 1 billion and no own fee, so just the 1% base. You buy with 400 ZRO.</P>
      <Table
        cols={['Step', 'Amount']}
        numeric={[1]}
        rows={[
          ['You send', '400 ZRO'],
          ['Fee, 1% of the trade', '4 ZRO'],
          ['Into the curve', '396 ZRO'],
          ['Tokens you get', '176,293,823'],
          ['Average price you paid', '0.0000023 ZRO'],
          ['Market cap after', '2,691 ZRO'],
        ]}
        caption="Figure 2. One buy of 400 ZRO on a fresh token with no own fee, by a wallet without a rank."
      />
      <P>
        Sell all 176,293,823 straight back and the curve returns 396 ZRO, less the 1% fee on the sale, so you get <B>392.04 ZRO</B>. The two
        fees are the whole cost of the round trip. Where those fees go, and how a volume rank lowers them, is on <L to="fees">Fees</L>.
      </P>
      <P>
        Later buys get fewer tokens for the same ZRO. With 4,000 ZRO already raised, 400 ZRO buys about 22,013,759 tokens, an eighth of what
        it bought at the start.
      </P>

      <H2 id="path">From launch to pool</H2>
      <Steps
        items={[
          <>The creator launches it, often with a first buy in the same transaction, so nobody can buy before them. See <L to="launching">Launching a token</L>.</>,
          'Anyone buys and sells on the curve. The price follows Figure 1.',
          'The buy that brings the raise to 6,000 ZRO only pays for what was left. The rest of its ZRO comes back in the same transaction.',
          'That same buy moves the token to its pool. Trading carries on there without a pause.',
        ]}
      />
      <H3>The last buy, worked out</H3>
      <P>
        5,800 ZRO is raised and you send 400 ZRO at a 1% fee, a token with no own fee. Only 200 ZRO fits, so the contract takes <B>202.02 ZRO</B> (200 ZRO plus its 1%
        fee), gives you the last 6,837,607 tokens on the curve, and sends <B>197.98 ZRO</B> back.
      </P>

      <H2 id="graduation">Moving to a pool</H2>
      <P>
        The 6,000 ZRO raised and the 20% of the supply held back open a pool on PancakeSwap Infinity at exactly the price the curve ended on,
        so there is no jump for a bot to catch. They go in as one position over the whole price range, owned by Submarine&apos;s pools contract,
        which has no way to take it out. The pool refuses liquidity from anyone else and refuses every removal, so this liquidity stays for
        good.
      </P>
      <P>
        The token&apos;s fee doesn&apos;t change at the move. The pool&apos;s hook takes the same 1% base and own fee the curve did,
        Submarine&apos;s 0.4% included, so everyone keeps the same share, as <L to="fees" at="pool">Fees</L> shows. Only graduation can open a Submarine pool for one of these tokens, so nobody can set one up at a skewed price. Pools someone
        makes elsewhere, including plain Infinity pools without Submarine&apos;s hook, are not Submarine&apos;s, and the router doesn&apos;t trade
        on them.
      </P>

      <H2 id="after">Trading on a pool</H2>
      <P>
        A pool runs on PancakeSwap Infinity&apos;s concentrated-liquidity engine, but with its one position spread over the whole price range
        it prices like a constant product, with real ZRO and the token on its two sides. It has no fee of its own. Its hook, Submarine&apos;s
        pools contract, takes the token&apos;s fee on the ZRO side of every trade, through any router or straight on Infinity. The first 400
        ZRO buy on a freshly graduated pool of a 1 billion supply token with no own fee gets about 12.38 million tokens.
      </P>
      <P>
        For now the graduation&apos;s position is the only liquidity in each pool. Positions of your own, over a price range you choose, are
        planned for later.
      </P>

      <H2 id="router">Best price and slippage</H2>
      <P>
        Every trade from Submarine goes through the router. It asks every connected market for a price and trades on the best. A token on
        its curve trades on the curve and a token with a pool trades on the pool. A market that quotes well and then fails is passed over for
        the next one.
      </P>
      <P>
        Your slippage limit is a minimum the contracts enforce: if the price moves past it before your trade lands, the trade fails and you
        only lose the gas. The router checks what actually arrived in your wallet, not what a market claims it sent.
      </P>
      <P>
        The default is <B>Auto</B>, which lets the price slip <B>1%</B> at most. Zero&apos;s blocks come a fraction of a second apart, so a
        fresh quote hardly moves before the trade lands, and a tight limit leaves a bot nothing to take. Pick 3% or 10% for a token moving
        fast. Every trade through the router also adds to your volume, which lowers your fee as it passes each{' '}
        <L to="fees" at="ranks">rank</L>, and earns <L to="points">points</L>.
      </P>

      <H2 id="sandwich">Sandwich protection</H2>
      <P>
        A sandwich is a bot buying just before your buy and selling just after it, in the same block, to pocket the price your buy moved.
        Tokens launched on Submarine stop it in the token itself: a wallet that got coins from the curve or the pool can&apos;t send or sell any
        of that token until the next block. The bot&apos;s sale after yours would revert, so the risk-free version of the trade is gone.
      </P>
      <Bullets
        items={[
          'It applies to every token launched here, plain and holder tokens alike, for good.',
          'The next block is a fraction of a second later, so a person trading by hand never notices.',
          'Coins sent to you by another wallet don\'t hold you. Only coins straight from the curve or the pool do.',
          'The curve and the pool themselves are never held, so the market keeps trading with everyone in the same block.',
          <>A contract that buys and sells in one transaction fails with <C>BoughtThisBlock</C>. See <L to="launch-from-code" at="buy-sell">Buy and sell</L>.</>,
        ]}
      />
      <P>
        Tokens from other launchpads follow their own contracts, which may have no such protection. A tight slippage limit is the defence
        there.
      </P>

      <H2 id="card">The trade card</H2>
      <Table
        cols={['Setting', 'Choices', 'Default']}
        rows={[
          ['Buy amount', '50, 200, 500, 2,000 ZRO or Max (your balance less 1 ZRO for gas)', 'Your quick size, 50 ZRO'],
          ['Sell amount', '25%, 50%, 75%, All, or Paid in (sells what you paid back out)', ''],
          ['Slippage', 'Auto (1%), 3% or 10%', 'Auto'],
          ['Presets P1 to P3', 'An amount and a slippage each. Double click to edit', '20 ZRO at 3%, 80 at 10%, 400 at 20%'],
          ['Mode', 'Market, Limit, or TP / SL', 'Market'],
        ]}
      />
      <Bullets
        items={[
          <><B>Price impact</B> turns red above 5%.</>,
          <>
            <B>Sell right after</B> says what a sale straight after your buy would bring back. For a token from another launchpad it is a
            test sale: Submarine asks the chain to buy and sell back in one call, through the same contract. For a token launched here the
            one-block hold would stop that test, and the contract is Submarine&apos;s and can&apos;t tax or block a sale, so the figure is worked
            out from its fees. It warns if the sale would revert or lose 15% or more. It runs as you type and every 12 seconds. It&apos;s a
            check at that moment and can&apos;t promise the token will still sell later.
          </>,
          <>A trade has 120 seconds to land, then it expires and fails.</>,
          <>While anti-snipe is on, a banner says what a buy pays right now.</>,
        ]}
      />

      <H2 id="progress">What happens after you press buy</H2>
      <P>Each trade shows its real progress, timed in your browser:</P>
      <Table
        cols={['Stage', 'What it means']}
        rows={[
          ['Sent', 'The node has your transaction'],
          ['In a block', 'It is in a block'],
          ['Executed', 'It ran, and you can see whether it succeeded. Only this tells you that'],
        ]}
      />
      <P>Submarine estimates the gas for each trade and adds 20%, so it still goes through if the state moves a little before it lands.</P>

      <H2 id="other">Tokens from other launchpads</H2>
      <P>
        The list shows every new token on the chain, wherever it launched, found by watching the chain itself, so nothing here is checked or
        endorsed. You can launch on any connected launchpad from the <Go to="/launch">Launch</Go> page and trade its tokens from here, with
        their chart, holders and trades like any other, and Submarine adds no fee of its own.
      </P>
      <P>
        Someone else&apos;s launchpad sets its own curve, fees and what happens at the end. Its tokens trade on its contract, not through our
        router, so limit orders aren&apos;t available for them. The test sale still runs against its contract before you buy. A token from
        a launchpad that isn&apos;t connected becomes tradable once its launchpad is connected. Submarine pools are only for tokens that
        graduated here.
      </P>
      <Note title="A price on screen is not a promise.">
        Most new tokens lose most of their value, and a curve only buys back at its formula&apos;s price. Read <L to="risks">Risks</L> before
        you trade. Builders can find the formulas in the <L to="reference" at="launchpad">contract reference</L>, and <C>Launchpad.sol</C>{' '}
        has them in full.
      </Note>
    </Doc>
  );
}
