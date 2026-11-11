import { B, Bullets, C, Doc, Go, H2, L, Note, P, Table } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('holder-rewards');

export default function Page() {
  return (
    <Doc
      slug="holder-rewards"
      lead={
        <>
          A creator who adds a fee of their own on top of the 1% base can give part of it to the token&apos;s holders. Then every trade, on the curve and later on its pool, pays everyone
          holding it in ZRO, in proportion to what they hold. You claim whenever you like.
        </>
      }
      toc={[
        ['how', 'How a share is counted'],
        ['example', 'A worked example'],
        ['who', 'Who earns and who doesn\'t'],
        ['claim', 'Claiming'],
        ['edge', 'Good to know'],
      ]}
    >
      <H2 id="how">How a share is counted</H2>
      <P>
        A token whose creator set a holders share is a <B>holder token</B>. The share is of the creator&apos;s own fee only, never of the 1%
        base. Each time a fee comes in, its holders&apos; part is added to a
        running total per token held. What you can claim is your balance times how much that total grew while you held it.
      </P>
      <Bullets
        items={[
          'You earn from the moment tokens reach your wallet, never for fees paid before.',
          'A buyer doesn\'t earn from their own buy, and a seller doesn\'t earn from their own sale: the fee is paid before the tokens move.',
          'Rewards you earned stay yours when you sell or send the tokens on. Claim them later from Portfolio.',
          'Nothing is taken from a transfer. The ZRO comes from the trading fee, not from holders.',
        ]}
      />

      <H2 id="example">A worked example</H2>
      <P>
        A token with a 2% own fee gives 50% of it to holders, so holders get <B>1%</B> of everything traded on the curve. Traders pay 3%
        in all, with the 1% base.
      </P>
      <Table
        cols={['', 'Amount']}
        numeric={[1]}
        rows={[
          ['Traded in a day', '40,000 ZRO'],
          ['To holders, 1%', '400 ZRO'],
          ['Your share of the tokens people hold', '2%'],
          ['Yours for the day', '8 ZRO'],
        ]}
        caption="Figure 1. Your share is of the tokens held by people, not of the whole supply."
      />
      <P>
        On a pool the same token pays holders 4 ZRO per 400 ZRO traded, the same as on the curve, since the pool has no LP fee. The
        breakdown is on <L to="fees" at="pool">Fees</L>. A trader&apos;s volume rank never changes what holders get: the discount comes off
        Submarine&apos;s cut only. Trades made on the pool around Submarine pay holders too, once anyone runs <C>distribute</C>;
        Submarine&apos;s own trades run it every time.
      </P>
      <Note title="Early holders split rewards among fewer people.">
        Tokens still on the curve sit in the launchpad, which doesn&apos;t earn. Early on, a few holders share every reward between them.
      </Note>

      <H2 id="who">Who earns and who doesn&apos;t</H2>
      <P>
        Contracts that only pass tokens through earn nothing, so their share goes to people who hold. These never earn:
      </P>
      <Table
        cols={['Address', 'Why']}
        rows={[
          ['The launchpad', 'Holds the unsold part of the curve'],
          ['The pools', 'Infinity\'s vault holds every pool\'s tokens. The pools contract and its venue only pass them through'],
          ['The dead address', 'Burned tokens'],
          ['The router', 'Holds tokens only during a trade'],
          ['Limit orders', 'Tokens escrowed in a sale order don\'t earn while they wait'],
          ['The treasury', 'It buys only to burn'],
          ['The copy vault', 'Tokens bought by copy trading in the vault don\'t earn'],
        ]}
      />
      <P>
        So tokens waiting in a sale order or held in your copy vault earn nothing until they come back to your wallet.
      </P>

      <H2 id="claim">Claiming</H2>
      <P>
        Claim from the token&apos;s page or from <Go to="/portfolio">Portfolio</Go>, which lists every holder token you hold or have traded.
        A claim is a transaction and costs gas, so small amounts can wait.
      </P>
      <P>
        Anyone may claim for you with <C>claimFor</C>, paying the gas, and the ZRO still only goes to you.
      </P>

      <H2 id="edge">Good to know</H2>
      <Bullets
        items={[
          <>Rewards wait until at least one whole token is held by people. Until then they build up and are paid out with the next fee.</>,
          'The token page shows how much its fee has paid holders so far.',
          'The holders share can\'t be added, removed or changed after launch.',
        ]}
      />
    </Doc>
  );
}
