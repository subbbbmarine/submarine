import type { ReactNode } from 'react';
import { C, Code, Doc, H2, L, Note, P, Table } from '../_ui/doc';
import { ZERO_RPC } from '../_ui/deployment';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('events');

type Ev = [string, string, ReactNode];

function Events({ rows }: { rows: Ev[] }) {
  return (
    <div className="mt-4 space-y-2">
      {rows.map(([name, sig, what]) => (
        <div key={name} className="rounded-xl border border-white/[.06] px-3.5 py-3">
          <p className="font-semibold text-ink">{name}</p>
          <code className="num mt-1 block break-words text-[13px] leading-relaxed text-accent/90">{sig}</code>
          <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{what}</p>
        </div>
      ))}
    </div>
  );
}

export default function Page() {
  return (
    <Doc
      slug="events"
      lead={
        <>
          Everything Submarine shows is rebuilt from these events, so an indexer of your own can show the same. This is the list the
          indexer reads, from <C>indexer/src/chain.ts</C>, grouped by the contract that emits it.
        </>
      }
      toc={[
        ['reading', 'Reading them'],
        ['launchpad', 'Launchpad'],
        ['tokens', 'Tokens'],
        ['pools', 'ZroInfinityPools'],
        ['router', 'Router'],
        ['orders', 'LimitOrders'],
        ['copy', 'CopyVault'],
        ['treasury', 'BuybackVault'],
        ['referrals', 'Referrals'],
        ['decoding', 'Decoding with viem'],
      ]}
    >
      <H2 id="reading">Reading them</H2>
      <P>
        Start at the block the contracts were deployed in, the <C>startBlock</C> in the deployment file, and read forward with{' '}
        <C>eth_getLogs</C> in ranges your RPC accepts. Filter by the contract addresses on <L to="contracts">Contract addresses</L> and by
        topic. Amounts are in wei and tokens have 18 decimals.
      </P>
      <Note title="One trade can emit several events.">
        A buy through the router on a curve emits the launchpad&apos;s <C>Trade</C> and <C>EarnersPaid</C>, the token&apos;s{' '}
        <C>Transfer</C>s, and the router&apos;s <C>Routed</C>. A trade on a graduated token&apos;s pool emits the hook&apos;s <C>Swap</C>,
        then, when its fees are paid out, the hook&apos;s <C>Burned</C> and the launchpad&apos;s <C>EarnersPaid</C>, <C>PoolFeePaid</C> and{' '}
        <C>ProtocolFeeFromPool</C>. Count a trade once, from the venue&apos;s event, and use <C>Routed</C> to learn whose trade it was. When
        the venue saw the router as its trader, the real one is the <C>trader</C> on <C>Routed</C> in the same transaction, even for a limit
        order or a copy made in a user&apos;s name.
      </Note>

      <H2 id="launchpad">Launchpad</H2>
      <Events
        rows={[
          ['TokenLaunched', 'TokenLaunched(address indexed token, address indexed creator, string name, string symbol, string uri, uint256 timestamp, uint256 supply, uint16 feeBps, uint16 holdersBps, uint16 burnBps, bool antiSnipe)', 'A new token and its terms, which never change. feeBps is the whole fee a trader without a rank pays: 100 for the base plus the creator\'s own fee. holdersBps and burnBps are shares of the own fee. The uri is the metadata link, see the API\'s /meta route.'],
          ['Trade', 'Trade(address indexed token, address indexed trader, bool isBuy, uint256 zroAmount, uint256 tokenAmount, uint256 fee, uint256 toTreasury, uint256 raisedAfter, uint256 soldAfter)', 'A trade on a curve. On a buy, zroAmount includes the fee. On a sale, it is what the seller got, after the fee. toTreasury is the part of fee that went to the treasury after any referral share. raisedAfter and soldAfter give the price after the trade.'],
          ['EarnersPaid', 'EarnersPaid(address indexed token, uint256 toCreator, uint256 toHolders, uint256 toBurn, uint256 burned)', 'Where everything but the terminal\'s cut went. toCreator is the creator\'s 0.6% base plus their part of the own fee. toBurn is ZRO that bought burned tokens on the curve and sent them to the dead address; on a pool the hook burns that part itself, so toBurn is 0 there.'],
          ['Graduated', 'Graduated(address indexed token, uint256 zroToPool, uint256 tokensToPool)', 'The curve filled: 6,000 ZRO and 20% of the supply opened its pool.'],
          ['PoolFeePaid', 'PoolFeePaid(address indexed token, uint256 amount)', 'A graduated token\'s fee from its pool reached the launchpad when distribute ran, and was paid to its holders and creator (with an EarnersPaid just before it). The buyback part was already burned by the hook.'],
          ['ProtocolFeeFromPool', 'ProtocolFeeFromPool(address indexed token, uint256 toTreasury)', 'The terminal\'s 0.4% of pool trades, less any rank discount, which the hook took and handed to the launchpad when distribute ran. toTreasury is what is left after any referral share, added to the treasury\'s fees.'],
          ['CreatorFeesClaimed', 'CreatorFeesClaimed(address indexed creator, uint256 amount)', 'A creator took their fees.'],
          ['ProtocolFeesCollected', 'ProtocolFeesCollected(address indexed treasury, uint256 amount)', 'Fees pushed to the treasury.'],
          ['LaunchFeeUpdated', 'LaunchFeeUpdated(uint256 launchFee)', 'The owner changed the fee to launch, at most 40 ZRO. The trading fees have no event because they can\'t change. The indexer doesn\'t read it.'],
        ]}
      />

      <H2 id="tokens">Tokens</H2>
      <Events
        rows={[
          ['Transfer', 'Transfer(address indexed from, address indexed to, uint256 value)', 'Standard ERC-20. Balances, holders, the creator\'s transfers and burns all come from this. The indexer leaves out the zero address, the dead address and Submarine\'s own contracts when it counts holders.'],
          ['RewardsAdded', 'RewardsAdded(uint256 amount)', 'HolderToken only. ZRO added for holders.'],
          ['RewardsClaimed', 'RewardsClaimed(address indexed holder, uint256 amount)', 'HolderToken only. A holder took rewards.'],
        ]}
      />

      <H2 id="pools">ZroInfinityPools</H2>
      <P>
        Emitted by the pools contract, the hook of every graduated token&apos;s pool, at the <C>pools</C> address in the deployment file. The
        fields are the same as the constant-product pools these replaced had, so a reader built for those keeps working. Infinity&apos;s
        CLPoolManager also emits events of its own for the same pools, in its own terms.
      </P>
      <Events
        rows={[
          ['PoolCreated', 'PoolCreated(address indexed token, address indexed by, bool graduated)', 'A graduated token\'s pool opened on Infinity. by is the launchpad and graduated is always true: no other pools open here.'],
          ['Swap', 'Swap(address indexed token, address indexed trader, bool isBuy, uint256 zroAmount, uint256 tokenAmount, uint256 reserveZro, uint256 reserveToken)', 'A trade on a pool, emitted for every trade, through Submarine\'s venue, another router or Infinity directly. On a buy, zroAmount is what went into the pool, the token\'s fee included; on a sale, what the trader got, after it. That fee includes the terminal\'s 0.4%, which the hook takes itself: the router adds no fee of its own here. trader is the recipient Submarine\'s venue names, or whoever called Infinity\'s pool manager otherwise. The reserves are what the pool\'s liquidity is worth at the price after the trade, so their ratio is the price.'],
          ['Burned', 'Burned(address indexed token, uint256 zro, uint256 tokens)', 'The burn share of a graduated token\'s fee bought tokens back from its pool and sent them to the dead address, when distribute ran. zro is what it spent.'],
          ['LiquidityAdded', 'LiquidityAdded(address indexed token, address indexed provider, uint256 zro, uint256 tokens, uint256 sharesMinted)', 'Once per pool, at graduation: the locked position going in. provider is the dead address, since nobody can take it out, and sharesMinted is the position\'s liquidity.'],
        ]}
      />
      <P>
        There is no <C>LiquidityRemoved</C> any more: nothing can be removed from these pools.
      </P>

      <H2 id="router">Router</H2>
      <Events
        rows={[
          ['Routed', 'Routed(address indexed token, address indexed trader, address indexed venue, bool isBuy, uint256 zroAmount, uint256 tokenAmount, uint256 fee)', 'A trade through the router: whose trade it was, which venue won, and the router fee, 0 on Submarine\'s own curve and pools. trader is the user for a limit order or a copy, and on a direct sale it is the seller, not the recipient. On a buy, zroAmount is what the trader spent after any refund. The indexer counts points from this.'],
          ['RankUp', 'RankUp(address indexed trader, uint256 rank, uint256 volume)', 'A wallet\'s volume through the router passed a mark: 2,000, 10,000, 40,000, 200,000 or 1,000,000 ZRO. rank is 1 to 5, volume the wallet\'s total after the trade, in wei. The new rank counts from its next trade. The indexer doesn\'t read it: the site asks the router for volumeOf instead.'],
          ['VenueQueued', 'VenueQueued(bytes32 indexed id, address indexed venue, uint16 feeBps, string name, uint256 listableAt)', 'A venue was announced. Watch this one: it can be listed at listableAt, 2 days later.'],
          ['VenueListed / VenueUpdated / VenueRemoved / VenueQueueCancelled / SetupFinished', 'VenueListed(uint256 indexed index, address indexed venue, uint16 feeBps, string name) …', 'Changes to the venue list.'],
        ]}
      />

      <H2 id="orders">LimitOrders</H2>
      <Events
        rows={[
          ['Placed', 'Placed(uint256 indexed id, address indexed owner, address indexed token, bool isBuy, uint256 amount, uint256 minOut, uint256 expiry)', 'A new order. amount is ZRO for a buy and tokens for a sale. expiry 0 means none.'],
          ['Conditions', 'Conditions(uint256 indexed id, uint8 kind, uint256 trigger, uint16 trailBps, uint32 interval, uint16 slices, uint256 group)', 'What a non-limit order waits for. kind: 0 limit, 1 stop, 2 trailing, 3 on graduation, 4 on dev sale, 5 DCA. group is the first leg\'s id for a sale group.'],
          ['Filled', 'Filled(uint256 indexed id, uint256 zroSide, uint256 tokenSide, address indexed by)', 'A fill or part of one, and who made it.'],
          ['Closed', 'Closed(uint256 indexed id, bool expired)', 'Filled in full, cancelled, or closed after expiry.'],
          ['Peak', 'Peak(uint256 indexed id, uint256 value)', 'A trailing stop\'s high moved up.'],
          ['Credited / Withdrawn', 'Credited(address indexed owner, uint256 amount) · Withdrawn(address indexed owner, address indexed to, uint256 amount)', 'ZRO a wallet refused, held for it, and later taken out.'],
          ['Config', 'Config(uint16 feeBps, uint256 runFee)', 'New fees for orders placed from now on.'],
        ]}
      />

      <H2 id="copy">CopyVault</H2>
      <Events
        rows={[
          ['Deposited / Withdrawn', 'Deposited(address indexed follower, uint256 amount) · Withdrawn(address indexed follower, address to, uint256 amount)', 'ZRO in and out. This Withdrawn has the same signature as LimitOrders\' but a different indexed field, so decode by address.'],
          ['Followed / Unfollowed', 'Followed(address indexed follower, address indexed leader, (uint128 perTrade, uint128 perToken, uint128 perDay, uint16 sizeBps, uint16 slippageBps, uint16 chaseBps, uint16 minSellBps, bool buyOnce, bool copySells, uint32 maxAge) rules)', 'A follow with its rules, or the end of one.'],
          ['ExitSet', 'ExitSet(address indexed follower, (uint16 takeProfitBps, uint16 stopLossBps, uint16 slippageBps) exit)', 'Take profit and stop loss.'],
          ['CopiedBuy / CopiedSell', 'CopiedBuy(address indexed follower, address indexed leader, address indexed token, uint256 zro, uint256 tokens, address by)', 'A copy ran, and who ran it.'],
          ['Exited', 'Exited(address indexed follower, address indexed token, bool takeProfit, uint256 zro, uint256 tokens, address by)', 'A position sold at take profit or stop loss.'],
          ['Sold / TokensWithdrawn', 'Sold(address indexed follower, address indexed token, uint256 zro, uint256 tokens) · TokensWithdrawn(address indexed follower, address indexed token, address to, uint256 tokens)', 'The follower sold or took out tokens.'],
          ['RunnerCredited', 'RunnerCredited(address indexed runner, uint256 amount)', 'A runner refused its run fee, so it was held for it.'],
        ]}
      />
      <P>The vault trades through the router in the follower&apos;s name, so the <C>Routed</C> of a copy or an exit already names the follower as its trader. LimitOrders does the same for the order&apos;s owner.</P>

      <H2 id="treasury">BuybackVault</H2>
      <Events
        rows={[
          ['Buyback', 'Buyback(address indexed token, uint256 zroSpent, uint256 tokensBurned)', 'The treasury bought its token and burned it.'],
          ['BuybackTokenSet / RouterSet / KeeperUpdated', 'BuybackTokenSet(address token) · RouterSet(address router) · KeeperUpdated(address keeper)', 'Setup, and who may run buybacks.'],
        ]}
      />

      <H2 id="referrals">Referrals</H2>
      <Events
        rows={[
          ['Linked', 'Linked(address indexed trader, address indexed referrer)', 'A trader linked to a referrer, for good.'],
          ['Credited', 'Credited(address indexed trader, address indexed referrer, uint256 toReferrer, uint256 toTrader)', 'A referred trade paid its share: 75% to the referrer and 25% back to the trader.'],
          ['Claimed', 'Claimed(address indexed who, uint256 amount)', 'Earnings taken.'],
        ]}
      />

      <H2 id="decoding">Decoding with viem</H2>
      <Code
        lang="ts"
        code={`import { createPublicClient, http, parseAbiItem } from 'viem';

const client = createPublicClient({ transport: http('${ZERO_RPC}') });
const trade = parseAbiItem(
  'event Trade(address indexed token, address indexed trader, bool isBuy, uint256 zroAmount, uint256 tokenAmount, uint256 fee, uint256 toTreasury, uint256 raisedAfter, uint256 soldAfter)',
);

let from = START_BLOCK; // startBlock from the deployment file
const head = await client.getBlockNumber();
while (from <= head) {
  const to = from + 999n > head ? head : from + 999n; // 1,000 blocks per call
  const logs = await client.getLogs({ address: LAUNCHPAD, event: trade, fromBlock: from, toBlock: to });
  for (const l of logs) console.log(l.args.token, l.args.isBuy, l.args.zroAmount);
  from = to + 1n;
}`}
      />
      <P>The start block comes with Submarine&apos;s deployment on Zero. The RPC above is Zero&apos;s testnet, which answers developers LayerZero has let in.</P>
      <P>
        Don&apos;t want to run your own? The <L to="api">public API</L> serves the same data already worked out, and its live stream pushes
        each event as it lands.
      </P>
    </Doc>
  );
}
