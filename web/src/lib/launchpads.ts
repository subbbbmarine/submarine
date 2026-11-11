'use client';

import { useEffect, useState } from 'react';
import { encodeFunctionData, parseAbiItem, parseEventLogs, type AbiEvent, type AbiFunction, type Address, type Hex, type Log } from 'viem';
import { get, type Token } from './api';
import { publicClient } from './wallet';

/**
 * Launchpads other than our own, as their files in launchpads/ describe them. The indexer serves those files, and this turns
 * them into calls, so a new launchpad needs no new build of the site. See launchpads/README.md for the format.
 */
export interface PadCall {
  function: string;
  /** "{name}" style fields are filled in when the call is made. Anything else is sent as written. */
  args: unknown[];
  /** On a quote that returns several values, which one is the amount. */
  output?: number;
  /** Who the tokens have to be approved to, on a sale, when it isn't the contract itself. */
  spender?: Address;
}
export interface Launchpad {
  id: string;
  name: string;
  /** Our own, which has its own code path through the router. */
  builtin?: boolean;
  contract: Address;
  description?: string;
  site?: string;
  /** Made for trying things out, and labelled so. */
  test?: boolean;
  /** What its curve is, as far as its file says: ZRO to fill it, market cap in ZRO at launch and tokens made. */
  curve?: { target?: number; startCap?: number; supply?: number };
  launch?: PadCall & { fee?: string | { read: string }; fields?: string[] };
  buy?: PadCall;
  sell?: PadCall;
  quoteBuy?: PadCall;
  quoteSell?: PadCall;
  events?: { created?: { event: string; token: string } };
}

let all: Promise<Launchpad[]> | null = null;
export function getLaunchpads(): Promise<Launchpad[]> {
  all ??= get<{ launchpads: Launchpad[] }>('/api/v1/launchpads')
    .then((r) => r.launchpads)
    .catch((err) => {
      all = null;
      throw err;
    });
  return all;
}

export function useLaunchpads(): Launchpad[] {
  const [pads, setPads] = useState<Launchpad[]>([]);
  useEffect(() => {
    getLaunchpads().then(setPads, () => {});
  }, []);
  return pads;
}

interface TokenFacts {
  pad: Launchpad | null;
  paysHolders: boolean;
}
const tokenFacts = new Map<string, Promise<TokenFacts>>();

/** What trading a token depends on. Asked once per token, then remembered. */
function factsOf(token: string): Promise<TokenFacts> {
  const key = token.toLowerCase();
  let known = tokenFacts.get(key);
  if (!known) {
    // If the indexer can't answer right now, a trade through our router shouldn't have to wait for it, so that's not remembered.
    known = Promise.all([get<Token>(`/api/v1/tokens/${key}`), getLaunchpads()])
      .then(([t, pads]) => ({ pad: t.launchpad ? pads.find((p) => p.id === t.launchpad && !p.builtin) ?? null : null, paysHolders: t.fee_route === 'holders' }))
      .catch(() => {
        tokenFacts.delete(key);
        return { pad: null, paysHolders: false };
      });
    tokenFacts.set(key, known);
  }
  return known;
}

/** The other launchpad a token trades on, or null for one that goes through our router. */
export const padOf = (token: string): Promise<Launchpad | null> => factsOf(token).then((f) => f.pad);

/** Which kind of trade to remember gas for. Paying holders costs more on every trade, so those are remembered apart. */
export const gasKindOf = (token: string, side: 'buy' | 'sell'): Promise<string> => factsOf(token).then((f) => (f.paysHolders ? `${side}:holders` : side));

const fnOf = (spec: PadCall) => parseAbiItem(spec.function as string) as AbiFunction;

function argsOf(spec: PadCall, values: Record<string, unknown>): unknown[] {
  const inputs = fnOf(spec).inputs;
  return spec.args.map((arg, i) => {
    const raw = typeof arg === 'string' && /^\{\w+\}$/.test(arg) ? values[arg.slice(1, -1)] : arg;
    if (raw === undefined) throw new Error(`The launchpad's file asks for ${String(arg)}, which nothing provides`);
    const type = inputs[i]?.type ?? '';
    if (/^u?int/.test(type)) return BigInt(raw as string | number | bigint);
    if (type === 'bool') return raw === true || raw === 'true';
    return raw;
  });
}

export const encodePad = (spec: PadCall, values: Record<string, unknown>): Hex => encodeFunctionData({ abi: [fnOf(spec)], args: argsOf(spec, values) });

export async function readPad(pad: Launchpad, spec: PadCall, values: Record<string, unknown>): Promise<bigint> {
  const fn = fnOf(spec);
  const out = (await publicClient.readContract({ address: pad.contract, abi: [fn], functionName: fn.name, args: argsOf(spec, values) } as never)) as unknown;
  return BigInt((Array.isArray(out) ? out[spec.output ?? 0] : out) as bigint);
}

export const spenderOf = (pad: Launchpad): Address => pad.sell?.spender ?? pad.contract;

/** What launching there costs on top of a first buy. */
export async function launchFeeOf(pad: Launchpad): Promise<bigint> {
  const fee = pad.launch?.fee;
  if (!fee) return 0n;
  if (typeof fee === 'string') return BigInt(Math.round(Number(fee) * 1e18));
  const fn = parseAbiItem(fee.read as string) as AbiFunction;
  return BigInt((await publicClient.readContract({ address: pad.contract, abi: [fn], functionName: fn.name } as never)) as bigint);
}

const MINT_TOPICS = ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', '0x0000000000000000000000000000000000000000000000000000000000000000'];

/** The token a launch made: from the launchpad's own event if its file names one, or else from the mint every new token logs. */
export function launchedToken(pad: Launchpad, logs: Log[]): string | null {
  const created = pad.events?.created;
  if (created) {
    const [log] = parseEventLogs({ abi: [parseAbiItem(created.event as string) as AbiEvent], logs }) as unknown as Array<{ args: Record<string, unknown> }>;
    const token = log?.args[created.token];
    if (token) return String(token).toLowerCase();
  }
  const mint = logs.find((l) => l.topics[0] === MINT_TOPICS[0] && l.topics[1] === MINT_TOPICS[1]);
  return mint ? mint.address.toLowerCase() : null;
}
