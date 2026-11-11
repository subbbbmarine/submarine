import { B, Bullets, C, Doc, Go, H2, H3, L, Note, P, Table } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('buyback-and-burn');

export default function Page() {
  return (
    <Doc
      slug="buyback-and-burn"
      lead={
        <>
          Two different burns happen here. A token&apos;s own burn share buys that token back inside every trade, if its creator chose one.
          Separately, Submarine&apos;s treasury can only ever spend its fees on buying one token and burning it.
        </>
      }
      toc={[
        ['token-burn', 'A token\'s own burn'],
        ['example', 'A worked example'],
        ['treasury', 'The treasury'],
        ['limits', 'What limits the treasury'],
        ['watch', 'Watching it happen'],
      ]}
    >
      <H2 id="token-burn">A token&apos;s own burn</H2>
      <P>
        At launch, a creator who adds a fee of their own on top of the 1% base can send a share of it to a burn. The share is of the own
        fee only: the base always goes 0.4% to Submarine and 0.6% to the creator. On the curve, and on a pool for every trade made
        through Submarine, it happens inside the same transaction as the trade that paid it, so there is nothing to wait for and nobody to
        trust.
      </P>
      <Table
        cols={['Where the token trades', 'How the burn works']}
        rows={[
          ['On its curve', 'The burn share buys tokens on the curve with no fee, and they go to the dead address. This adds to the ZRO raised, so it also moves the token toward its pool'],
          ['On its pool', 'The pool\'s hook collects the fee during the trade. Right after the trader\'s own swap, the burn share buys tokens from the pool, so it never changes what the trader gets, and sends them to the dead address'],
        ]}
      />
      <P>
        One burn on a pool moves the price at most about 5%. What it can&apos;t spend within that goes to the token&apos;s holders and creator
        with the rest of the fee. A trade made on the pool around Submarine pays the same fee, and its burn runs when anyone calls{' '}
        <C>distribute</C>; Submarine&apos;s own trades call it every time.
      </P>
      <P>
        Burned tokens leave circulation for good. The supply on the token itself stays the same, because nothing can be destroyed in it, but
        what sits at the dead address can never move again.
      </P>

      <H2 id="example">A worked example</H2>
      <P>
        A token with a 2% own fee, half of it going to the burn. Traders pay 3% in all. Each 400 ZRO traded on the curve sends{' '}
        <B>4 ZRO</B> to the burn (50% of 8 ZRO). If the token trades 40,000 ZRO in a day, 400 ZRO of its own tokens is bought and burned
        that day, on top of what traders bought.
      </P>
      <P>
        On a pool the same token burns 4 ZRO per 400 ZRO traded, the same as on the curve: the pool has no LP fee, and the hook takes the
        same fee from the same side of the trade. The token page shows how much ZRO has gone to its burn so far and how
        many tokens that bought.
      </P>
      <Note title="A burn on the curve stops at the end of the curve.">
        A burn never buys past the 6,000 ZRO that moves a token to its pool. If there is no room left, that part goes to the creator instead,
        so nothing is left stranded.
      </Note>

      <H2 id="treasury">The treasury</H2>
      <P>
        Every fee Submarine itself takes, the 0.4% of each trade, less any rank discount and referral share, lands in one contract: the <B>BuybackVault</B>. It has no withdraw
        function, for the owner or anyone else. The only thing it can do with ZRO is buy one token through the router and send it straight to
        the dead address.
      </P>
      <Bullets
        items={[
          'That token is set once and can never change, so nobody can point the treasury at a token they control and take the ZRO.',
          'The token hasn\'t been chosen yet. Until it is, fees simply accumulate in the treasury.',
          <>The <Go to="/stats">Stats</Go> page shows the treasury&apos;s balance and everything it has bought and burned.</>,
        ]}
      />

      <H2 id="limits">What limits the treasury</H2>
      <Table
        cols={['Rule', 'Value']}
        rows={[
          ['Who may run a buyback', 'The keeper the owner names, or the owner'],
          ['Most per buyback', '10% of the balance'],
          ['How often', 'At most once an hour'],
          ['What it buys', 'One token, set once'],
          ['Where it goes', 'The dead address, in the same transaction'],
        ]}
      />
      <H3>Why there is a cap</H3>
      <P>
        A keeper could still pick a bad moment and a low minimum. The 10% an hour cap is what limits how much a bad or compromised keeper can
        waste: at most a tenth of the balance in any hour.
      </P>
      <P>
        Example: with 4,000 ZRO in the treasury, one buyback may spend up to 400 ZRO. The next can come an hour later, up to 10% of the
        3,600 ZRO left.
      </P>

      <H2 id="watch">Watching it happen</H2>
      <P>
        Every buyback emits a <C>Buyback</C> event with the ZRO spent and the tokens burned, and every token burn emits <C>EarnersPaid</C> on
        the curve or <C>Burned</C> on a pool. See <L to="events">Events to index</L>.
      </P>
    </Doc>
  );
}
