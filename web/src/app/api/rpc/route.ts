import { NextResponse } from 'next/server';

// A node that sends no CORS headers can't be called from a browser directly. This forwards only what Submarine
// needs, which keeps it from being an open relay for debug or subscription methods. WebSockets aren't affected by CORS,
// so the live streams still go straight from the browser to the node.
const UPSTREAM = process.env.RPC_URL || 'http://127.0.0.1:8546';
const MAX_BODY = 256 * 1024;

const ALLOWED = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_chainId',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockByNumber',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_sendRawTransaction',
  'web3_clientVersion',
]);

interface RpcRequest {
  id?: unknown;
  method?: unknown;
}

export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > MAX_BODY) return NextResponse.json({ message: 'Request too large' }, { status: 413 });

  let parsed: RpcRequest | RpcRequest[];
  try {
    parsed = JSON.parse(text);
  } catch {
    return NextResponse.json({ message: 'Bad JSON' }, { status: 400 });
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  if (calls.length === 0 || calls.length > 20) return NextResponse.json({ message: 'Bad batch size' }, { status: 400 });

  const refused = calls.find((c) => typeof c?.method !== 'string' || !ALLOWED.has(c.method));
  if (refused) {
    return NextResponse.json({ jsonrpc: '2.0', id: refused?.id ?? null, error: { code: -32601, message: 'Method not available through this proxy' } });
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: text,
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    return new NextResponse(await upstream.text(), { status: upstream.status, headers: { 'content-type': 'application/json' } });
  } catch {
    return NextResponse.json({ message: 'The node is not answering' }, { status: 502 });
  }
}
