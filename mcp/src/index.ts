// MCP server: gives AI agents the terminal's market data and real on-chain quotes. On its own it only reads and holds no keys.
// Given an agent vault and that vault's agent key (AGENT_VAULT, AGENT_KEY), it can also trade, but only through the vault: what it
// buys stays there, sales pay back there, and the vault's owner-set limits apply to every trade. The key can't withdraw anything.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { createPublicClient, createWalletClient, formatEther, http, parseAbi, parseEther, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const API_BASE = process.env.TERMINAL_API || 'http://localhost:3001';
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8546';
const VAULT = process.env.AGENT_VAULT as Address | undefined;
const AGENT_KEY = process.env.AGENT_KEY as Hex | undefined;

const client = createPublicClient({ transport: http(RPC_URL) });
const VAULT_ABI = parseAbi([
  'function owner() view returns (address)',
  'function agent() view returns (address)',
  'function limits() view returns (uint128 perTrade, uint128 perDay, uint16 slippageBps, bool listedOnly)',
  'function leftToday() view returns (uint256)',
  'function listed(address) view returns (bool)',
  'function buy(address token, uint256 zroIn, uint256 minOut, uint256 deadline) returns (uint256)',
  'function sell(address token, uint256 tokensIn, uint256 minOut, uint256 deadline) returns (uint256)',
]);
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const agentAccount = VAULT && AGENT_KEY ? privateKeyToAccount(AGENT_KEY) : undefined;
const wallet = agentAccount ? createWalletClient({ account: agentAccount, transport: http(RPC_URL) }) : undefined;
const ROUTER = parseAbi([
  'function quoteBuy(address token, uint256 zroIn) view returns (uint256)',
  'function quoteSell(address token, uint256 tokensIn) view returns (uint256)',
]);

async function api(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new McpError(ErrorCode.InternalError, `Indexer answered ${res.status} for ${path}`);
  return res.json();
}

async function routerAddress(): Promise<Address> {
  const health = (await api('/health')) as { deployment?: { router: Address } | null };
  if (!health.deployment) throw new McpError(ErrorCode.InternalError, 'Contracts are not deployed on this chain yet');
  return health.deployment.router;
}

const address = { type: 'string', description: 'Token contract address' };
const TOOLS = [
  { name: 'get_market_stats', description: 'Totals for the whole market: tokens, graduations, 24 hour volume, trades and traders.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'list_tokens',
    description: 'List tokens from every launchpad on the chain. Sort: new, volume, progress, mcap, active. Stage: curve, graduating, graduated, external.',
    inputSchema: { type: 'object', properties: { sort: { type: 'string' }, stage: { type: 'string' }, limit: { type: 'number' } } },
  },
  { name: 'search_tokens', description: 'Find tokens by name, symbol or address.', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } },
  { name: 'get_token', description: 'One token with price, market cap, curve progress, holders and 24 hour stats.', inputSchema: { type: 'object', properties: { address }, required: ['address'] } },
  { name: 'get_token_trades', description: 'Recent trades of a token.', inputSchema: { type: 'object', properties: { address, limit: { type: 'number' } }, required: ['address'] } },
  { name: 'get_wallet', description: 'A wallet: holdings with cost basis, recent trades and tokens it launched.', inputSchema: { type: 'object', properties: { address }, required: ['address'] } },
  {
    name: 'quote_buy',
    description: 'On-chain quote: tokens out for a ZRO amount at the best venue, after fees.',
    inputSchema: { type: 'object', properties: { address, zro: { type: 'string', description: 'ZRO amount, for example "50"' } }, required: ['address', 'zro'] },
  },
  {
    name: 'quote_sell',
    description: 'On-chain quote: ZRO out for a token amount at the best venue, after fees.',
    inputSchema: { type: 'object', properties: { address, tokens: { type: 'string', description: 'Token amount, for example "1000"' } }, required: ['address', 'tokens'] },
  },
];

// Trading through an agent vault, offered only when the vault and its agent key are set.
const VAULT_TOOLS = [
  { name: 'vault_status', description: "The agent vault: its ZRO, the owner's limits, what is left to spend today, and what it holds.", inputSchema: { type: 'object', properties: {} } },
  {
    name: 'vault_buy',
    description: "Buy a token with the vault's ZRO at the best venue. The tokens stay in the vault. Refused above the owner's limits.",
    inputSchema: {
      type: 'object',
      properties: { address, zro: { type: 'string', description: 'ZRO to spend, for example "20"' }, slippage: { type: 'number', description: "Percent the trade may slip from the quote. Defaults to the vault's own limit." } },
      required: ['address', 'zro'],
    },
  },
  {
    name: 'vault_sell',
    description: "Sell a token the vault holds at the best venue. The ZRO comes back to the vault.",
    inputSchema: {
      type: 'object',
      properties: { address, tokens: { type: 'string', description: 'Token amount, or "all"' }, slippage: { type: 'number', description: "Percent the trade may slip from the quote. Defaults to the vault's own limit." } },
      required: ['address', 'tokens'],
    },
  },
];

async function vaultLimits() {
  const [perTrade, perDay, slippageBps, listedOnly] = await client.readContract({ address: VAULT!, abi: VAULT_ABI, functionName: 'limits' });
  return { perTrade, perDay, slippageBps, listedOnly };
}

/** The least a trade must get: the quote less the slippage asked for, never looser than the vault allows. */
function floor(quote: bigint, askedPct: number | undefined, vaultBps: number): bigint {
  const bps = askedPct === undefined ? vaultBps : Math.min(vaultBps, Math.round(askedPct * 100));
  return (quote * BigInt(10_000 - bps)) / 10_000n;
}

async function vaultTrade(write: { functionName: 'buy' | 'sell'; args: readonly [Address, bigint, bigint, bigint] }) {
  const hash = await wallet!.writeContract({ address: VAULT!, abi: VAULT_ABI, chain: null, ...write });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new McpError(ErrorCode.InternalError, `The trade reverted: ${hash}`);
  return hash;
}

const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 60);

const server = new Server({ name: 'submarine', version: '0.3.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: wallet ? [...TOOLS, ...VAULT_TOOLS] : TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, string | number | undefined>;
  const a = encodeURIComponent(String(args.address ?? ''));
  const query = (o: Record<string, unknown>) => new URLSearchParams(Object.entries(o).flatMap(([k, v]): [string, string][] => (v === undefined ? [] : [[k, String(v)]]))).toString();

  let result: unknown;
  switch (req.params.name) {
    case 'get_market_stats':
      result = await api('/api/v1/market/stats');
      break;
    case 'list_tokens':
      result = await api(`/api/v1/tokens?${query({ sort: args.sort, stage: args.stage, limit: args.limit })}`);
      break;
    case 'search_tokens':
      result = await api(`/api/v1/tokens?${query({ q: args.q })}`);
      break;
    case 'get_token':
      result = await api(`/api/v1/tokens/${a}`);
      break;
    case 'get_token_trades':
      result = await api(`/api/v1/tokens/${a}/trades?${query({ limit: args.limit })}`);
      break;
    case 'get_wallet':
      result = await api(`/api/v1/wallet/${a}`);
      break;
    case 'quote_buy': {
      const out = await client.readContract({ address: await routerAddress(), abi: ROUTER, functionName: 'quoteBuy', args: [String(args.address) as Address, parseEther(String(args.zro))] });
      result = { tokensOut: formatEther(out), route: out > 0n ? 'available' : 'none' };
      break;
    }
    case 'quote_sell': {
      const out = await client.readContract({ address: await routerAddress(), abi: ROUTER, functionName: 'quoteSell', args: [String(args.address) as Address, parseEther(String(args.tokens))] });
      result = { zroOut: formatEther(out), route: out > 0n ? 'available' : 'none' };
      break;
    }
    case 'vault_status':
    case 'vault_buy':
    case 'vault_sell': {
      if (!wallet || !VAULT) throw new McpError(ErrorCode.MethodNotFound, 'Set AGENT_VAULT and AGENT_KEY to trade');
      const l = await vaultLimits();
      const token = String(args.address ?? '') as Address;
      const slippage = args.slippage === undefined ? undefined : Number(args.slippage);
      if (req.params.name === 'vault_status') {
        const [zro, left, holdings] = await Promise.all([
          client.getBalance({ address: VAULT }),
          client.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'leftToday' }),
          api(`/api/v1/wallet/${VAULT}`).catch(() => null),
        ]);
        result = {
          vault: VAULT,
          agent: agentAccount!.address,
          zro: formatEther(zro),
          leftToday: formatEther(left),
          limits: { perTrade: formatEther(l.perTrade), perDay: formatEther(l.perDay), slippagePct: l.slippageBps / 100, listedOnly: l.listedOnly },
          holdings,
        };
        break;
      }
      const router = await routerAddress();
      if (req.params.name === 'vault_buy') {
        const zroIn = parseEther(String(args.zro));
        const quote = await client.readContract({ address: router, abi: ROUTER, functionName: 'quoteBuy', args: [token, zroIn] });
        if (quote === 0n) throw new McpError(ErrorCode.InvalidParams, 'No venue sells this token');
        const hash = await vaultTrade({ functionName: 'buy', args: [token, zroIn, floor(quote, slippage, l.slippageBps), deadline()] });
        result = { tx: hash, quotedTokens: formatEther(quote) };
      } else {
        const held = await client.readContract({ address: token, abi: ERC20, functionName: 'balanceOf', args: [VAULT] });
        const tokensIn = String(args.tokens) === 'all' ? held : parseEther(String(args.tokens));
        if (tokensIn === 0n || tokensIn > held) throw new McpError(ErrorCode.InvalidParams, `The vault holds ${formatEther(held)} of this token`);
        const quote = await client.readContract({ address: router, abi: ROUTER, functionName: 'quoteSell', args: [token, tokensIn] });
        const hash = await vaultTrade({ functionName: 'sell', args: [token, tokensIn, floor(quote, slippage, l.slippageBps), deadline()] });
        result = { tx: hash, quotedZro: formatEther(quote) };
      }
      break;
    }
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool ${req.params.name}`);
  }
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

await server.connect(new StdioServerTransport());
