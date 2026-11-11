import { B, Bullets, C, Doc, FlowTree, Go, H2, L, P, Steps, Table } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('referrals');

export default function Page() {
  return (
    <Doc
      slug="referrals"
      lead={
        <>
          Share your link. Every trader who links to you sends 40% of Submarine&apos;s cut of their trades to the referral contract: 75% of
          that to you, and 25% back to them as cashback, for as long as they trade.
        </>
      }
      toc={[
        ['how', 'How it works'],
        ['example', 'A worked example'],
        ['link', 'Your link'],
        ['joining', 'Joining through a link'],
        ['claim', 'Claiming'],
        ['rules', 'Rules'],
      ]}
    >
      <H2 id="how">How it works</H2>
      <P>
        Submarine takes 0.4% of each trade, its part of the 1% base. When the trader has a referrer, 40% of that goes to the referral contract
        instead of the treasury. The contract keeps a running total for both of you. The creator&apos;s 0.6%, the token&apos;s own fee and
        what its holders and burn get don&apos;t change.
      </P>
      <Table
        cols={['Of each trade', 'Share']}
        numeric={[1]}
        rows={[
          ['Submarine\'s cut, without a rank', '0.4%'],
          ['Of that, to referrals', '40%, or 0.16% of the trade'],
          ['To the referrer', '75% of that, or 0.12% of the trade'],
          ['Back to the trader', '25% of that, or 0.04% of the trade'],
        ]}
      />
      <P>
        A trader with a <L to="fees" at="ranks">volume rank</L> pays a smaller cut, and the referral share is 40% of that smaller cut. A
        Legend trader&apos;s cut is 0.15%, so 0.06% of each trade goes to referrals: 0.045% to the referrer and 0.015% back.
      </P>

      <H2 id="example">A worked example</H2>
      <P>Five people join through your link and each trades 1,600 ZRO in a week, on curves or pools, so none of them reaches a rank yet.</P>
      <FlowTree
        items={[
          {
            amount: '8,000 ZRO',
            label: 'Traded in the week',
            parts: [
              {
                amount: '32',
                label: 'Submarine\'s 0.4%',
                parts: [
                  { amount: '19.2', label: 'To the treasury' },
                  {
                    amount: '12.8',
                    label: 'To referrals',
                    parts: [
                      { amount: '9.6', label: 'Yours' },
                      { amount: '3.2', label: 'Their cashback, 0.64 ZRO each' },
                    ],
                  },
                ],
              },
            ],
          },
        ]}
        caption="Figure 1. Referral earnings come from Submarine's cut, so the people you bring pay no more."
      />

      <H2 id="link">Your link</H2>
      <P>
        Your link is Submarine&apos;s address with <C>?ref=</C> and your wallet address, for example <C>/?ref=0xYourAddress</C>. Copy it
        from the Invite friends panel in <Go to="/portfolio">Portfolio</Go>, which also shows how many people joined, what you earned from
        referrals, your own cashback, and what is ready to claim.
      </P>

      <H2 id="joining">Joining through a link</H2>
      <Steps
        items={[
          'Open a link with ?ref=. Submarine remembers the referrer in this browser.',
          <>A box says you were invited. Press <B>Link and get cashback</B>.</>,
          'That sends one transaction, which costs a little gas. From then on, 25% of the referral share of your trades comes back to you.',
        ]}
      />

      <H2 id="claim">Claiming</H2>
      <P>
        Earnings build up in the referral contract, for the referrer and the trader alike. Claim them from Portfolio whenever you like, in one
        transaction.
      </P>

      <H2 id="rules">Rules</H2>
      <Bullets
        items={[
          'A wallet links once, for good. It can\'t change its referrer later.',
          'You can\'t refer yourself, and you can\'t link to a wallet that you referred.',
          'Nobody can change the shares: the referral contract has no owner and no settings.',
          <>It covers every trade of a token launched here on its curve, through the router or straight to the launchpad, and on its pool through Submarine&apos;s router, limit orders and copies made in your name included. A pool trade made around Submarine pays Submarine&apos;s cut all to the treasury. Tokens from other launchpads trade on their own contracts and pay nothing here.</>,
        ]}
      />
      <P>
        More on where every fee goes is on <L to="fees" at="referred">Fees</L>.
      </P>
    </Doc>
  );
}
