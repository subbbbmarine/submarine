// Read-only MCP server: gives AI agents the terminal's market data and real on-chain quotes. It holds no keys.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { createPublicClient, formatEther, http, parseAbi, parseEther, type Address } from 'viem';

const API_BASE = process.env.TERMINAL_API || 'http://localhost:3001';
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8546';

const client = createPublicClient({ transport: http(RPC_URL) });
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

const server = new Server({ name: 'submarine', version: '0.2.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

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
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool ${req.params.name}`);
  }
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

await server.connect(new StdioServerTransport());
