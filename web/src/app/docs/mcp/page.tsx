import { B, C, Code, Doc, H2, L, Note, P, Table } from '../_ui/doc';
import { SUBMARINE_API, ZERO_RPC } from '../_ui/deployment';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('mcp');

export default function Page() {
  return (
    <Doc
      slug="mcp"
      lead={
        <>
          A Model Context Protocol server in <C>mcp/</C> that gives an AI agent Submarine&apos;s market data and real on-chain quotes. On
          its own it only reads and holds no keys. Given an <L to="agent-vault">agent vault</L> and its agent key, it can also trade, but
          only through that vault and inside its limits.
        </>
      }
      toc={[
        ['tools', 'Tools'],
        ['install', 'Install'],
        ['connect', 'Connect a client'],
        ['examples', 'What to ask'],
        ['trading', 'Letting an agent trade'],
      ]}
    >
      <H2 id="tools">Tools</H2>
      <Table
        cols={['Tool', 'Arguments', 'What it returns']}
        rows={[
          [<C key="1">get_market_stats</C>, 'none', 'Tokens, graduations, and 24 hour volume, trades and traders. From /api/v1/market/stats'],
          [<C key="2">list_tokens</C>, 'sort, stage, limit', 'Tokens from every launchpad. sort: new, volume, progress, mcap, active. stage: curve, graduating, graduated, external'],
          [<C key="3">search_tokens</C>, 'q', 'Tokens by name, symbol or address'],
          [<C key="4">get_token</C>, 'address', 'One token with price, market cap, curve progress, holders and 24 hour figures'],
          [<C key="5">get_token_trades</C>, 'address, limit', 'Its recent trades'],
          [<C key="6">get_wallet</C>, 'address', 'Holdings with cost, recent trades and tokens it launched'],
          [<C key="7">quote_buy</C>, 'address, zro, an amount of ZRO ("50")', 'Tokens out at the best venue, after fees, read from the router on chain'],
          [<C key="8">quote_sell</C>, 'address, tokens ("1000")', 'ZRO out at the best venue, after fees, read from the router on chain'],
          [<C key="9">vault_status</C>, 'none', 'With a vault set: its ZRO, the owner\'s limits, what is left to spend today, and its holdings'],
          [<C key="10">vault_buy</C>, 'address, zro, slippage (percent)', 'With a vault set: buys with the vault\'s ZRO, minimum from a fresh quote'],
          [<C key="11">vault_sell</C>, 'address, tokens or "all", slippage', 'With a vault set: sells the vault\'s tokens, the ZRO back to the vault'],
        ]}
      />
      <P>
        Every answer is JSON as text. The quote tools ask the router, so they match what a trade would get at that moment, and say{' '}
        <C>route: none</C> when no venue can trade the token.
      </P>

      <H2 id="install">Install</H2>
      <Code
        lang="powershell"
        title="Windows PowerShell, from the repository"
        code={`npm.cmd install
npm.cmd run build --workspace=mcp`}
      />
      <Code
        lang="bash"
        title="macOS or Linux"
        code={`npm install
npm run build --workspace=mcp`}
      />
      <Table
        cols={['Variable', 'Default', 'What']}
        rows={[
          [<C key="1">TERMINAL_API</C>, <C key="1b">http://localhost:3001</C>, 'The API to read from. Set it to the public one below to skip running an indexer'],
          [<C key="2">RPC_URL</C>, <C key="2b">http://127.0.0.1:8546</C>, <>The node the quotes are read from. Set it to Zero&apos;s, <C key="2c">{ZERO_RPC}</C></>],
          [<C key="3">AGENT_VAULT</C>, 'none', <>An <L key="3l" to="agent-vault">agent vault</L> to trade through. With AGENT_KEY, turns on the three vault tools</>],
          [<C key="4">AGENT_KEY</C>, 'none', 'The vault\'s agent key. It can trade inside the vault and nothing else'],
        ]}
      />
      <P>
        The public API is at <C>{SUBMARINE_API}</C>. That address and Zero&apos;s RPC are filled in at launch. The server finds the
        router&apos;s address from the API&apos;s <C>/health</C>, so it follows a redeploy on its own.
      </P>

      <H2 id="connect">Connect a client</H2>
      <P>It talks over standard input and output. In a client that takes a JSON config, such as Claude Desktop:</P>
      <Code
        lang="json"
        code={`{
  "mcpServers": {
    "submarine": {
      "command": "node",
      "args": ["/path/to/submarine/mcp/dist/index.js"],
      "env": {
        "TERMINAL_API": "${SUBMARINE_API}",
        "RPC_URL": "${ZERO_RPC}"
      }
    }
  }
}`}
      />
      <P>
        On Windows, write the path with forward slashes or doubled backslashes, for example <C>D:/submarine/mcp/dist/index.js</C>.
      </P>

      <H2 id="examples">What to ask</H2>
      <Table
        cols={['Ask', 'Tools it uses']}
        rows={[
          ['Which tokens are closest to moving to a pool?', 'list_tokens with sort progress and stage curve'],
          ['What would 200 ZRO of this token get me, and what would it sell back for?', 'quote_buy, then quote_sell'],
          ['What does this wallet hold, and is it up?', 'get_wallet'],
          ['Is anyone selling this token hard right now?', 'get_token_trades'],
        ]}
      />

      <H2 id="trading">Letting an agent trade</H2>
      <P>
        Without a vault the server can&apos;t trade, on purpose. The safe way to let an agent trade is an{' '}
        <L to="agent-vault">agent vault</L>: you own it, the agent&apos;s key only trades inside it, within your limits, and only you can take
        anything out. Set <C>AGENT_VAULT</C> and <C>AGENT_KEY</C> and the server offers <C>vault_buy</C> and <C>vault_sell</C>, which quote
        first and never ask for a looser minimum than the vault allows. An agent can also trade from its own wallet with the calls on{' '}
        <L to="launch-from-code">Launch and trade from code</L>, but then it holds everything in that wallet.
      </P>
      <Note title="Agents read the same numbers as people.">
        The <L to="api">public API</L> has far more routes than these tools: holder labels, risk, Pulse, Radar and the live stream. An
        agent can call them directly over HTTP.
      </Note>
      <P>
        <B>Source:</B> <C>mcp/src/index.ts</C>.
      </P>
    </Doc>
  );
}
