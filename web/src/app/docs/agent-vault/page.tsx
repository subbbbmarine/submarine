import { B, Bullets, C, Code, Doc, H2, L, Note, P, Table } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('agent-vault');

export default function Page() {
  return (
    <Doc
      slug="agent-vault"
      lead={
        <>
          A vault you make for an AI agent or a bot of your own. You own it and put ZRO in. The agent gets a key of its own that can only
          buy and sell through Submarine&apos;s router, inside limits only you set. Only you can take anything out.
        </>
      }
      toc={[
        ['why', 'Why a vault'],
        ['rules', 'What the agent can and cannot do'],
        ['limits', 'The limits'],
        ['make', 'Making one'],
        ['mcp', 'Trading from the MCP server'],
        ['code', 'Trading from code'],
        ['risks', 'What the limits do not cover'],
      ]}
    >
      <H2 id="why">Why a vault</H2>
      <P>
        An agent that trades needs a key it can sign with. Handing it the key of your own wallet means handing it everything in that
        wallet. A vault splits the two: your wallet owns the vault, and the agent&apos;s key only trades inside it. If the agent&apos;s key
        leaks, the most anyone can do with it is trade inside your limits until you remove it.
      </P>

      <H2 id="rules">What the agent can and cannot do</H2>
      <Table
        cols={['', 'The agent', 'You, the owner']}
        rows={[
          ['Buy and sell through the router', 'Yes, inside the limits', 'Yes, without limits'],
          ['Where bought tokens go', 'The vault, always', 'The vault, always'],
          ['Where the ZRO from a sale goes', 'The vault, always', 'The vault, always'],
          ['Take ZRO or tokens out', 'Never', 'Any time, to any address'],
          ['Change the limits or the token list', 'Never', 'Any time'],
          ['Change or remove the agent', 'Never', 'Any time'],
          ['Change the owner', 'Nobody can', 'Nobody can'],
        ]}
      />
      <P>
        The owner is fixed when the vault is made. There is no call that hands the vault to someone else, so there is none for an agent
        to trick you into.
      </P>

      <H2 id="limits">The limits</H2>
      <Table
        cols={['Limit', 'What it does']}
        rows={[
          [<C key="1">perTrade</C>, 'The most ZRO one buy may spend'],
          [<C key="2">perDay</C>, 'The most ZRO the agent\'s buys may spend in a UTC day. What a curve hands back on the buy that fills it is not counted'],
          [<C key="3">slippageBps</C>, 'Every trade\'s minimum must be at least the router\'s quote at that moment, less this. 500 is 5%. At most 5,000'],
          [<C key="4">listedOnly</C>, 'When on, the agent may buy only tokens you have listed with setListed'],
        ]}
      />
      <P>Sales are not counted against the day: they bring ZRO back. They still have to meet the slippage floor.</P>

      <H2 id="make">Making one</H2>
      <P>
        Call <C>create</C> on <C>AgentVaultFactory</C> from the wallet that should own the vault, with the agent&apos;s address, the
        limits, and any ZRO to put in. The factory keeps a list of every owner&apos;s vaults, <C>vaultsOf(owner)</C>. The address is on{' '}
        <L to="contracts">Contract addresses</L> once it is deployed.
      </P>
      <Code
        lang="ts"
        title="viem"
        code={`const limits = { perTrade: parseEther('50'), perDay: parseEther('200'), slippageBps: 500, listedOnly: false };
await owner.writeContract({
  address: agentVaultFactory,
  abi: parseAbi(['function create(address agent, (uint128 perTrade, uint128 perDay, uint16 slippageBps, bool listedOnly) limits) payable returns (address)']),
  functionName: 'create',
  args: [agentAddress, limits],
  value: parseEther('500'),
});`}
      />
      <P>
        Make the agent&apos;s key a fresh one, not one that holds anything else. It needs a little ZRO of its own for gas: the vault pays for
        trades, not for the agent&apos;s transactions.
      </P>

      <H2 id="mcp">Trading from the MCP server</H2>
      <P>
        Give the <L to="mcp">MCP server</L> the vault&apos;s address and the agent&apos;s key, and it offers three more tools:{' '}
        <C>vault_status</C>, <C>vault_buy</C> and <C>vault_sell</C>. They quote first, set the minimum from the quote, and never ask for a
        looser one than the vault allows.
      </P>
      <Code
        lang="json"
        code={`"env": {
  "TERMINAL_API": "...",
  "RPC_URL": "...",
  "AGENT_VAULT": "0xYourVault",
  "AGENT_KEY": "0xTheAgentsOwnKey"
}`}
      />

      <H2 id="code">Trading from code</H2>
      <Table
        cols={['Call', 'Who', 'What']}
        rows={[
          [<C key="1">buy(token, zroIn, minOut, deadline)</C>, 'agent or owner', 'Buys with the vault\'s ZRO. The tokens stay in the vault'],
          [<C key="2">sell(token, tokensIn, minOut, deadline)</C>, 'agent or owner', 'Sells the vault\'s tokens. The ZRO comes back to the vault'],
          [<C key="3">leftToday()</C>, 'anyone', 'What the agent may still spend today, given the vault\'s balance'],
          [<C key="4">setAgent(agent)</C>, 'owner', 'Changes the agent. The zero address removes it'],
          [<C key="5">setLimits(limits)</C>, 'owner', 'New limits, from the next trade on'],
          [<C key="6">setListed(tokens, on)</C>, 'owner', 'Adds tokens to the list, or takes them off'],
          [<C key="7">withdraw(amount, to)</C>, 'owner', 'Sends ZRO out'],
          [<C key="8">withdrawTokens(token, amount, to)</C>, 'owner', 'Sends tokens out'],
        ]}
      />
      <P>
        A vault that holds a token which pays its holders earns like any holder. Anyone can call <C>claimFor(vault)</C> on the token, and
        the ZRO lands in the vault.
      </P>

      <H2 id="risks">What the limits do not cover</H2>
      <Bullets
        items={[
          'The limits cap how much the agent can spend, not how well it trades. Inside them it can still buy a token that goes to zero.',
          'A leaked agent key can trade until you remove it with setAgent. It can never take anything out.',
          <>For larger amounts, turn on <B>listedOnly</B> and list only tokens you are willing to hold.</>,
        ]}
      />
      <Note title="Keep in it only what the agent may lose.">
        The vault makes a bad agent cheap, not harmless. Start small, watch it trade, then raise the limits.
      </Note>
      <P>
        <B>Source:</B> <C>contracts/src/periphery/AgentVault.sol</C>, tests in <C>contracts/test/AgentVault.t.sol</C>.
      </P>
    </Doc>
  );
}
