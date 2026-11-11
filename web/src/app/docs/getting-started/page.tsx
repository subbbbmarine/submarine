import { B, Bullets, Doc, H2, L, Note, P, Steps, Table } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('getting-started');

export default function Page() {
  return (
    <Doc
      slug="getting-started"
      lead={
        <>
          Submarine runs on Zero, LayerZero&apos;s chain. Zero&apos;s own coin is ZRO: it pays for gas, and it is what you buy with, sell for and
          pay fees in. Zero&apos;s mainnet is scheduled for November 30, 2026, and Submarine is not deployed on it yet.
        </>
      }
      toc={[
        ['quick', 'The short version'],
        ['wallet', '1. Have a wallet'],
        ['zro', '2. Have ZRO on Zero'],
        ['uses', 'What ZRO pays for'],
        ['network', 'Network details'],
      ]}
    >
      <H2 id="quick">The short version</H2>
      <Steps
        items={[
          <>Create a wallet in Submarine, or connect MetaMask. See <L to="wallets">Wallets</L>.</>,
          'Have ZRO on Zero in that address.',
          'Trade.',
        ]}
      />
      <Note title="Your address is the same on every EVM chain.">
        The wallet you make in Submarine, or the one in MetaMask, is the address that holds your ZRO on Zero.
      </Note>

      <H2 id="wallet">1. Have a wallet</H2>
      <P>
        Press the wallet button at the top right. <B>New</B> makes a key in this browser in one click, and Submarine asks you to save it
        straight away. Or connect MetaMask or another browser wallet. Everything about wallets is on <L to="wallets">Wallets</L>.
      </P>

      <H2 id="zro">2. Have ZRO on Zero</H2>
      <P>
        Every trade, launch and order on Submarine is paid in ZRO on Zero. How ZRO gets onto Zero will be added here when LayerZero publishes
        it. There is no public testnet to practise on yet.
      </P>

      <H2 id="uses">What ZRO pays for</H2>
      <Table
        cols={['What', 'In ZRO']}
        rows={[
          ['Gas', 'Every transaction you send'],
          ['Buying a token', 'Any amount. The quick sizes are 5, 50, 200 and 500 ZRO'],
          ['Launching a token', <>The launch fee, at most 40 ZRO, and an optional first buy. See <L key="l" to="launching">Launching a token</L></>],
          ['Limit orders and copies', <>A run fee for whoever fills them, 0.04 ZRO by default. See <L key="o" to="orders">Limit orders</L></>],
        ]}
      />
      <P>Keep a little ZRO back for gas, so a sell or a cancel always goes through.</P>

      <H2 id="network">Network details</H2>
      <P>
        These are Zero&apos;s testnet settings as LayerZero lists them. Its RPC only answers developers LayerZero has let in, and mainnet&apos;s
        settings aren&apos;t public yet. They will be added here, and on <L to="contracts">Contract addresses</L>, when they are.
      </P>
      <Table
        cols={['Setting', 'Value']}
        rows={[
          ['Network name', 'Zero'],
          ['Currency', 'ZRO'],
          ['Chain id', '1337 on the testnet'],
          ['RPC', 'https://testnet.zero.layerzero.network, by access from LayerZero'],
          ['Block time', 'About 1 second'],
          ['Explorer', 'Not published yet'],
          ['Mainnet', 'Scheduled for November 30, 2026'],
        ]}
      />
      <Bullets
        items={[
          'Connecting MetaMask from Submarine adds the network for you.',
          <>Submarine&apos;s contract addresses appear on <L key="c" to="contracts">Contract addresses</L> once it is deployed.</>,
        ]}
      />
    </Doc>
  );
}
