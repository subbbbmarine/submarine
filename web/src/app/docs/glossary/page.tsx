import { Doc, H2, L, Terms } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('glossary');

export default function Page() {
  return (
    <Doc
      slug="glossary"
      lead={<>The words used across Submarine and these docs, one line each, with a link where there is more.</>}
      toc={[
        ['trading', 'Trading'],
        ['fees', 'Fees and earning'],
        ['orders', 'Orders and copying'],
        ['labels', 'Holder labels'],
        ['chain', 'The chain'],
      ]}
    >
      <H2 id="trading">Trading</H2>
      <Terms
        items={[
          ['Bonding curve', <>The contract that sells a new token and buys it back at a price set by one formula. <L to="trading">More</L></>],
          ['Virtual reserve', 'ZRO and tokens the curve counts but doesn\'t hold: 2,000 ZRO and 16/15 of the supply. They set the starting price.'],
          ['Raised', 'Real ZRO in a token\'s curve. 6,000 ZRO moves it to a pool.'],
          ['Progress', 'Raised over 6,000 ZRO, from 0 to 100%.'],
          ['Graduation', 'The move from the curve to a pool, at 6,000 ZRO raised and a market cap of 30,000 ZRO.'],
          ['Pool', 'Where a graduated token trades: a ZRO/token pool on PancakeSwap Infinity, with one locked position over the whole price range and no fee of its own.'],
          ['Hook', 'A contract an Infinity pool calls around each trade. Submarine\'s takes the token\'s fee on every trade and refuses any liquidity but the locked position.'],
          ['PancakeSwap Infinity', 'The concentrated-liquidity engine Submarine\'s pools run on. Submarine deploys its core on Zero itself.'],
          ['Market cap', 'Price times the whole supply, in ZRO.'],
          ['Router', 'The contract every trade goes through. It asks every market for a price and trades on the best.'],
          ['Venue', 'A market the router can trade on: the curve, the pools, or another launchpad\'s adapter.'],
          ['Slippage', 'How far the price may move against you before your trade fails instead. Auto, the default, is 1%.'],
          ['Sandwich', <>A bot buying just before your trade and selling just after it in the same block. Tokens launched on Submarine hold bought coins for one block, which stops it. <L to="trading" at="sandwich">More</L></>],
          ['Price impact', 'How much your own trade moves the price.'],
          ['Sell right after', 'What a sale straight after your buy would bring back, to catch tokens that can\'t be sold or lose a lot when sold. A test sale for other launchpads\' tokens, worked out from the fees for Submarine\'s.'],
          ['Quick size', 'The amount B buys, set with 1 to 4 or in settings. 50 ZRO to start.'],
          ['Preset', 'A saved amount and slippage, P1 to P3.'],
        ]}
      />

      <H2 id="fees">Fees and earning</H2>
      <Terms
        items={[
          ['Base fee', <>The 1% every token launched on Submarine pays on every trade: 0.4% to Submarine, 0.6% to the creator. Nobody can change it. <L to="fees">More</L></>],
          ['Own fee', 'What a creator adds on top of the base at launch: none to 10%. Split between holders, burn and creator.'],
          ['Submarine\'s cut', '0.4% of each trade, out of the base, sent to the treasury. Less for a ranked wallet.'],
          ['Rank', <>Where a wallet stands by the ZRO it has traded through the router, from Starter to Legend. Each rank lowers Submarine&apos;s cut. <L to="fees" at="ranks">More</L></>],
          ['Volume', 'ZRO a wallet has traded through the router, buys and sales, for good. It never goes down.'],
          ['Points', <>Counted by the indexer for trading and launching on Submarine, toward a reward for early users. <L to="points">More</L></>],
          ['Holder token', <>A token that pays part of its fee to its holders in ZRO. <L to="holder-rewards">More</L></>],
          ['Burn share', 'Part of the own fee that buys the token back and sends it to the dead address.'],
          ['Dead address', '0x…dEaD. Tokens sent there can never move again.'],
          ['Treasury', <>The BuybackVault, which receives Submarine&apos;s fees and can only buy one token and burn it. <L to="buyback-and-burn" at="treasury">More</L></>],
          ['Anti-snipe', 'A launch option: buys pay 50% at launch, falling to the normal fee over 60 seconds. The extra goes where the own fee goes.'],
          ['Cashback', 'The quarter of the referral share that goes back to the referred trader.'],
        ]}
      />

      <H2 id="orders">Orders and copying</H2>
      <Terms
        items={[
          ['Limit order', <>Locks ZRO or tokens until the market pays at least your minimum. <L to="orders">More</L></>],
          ['Take profit, stop loss', 'Sales that fire when your tokens are worth a set amount more, or less.'],
          ['Trailing stop', 'A sale that fires once the value drops a set share below the highest it reached.'],
          ['Sale group', 'Several ways out of the same tokens, sharing one escrow.'],
          ['DCA', 'A buy split into equal parts, a set time apart.'],
          ['Run fee', 'What whoever fills an order or runs a copy earns: 0.04 ZRO by default.'],
          ['Keeper', 'A program that fills orders and runs copies for the run fees. Anyone may run one.'],
          ['Leader', 'A wallet being copied.'],
          ['Copy vault', <>The contract that copies leaders for you with the browser closed. <L to="copy-trading" at="vault">More</L></>],
          ['Chase', 'How much worse than the leader\'s price a copy may still trade at.'],
        ]}
      />

      <H2 id="labels">Holder labels</H2>
      <Terms
        items={[
          ['dev', 'The token\'s creator.'],
          ['insider', 'Got coins straight from the dev.'],
          ['sniper', 'First bought within 5 seconds of launch. Never the dev.'],
          ['bundle', 'Bought in the same block the token launched in. Never the dev.'],
          ['whale', 'Holds 2% or more of the supply.'],
          ['top 10', 'One of the ten biggest holders.'],
          ['new', 'First seen in the last 3 days, on 2 tokens or fewer.'],
          ['smart', 'Over 30 days: traded at least 5 tokens, won on at least 60% of them, and is up overall.'],
          ['bot', '300 trades or more in 24 hours.'],
          ['linked', 'Passed coins to or from another holder of the same token.'],
        ]}
      />

      <H2 id="chain">The chain</H2>
      <Terms
        items={[
          ['Zero', 'LayerZero\'s chain, which Submarine runs on. Its mainnet is scheduled for November 30, 2026.'],
          ['ZRO', 'Zero\'s own coin. It pays for gas, and every trade, fee and reward here is in ZRO.'],
          ['In a block', 'The transaction is in a block. Not the same as succeeding.'],
          ['Executed', 'The transaction ran, and you know whether it succeeded.'],
        ]}
      />
    </Doc>
  );
}
