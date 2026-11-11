import { B, C, Code, Doc, H2, L, Note, P, Table } from '../_ui/doc';
import { SUBMARINE_API, ZERO_CHAIN_ID, ZERO_RPC } from '../_ui/deployment';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('launch-from-code');

export default function Page() {
  return (
    <Doc
      slug="launch-from-code"
      lead={
        <>
          Everything the site does is a plain contract call. These examples use <C>viem</C> and a key in an environment variable. Swap in a
          browser wallet and they work the same. Zero&apos;s RPC and chain ID and Submarine&apos;s API address are placeholders, filled in at
          launch.
        </>
      }
      toc={[
        ['setup', 'Set up'],
        ['metadata', 'Save the picture and links'],
        ['launch', 'Launch a token'],
        ['first-buy', 'The first buy, worked out'],
        ['quote', 'Quote'],
        ['buy-sell', 'Buy and sell'],
        ['read', 'Read a curve'],
        ['claim', 'Claim fees and rewards'],
        ['orders', 'Place an order'],
        ['referral', 'Link a referrer'],
        ['errors', 'When a call reverts'],
      ]}
    >
      <H2 id="setup">Set up</H2>
      <Code
        lang="ts"
        code={`import { createPublicClient, createWalletClient, http, parseAbi, parseEther, parseEventLogs, formatEther, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPC = '${ZERO_RPC}';
const chain = { id: ${ZERO_CHAIN_ID}, name: 'Zero', nativeCurrency: { name: 'ZRO', symbol: 'ZRO', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const client = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(process.env.KEY as \`0x\${string}\`) });

// Read the addresses live, so a redeploy doesn't break this.
const { deployment } = await (await fetch('${SUBMARINE_API}/health')).json();
const LAUNCHPAD = deployment.launchpad as Address;
const ROUTER = deployment.router as Address;

const PAD = parseAbi([
  'function launch(string name, string symbol, string uri, uint256 minTokensOut, uint256 wholeSupply, uint16 devFeeBps, uint16 holdersBps, uint16 burnBps, bool antiSnipe) payable returns (address)',
  'function launchFee() view returns (uint256)',
  'function curves(address) view returns (address creator, uint40 createdAt, bool graduated, uint16 feeBps, uint16 holdersBps, uint16 burnBps, bool antiSnipe, uint128 raised, uint128 sold, uint128 supply, uint16 protocolBps)',
  'function priceOf(address) view returns (uint256)',
  'function buyFeeBps(address) view returns (uint256)',
  'function buyFeeBpsFor(address token, address trader) view returns (uint256)',
  'function claimCreatorFees()',
  'function creatorFees(address) view returns (uint256)',
  'event TokenLaunched(address indexed token, address indexed creator, string name, string symbol, string uri, uint256 timestamp, uint256 supply, uint16 feeBps, uint16 holdersBps, uint16 burnBps, bool antiSnipe)',
]);
const ROUTER_ABI = parseAbi([
  'function quoteBuy(address token, uint256 zroIn) view returns (uint256)',
  'function quoteSell(address token, uint256 tokensIn) view returns (uint256)',
  'function buy(address token, uint256 minOut, address recipient, uint256 deadline) payable returns (uint256)',
  'function sell(address token, uint256 tokensIn, uint256 minOut, address recipient, uint256 deadline) returns (uint256)',
  'function volumeOf(address) view returns (uint256)',
  'function rankOf(address) view returns (uint256)',
  'function discountOf(address) view returns (uint256)',
]);
const ERC20 = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);`}
      />

      <H2 id="metadata">Save the picture and links</H2>
      <P>
        A picture is too big for the chain, so it is saved first and the token carries a short link to it. The answer&apos;s <C>uri</C> is
        what goes into <C>launch</C>. You can also pass any picture link of your own as the uri and skip this.
      </P>
      <Code
        lang="ts"
        code={`const meta = await fetch('${SUBMARINE_API}/api/v1/meta', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    image: 'data:image/png;base64,iVBORw0…',   // PNG, JPEG, WebP or GIF, 2 MB at most
    description: 'A token about cats.',      // 600 characters at most
    website: 'https://example.com',
    twitter: 'https://x.com/example',
  }),
}).then((r) => r.json());
// meta.uri is the link to launch with`}
      />

      <H2 id="launch">Launch a token</H2>
      <Table
        cols={['Argument', 'Allowed', 'Example']}
        rows={[
          [<C key="1">name</C>, '1 to 64 bytes (the site stops at 48 characters)', '"Cat Coin"'],
          [<C key="2">symbol</C>, '1 to 16 bytes', '"CAT"'],
          [<C key="3">uri</C>, 'At most 512 bytes', 'meta.uri'],
          [<C key="4">wholeSupply</C>, '10⁹ to 10¹⁵ whole tokens', '1_000_000_000n'],
          [<C key="5">devFeeBps</C>, 'Your own fee on top of the 1% base: 0 to 1,000 (none to 10%)', '200'],
          [<C key="6">holdersBps, burnBps</C>, 'Shares of your own fee only, adding up to 10,000 or less. You get the rest. Both 0 when devFeeBps is 0', '5000, 5000'],
          [<C key="7">antiSnipe</C>, 'Buys pay 50% at launch, falling to the token\'s fee over 60 seconds', 'false'],
          [<C key="8">value</C>, 'launchFee() plus your first buy, if any', 'launchFee + 200 ZRO'],
        ]}
      />
      <Code
        lang="ts"
        code={`const launchFee = await client.readContract({ address: LAUNCHPAD, abi: PAD, functionName: 'launchFee' });
const firstBuy = parseEther('200');

const hash = await wallet.writeContract({
  address: LAUNCHPAD,
  abi: PAD,
  functionName: 'launch',
  args: ['Cat Coin', 'CAT', meta.uri, minFirstBuy, 1_000_000_000n, 200, 5000, 5000, false], // 2% own fee, half to holders, half to the burn
  value: launchFee + firstBuy,
});
const receipt = await client.waitForTransactionReceipt({ hash });

// The new token's address is on the TokenLaunched event.
const [launched] = parseEventLogs({ abi: PAD, logs: receipt.logs, eventName: 'TokenLaunched' });
const token = launched.args.token;
// launched.args.feeBps is 300: the 1% base plus the 2% own fee.`}
      />
      <P>
        The 1% base is fixed and isn&apos;t an argument: 0.4% of each trade goes to Submarine and 0.6% to you, on the curve and later on the
        pool, whatever you choose for the rest.
      </P>
      <Note title="The first buy can't be front-run.">
        It happens in the same transaction that creates the token, so nobody can buy before you. It never pays the anti-snipe rate.
      </Note>

      <H2 id="first-buy">The first buy, worked out</H2>
      <P>
        There is no token to quote yet, so work out <C>minTokensOut</C> from the curve itself. These are the contract&apos;s own formulas,
        rounding the same way:
      </P>
      <Code
        lang="ts"
        code={`function firstBuyOut(zroIn: bigint, feeBps: bigint, wholeSupply: bigint): bigint {
  const supply = wholeSupply * 10n ** 18n;
  const vTokens = (supply * 16n) / 15n;            // VIRTUAL_TOKENS
  const vZro = parseEther('2000');                 // VIRTUAL_ZRO, in ZRO
  const fee = (zroIn * feeBps + 9999n) / 10000n;    // rounded up. feeBps is the whole fee: 100 + devFeeBps
  const net = zroIn - fee;
  const left = (vZro * vTokens + (vZro + net) - 1n) / (vZro + net); // rounded up
  return vTokens - left;
}

const expected = firstBuyOut(parseEther('200'), 300n, 1_000_000_000n); // 100 base + 200 own
const minFirstBuy = (expected * 99n) / 100n; // allow 1%`}
      />
      <P>
        On a fresh token with no own fee (1% in all) and a supply of 1 billion, 400 ZRO buys <B>176,293,823</B> tokens: the fee is 4 ZRO, 396 ZRO goes into
        the curve, and the market cap moves from 1,875 ZRO to about 2,691 ZRO.
      </P>

      <H2 id="quote">Quote</H2>
      <P>
        Quote through the router. It asks every venue and answers with the best price after every fee, whether the token is still on its
        curve or already in a pool.
      </P>
      <Code
        lang="ts"
        code={`const out = await client.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'quoteBuy', args: [token, parseEther('40')] });
const back = await client.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'quoteSell', args: [token, out] });
console.log(formatEther(out), 'tokens for 40 ZRO, which sell back for', formatEther(back));`}
      />

      <H2 id="buy-sell">Buy and sell</H2>
      <Code
        lang="ts"
        code={`const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);

// Buy with 1% slippage, the site's Auto.
const quote = await client.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'quoteBuy', args: [token, parseEther('40')] });
await wallet.writeContract({
  address: ROUTER, abi: ROUTER_ABI, functionName: 'buy',
  args: [token, (quote * 99n) / 100n, wallet.account.address, deadline],
  value: parseEther('40'),
});

// Sell everything, in a later block than the buy: approve the router, then sell.
const bal = await client.readContract({ address: token, abi: ERC20, functionName: 'balanceOf', args: [wallet.account.address] });
await wallet.writeContract({ address: token, abi: ERC20, functionName: 'approve', args: [ROUTER, bal] });
const zro = await client.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'quoteSell', args: [token, bal] });
await wallet.writeContract({
  address: ROUTER, abi: ROUTER_ABI, functionName: 'sell',
  args: [token, bal, (zro * 99n) / 100n, wallet.account.address, deadline],
});`}
      />
      <P>
        The router checks what really arrived against your minimum, so a token that takes something from a transfer can&apos;t slip past it.
        Buy for yourself (<C>recipient</C> equal to the sender) and the trade also counts as your activity, which is what copy trading follows.
      </P>
      <P>
        A trade through the router adds to your volume, and your rank&apos;s discount comes off Submarine&apos;s cut from the next one. The
        router&apos;s quotes are for a wallet without a rank, so a ranked wallet gets a little more than quoted and a minimum taken from the
        quote stays safe. A trade sent straight to the launchpad, or to the pool through Infinity, pays the same fee, the full 0.4% included,
        and adds no volume.
      </P>
      <Note title="Coins bought here can't move in the same block.">
        A wallet that got coins of a Submarine token from its curve or its pool can&apos;t send or sell any of that token until the next block.
        A script that buys and sells in one block, or in one transaction, reverts with <C>BoughtThisBlock</C>. Wait for the buy&apos;s
        receipt before you sell.
      </Note>
      <Note title="Estimate gas, then add a little.">
        Gas is paid in ZRO. The site adds 20% to each estimate, so a trade still goes through if the state moves a little before it lands.
      </Note>

      <H2 id="read">Read a curve</H2>
      <Code
        lang="ts"
        code={`const [creator, createdAt, graduated, feeBps, holdersBps, burnBps, antiSnipe, raised, sold, supply, protocolBps] =
  await client.readContract({ address: LAUNCHPAD, abi: PAD, functionName: 'curves', args: [token] });

const ownFee = feeBps - 100;                       // the creator's own fee; holdersBps and burnBps are shares of it
// protocolBps is always 40, Submarine's 0.4% before a rank discount

const progress = Number(raised) / 6000e18;        // 6,000 ZRO moves it to a pool
const price = await client.readContract({ address: LAUNCHPAD, abi: PAD, functionName: 'priceOf', args: [token] }); // wei per whole token
const marketCap = (Number(price) / 1e18) * (Number(supply) / 1e18); // in ZRO
const buyFeeNow = await client.readContract({ address: LAUNCHPAD, abi: PAD, functionName: 'buyFeeBps', args: [token] });

// What this wallet pays through the router, with its rank taken off, and the rank itself.
const myFee = await client.readContract({ address: LAUNCHPAD, abi: PAD, functionName: 'buyFeeBpsFor', args: [token, wallet.account.address] });
const volume = await client.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'volumeOf', args: [wallet.account.address] }); // ZRO, in wei
const rank = await client.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'rankOf', args: [wallet.account.address] }); // 0 Starter to 5 Legend`}
      />

      <H2 id="claim">Claim fees and rewards</H2>
      <Code
        lang="ts"
        code={`// A creator's share, from every token they launched.
await wallet.writeContract({ address: LAUNCHPAD, abi: PAD, functionName: 'claimCreatorFees' });

// A holder's rewards, on a token that pays its holders.
const HOLDER = parseAbi(['function rewardOf(address) view returns (uint256)', 'function claim()', 'function claimFor(address)']);
const due = await client.readContract({ address: token, abi: HOLDER, functionName: 'rewardOf', args: [wallet.account.address] });
if (due > 0n) await wallet.writeContract({ address: token, abi: HOLDER, functionName: 'claim' });`}
      />

      <H2 id="orders">Place an order</H2>
      <Code
        lang="ts"
        code={`const LIMITS = parseAbi([
  'function placeBuy(address token, uint256 minOut, uint40 expiry) payable returns (uint256)',
  'function placeSellLegs(address token, uint256 amount, uint40 expiry, (uint8 kind, uint128 share, uint128 minOut, uint128 trigger, uint16 trailBps)[] legs) returns (uint256)',
  'function runFee() view returns (uint256)',
]);

// Buy 200 ZRO of tokens once 200 ZRO (less the run fee) gets at least 10 million tokens, within a day.
const expiry = Math.floor(Date.now() / 1000) + 86400;
await wallet.writeContract({
  address: deployment.limitOrders, abi: LIMITS, functionName: 'placeBuy',
  args: [token, parseEther('10000000'), expiry], value: parseEther('200'),
});

// One escrow, two ways out: half at double the value, all of it at a 40% loss.
const amount = parseEther('1000000');
const value = await client.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'quoteSell', args: [token, amount] });
await wallet.writeContract({ address: token, abi: ERC20, functionName: 'approve', args: [deployment.limitOrders, amount] });
await wallet.writeContract({
  address: deployment.limitOrders, abi: LIMITS, functionName: 'placeSellLegs',
  args: [token, amount, 0, [
    { kind: 0, share: amount / 2n, minOut: value, trigger: 0n, trailBps: 0 },              // LIMIT: half at 2x
    { kind: 1, share: amount, minOut: (value * 3n) / 10n, trigger: (value * 6n) / 10n, trailBps: 0 }, // STOP at -40%, never below -70%
  ]],
});`}
      />
      <P>
        The minimum of a limit order is after every fee and the run fee. See <L to="orders">Limit orders and automation</L> for what each kind
        means.
      </P>

      <H2 id="referral">Link a referrer</H2>
      <Code
        lang="ts"
        code={`const REF = parseAbi(['function link(address referrer)', 'function claim()', 'function earned(address) view returns (uint256)']);
await wallet.writeContract({ address: deployment.referrals, abi: REF, functionName: 'link', args: [REFERRER] });`}
      />

      <H2 id="errors">When a call reverts</H2>
      <Table
        cols={['Error', 'Usually means']}
        rows={[
          [<C key="1">Slippage</C>, 'The price moved past your minimum. Quote again'],
          [<C key="2">Expired</C>, 'The deadline passed before the transaction landed'],
          [<C key="3">AlreadyGraduated</C>, 'Selling on the curve after it moved to a pool. Trade through the router instead'],
          [<C key="4">NoRoute</C>, 'No venue can trade this token'],
          [<C key="5">BadMetadata</C>, 'Name, symbol or uri too long or empty'],
          [<C key="6">BadTerms</C>, 'Supply, own fee or shares out of range, or shares set with no own fee'],
          [<C key="7">WrongLaunchFee</C>, 'value is below launchFee()'],
          [<C key="8">BadOrder</C>, 'An order\'s amount, minimum, expiry or legs are out of range'],
          [<C key="9">BoughtThisBlock</C>, 'The wallet got these coins from the market in this block. Try again from the next one'],
        ]}
      />
      <P>
        Every function and error is on the <L to="reference">contract reference</L>.
      </P>
    </Doc>
  );
}
