import { Doc, Faq, H2, L } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('faq');

export default function Page() {
  return (
    <Doc
      slug="faq"
      lead={<>Short answers to what people ask most. Each links to the page with the whole story.</>}
      toc={[
        ['start', 'Getting started'],
        ['trading', 'Trading'],
        ['launching', 'Launching'],
        ['earning', 'Earning'],
        ['safety', 'Safety'],
      ]}
    >
      <H2 id="start">Getting started</H2>
      <Faq
        items={[
          ['Is Submarine live?', <>Not yet. Submarine is not deployed on Zero yet, and Zero&apos;s mainnet is scheduled for November 30, 2026. <L to="getting-started">Getting started on Zero</L></>],
          ['Where do I get ZRO on Zero?', <>How ZRO gets onto Zero will be added to these docs when LayerZero publishes it. <L to="getting-started" at="zro">Have ZRO on Zero</L></>],
          ['Do I need MetaMask?', <>No. New makes a wallet in this browser in one click, and its trades need no popup. MetaMask works too. <L to="wallets">Wallets</L></>],
          ['I lost my key. Can you recover it?', 'No. Nobody else holds a copy. Save the key when Submarine asks you to.'],
          ['I forgot my PIN.', 'It can\'t be reset. The key you saved is the only way back into that wallet.'],
        ]}
      />

      <H2 id="trading">Trading</H2>
      <Faq
        items={[
          ['Why did my trade fail?', 'Usually the price moved past your slippage before it landed, or it took more than 120 seconds. You only lose the gas. On a fast token, try 3% or 10% instead of Auto.'],
          ['What does a trade cost?', <>1% on a token launched on Submarine, plus whatever own fee its creator added, up to 10%. The same on its pool, which has no LP fee. <L to="fees">Fees</L></>],
          ['How do I pay less?', <>Trade more. Past 2,000 ZRO through Submarine its cut falls from 0.4% to 0.35%, and at 1,000,000 ZRO to 0.15%. <L to="fees" at="ranks">Volume ranks</L></>],
          ['Can a bot sandwich my trade?', <>Not on a token launched on Submarine. Coins bought from the curve or the pool can&apos;t move until the next block, so the bot can&apos;t sell in the block it bought. <L to="trading" at="sandwich">Sandwich protection</L></>],
          ['Why can\'t I send coins I just bought?', 'For one block, a fraction of a second, coins bought from the curve or the pool stay where they landed. Try again a moment later.'],
          ['Why did I get ZRO back on a buy?', <>Your buy filled the curve. It only pays for what was left and returns the rest. <L to="trading" at="path">From launch to pool</L></>],
          ['What happens to my tokens when a token moves to a pool?', 'Nothing. You keep them and trade them on the pool, through the same buttons.'],
          ['Why did a buy right after launch cost so much?', <>The creator turned on anti-snipe: buys pay 50% at launch, falling to the normal fee over 60 seconds. <L to="launching" at="anti-snipe">Anti-snipe</L></>],
          ['Can I trade tokens from other launchpads?', <>Yes, from their own contracts, with no fee from Submarine. Limit orders aren&apos;t available for them. <L to="trading" at="other">Other launchpads</L></>],
          ['Can I add liquidity to a pool?', <>Not yet. The position put in at graduation is each pool&apos;s only liquidity for now. Positions of your own are planned. <L to="trading" at="after">Trading on a pool</L></>],
          ['My limit order hasn\'t filled. Why?', <>The market hasn&apos;t paid your minimum yet, or only part of it fits at your level. You can cancel any time. <L to="orders" at="fills">Partial fills</L></>],
        ]}
      />

      <H2 id="launching">Launching</H2>
      <Faq
        items={[
          ['What does launching cost?', 'Gas only. The launch fee is 0 today, and the owner can never set it above 40 ZRO.'],
          ['What do I earn as a creator?', <>0.6% of every trade of your token, plus your own fee if you add one, less what you give holders and the burn. <L to="launching" at="fee">The fee</L></>],
          ['Can I change my token\'s fee later?', 'No. Supply, own fee, split and anti-snipe are fixed for good at launch, and the 1% base can\'t change for anyone.'],
          ['Where are my creator fees?', 'In the launchpad, waiting for you. Claim them from Portfolio, for every token you launched at once.'],
          ['Can someone buy before my first buy?', 'No. Your first buy happens in the same transaction that creates the token.'],
        ]}
      />

      <H2 id="earning">Earning</H2>
      <Faq
        items={[
          ['How do holder rewards work?', <>If the creator gave holders a share, every trade pays holders in ZRO by what they hold. Claim any time. <L to="holder-rewards">Holder rewards</L></>],
          ['Why are my rewards zero while my tokens are in an order or the copy vault?', 'Contracts don\'t earn. Tokens earn only while they sit in your own wallet.'],
          ['How much do referrals pay?', <>0.12% of what the people you bring trade, and they get 0.04% back. Less once they have a rank. <L to="referrals">Referrals</L></>],
          ['What are points?', <>A count of what you trade and launch on Submarine, toward a reward for early users that will be announced later. Nothing to sign. <L to="points">Points</L></>],
          ['Can I earn by running a keeper?', <>Yes. Filling orders and running copies each pay 0.04 ZRO by default. <L to="keepers">Run a keeper</L></>],
        ]}
      />

      <H2 id="safety">Safety</H2>
      <Faq
        items={[
          ['Can the team take the treasury?', <>No. It has no withdraw function. It can only buy one token and burn it. <L to="buyback-and-burn" at="treasury">The treasury</L></>],
          ['Can a graduated token\'s liquidity be pulled?', 'No. It is one position owned by the pools contract, which has no way to remove it, and the pool refuses every removal.'],
          ['Is Submarine audited?', <>No. Don&apos;t put in money you can&apos;t lose. <L to="risks">Risks and who controls what</L></>],
          ['What if Submarine goes down?', 'Your tokens, orders and vault balance live in the contracts. You can cancel, withdraw and trade with them directly.'],
        ]}
      />
    </Doc>
  );
}
