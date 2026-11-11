import { Addresses } from '../_ui/Addresses';
import { SUBMARINE_API, ZERO_CHAIN_ID, ZERO_RPC } from '../_ui/deployment';
import { B, C, Code, Doc, H2, L, P, Table } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('contracts');

export default function Page() {
  return (
    <Doc
      slug="contracts"
      lead={
        <>
          Eight contracts of its own make up Submarine, all on Zero, and its pools run on two more from PancakeSwap Infinity&apos;s core, which
          Submarine deploys there itself. None of them is a proxy, so the code at each address is the code that runs, for good. Submarine is not
          deployed on Zero yet: the addresses and the network settings are filled in at launch.
        </>
      }
      toc={[
        ['addresses', 'Addresses'],
        ['network', 'The network'],
        ['how-they-fit', 'How they fit together'],
        ['infinity', 'Pools on PancakeSwap Infinity'],
        ['wiring', 'Set once at deployment'],
        ['json', 'In your own code'],
      ]}
    >
      <H2 id="addresses">Addresses</H2>
      <P>
        Once Submarine is deployed, the list below is read live from the API&apos;s <C>/health</C> route, which serves the deployment file
        for Zero&apos;s chain ID. Indexing starts at the block the contracts were deployed in.
      </P>
      <Addresses />

      <H2 id="network">The network</H2>
      <Table
        cols={['Setting', 'Value']}
        rows={[
          ['Chain id', <C key="c">{ZERO_CHAIN_ID}</C>],
          ['Currency', 'ZRO, used for gas, trading and fees'],
          ['RPC', <C key="r">{ZERO_RPC}</C>],
          ['Mainnet', 'Scheduled for November 30, 2026'],
        ]}
      />
      <P>
        These are Zero&apos;s testnet settings from LayerZero&apos;s own chain list; its RPC answers only developers LayerZero has let in, and
        mainnet&apos;s aren&apos;t public yet. The site sends its own
        requests through <C>/api/rpc</C> on the same domain. A script or a server can use the RPC directly.
      </P>

      <H2 id="how-they-fit">How they fit together</H2>
      <Table
        cols={['Contract', 'Talks to', 'Holds money?']}
        rows={[
          ['Launchpad', 'ZroInfinityPools (opens a pool at graduation), Referrals, the treasury, the router (asks who is trading)', 'ZRO raised on every curve, unclaimed creator fees, treasury fees until collected'],
          ['ZroInfinityPools', 'Infinity\'s CLPoolManager (as every pool\'s hook) and Vault, Launchpad (pays each token\'s fee back to its earners and the terminal\'s cut to the treasury), the router (asks who is trading, for its rank)', 'Fees not yet paid out, as claims on Infinity\'s vault, and a few wei left from rounding when each pool opened'],
          ['ZroInfinityVenue', 'Infinity\'s Vault and CLPoolManager (each trade), ZroInfinityPools (quotes, and paying out the fee after each trade)', 'Nothing between calls'],
          ['Infinity Vault', 'CLPoolManager, the only app registered on it', 'Every pool\'s ZRO and tokens'],
          ['Infinity CLPoolManager', 'The Vault, and each pool\'s hook', 'Nothing. The Vault holds the money'],
          ['Router', 'Every listed venue, Referrals, the treasury', 'Nothing between calls'],
          ['LimitOrders', 'Router, Launchpad (graduation and creator checks), the treasury', 'Escrow of open orders, and ZRO a wallet refused'],
          ['CopyVault', 'Router (the leader\'s trades and every copy), Launchpad (token age)', 'Followers\' ZRO and positions'],
          ['BuybackVault', 'Router (its buybacks)', 'The treasury'],
          ['Referrals', 'Nothing. It only receives', 'Unclaimed referral earnings'],
        ]}
      />
      <P>
        Every place a token can trade has the same four functions, the <C>IVenue</C> interface: <C>quoteBuy</C>, <C>quoteSell</C>,{' '}
        <C>buy</C> and <C>sell</C>. The Launchpad and ZroInfinityVenue are venues, and so is the Router, which makes &quot;the best price
        anywhere&quot; one more venue for limit orders and agents. See the <L to="reference">contract reference</L>.
      </P>

      <H2 id="infinity">Pools on PancakeSwap Infinity</H2>
      <P>
        A graduated token trades on a pool on PancakeSwap Infinity, a concentrated-liquidity engine with hooks. Submarine deploys Infinity&apos;s
        core on Zero itself, unmodified, from pancakeswap/infinity-core-bsc-base at commit 7c04695: the <B>Vault</B>, which holds every
        pool&apos;s money, and the <B>CLPoolManager</B>, which runs the pools. <C>ZroInfinityPools</C> is the hook of every Submarine pool: it
        opens the pool at graduation with one locked position, refuses any other liquidity, and takes the token&apos;s fee on every trade.{' '}
        <C>ZroInfinityVenue</C> is how the router trades them. It is separate from the hook because Infinity doesn&apos;t call a hook for
        swaps the hook makes itself.
      </P>
      <P>
        Why Infinity: Uniswap v4&apos;s core is under the Business Source License until 2027-06-15, so running it in production before then
        needs a grant from Uniswap governance. Infinity&apos;s core is GPL-2.0-or-later and may run in production. The two Submarine contracts
        that import it are GPL-2.0-or-later too.
      </P>
      <P>
        Submarine&apos;s deployer owns the Vault and the CLPoolManager. What that lets it do, and the plan to move it to a multisig, is on{' '}
        <L to="risks" at="owner">Risks</L>.
      </P>

      <H2 id="wiring">Set once at deployment</H2>
      <P>Some links can only be made after both contracts exist. Each of these is a one-shot setter that reverts if called again:</P>
      <Table
        cols={['Call', 'What it fixes']}
        rows={[
          [<C key="1">ZroInfinityPools.setLaunchpad</C>, 'The only contract allowed to open a pool for a graduated token'],
          [<C key="2">Launchpad.setRouter</C>, 'The router the launchpad and the pools ask for the real trader, for referrals and ranks'],
          [<C key="3">BuybackVault.setRouter</C>, 'The router the treasury buys through'],
          [<C key="4">BuybackVault.setBuybackToken</C>, 'The one token the treasury may ever buy and burn'],
          [<C key="5">Launchpad.setNotEarning</C>, 'Router, LimitOrders, BuybackVault, CopyVault, ZroInfinityVenue and Infinity\'s Vault, which hold or pass holder tokens through without earning on them'],
          [<C key="7">Router.setForwarders</C>, 'LimitOrders and CopyVault, the only contracts that may trade in a user\'s name, so those trades count for the user'],
          [<C key="6">Router.finishSetup</C>, 'Ends free listing. Any venue after this waits 2 days in public first'],
        ]}
      />
      <P>
        The deploy script lists two venues on the router, the Launchpad and ZroInfinityVenue as &quot;Submarine Pools&quot;, both with a
        router fee of <B>0</B>, fixed for good: the curve and the hook each take Submarine&apos;s 0.4% themselves, less the trader&apos;s rank
        discount, and pay it to the treasury. It also registers the CLPoolManager on Infinity&apos;s Vault, the one app the vault serves.
      </P>

      <H2 id="json">In your own code</H2>
      <P>Read the live list instead of copying addresses, so a redeploy doesn&apos;t break your code:</P>
      <Code
        lang="ts"
        code={`const res = await fetch('${SUBMARINE_API}/health');
const { chainId, deployment } = await res.json();
// deployment: { chainId, startBlock, launchpad, pools, poolVenue, infinityVault, poolManager,
//               router, limitOrders, vault, copyVault, referrals }`}
      />
      <P>
        <C>pools</C> is ZroInfinityPools, the hook. <C>poolVenue</C> is ZroInfinityVenue. <C>infinityVault</C> and <C>poolManager</C> are
        Infinity&apos;s Vault and CLPoolManager. <C>vault</C> is still the treasury, the BuybackVault.
      </P>
      <P>
        The same file is in the repository at <C>contracts/deployments/&lt;chain id&gt;.json</C>, which is what the indexer, the keeper and
        the site all read. The API&apos;s address is filled in at launch.
      </P>
    </Doc>
  );
}
