import { B, Bullets, Doc, FlowTree, Go, H2, H3, L, Note, P, Steps, Table } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('launching');

export default function Page() {
  return (
    <Doc
      slug="launching"
      lead={
        <>
          Anyone can launch a token from the <Go to="/launch">Launch</Go> page in one transaction. Every token pays the same 1% base fee. You
          choose its supply, whether to add a fee of your own on top, who that fee pays, and whether early buys pay more. None of it can change
          after launch, by you or anyone.
        </>
      }
      toc={[
        ['what-you-get', 'What a token is'],
        ['steps', 'Launching, step by step'],
        ['supply', 'Supply'],
        ['fee', 'The fee'],
        ['split', 'Who your own fee pays'],
        ['anti-snipe', 'Anti-snipe'],
        ['first-buy', 'Your first buy'],
        ['after', 'After launch'],
      ]}
    >
      <H2 id="what-you-get">What a token is</H2>
      <Bullets
        items={[
          'A fixed supply, minted once to the launchpad. There is no owner and no way to mint more.',
          'Nothing taken from a transfer, and no pause. Fees are charged by the curve and the pool, not by the token.',
          <>Coins a wallet gets from the curve or the pool can&apos;t leave it until the next block, which stops sandwich bots. See <L to="trading" at="sandwich">Sandwich protection</L>.</>,
          '80% is sold on the curve and 20% is held back to open its pool when 6,000 ZRO has been raised.',
          'A name, a ticker, and a link to its picture, description and links.',
        ]}
      />

      <H2 id="steps">Launching, step by step</H2>
      <Steps
        items={[
          <>Fill in a name (up to 48 characters on the site), a ticker (up to 16, no spaces) and, if you like, a description of up to 600 characters.</>,
          <>Add a picture: PNG, JPEG, WebP or GIF up to 2 MB, or a link to one. It is resized to 512 px. A GIF is kept whole. Add links to a website, X, Telegram or Discord.</>,
          'Pick a supply, your own fee if you want one, who it pays, and whether anti-snipe is on.',
          'Choose a first buy, or none.',
          <>Press launch. The picture and links are saved first, then one transaction creates the token and makes your first buy. Launching costs only gas today: the launch fee is 0, and the owner can raise it to at most 40 ZRO.</>,
        ]}
      />
      <P>
        You can also pick another connected launchpad on the same page. Its own rules then apply, not the ones below. See{' '}
        <L to="trading" at="other">Tokens from other launchpads</L>.
      </P>

      <H2 id="supply">Supply</H2>
      <P>
        Choose 1 billion, 10 billion, 100 billion or 1 trillion, or any whole number from 1 billion to 1 quadrillion. The supply changes the
        price per coin, never the market cap: every token opens at 1,875 ZRO and moves to its pool at 30,000 ZRO.
      </P>

      <H2 id="fee">The fee</H2>
      <P>
        Every trade of every token launched on Submarine pays a <B>1% base</B>, on the curve and later on its pool: <B>0.4%</B> to Submarine and{' '}
        <B>0.6%</B> to you, the creator. Nobody can change it. On top of it you may add a fee of your own. The site offers <B>none, 1%, 2%,
        3%, 5% and 10%</B>, and the contract takes any whole basis point up to 10%.
      </P>
      <Table
        cols={['Your own fee', 'A trader pays', 'Submarine', 'You, the base', 'Your own fee per 400 ZRO']}
        numeric={[1, 2, 3, 4]}
        rows={[
          ['None', '1%', '0.4%', '0.6%', '0'],
          ['1%', '2%', '0.4%', '0.6%', '4 ZRO'],
          ['2%', '3%', '0.4%', '0.6%', '8 ZRO'],
          ['3%', '4%', '0.4%', '0.6%', '12 ZRO'],
          ['5%', '6%', '0.4%', '0.6%', '20 ZRO'],
          ['10%', '11%', '0.4%', '0.6%', '40 ZRO'],
        ]}
        caption="Figure 1. The choices the site offers, for a trader without a rank. The pool takes the same, and adds no LP fee of its own."
      />
      <P>
        A higher own fee earns more per trade and costs traders more. A trader with a <L to="fees" at="ranks">volume rank</L> pays less, and
        it all comes off Submarine&apos;s 0.4%: your 0.6% and your own fee stay the same.
      </P>

      <H2 id="split">Who your own fee pays</H2>
      <P>
        Your own fee is split three ways. Pick <B>Pays you</B>, <B>Pays holders</B>, <B>Buys back</B> or <B>Mix</B>, and in Mix drag the bar
        or set each share in whole percent. The split covers your own fee only: the 1% base always goes 0.4% to Submarine and 0.6% to you. With
        no own fee there is nothing to split.
      </P>
      <Table
        cols={['Share', 'Where it goes']}
        rows={[
          ['Holders', <>Paid to everyone holding the token, in proportion, in ZRO. Turning this on makes it a holder token. See <L to="holder-rewards">Holder rewards</L>.</>],
          ['Buyback', <>Buys the token back in the same trade and sends it to the dead address. See <L to="buyback-and-burn">Buyback and burn</L>.</>],
          ['You', 'Whatever the other two leave. It builds up in the launchpad with your 0.6%, and you claim it from Portfolio.'],
        ]}
      />
      <FlowTree
        items={[
          {
            amount: '12 ZRO',
            label: 'A 3% fee on 400 ZRO traded on the curve: the 1% base and a 2% own fee',
            parts: [
              { amount: '1.6', label: 'To Submarine, 0.4% of the trade' },
              { amount: '2.4', label: 'To you, the 0.6% base' },
              {
                amount: '8',
                label: 'Your own fee',
                parts: [
                  { amount: '4', label: 'Holders, 50%' },
                  { amount: '4', label: 'Buyback, 50%' },
                ],
              },
            ],
          },
        ]}
        caption="Figure 2. A 2% own fee split 50% holders, 50% buyback, traded by a wallet without a rank."
      />

      <H2 id="anti-snipe">Anti-snipe</H2>
      <P>
        Bots try to buy in the first second. With anti-snipe on, a buy pays <B>50%</B> at launch, falling in a straight line to the
        token&apos;s normal fee over <B>60 seconds</B>. Submarine still takes only its 0.4%, and the extra goes where your own fee goes, or to you
        if you have none. Sales never pay it, and neither does your own first buy. The trade card says what a buy pays before anyone buys.
      </P>
      <Table
        cols={['Seconds after launch', 'Buy fee, no own fee', 'Buy fee, 2% own fee']}
        numeric={[0, 1, 2]}
        rows={[
          ['0', '50%', '50%'],
          ['10', '41.84%', '42.17%'],
          ['15', '37.75%', '38.25%'],
          ['30', '25.5%', '26.5%'],
          ['45', '13.25%', '14.75%'],
          ['59', '1.82%', '3.79%'],
          ['60 and after', '1%', '3%'],
        ]}
        caption="Figure 3. 50% minus (50% minus the fee) × seconds ÷ 60, rounded up to a whole basis point. A ranked trader pays their discount less."
      />

      <H2 id="first-buy">Your first buy</H2>
      <P>
        Pick 50, 200, 500 or 2,000 ZRO, or any amount. It happens in the same transaction that creates the token, so nobody can get in before
        you. It pays the normal fee. 400 ZRO on a fresh token with no own fee buys 176,293,823 of 1 billion, about 17.6%.
      </P>
      <Note title="Holders see your first buy.">
        The token page marks the creator&apos;s buys, sales, transfers and burns on the chart, and the Holders tab labels the creator as dev.
        A big first buy reads as a big risk to traders.
      </Note>

      <H2 id="after">After launch</H2>
      <H3>Claiming your share</H3>
      <P>
        Your 0.6% and your part of your own fee, on the curve and on the pool, wait in the launchpad. Claim them from{' '}
        <Go to="/portfolio">Portfolio</Go> whenever you like. One claim covers every token you launched. Every ZRO others trade on your coins
        also earns you <L to="points">points</L>.
      </P>
      <H3>What you can&apos;t change</H3>
      <P>
        Supply, own fee, split and anti-snipe are fixed for good. The 1% base and its 0.4% and 0.6% are constants in the launchpad and the
        pools&apos; hook, so the owner can&apos;t change them either, for your token or any other. You have no special power over the token
        after launch.
      </P>
    </Doc>
  );
}
