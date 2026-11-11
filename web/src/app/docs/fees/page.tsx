import { B, C, Doc, FlowTree, H2, L, Note, P, Table } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('fees');

export default function Page() {
  return (
    <Doc
      slug="fees"
      lead={
        <>
          Every token launched on Submarine pays the same 1% base fee on every trade: 0.4% to Submarine and 0.6% to the token&apos;s creator. Nobody
          can change it. On top of that the creator may add a fee of their own, up to 10%, and split it between holders, a buyback that burns
          the token, and themselves. The more a wallet trades through Submarine, the smaller Submarine&apos;s 0.4% gets.
        </>
      }
      toc={[
        ['summary', 'Every fee in one table'],
        ['base', 'The 1% base'],
        ['own', 'The creator\'s own fee'],
        ['curve', 'Where a fee goes on the curve'],
        ['pool', 'Where a fee goes on a pool'],
        ['ranks', 'Volume ranks'],
        ['referred', 'When you were referred'],
        ['other', 'Orders, copies and launches'],
        ['treasury', 'What Submarine does with its cut'],
        ['gas', 'Gas'],
      ]}
    >
      <H2 id="summary">Every fee in one table</H2>
      <Table
        cols={['What', 'You pay', 'Goes to']}
        rows={[
          ['A trade on a curve', 'The 1% base, plus the creator\'s own fee if any', '0.4% to the treasury, 0.6% to the creator, the own fee where the creator said'],
          ['A trade on a pool', 'The same fee, nothing more', 'The same places, all taken by the pool\'s hook. The pool has no LP fee'],
          ['A buy in the first 60 s', 'Up to 50% if the creator turned anti-snipe on', 'The extra goes where the own fee goes'],
          ['A ranked wallet\'s trade', '0.05% to 0.25% less', 'Comes off Submarine\'s 0.4% only'],
          ['A limit order', '0.04 ZRO per order', 'Whoever fills it, shared across its parts'],
          ['A copy-vault copy or exit', '0.04 ZRO each', 'Whoever runs it'],
          ['Launching a token', 'Nothing today, just gas', 'The owner may set up to 40 ZRO'],
          ['Transfers', 'No Submarine fee', 'Only gas'],
        ]}
      />
      <P>
        Tokens from other launchpads trade on their own contracts at their own fees. Submarine adds nothing to those.
      </P>

      <H2 id="base">The 1% base</H2>
      <P>
        The base is the same on every token launched on Submarine, and it is written into the launchpad as constants: <C>BASE_FEE_BPS = 100</C>,{' '}
        <C>PROTOCOL_BPS = 40</C> and <C>CREATOR_BASE_BPS = 60</C>. The pools&apos; hook, <C>ZroInfinityPools</C>, has the same{' '}
        <C>PROTOCOL_BPS = 40</C>. The owner has no function that changes them, for new tokens or old ones. They apply on the curve and on the
        pool, whether a trade comes through Submarine or straight to the contract.
      </P>
      <Table
        cols={['Part', 'Of each trade', 'Per 400 ZRO traded']}
        numeric={[1, 2]}
        rows={[
          ['Submarine (the treasury)', '0.4%', '1.6 ZRO'],
          ['The token\'s creator', '0.6%', '2.4 ZRO'],
          ['All of the base', '1%', '4 ZRO'],
        ]}
        caption="Figure 1. The base, on a buy and on a sale alike. A ranked wallet's trade sends less to Submarine."
      />
      <P>
        Both parts are shares of the trade, not of the fee. The creator&apos;s 0.6% is theirs whatever they choose for the rest, and is
        claimable from Portfolio.
      </P>

      <H2 id="own">The creator&apos;s own fee</H2>
      <P>
        At launch the creator may add a fee of their own on top of the base. The site offers none, 1%, 2%, 3%, 5% and 10%. The contract takes
        any figure from 0 to 1,000 basis points. It never changes after launch.
      </P>
      <Table
        cols={['Own fee', 'Total a trade pays', 'Submarine', 'Creator\'s base', 'Own fee']}
        numeric={[1, 2, 3, 4]}
        rows={[
          ['None', '1%', '1.6', '2.4', '0'],
          ['1%', '2%', '1.6', '2.4', '4'],
          ['2%', '3%', '1.6', '2.4', '8'],
          ['3%', '4%', '1.6', '2.4', '12'],
          ['5%', '6%', '1.6', '2.4', '20'],
          ['10%', '11%', '1.6', '2.4', '40'],
        ]}
        caption="Figure 2. In ZRO, per 400 ZRO traded by a wallet without a rank. A buy's fee is on the ZRO you send, a sale's on the ZRO the curve pays out."
      />
      <P>
        The creator splits the own fee three ways: a share to the token&apos;s <L to="holder-rewards">holders</L>, a share that{' '}
        <L to="buyback-and-burn">buys the token back and burns it</L>, and the rest to themselves. The split covers the own fee only. The 1%
        base always goes 0.4% and 0.6%. A token with no own fee has nothing to split, so all of its fee is the base.
      </P>

      <H2 id="curve">Where a fee goes on the curve</H2>
      <P>
        Take a token with a 2% own fee whose creator gave 50% of it to holders and 50% to the burn. A wallet without a rank buys with 400 ZRO.
        The whole fee is 3%:
      </P>
      <FlowTree
        items={[
          { amount: '400 ZRO', label: 'Sent by the buyer', parts: [{ amount: '388', label: 'Into the curve, for tokens' }] },
          {
            amount: '12 ZRO',
            label: 'The fee, 3%',
            parts: [
              { amount: '1.6', label: 'Submarine, 0.4% of the trade' },
              { amount: '2.4', label: 'Creator, the 0.6% base, claimable from Portfolio' },
              {
                amount: '8',
                label: 'The creator\'s own fee, 2%',
                parts: [
                  { amount: '4', label: 'Holders, 50%, added to their rewards at once' },
                  { amount: '4', label: 'Burn, 50%, buys tokens on the curve with no fee and sends them to the dead address' },
                ],
              },
            ],
          },
        ]}
        caption="Figure 3. 400 ZRO bought on the curve of a token with a 2% own fee split 50 / 50."
      />
      <P>
        A sale works the same way on the ZRO the curve pays out. The same buy by a wallet of the Regular rank pays 2.9%: Submarine gets 1.2 ZRO,
        and the creator, holders and burn get exactly the same as above.
      </P>

      <H2 id="pool">Where a fee goes on a pool</H2>
      <P>
        After the move to a PancakeSwap Infinity pool, the pool&apos;s hook takes the whole fee itself, the same 1% base and the same own fee
        as on the curve, out of the ZRO side of the swap. The router adds nothing, and the pool has no LP fee. The hook pays Submarine&apos;s 0.4%,
        less any rank discount, to the launchpad for the treasury, buys the token back and burns the buyback&apos;s part right after the
        trade, and sends the rest to the launchpad for the creator and the holders. The same token, the same 400 ZRO buy:
      </P>
      <FlowTree
        items={[
          { amount: '1.6 ZRO', label: 'Submarine, 0.4% of 400 ZRO, taken by the hook and paid to the treasury through the launchpad' },
          {
            amount: '10.4 ZRO',
            label: 'Earners\' cut, 2.6% of 400 ZRO: the 0.6% base and the 2% own fee',
            parts: [
              { amount: '4', label: 'Burn, bought back from the pool right after the trade' },
              { amount: '4', label: 'Holders, their half of the own fee' },
              { amount: '2.4', label: 'Creator, the 0.6% base' },
            ],
          },
          { amount: '388 ZRO', label: 'Buys tokens' },
        ]}
        caption="Figure 4. The same buy after graduation. All in, 3%, the same as on the curve."
      />
      <Note title="The fee is paid whoever trades.">
        The hook takes the token&apos;s fee inside the swap itself, so a trade through another router, or straight on PancakeSwap Infinity,
        pays Submarine, the creator and the holders the same. Going around Submarine only loses a rank discount. The fees of those trades reach the
        treasury, holders, the burn and the creator when anyone runs <C>distribute</C>, which Submarine&apos;s own trades do every time.
      </Note>
      <P>
        Infinity&apos;s own protocol fee is off on these pools. Who could turn it on, and how far, is on <L to="risks" at="owner">Risks</L>.
      </P>

      <H2 id="ranks">Volume ranks</H2>
      <P>
        The router keeps a count of the ZRO each wallet has traded through it, buys and sales, for good. It never goes down. Past each mark
        Submarine&apos;s cut on that wallet&apos;s trades gets smaller:
      </P>
      <Table
        cols={['Rank', 'From', 'Submarine\'s cut', 'Total on a token with no own fee']}
        numeric={[1, 2, 3]}
        rows={[
          ['Starter', '0 ZRO', '0.40%', '1.00%'],
          ['Trader', '2,000 ZRO', '0.35%', '0.95%'],
          ['Regular', '10,000 ZRO', '0.30%', '0.90%'],
          ['Pro', '40,000 ZRO', '0.25%', '0.85%'],
          ['Whale', '200,000 ZRO', '0.20%', '0.80%'],
          ['Legend', '1,000,000 ZRO', '0.15%', '0.75%'],
        ]}
        caption="Figure 5. The marks are fixed in the router's code. Nobody can move them."
      />
      <P>
        The discount comes off Submarine&apos;s cut only, so you pay less and the creator&apos;s share is unchanged. It counts on the curve and on
        the pool, which both ask the router whose trade it is and what that wallet&apos;s rank takes off. A rank applies from the trade after
        the one that passes its mark.
      </P>
      <P>
        Only trades through the router count, which is every trade the site makes. Limit orders and copy-vault copies and exits count too:
        those contracts trade through the router in your name, with <C>buyFor</C> and <C>sellFor</C>, so the trade adds to your volume and
        gets your discount. A trade sent straight to the launchpad or a pool pays the full 0.4%, and neither counts nor gets the discount. Your
        profile in Portfolio, the wallet panel and every public trader page shows your volume on a scale with a mark for each rank, and{' '}
        <B>Save card</B> makes a picture of your rank to share. Trading through Submarine also earns <L to="points">points</L>.
      </P>

      <H2 id="referred">When you were referred</H2>
      <P>
        If you linked to a referrer, 40% of Submarine&apos;s cut of your trades goes to the referral contract instead of the treasury:
        three quarters to your referrer and one quarter back to you. Your fee doesn&apos;t change.
      </P>
      <FlowTree
        items={[
          {
            amount: '1.6 ZRO',
            label: 'Submarine\'s cut of a 400 ZRO trade, without a rank',
            parts: [
              { amount: '0.96', label: 'Treasury, 60%' },
              {
                amount: '0.64',
                label: 'Referrals, 40%',
                parts: [
                  { amount: '0.48', label: 'Your referrer, 75%' },
                  { amount: '0.16', label: 'Back to you, 25%' },
                ],
              },
            ],
          },
        ]}
        caption="Figure 6. The creator's base and own fee are untouched by referrals. With a rank, it is 40% of the smaller cut, on the curve and on the pool alike."
      />
      <P>
        More on <L to="referrals">Referrals</L>.
      </P>

      <H2 id="other">Orders, copies and launches</H2>
      <P>
        <B>Limit orders</B> add no fee of their own today: the order trades through the router and pays the usual fees there. Whoever fills it
        earns the run fee, <B>0.04 ZRO</B> per order, taken from the order and shared across its parts. The owner can raise it to at most
        0.4 ZRO and add a fee of at most 1% for new orders, never for open ones. See <L to="orders">Limit orders</L>.
      </P>
      <P>
        <B>Copy-vault</B> copies and exits each pay <B>0.04 ZRO</B> from your vault balance to whoever runs them. Copying in the browser
        costs nothing extra. See <L to="copy-trading">Copy trading</L>.
      </P>
      <P>
        <B>Launching</B> has a launch fee of 0 today. The owner can set it with <C>setLaunchFee</C>, up to 40 ZRO at most. It is the only fee
        the owner can change on the launchpad.
      </P>

      <H2 id="treasury">What Submarine does with its cut</H2>
      <P>
        Every Submarine fee goes to the treasury, a contract that can only buy one token and burn it, at most 10% of its balance an hour. It
        has no way to withdraw, for the owner or anyone. That token isn&apos;t chosen yet, so for now the fees only accumulate. See{' '}
        <L to="buyback-and-burn" at="treasury">Buyback and burn</L>.
      </P>
      <P>
        Submarine&apos;s 0.4% can&apos;t change, on the curve or on the pool: the launchpad and the hook both take it as a constant. The router
        lists both, Submarine Launchpad and Submarine Pools, at a router fee of 0, fixed for good at deployment (<C>feeFixed</C>). A router fee is
        only for other launchpads&apos; venues, capped at 1% and public in <C>venueAt</C> and the <C>VenueUpdated</C> event. Every trade
        still has your own minimum as a floor.
      </P>

      <H2 id="gas">Gas</H2>
      <P>
        Every transaction pays gas in ZRO. Submarine estimates each trade and adds 20%, so it still goes through if the state moves a little
        before it lands. A failed trade still costs its gas.
      </P>
      <P>
        Builders: a trade sent to the launchpad or a pool directly, through <C>ZroInfinityVenue</C> or Infinity&apos;s pool manager, pays the
        same fee as one through the router, the full 0.4% included, since a rank discount only applies through the router. It doesn&apos;t
        count toward a rank. The site always uses the router, to get the best price.
      </P>
    </Doc>
  );
}
