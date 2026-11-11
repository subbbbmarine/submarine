import { B, Bullets, Doc, H2, L, Note, P, Table } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('risks');

export default function Page() {
  return (
    <Doc
      slug="risks"
      lead={
        <>
          Read this before you put money in. It says what can go wrong, what Submarine&apos;s owner can and can&apos;t do, and what nobody
          can do at all.
        </>
      }
      toc={[
        ['risks', 'Risks'],
        ['owner', 'What the owner can do'],
        ['cannot', 'What the owner cannot do'],
        ['nobody', 'What nobody can do'],
        ['markets', 'Adding a market'],
        ['keepers', 'Keepers and the site'],
      ]}
    >
      <H2 id="risks">Risks</H2>
      <Bullets
        items={[
          <><B>Not audited.</B> These contracts have not been audited. Don&apos;t put in money you can&apos;t lose.</>,
          <><B>Pools on another engine.</B> Graduated tokens trade on PancakeSwap Infinity&apos;s core, which Submarine deploys on Zero itself. The core is PancakeSwap&apos;s code, unmodified, but this deployment and Submarine&apos;s hook on it are new and unaudited.</>,
          <><B>A new chain.</B> Zero&apos;s mainnet is scheduled for November 30, 2026, and Submarine is not deployed on it yet. A new chain and new contracts have had little time to show their faults.</>,
          <><B>Most new tokens fail.</B> Most lose most of their value. A price on screen is not a promise that you can sell at it.</>,
          <><B>Other launchpads are not checked.</B> Tokens from elsewhere are found on the chain and listed as they are. Their rules are their own.</>,
          <><B>A sale check is a moment.</B> It works out selling right after buying. It can&apos;t promise the token will still sell later.</>,
          <><B>Bought coins wait a block.</B> Coins of a token launched on Submarine that a wallet got from the curve or the pool can&apos;t move until the next block. That stops sandwich bots, and it also makes any contract or script that buys and then sells or sends in the same block fail.</>,
          <><B>Points are not a promise.</B> Points are counted by Submarine&apos;s indexer, not by a contract. They go toward a reward for early users that hasn&apos;t been announced, and the rules may change. See <L to="points">Points</L>.</>,
          <><B>Figures are estimates.</B> Profit uses current prices and leaves out gas. Dollar amounts use a public ZRO price for display; every trade settles in ZRO.</>,
          <><B>Keys in the browser.</B> A wallet made here lives in this browser, encrypted with your PIN. While a tab is unlocked, anyone at this computer can trade from it, and nobody can recover a lost key or a forgotten PIN.</>,
          <><B>Copying loses too.</B> A leader can lose, or buy a token only to sell it to the people copying them.</>,
        ]}
      />

      <H2 id="owner">What the owner can do</H2>
      <Table
        cols={['Contract', 'The owner can', 'Within']}
        rows={[
          ['Launchpad', 'Change the launch fee', 'At most 40 ZRO. Today 0. This is the only setting it has'],
          ['Router', 'Change a market\'s router fee', 'Only on other launchpads, at most 1%. It is fixed at 0 on the curve and the pools, which take Submarine\'s 0.4% themselves. The 0.4% can\'t change'],
          ['Router', 'Name the contracts that trade in a user\'s name', 'Once only, at deployment: LimitOrders and CopyVault'],
          ['Router', 'Remove a market', 'At once, as the emergency action'],
          ['Router', 'Add a market', 'Only after announcing it in public 2 days ahead'],
          ['LimitOrders', 'Change the order fee and the run fee', 'At most 1% and 0.4 ZRO, for new orders only. Today 0 and 0.04 ZRO'],
          ['BuybackVault', 'Choose who runs buybacks', 'Buybacks stay capped at 10% of the balance an hour'],
          ['BuybackVault', 'Choose the one token it buys and burns', 'Once only, never again'],
          ['Infinity CLPoolManager', 'Pause it', 'Stops every trade on every graduated pool until it unpauses. The buy that would fill a curve fails too, since graduation adds liquidity'],
          ['Infinity CLPoolManager', 'Name a protocol-fee controller', 'The controller can then charge up to 0.4% of each swap on these pools, on top of the token\'s fee, and collect it. None is named today'],
          ['Infinity Vault', 'Register an app, a contract allowed to keep balances in the vault', 'Only the CLPoolManager is registered. The vault keeps each app\'s balances apart'],
        ]}
      />
      <P>
        Submarine&apos;s deployer owns Infinity&apos;s Vault and CLPoolManager on Zero, as it owns the rest. These are owner powers in
        Infinity&apos;s code, not Submarine&apos;s. Ownership of all of them is to move to a multisig before mainnet. That is a plan, and it
        isn&apos;t done yet.
      </P>

      <H2 id="cannot">What the owner cannot do</H2>
      <Bullets
        items={[
          'Take ZRO out of the treasury. It has no withdraw function at all.',
          'Change where fees go, or change the treasury\'s address.',
          'Change the 1% base fee or its split, 0.4% to Submarine and 0.6% to the creator, for any token, on the curve or the pool. They are constants in the launchpad and the hook.',
          'Change a token\'s supply, own fee, split or anti-snipe after launch.',
          'Move the volume marks of the ranks or their discounts, or lower anyone\'s volume. They are fixed in the router\'s code.',
          'Mint tokens, pause them, or take anything from a transfer.',
          'Withdraw a graduated token\'s pool. Its liquidity is one position owned by the pools contract, which has no way to remove it, and the pool refuses every removal.',
          'Change a graduated token\'s fee on its pool. It is frozen when the pool opens, and the pool\'s own LP fee is 0 for good. Infinity\'s protocol fee, above, is the one fee that could be added.',
          'Touch your limit orders, your copy vault, or your referral earnings.',
          'Change the copy vault or the referral contract in any way. Neither has an owner.',
          'Upgrade any contract. None is a proxy.',
        ]}
      />

      <H2 id="nobody">What nobody can do</H2>
      <Bullets
        items={[
          'Make a wallet look like it bought, to trigger copy trading. Only a trade the wallet made through the router for itself counts.',
          'Fill your order below the minimum you set.',
          'Open a Submarine pool for a token before it graduates, or add liquidity to one after.',
          'Claim holder rewards or creator fees for someone else\'s benefit. A claim always pays the owner.',
        ]}
      />

      <H2 id="markets">Adding a market</H2>
      <P>
        A market listed on the router receives the trades routed to it and is bound only by each trade&apos;s slippage limit. That is the
        power that matters, so a new market must be announced in public and can only be listed 2 days later. That gives anyone time to look
        at it, and to leave. Removing a market is instant.
      </P>

      <H2 id="keepers">Keepers and the site</H2>
      <P>
        Order fills, copies and exits are run by a keeper, but anyone may run them and the contracts check every condition. If
        Submarine&apos;s keeper stops, someone else can carry on, and you can always cancel orders and withdraw from the copy vault yourself.
      </P>
      <P>
        The site and its API are a convenience too. Your tokens, orders and vault balance live in the contracts, which you can use without
        them. See <L to="contracts">Contract addresses</L>.
      </P>
      <Note title="When in doubt, trade small.">Learn how it behaves before anything you would mind losing.</Note>
    </Doc>
  );
}
