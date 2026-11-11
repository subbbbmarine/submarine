import { B, Cards, Doc, H2, L, P, Stats, Steps, Terms } from './_ui/doc';
import { DOCS, docMeta } from './_ui/pages';

export const metadata = docMeta('');

export default function DocsIndex() {
  return (
    <Doc
      slug=""
      lead={
        <>
          Submarine trades every token on Zero from one screen, and launches new ones on its own bonding curve. These docs say what happens
          to your tokens and your money, in plain words, with the real numbers from the contracts.
        </>
      }
      toc={[
        ['glance', 'At a glance'],
        ['first-steps', 'First steps'],
        ['traders', 'For traders'],
        ['builders', 'For builders'],
        ['words', 'The words'],
      ]}
    >
      <H2 id="glance">At a glance</H2>
      <Stats
        items={[
          ['Network', 'Zero', 'Paid in ZRO. Mainnet scheduled for November 30, 2026'],
          ['A token opens at', '1,875 ZRO', 'Market cap, about $3K, whatever the supply'],
          ['Moves to a pool at', '6,000 ZRO raised', 'At 30,000 ZRO market cap, liquidity locked'],
          ['Base fee', '1%', 'On every token, fixed: 0.4% to Submarine, 0.6% to the creator'],
          ['Creator\'s own fee', 'None to 10%', 'On top of the base, chosen at launch, fixed for good'],
          ['Volume ranks', 'Down to 0.15%', 'Submarine\'s cut, for wallets that have traded more'],
          ['Referrals', '40% of the cut', '75% to the referrer, 25% back to the trader'],
        ]}
      />

      <H2 id="first-steps">First steps</H2>
      <Steps
        items={[
          <>Make a wallet with the button at the top right, and save its key. <L to="wallets">Wallets</L></>,
          <>Have ZRO on Zero in that wallet. <L to="getting-started">Getting started on Zero</L></>,
          <>Pick a token and trade, or press B to buy at your quick size. <L to="trading">Trading and the curve</L></>,
          <>Before anything you&apos;d mind losing, read <L to="risks">Risks and who controls what</L>.</>,
        ]}
      />

      <H2 id="traders">For traders</H2>
      <P>How tokens are priced and launched, where every fee goes, and every tool on the screen.</P>
      <Cards slugs={DOCS.filter((d) => d.group === 'traders').map((d) => d.slug)} />

      <H2 id="builders">For builders</H2>
      <P>
        Every contract, event and API route, a keeper anyone can run for the fees, and examples in <B>viem</B>. No key is needed for the API.
      </P>
      <Cards slugs={DOCS.filter((d) => d.group === 'builders').map((d) => d.slug)} />

      <H2 id="words">The words</H2>
      <Terms
        items={[
          ['Bonding curve', 'The contract that sells a new token and buys it back, at a price that rises with every buy.'],
          ['Graduation', 'The move from the curve to a pool at 6,000 ZRO raised. The pool\'s liquidity is locked for good.'],
          ['Base fee', 'The 1% every token on Submarine pays on every trade: 0.4% to Submarine, 0.6% to the creator. Nobody can change it.'],
          ['Own fee', 'What a creator may add on top of the base. It goes to holders, a burn and the creator, in shares set at launch.'],
          ['Holder token', 'A token that pays part of its fee to its holders, in ZRO.'],
          ['Run fee', '0.04 ZRO by default, paid to whoever fills an order or runs a copy.'],
        ]}
      />
      <P>
        Every other word is in the <L to="glossary">Glossary</L>, and short answers are in <L to="faq">Questions</L>.
      </P>
      <P>
        Pools run on PancakeSwap Infinity&apos;s core (GPL-2.0-or-later). See <L to="contracts" at="infinity">Pools on PancakeSwap Infinity</L>.
      </P>
    </Doc>
  );
}
