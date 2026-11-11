import { B, C, Code, Doc, H2, H3, L, Note, P, Steps, Table } from '../_ui/doc';
import { ZERO_CHAIN_ID, ZERO_RPC } from '../_ui/deployment';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('keepers');

export default function Page() {
  return (
    <Doc
      slug="keepers"
      lead={
        <>
          Filling limit orders, raising trailing stops, copying leaders for copy-vault followers and selling at their take profit or stop loss
          are all open to anyone, and most of them pay. The contracts check every condition themselves, so a keeper is a convenience, not a
          party anyone has to trust.
        </>
      }
      toc={[
        ['what-pays', 'What pays'],
        ['orders', 'Filling orders'],
        ['copies', 'Running copies and exits'],
        ['run-ours', 'Running Submarine\'s keeper'],
        ['your-own', 'Writing your own'],
        ['costs', 'Costs and races'],
      ]}
    >
      <H2 id="what-pays">What pays</H2>
      <Table
        cols={['Call', 'Contract', 'Pays the caller']}
        rows={[
          [<C key="1">fill(id, part)</C>, 'LimitOrders', 'The order\'s run fee, 0.04 ZRO per whole order by default, shared across its parts'],
          [<C key="2">fillBatch(ids, parts)</C>, 'LimitOrders', 'The same, for each part that fills'],
          [<C key="3">poke(ids)</C>, 'LimitOrders', 'Nothing. It raises trailing stops\' highs'],
          [<C key="4">copyBuy(follower, leader, token)</C>, 'CopyVault', '0.04 ZRO, from the follower'],
          [<C key="5">copySell(follower, leader, token)</C>, 'CopyVault', '0.04 ZRO, from the follower'],
          [<C key="6">exit(follower, token)</C>, 'CopyVault', '0.04 ZRO, from the follower'],
          [<C key="7">claimFor(holder)</C>, 'HolderToken', 'Nothing. Sends a holder\'s rewards to the holder'],
          [<C key="8">collectProtocolFees()</C>, 'Launchpad', 'Nothing. Moves the treasury\'s fees to the treasury'],
        ]}
      />
      <P>
        An order&apos;s run fee is fixed when it is placed: the owner can raise it to at most 0.4 ZRO for new orders, never for open ones. A
        copy-vault run fee is a constant.
      </P>

      <H2 id="orders">Filling orders</H2>
      <P>
        <C>openIds(from, count)</C> lists open orders in a range, <C>getOrder(id)</C> returns one, and <C>available(id)</C> says how much of it
        may trade now, which for a sale group is capped by what the group still holds.
      </P>
      <Table
        cols={['Kind', 'Fills when', 'Checked']}
        rows={[
          ['0 Limit', 'The market pays at least the minimum, after fees and the run fee', 'By the trade itself'],
          ['1 Stop', 'A part would fetch no more than its share of trigger, and still at least its minimum', 'After the sale, against what it really fetched'],
          ['2 Trailing', 'What it fetches is trailBps below the high, per token', 'After the sale'],
          ['3 On graduation', 'The token has moved to its pool', 'Before trading'],
          ['4 On dev sale', 'The creator holds trigger tokens or fewer', 'Before trading'],
          ['5 DCA', 'At least interval seconds since the last part, and a part is at most total ÷ slices', 'Before trading'],
        ]}
      />
      <P>
        An expired order can always be filled: the call closes it and refunds the owner, and pays nothing. A part&apos;s minimum and its run
        fee both scale with its size and round up. Every buy moves the price against the next, so a large order at a near level often fills
        only as far as its level allows. Find that amount by bisection, as Submarine&apos;s keeper does, rather than trying the whole.
      </P>
      <Note title="Simulate each fill on its own.">
        <C>fillBatch</C> wraps each fill in try and catch, so estimating gas for a batch finds the least gas at which the batch succeeds,
        which can be too little for any fill to go through. Estimate fills one at a time and send the batch with their sum.
      </Note>
      <H3>Trailing stops</H3>
      <P>
        A trailing stop&apos;s high only counts once it is on chain. <C>poke(ids)</C> raises each high to what its remaining tokens would fetch
        now. It pays nothing, so Submarine&apos;s keeper pokes at most every ten seconds.
      </P>

      <H2 id="copies">Running copies and exits</H2>
      <Steps
        items={[
          <>Rebuild who follows whom from the vault&apos;s <C>Followed</C>, <C>Unfollowed</C> and <C>ExitSet</C> events.</>,
          <>
            Watch the router&apos;s <C>Routed</C> events. When a followed leader buys or sells, call <C>copyBuy</C> or <C>copySell</C> for each
            follower within 30 blocks.
          </>,
          <>
            For followers with an exit set, call <C>exit</C> on their positions now and then. It reverts unless take profit or stop loss has
            been reached, so simulate first: a simulation is free.
          </>,
        ]}
      />
      <P>
        The vault checks everything again: that the leader really traded through the router for itself, that this trade wasn&apos;t copied
        already, the follower&apos;s limits, how far the price has moved from the leader&apos;s, and the slippage. Most attempts are a normal
        &quot;no&quot;, which costs nothing when simulated.
      </P>

      <H2 id="run-ours">Running Submarine&apos;s keeper</H2>
      <P>
        The keeper in <C>keeper/src/index.ts</C> does all of the above in one loop: orders, then copies, then exits, every second. It reads
        the contract addresses from <C>contracts/deployments/&lt;chain id&gt;.json</C>. Its defaults point at a local test chain. On Zero&apos;s
        testnet set <C>CHAIN_ID=1337</C> and <C>RPC_URL=https://testnet.zero.layerzero.network</C>.
      </P>
      <Table
        cols={['Variable', 'Default', 'What']}
        rows={[
          [<C key="1">KEEPER_PRIVATE_KEY</C>, 'required', 'The key that sends fills and earns the fees. Fund it with a little ZRO for gas'],
          [<C key="2">RPC_URL</C>, <C key="2b">http://127.0.0.1:8546</C>, <>The node. Set it to Zero&apos;s, <C key="2c">{ZERO_RPC}</C></>],
          [<C key="3">CHAIN_ID</C>, '31337', <>Which deployment file to read. Set it to <C key="3c">{ZERO_CHAIN_ID}</C></>],
          [<C key="4">KEEPER_POLL_MS</C>, '1000', 'Pause between rounds'],
          [<C key="5">LOG_LEVEL</C>, 'info', 'pino log level'],
        ]}
      />
      <Code
        lang="powershell"
        title="Windows PowerShell"
        code={`npm.cmd install
$env:KEEPER_PRIVATE_KEY = "0x..."; npm.cmd run dev --workspace=keeper`}
      />
      <Code
        lang="bash"
        title="macOS or Linux"
        code={`npm install
KEEPER_PRIVATE_KEY=0x... npm run dev --workspace=keeper`}
      />
      <P>
        It fills up to 32 orders per transaction, skips a part smaller than a twentieth of its order (its share of the run fee would not pay
        for the gas), and checks exits every five seconds.
      </P>

      <H2 id="your-own">Writing your own</H2>
      <Code
        lang="ts"
        title="Fill whatever can fill, one simulation each"
        code={`import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const chain = { id: ${ZERO_CHAIN_ID}, name: 'Zero', nativeCurrency: { name: 'ZRO', symbol: 'ZRO', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const client = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(KEY) });

const LIMITS = parseAbi([
  'function ordersCount() view returns (uint256)',
  'function openIds(uint256 from, uint256 count) view returns (uint256[])',
  'function available(uint256 id) view returns (uint256)',
  'function fill(uint256 id, uint256 part) returns (uint256, uint256)',
]);

const count = await client.readContract({ address: LIMIT_ORDERS, abi: LIMITS, functionName: 'ordersCount' });
const ids = await client.readContract({ address: LIMIT_ORDERS, abi: LIMITS, functionName: 'openIds', args: [0n, count] });
for (const id of ids) {
  const part = await client.readContract({ address: LIMIT_ORDERS, abi: LIMITS, functionName: 'available', args: [id] });
  try {
    const { request } = await client.simulateContract({ address: LIMIT_ORDERS, abi: LIMITS, functionName: 'fill', args: [id, part], account: wallet.account });
    await wallet.writeContract(request);
  } catch {
    // not yet: condition or minimum not met
  }
}`}
      />

      <H2 id="costs">Costs and races</H2>
      <P>
        Gas is paid in ZRO. Submarine&apos;s keeper adds 20% to each estimate, so a fill still lands if the state moves a little.
      </P>
      <P>
        Anyone can run the same fill. The first to land gets the fee, and the others revert and pay their gas. A copy can only run once per
        leader trade per follower, and an order part only once. Simulate right before sending and stop when a simulation fails.
      </P>
      <P>
        A runner whose address refuses ZRO doesn&apos;t block a copy: the vault holds the fee as <C>runnerCredit</C>, collected later with{' '}
        <C>collectRunnerCredit(to)</C>. In LimitOrders the keeper&apos;s payment has a gas cap, so a keeper that refuses ZRO just can&apos;t
        fill.
      </P>
      <P>
        <B>Next:</B> launching and trading from code is on <L to="launch-from-code">Launch and trade from code</L>, and the events behind all
        of this are on <L to="events">Events to index</L>.
      </P>
    </Doc>
  );
}
