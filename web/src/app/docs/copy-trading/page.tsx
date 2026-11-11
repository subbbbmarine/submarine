import { B, Bullets, Doc, Go, H2, H3, L, Note, P, Steps, Table } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('copy-trading');

export default function Page() {
  return (
    <Doc
      slug="copy-trading"
      lead={
        <>
          There are two ways to copy a wallet. <B>Copy in the browser</B> trades from your own wallet while a tab is open. The{' '}
          <B>copy vault</B> keeps copying with every tab closed, from ZRO you deposit, within limits the contract enforces.
        </>
      }
      toc={[
        ['compare', 'The two ways side by side'],
        ['follow', 'Following a wallet'],
        ['browser', 'Copy in the browser'],
        ['vault', 'The copy vault'],
        ['rules', 'Vault rules'],
        ['example', 'A worked example'],
        ['sales', 'Copied sales'],
        ['exits', 'Take profit and stop loss'],
        ['money', 'Your money in the vault'],
      ]}
    >
      <H2 id="compare">The two ways side by side</H2>
      <Table
        cols={['', 'In the browser', 'Copy vault']}
        rows={[
          ['Runs', 'Only while a tab is open', 'Always, with the browser closed'],
          ['Trades from', 'Your wallet', 'ZRO you deposit in the vault'],
          ['Limits enforced by', 'This browser', 'The contract'],
          ['Cost per copy', 'Gas only', '0.04 ZRO to whoever runs it, and no gas for you'],
          ['How fast', 'As soon as the trade shows up', 'Within 30 blocks, about 30 seconds, of the leader\'s trade'],
          ['Where to set it', 'Tracked list', <Go key="c" to="/copy">Copy</Go>],
        ]}
      />

      <H2 id="follow">Following a wallet</H2>
      <P>
        Click any wallet to see its record, and press Follow to keep it under <B>Tracked</B> with a name you choose. Its trades show up the
        moment they land, one click from doing the same: a buy spends your quick size, a sale sells the share they sold. Follows are kept in
        this browser.
      </P>

      <H2 id="browser">Copy in the browser</H2>
      <P>Switch Copy on for the wallets you choose. It then trades for you, from your wallet, under these rules:</P>
      <Table
        cols={['Rule', 'Default or value']}
        rows={[
          ['Size of a copied buy', '20 ZRO, or a size per wallet'],
          ['Daily limit', '400 ZRO, then it stops for the day'],
          ['Copy their sales', 'On. A sale sells the share they sold, from 1% to 100%'],
          ['Oldest trade it copies', '60 seconds'],
          ['Buys of one token', 'At most one a minute'],
          ['Kept for gas', '1 ZRO'],
          ['Test sale', 'Leaves a token alone if a sale right after buying would revert or lose 15% or more'],
        ]}
      />
      <P>
        If you have several tabs open, only one of them copies, so nothing is bought twice. The test sale is the same check as{' '}
        <L to="trading" at="card">Sell right after</L>: a simulation for other launchpads&apos; tokens, worked out from the fees for tokens
        launched on Submarine. It holds at the moment of the check, and can&apos;t promise the token will still sell later.
      </P>

      <H2 id="vault">The copy vault</H2>
      <Steps
        items={[
          <>Deposit ZRO on the <Go to="/copy">Copy</Go> page. Depositing everything keeps 1 ZRO in your wallet for gas.</>,
          'Add a wallet to copy, with your rules for it.',
          'Optionally set a take profit and a stop loss for everything the vault holds for you.',
          'That\'s it. Copies run soon after the leader\'s trade, within 30 blocks (about 30 seconds), even with this tab closed.',
        ]}
      />
      <P>
        The vault trades through the router in your name, so its copies and exits add to your volume and{' '}
        <L to="fees" at="ranks">rank</L>, get your rank&apos;s discount, share with your referrer and earn you <L to="points">points</L>.
        They don&apos;t count as your own activity, so nobody copying you copies what the vault does for you.
      </P>
      <P>
        Anyone may run a copy and earn 0.04 ZRO for it, paid from your vault balance. Submarine&apos;s keeper does, and so may anyone
        else. Nobody needs to be trusted, because the contract only copies a trade the leader really made through the router, for
        themselves, in the last 30 blocks, and only inside your rules. Sending the leader tokens doesn&apos;t look like a buy, and a copy can
        only run once per leader trade.
      </P>

      <H2 id="rules">Vault rules</H2>
      <Table
        cols={['Rule', 'Default', 'What it does']}
        rows={[
          ['Size', '100%', 'The leader\'s ZRO times this, before the limits below. From 0.01% to 600%'],
          ['Per trade', '20 ZRO', 'Most one copied buy may spend'],
          ['Per token', '80 ZRO', 'Most copied into one token over time'],
          ['Per day', '200 ZRO', 'Most copied from this leader in a day (UTC)'],
          ['Slippage', '10%', 'How far the trade may slip from the quote when it runs. At most 50%'],
          ['Chase', '15%', 'How much worse than the leader\'s own price a copy may still buy or sell at. At most 100%'],
          ['Least sale', '50%', 'A copied sale never fetches less than this share of what the tokens cost'],
          ['Copy sales', 'On', 'Sell along with the leader'],
          ['First buy only', 'Off', 'Copy only the first buy of each token'],
          ['Token age', 'Any', 'Only tokens younger than 10 minutes, an hour or a day. Launchpad tokens only when set'],
        ]}
      />

      <H2 id="example">A worked example</H2>
      <P>
        You follow a wallet with size 25%, per trade 120 ZRO, per token 200 ZRO, per day 400 ZRO, and you have 800 ZRO in the vault. The
        leader buys a token with 800 ZRO.
      </P>
      <Table
        cols={['Step', 'ZRO']}
        numeric={[1]}
        rows={[
          ['Leader\'s buy × 25%', '200'],
          ['Capped by per trade', '120'],
          ['Room left in per token and per day', '200 and 400, so still 120'],
          ['Copy buys with', '120'],
          ['Run fee to whoever ran it', '0.04'],
          ['Left in your vault', '679.96'],
        ]}
        caption="Figure 1. The smallest of the sized amount, every limit and your balance wins."
      />
      <P>
        Before buying, the vault checks the price. A copy always comes after the leader, so it pays more. With a 15% chase it still buys as
        long as 120 ZRO gets at least 1/1.15 of the tokens it would have got at the leader&apos;s price, about 87%. Past that, it waits, and the
        chance passes once 30 blocks, about 30 seconds, have gone by.
      </P>

      <H2 id="sales">Copied sales</H2>
      <P>
        With Copy sales on, when the leader sells, the vault sells the same share of your position in that token. If the leader&apos;s
        holding fell more since your last copy, for example through a sale the vault missed, it sells that larger share. If the leader sold
        everything, it sells everything.
      </P>
      <P>
        Example: the leader sells 40% of their tokens. You hold 1,000,000 of that token in the vault, bought for 120 ZRO, so the vault sells
        400,000. With least sale at 50%, that sale never fetches less than 24 ZRO, half of the 48 ZRO those tokens cost.
      </P>
      <Note title="Positions are per token, not per leader.">
        If two leaders bought the same token for you, a sale by either sells that share of your whole position in it.
      </Note>

      <H2 id="exits">Take profit and stop loss</H2>
      <P>
        One setting covers every position in your vault. Each is measured against what that position cost. Both are off until you set them.
      </P>
      <Bullets
        items={[
          <>Take profit at 100% sells a whole position once it is worth twice what it cost. It can be set as high as 655%.</>,
          <>Stop loss at 30% sells a whole position once it is worth 30% less. It must be under 100%.</>,
          <>Exit slippage is 10% by default. Each exit pays the 0.04 ZRO run fee.</>,
        ]}
      />

      <H2 id="money">Your money in the vault</H2>
      <Bullets
        items={[
          'Take ZRO out at any time, to any address.',
          'Sell any part of a position yourself, at your own minimum, or take the tokens out to your wallet.',
          'Stop copying a leader at any time. Positions stay until you sell or take them out.',
          <>Tokens in the vault don&apos;t earn holder rewards. Take them out to your wallet to earn. See <L to="holder-rewards">Holder rewards</L>.</>,
        ]}
      />
      <H3>The risk</H3>
      <P>
        A leader can lose money, and you will too. A leader can also buy a token just to sell it to the people copying them. Set per token and
        per day limits you can afford to lose, keep chase modest, and use least sale and a stop loss.
      </P>
    </Doc>
  );
}
