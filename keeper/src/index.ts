// Runs what anyone may run and is paid for: filling orders whose condition has come, raising trailing stops' highs, copying
// leaders' trades for CopyVault followers, and selling followers' positions at their take profit or stop loss. Every one of
// these is checked by the contracts themselves, so this is a convenience, not a trusted party: if it stops, anyone else can
// do the same, and every owner can always cancel or withdraw.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, nonceManager, parseAbi, parseAbiItem, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { pino } from 'pino';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const CHAIN_ID = parseInt(process.env.CHAIN_ID || '31337');
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8546';
const KEY = process.env.KEEPER_PRIVATE_KEY as Hex | undefined;
/** How often to ask for a new block. Work runs once per new block, so this only bounds how late a block is noticed. */
const POLL_MS = parseInt(process.env.KEEPER_POLL_MS || '100');
/** Orders looked at side by side: each takes a few reads, and one after another they'd take blocks. */
const PARALLEL = 16;
/** Copies sent side by side. Enough to land a leader's followers together, few enough that one refused send costs little. */
const COPIES_AT_ONCE = 5;
const BATCH = 32;
/** Log queries go 1000 blocks at a time, which every node we've met accepts. */
const LOG_RANGE = 1000n;

const here = dirname(fileURLToPath(import.meta.url));
const dep = JSON.parse(readFileSync(resolve(here, `../../contracts/deployments/${CHAIN_ID}.json`), 'utf8')) as {
  limitOrders: Address;
  router: Address;
  launchpad: Address;
  copyVault?: Address;
  startBlock?: number;
};

const ORDER =
  '(address owner, uint40 expiry, bool isBuy, bool open, uint16 feeBps, uint8 kind, address token, uint96 runFee, uint128 left, uint128 total, uint128 minOut, uint128 trigger, uint32 group, uint8 legs, uint16 trailBps, uint32 interval, uint40 lastFill, uint16 slices)';
const LIMITS = parseAbi([
  'function ordersCount() view returns (uint256)',
  'function openIds(uint256 from, uint256 count) view returns (uint256[])',
  `function getOrder(uint256 id) view returns (${ORDER})`,
  'function available(uint256 id) view returns (uint256)',
  'function fill(uint256 id, uint256 part) returns (uint256, uint256)',
  'function fillBatch(uint256[] ids, uint256[] parts) returns (uint256)',
  'function poke(uint256[] ids)',
]);
const ROUTER = parseAbi([
  'function quoteBuy(address token, uint256 zroIn) view returns (uint256)',
  'function quoteSell(address token, uint256 tokensIn) view returns (uint256)',
]);
const PAD = parseAbi([
  'function curves(address) view returns (address creator, uint40 createdAt, bool graduated, uint16 feeBps, uint16 holdersBps, uint16 burnBps, bool antiSnipe, uint128 raised, uint128 sold, uint128 supply, uint16 protocolBps)',
]);
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const VAULT = parseAbi([
  'function copyBuy(address follower, address leader, address token) returns (uint256)',
  'function copySell(address follower, address leader, address token) returns (uint256)',
  'function exit(address follower, address token) returns (uint256)',
  'function positions(address follower, address token) view returns (uint128 tokens, uint128 cost)',
]);
const FOLLOWED = parseAbiItem(
  'event Followed(address indexed follower, address indexed leader, (uint128 perTrade, uint128 perToken, uint128 perDay, uint16 sizeBps, uint16 slippageBps, uint16 chaseBps, uint16 minSellBps, bool buyOnce, bool copySells, uint32 maxAge) rules)',
);
const UNFOLLOWED = parseAbiItem('event Unfollowed(address indexed follower, address indexed leader)');
const EXIT_SET = parseAbiItem('event ExitSet(address indexed follower, (uint16 takeProfitBps, uint16 stopLossBps, uint16 slippageBps) exit)');
const COPIED_BUY = parseAbiItem('event CopiedBuy(address indexed follower, address indexed leader, address indexed token, uint256 zro, uint256 tokens, address by)');
const ROUTED = parseAbiItem('event Routed(address indexed token, address indexed trader, address indexed venue, bool isBuy, uint256 zroAmount, uint256 tokenAmount, uint256 fee)');

const KIND = { LIMIT: 0, STOP: 1, TRAILING: 2, ON_GRADUATION: 3, ON_DEV_SELL: 4, DCA: 5 } as const;
const BPS = 10_000n;

if (!KEY) {
  log.error('KEEPER_PRIVATE_KEY is not set');
  process.exit(1);
}
// Nonces are counted here, so sends that follow each other or go out together never wait to ask the node for one.
const account = privateKeyToAccount(KEY, { nonceManager });
const chain = {
  id: CHAIN_ID,
  name: 'Zero',
  nativeCurrency: { name: 'ZRO', symbol: 'ZRO', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};
const client = createPublicClient({ chain, transport: http(RPC_URL) });
const wallet = createWalletClient({ chain, transport: http(RPC_URL), account });

/** The gas price, asked for at most every few seconds instead of before every send. */
let price: { value: bigint; at: number } | null = null;

/**
 * A send the node refused (underpriced, a nonce out of line) leaves the counted nonces ahead of the chain, and every later
 * send would queue behind the gap. So the count starts again from the chain, and the price is asked for fresh.
 */
function afterRefusedSend(err: unknown) {
  const text = String((err as Error)?.message ?? err);
  if (!/nonce|underpriced|replacement|fee too low|gas price/i.test(text)) return;
  nonceManager.reset({ address: account.address, chainId: CHAIN_ID });
  price = null;
}
async function fees(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  if (!price || Date.now() - price.at > 5_000) price = { value: await client.getGasPrice(), at: Date.now() };
  return { maxFeePerGas: price.value, maxPriorityFeePerGas: price.value };
}

/** Runs `fn` over `items` with at most `n` at once, keeping their order in the result. */
async function inParallel<T, R>(items: readonly T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }));
  return out;
}

type Order = {
  owner: Address;
  expiry: number;
  isBuy: boolean;
  open: boolean;
  feeBps: number;
  kind: number;
  token: Address;
  runFee: bigint;
  left: bigint;
  total: bigint;
  minOut: bigint;
  trigger: bigint;
  group: number;
  legs: number;
  trailBps: number;
  interval: number;
  lastFill: number;
  slices: number;
};

/** The smallest part of an order worth filling on its own, as a fraction of the whole: its share of the run fee has to pay for the gas. */
const SMALLEST = 20n;

const quoteSell = (token: Address, amount: bigint) => client.readContract({ address: dep.router, abi: ROUTER, functionName: 'quoteSell', args: [token, amount] });
const curveOf = (token: Address) => client.readContract({ address: dep.launchpad, abi: PAD, functionName: 'curves', args: [token] });

/** Whether the market would pay this part of the order its share of the owner's minimum, right now. */
async function clears(o: Order, part: bigint): Promise<boolean> {
  const feeBps = BigInt(o.feeBps); // each order carries the fees it was placed under
  const scaled = (o.minOut * part + o.total - 1n) / o.total;
  const run = (o.runFee * part + o.total - 1n) / o.total; // the contract pays a share of the fee per part, rounded up
  if (o.isBuy) {
    const fee = (part * feeBps) / BPS;
    if (part <= fee + run) return false;
    return (await client.readContract({ address: dep.router, abi: ROUTER, functionName: 'quoteBuy', args: [o.token, part - fee - run] })) >= scaled;
  }
  const got = await quoteSell(o.token, part);
  return got >= scaled + (got * feeBps) / BPS + run;
}

/**
 * The most of an order the market serves at the owner's price, found by bisection. Every buy moves the price against the next
 * one, so a big order at a close level fills as far as its level allows and waits for the rest, the way it would on a book.
 */
async function fillableAtLevel(o: Order, room: bigint): Promise<bigint> {
  if (await clears(o, room)) return room;
  const floor = o.total / SMALLEST;
  if (room <= floor || !(await clears(o, floor))) return 0n;
  let low = floor;
  let high = room;
  for (let i = 0; i < 7; i++) {
    const mid = (low + high) / 2n;
    if (await clears(o, mid)) low = mid;
    else high = mid;
  }
  return low;
}

/** How much of an order to try now, or 0 if its condition hasn't come. The contract checks again, so a mistake here only costs a skipped fill. */
async function partFor(o: Order, room: bigint, now: number): Promise<bigint> {
  if (o.expiry !== 0 && o.expiry < now) return room > 0n ? room : 1n; // the fill closes and refunds it
  if (room === 0n) return 0n;
  switch (o.kind) {
    case KIND.LIMIT:
      return fillableAtLevel(o, room);
    case KIND.DCA: {
      if (o.lastFill !== 0 && now < o.lastFill + o.interval) return 0n;
      const slice = (o.total + BigInt(o.slices) - 1n) / BigInt(o.slices);
      const part = room < slice ? room : slice;
      return (await clears(o, part)) ? part : 0n;
    }
    case KIND.ON_GRADUATION: {
      const [, , graduated] = await curveOf(o.token);
      return graduated && (await clears(o, room)) ? room : 0n;
    }
    case KIND.ON_DEV_SELL: {
      const [creator] = await curveOf(o.token);
      const holds = await client.readContract({ address: o.token, abi: ERC20, functionName: 'balanceOf', args: [creator] });
      return holds <= o.trigger && (await clears(o, room)) ? room : 0n;
    }
    case KIND.STOP: {
      const got = await quoteSell(o.token, room);
      return got * o.total <= o.trigger * room && (await clears(o, room)) ? room : 0n;
    }
    case KIND.TRAILING: {
      const got = await quoteSell(o.token, room);
      return got * o.total * BPS <= o.trigger * room * (BPS - BigInt(o.trailBps)) && (await clears(o, room)) ? room : 0n;
    }
    default:
      return 0n;
  }
}

let lastPoke = 0;
/** Orders in a batch still on its way, left alone until it lands so the next block doesn't send them again. */
const pending = new Set<bigint>();

async function fillOrders(): Promise<void> {
  const count = await client.readContract({ address: dep.limitOrders, abi: LIMITS, functionName: 'ordersCount' });
  if (count === 0n) return;
  const ids = (await client.readContract({ address: dep.limitOrders, abi: LIMITS, functionName: 'openIds', args: [0n, count] })).filter((id) => !pending.has(id));
  const now = Math.floor(Date.now() / 1000);

  // Simulate each fill on its own. This is also the only trustworthy gas number: fillBatch swallows failed fills with
  // try/catch, so estimating the batch finds the least gas at which the batch "succeeds", which is too little to fill.
  const looked = await inParallel(ids, PARALLEL, async (id) => {
    const [o, room] = await Promise.all([
      client.readContract({ address: dep.limitOrders, abi: LIMITS, functionName: 'getOrder', args: [id] }) as unknown as Promise<Order>,
      client.readContract({ address: dep.limitOrders, abi: LIMITS, functionName: 'available', args: [id] }),
    ]);
    const [high, part] = await Promise.all([o.kind === KIND.TRAILING ? quoteSell(o.token, o.total).then((v) => v > o.trigger) : false, partFor(o, room, now)]);
    if (part === 0n) return { id, high, part, gas: 0n };
    try {
      return { id, high, part, gas: await client.estimateContractGas({ address: dep.limitOrders, abi: LIMITS, functionName: 'fill', args: [id, part], account }) };
    } catch {
      // the quote looked fine but the fill itself would revert, so paying gas to find out again would be waste
      return { id, high, part: 0n, gas: 0n };
    }
  });
  const highs = looked.filter((l) => l.high).map((l) => l.id);
  const queue = looked.filter((l) => l.part > 0n).slice(0, BATCH);

  // A trailing stop's high only counts once it's on the chain. At most every ten seconds, since each raise costs gas.
  if (highs.length && Date.now() - lastPoke > 10_000) {
    lastPoke = Date.now();
    const hash = await wallet.writeContract({ address: dep.limitOrders, abi: LIMITS, functionName: 'poke', args: [highs], ...(await fees()) });
    log.info({ raised: highs.length, hash }, 'trailing highs');
  }

  if (!queue.length) return;
  const args = [queue.map((q) => q.id), queue.map((q) => q.part)] as const;
  const gas = queue.reduce((sum, q) => sum + q.gas, 60_000n);
  // Some chains charge the declared limit, so keep the margin small. The extra covers the batch's own call overhead per order.
  const limit = (gas * 125n) / 100n + 30_000n * BigInt(queue.length);
  let hash: Hex;
  try {
    hash = await wallet.writeContract({ address: dep.limitOrders, abi: LIMITS, functionName: 'fillBatch', args, gas: limit, ...(await fees()) });
  } catch (err) {
    afterRefusedSend(err);
    throw err;
  }
  // The next block's look goes on without waiting for this one to land; only these orders sit it out.
  for (const q of queue) pending.add(q.id);
  void client
    .waitForTransactionReceipt({ hash, pollingInterval: 100 })
    .then((receipt) => log.info({ tried: queue.length, hash, status: receipt.status }, 'fill batch'))
    .catch((err) => log.warn({ hash, err: (err as Error).message.split('\n')[0] }, 'fill batch not confirmed'))
    .finally(() => {
      for (const q of queue) pending.delete(q.id);
    });
}

// ---------------------------------------------------------------- copy trading

/** leader -> followers, and every follower's tokens, rebuilt from the vault's own events. */
const followersOf = new Map<Address, Set<Address>>();
const exitsSet = new Set<Address>();
const held = new Map<Address, Set<Address>>();
let scanned = 0n;

const lc = (a: string) => a.toLowerCase() as Address;

async function logs<T>(from: bigint, to: bigint, address: Address, event: T) {
  const out: unknown[] = [];
  for (let start = from; start <= to; start += LOG_RANGE) {
    const end = start + LOG_RANGE - 1n < to ? start + LOG_RANGE - 1n : to;
    out.push(...(await client.getLogs({ address, event: event as never, fromBlock: start, toBlock: end, strict: true })));
  }
  return out as unknown as Array<{ args: Record<string, never>; blockNumber: bigint }>;
}

async function send(functionName: 'copyBuy' | 'copySell' | 'exit', args: readonly Address[]): Promise<void> {
  let gas: bigint;
  try {
    gas = await client.estimateContractGas({ address: dep.copyVault!, abi: VAULT, functionName, args: args as never, account });
  } catch {
    return; // outside the follower's limits, already done, or not reached: the contract said no, which is the normal case
  }
  try {
    const hash = await wallet.writeContract({ address: dep.copyVault!, abi: VAULT, functionName, args: args as never, gas: (gas * 120n) / 100n, ...(await fees()) });
    log.info({ run: functionName, args, hash }, 'copy vault');
  } catch (err) {
    afterRefusedSend(err);
    log.warn({ run: functionName, args, err: (err as Error).message.split('\n')[0] }, 'copy not sent');
  }
}

async function runCopies(): Promise<void> {
  if (!dep.copyVault) return;
  const head = await client.getBlockNumber();
  if (scanned === 0n) scanned = BigInt(dep.startBlock ?? Number(head) - 1) - 1n;
  if (head <= scanned) return;
  const from = scanned + 1n;
  // Catching up on a long gap would only find trades too old to copy, so the vault's own history is read in full and the
  // router's only for the last few hundred blocks.
  const [followed, unfollowed, exits, bought] = await Promise.all([
    logs(from, head, dep.copyVault, FOLLOWED),
    logs(from, head, dep.copyVault, UNFOLLOWED),
    logs(from, head, dep.copyVault, EXIT_SET),
    logs(from, head, dep.copyVault, COPIED_BUY),
  ]);
  const ordered = [...followed.map((e) => ({ ...e, on: true })), ...unfollowed.map((e) => ({ ...e, on: false }))].sort((a, b) => Number(a.blockNumber - b.blockNumber));
  for (const e of ordered) {
    const leader = lc(e.args.leader);
    const set = followersOf.get(leader) ?? new Set<Address>();
    if (e.on) set.add(lc(e.args.follower));
    else set.delete(lc(e.args.follower));
    followersOf.set(leader, set);
  }
  for (const e of exits) exitsSet.add(lc(e.args.follower));
  for (const e of bought) {
    const set = held.get(lc(e.args.follower)) ?? new Set<Address>();
    set.add(lc(e.args.token));
    held.set(lc(e.args.follower), set);
  }

  const recent = head - from > 300n ? head - 300n : from;
  const trades = await logs(recent, head, dep.router, ROUTED);
  scanned = head;
  // Copies go out a few at a time, so they can land in the block after the leader's without one stuck send holding up many.
  const copies: Array<readonly ['copyBuy' | 'copySell', readonly Address[]]> = [];
  for (const t of trades) {
    const leader = lc(t.args.trader);
    const followers = followersOf.get(leader);
    if (!followers?.size) continue;
    for (const follower of followers) copies.push([t.args.isBuy ? 'copyBuy' : 'copySell', [follower, leader, lc(t.args.token)]] as const);
  }
  await inParallel(copies, COPIES_AT_ONCE, ([name, args]) => send(name, args));
}

let lastExits = 0;

/** Take profit and stop loss over followers' positions. Every few seconds is plenty, and each check is a free simulation. */
async function runExits(): Promise<void> {
  if (!dep.copyVault || Date.now() - lastExits < 5_000) return;
  lastExits = Date.now();
  const pairs = [...exitsSet].flatMap((follower) => [...(held.get(follower) ?? [])].map((token) => [follower, token] as const));
  await inParallel(pairs, PARALLEL, async ([follower, token]) => {
    const [tokens] = await client.readContract({ address: dep.copyVault!, abi: VAULT, functionName: 'positions', args: [follower, token] });
    if (tokens > 0n) await send('exit', [follower, token]);
  });
}

log.info({ keeper: account.address, limitOrders: dep.limitOrders, copyVault: dep.copyVault, chainId: CHAIN_ID }, 'keeper up');

/**
 * Each job runs once per new block, and the three run side by side: copies don't wait for an order batch, and a slow look at
 * the orders doesn't hold up the next block's copies. A job still busy when a block comes picks it up when it's done.
 */
const jobs = [
  ['orders', fillOrders],
  ['copies', runCopies],
  ['exits', runExits],
] as const;
const busy = new Set<string>();
let seen = -1n;
let ranAt = 0;
for (;;) {
  try {
    const head = await client.getBlockNumber({ cacheTime: 0 });
    // Once a second without a block too: DCA slices and expiries come due with time, and a quiet chain may make no blocks.
    if (head !== seen || Date.now() - ranAt > 1000) {
      seen = head;
      ranAt = Date.now();
      for (const [name, job] of jobs) {
        if (busy.has(name)) continue;
        busy.add(name);
        void job()
          .catch((err) => log.warn({ job: name, err: (err as Error).message.split('\n')[0] }, 'tick failed'))
          .finally(() => busy.delete(name));
      }
    }
  } catch (err) {
    log.warn({ err: (err as Error).message.split('\n')[0] }, 'no head');
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
