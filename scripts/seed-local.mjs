// Fills a LOCAL test chain with real transactions so the terminal has something to show. Every token and trade here goes
// through the actual contracts. Refuses to run on anything but chain 31337, and the UI labels the chain as test data.
//   node scripts/seed-local.mjs          seed six hours of history, then exit
//   node scripts/seed-local.mjs --live   keep trading after that, until stopped
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, parseAbi, parseEther } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

const here = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.RPC_URL || 'http://127.0.0.1:8546';
const LIVE = process.argv.includes('--live');

const chain = { id: 31337, name: 'Local', nativeCurrency: { name: 'ZRO', symbol: 'ZRO', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const client = createPublicClient({ chain, transport: http(RPC), pollingInterval: 100 });
if ((await client.getChainId()) !== 31337) throw new Error('Refusing to seed: this is not the local chain');

const dep = JSON.parse(readFileSync(resolve(here, '../contracts/deployments/31337.json'), 'utf8'));
// Anvil's public default test mnemonic, not a secret. It only ever controls local test accounts.
const MNEMONIC = 'test test test test test test test test test test test junk';
const traders = Array.from({ length: 12 }, (_, i) => mnemonicToAccount(MNEMONIC, { addressIndex: i + 2 }));
const walletFor = (account) => createWalletClient({ chain, transport: http(RPC), account });

const PAD = parseAbi([
  'function launch(string name, string symbol, string uri, uint256 minTokensOut) payable returns (address)',
  'function launch(string name, string symbol, string uri, uint256 minTokensOut, uint256 wholeSupply, uint16 devFeeBps, uint16 holdersBps, uint16 burnBps, bool antiSnipe) payable returns (address)',
  'function curves(address) view returns (address creator, uint40 createdAt, bool graduated, uint16 feeBps, uint16 holdersBps, uint16 burnBps, bool antiSnipe, uint128 raised, uint128 sold, uint128 supply, uint16 protocolBps)',
  'event TokenLaunched(address indexed token, address indexed creator, string name, string symbol, string uri, uint256 timestamp)',
]);
const ROUTER = parseAbi([
  'function buy(address token, uint256 minOut, address recipient, uint256 deadline) payable returns (uint256)',
  'function sell(address token, uint256 tokensIn, uint256 minOut, address recipient, uint256 deadline) returns (uint256)',
]);
const ERC20 = parseAbi(['function approve(address, uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)', 'function transfer(address, uint256) returns (bool)']);
const LIMITS = parseAbi([
  'function placeBuy(address token, uint256 minOut, uint40 expiry) payable returns (uint256)',
  'function placeSell(address token, uint256 amount, uint256 minOut, uint40 expiry) returns (uint256)',
  'function fill(uint256 id, uint256 part) returns (uint256, uint256)',
  'function cancel(uint256 id)',
  'function ordersCount() view returns (uint256)',
  'function getOrder(uint256 id) view returns ((address owner, uint40 expiry, bool isBuy, bool open, uint16 feeBps, address token, uint96 runFee, uint128 left, uint128 total, uint128 minOut))',
]);
const QUOTES = parseAbi(['function quoteBuy(address token, uint256 zroIn) view returns (uint256)']);

// Placeholder pictures for demo tokens, from a public avatar service. Only the ticker is sent, and only by the browser.
const art = (symbol) => `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${symbol}`;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const deadline = () => 9_999_999_999n;

let clock = Number((await client.getBlock()).timestamp);
const wait = (hash) => client.waitForTransactionReceipt({ hash, pollingInterval: 50 });
async function advance(seconds) {
  if (LIVE_MODE) return;
  // every mined transaction moves the chain's clock too, so start from where it really is
  const latest = Number((await client.getBlock()).timestamp);
  // Never past the real time: a chain ahead of the clock would expire every trade's deadline in the browser.
  const room = Math.floor(Date.now() / 1000) - 120 - Math.max(clock, latest);
  clock = Math.max(clock, latest) + Math.max(1, Math.min(Math.round(seconds), room));
  await client.request({ method: 'evm_setNextBlockTimestamp', params: [clock] });
}
let LIVE_MODE = false;

const NAMES = [
  ['Slow Lane', 'SLOW'], ['Quiet Harbor', 'HARB'], ['Paper Crane', 'CRANE'], ['Night Shift', 'SHIFT'], ['Copper Moth', 'MOTH'],
  ['Long Division', 'LONG'], ['Second Breakfast', 'BRUNCH'], ['Tin Whistle', 'TIN'], ['Odd Socks', 'SOCKS'], ['Lunar Bakery', 'BAKE'],
  ['Grey Heron', 'HERON'], ['Pocket Storm', 'STORM'], ['Rust Garden', 'RUST'], ['Velvet Anvil', 'VELV'], ['Salt Road', 'SALT'],
  ['Ninth Inning', 'NINTH'], ['Mild Panic', 'MILD'], ['Hollow Oak', 'OAK'],
];
const tokens = [];

async function launch(i) {
  const [name, symbol] = NAMES[i % NAMES.length];
  const creator = pick(traders);
  const receipt = await wait(
    // Every third one adds a fee of its own on top of the 1% base and splits it: some to holders, some to buying it back and
    // burning it, the rest to its creator.
    await walletFor(creator).writeContract({
      address: dep.launchpad,
      abi: PAD,
      functionName: 'launch',
      args: i % 3 === 1 ? [name, symbol, art(symbol), 0n, 1_000_000_000n, 100, 2_000, 3_000, false] : [name, symbol, art(symbol), 0n],
      value: Math.random() < 0.6 ? parseEther(rand(20, 320).toFixed(2)) : 0n,
    }),
  );
  const log = receipt.logs.find((l) => l.address.toLowerCase() === dep.launchpad.toLowerCase());
  const token = `0x${log.topics[1].slice(26)}`;
  tokens.push({ token, symbol, creator, heat: rand(0.2, 1), graduated: false });
  return token;
}

async function tradeOnce(t, bias = 0.68) {
  const trader = pick(traders);
  const wallet = walletFor(trader);
  const balance = await client.readContract({ address: t.token, abi: ERC20, functionName: 'balanceOf', args: [trader.address] });
  if (balance > 0n && Math.random() > bias) {
    await wait(await wallet.writeContract({ address: t.token, abi: ERC20, functionName: 'approve', args: [dep.router, balance] }));
    await advance(rand(1, 8));
    await wait(await wallet.writeContract({ address: dep.router, abi: ROUTER, functionName: 'sell', args: [t.token, (balance * BigInt(Math.floor(rand(20, 100)))) / 100n, 0n, trader.address, deadline()] }));
  } else {
    const size = parseEther(Math.min(rand(12, 440) * t.heat, 1200).toFixed(2));
    await wait(await wallet.writeContract({ address: dep.router, abi: ROUTER, functionName: 'buy', args: [t.token, 0n, trader.address, deadline()], value: size }));
  }
}

// ZRO per token right now, from what a small buy would get.
async function priceOf(t) {
  const out = await client.readContract({ address: dep.router, abi: QUOTES, functionName: 'quoteBuy', args: [t.token, parseEther('0.4')] });
  return out > 0n ? 4e17 / Number(out) : 0;
}

// A resting order a few percent from the market: buys under it, sales over it, some of them big enough to fill only in parts.
async function placeOrder(t) {
  const price = await priceOf(t);
  if (!price) return;
  const trader = pick(traders);
  const wallet = walletFor(trader);
  const away = rand(0.015, 0.22);
  const balance = await client.readContract({ address: t.token, abi: ERC20, functionName: 'balanceOf', args: [trader.address] });
  if (balance > parseEther('1000') && Math.random() < 0.45) {
    const amount = (balance * BigInt(Math.floor(rand(25, 80)))) / 100n;
    const minOut = parseEther(((Number(amount) / 1e18) * price * (1 + away)).toFixed(12));
    await wait(await wallet.writeContract({ address: t.token, abi: ERC20, functionName: 'approve', args: [dep.limitOrders, amount] }));
    await advance(rand(1, 5));
    await wait(await wallet.writeContract({ address: dep.limitOrders, abi: LIMITS, functionName: 'placeSell', args: [t.token, amount, minOut, 0] }));
  } else {
    const size = rand(80, 1000);
    const minOut = parseEther((size / (price * (1 - away))).toFixed(6));
    await wait(await wallet.writeContract({ address: dep.limitOrders, abi: LIMITS, functionName: 'placeBuy', args: [t.token, minOut, 0], value: parseEther(size.toFixed(4)) }));
  }
}

// Plays the keeper while history is written: fills what the market now allows, as far as it allows, the same way the real one does.
const filler = () => traders[0];
async function fillOrders() {
  const count = Number(await client.readContract({ address: dep.limitOrders, abi: LIMITS, functionName: 'ordersCount' }));
  for (let id = 0n; id < BigInt(count); id++) {
    const o = await client.readContract({ address: dep.limitOrders, abi: LIMITS, functionName: 'getOrder', args: [id] });
    if (!o.open) continue;
    for (const part of [o.left, o.left / 2n, o.left / 4n, o.left / 10n]) {
      if (part === 0n) continue;
      try {
        await client.simulateContract({ account: filler(), address: dep.limitOrders, abi: LIMITS, functionName: 'fill', args: [id, part] });
      } catch {
        continue;
      }
      await advance(rand(1, 4));
      await wait(await walletFor(filler()).writeContract({ address: dep.limitOrders, abi: LIMITS, functionName: 'fill', args: [id, part] }));
      break;
    }
  }
}

// What a creator does besides trading: hands some to another wallet, burns a little.
async function creatorMoves(t) {
  const wallet = walletFor(t.creator);
  const balance = await client.readContract({ address: t.token, abi: ERC20, functionName: 'balanceOf', args: [t.creator.address] });
  if (balance === 0n) return;
  const other = pick(traders.filter((x) => x.address !== t.creator.address));
  await wait(await wallet.writeContract({ address: t.token, abi: ERC20, functionName: 'transfer', args: [other.address, balance / 5n] }));
  if (Math.random() < 0.5) {
    await advance(rand(30, 200));
    await wait(await wallet.writeContract({ address: t.token, abi: ERC20, functionName: 'transfer', args: ['0x000000000000000000000000000000000000dEaD', balance / 20n] }));
  }
}

async function refresh(t) {
  const c = await client.readContract({ address: dep.launchpad, abi: PAD, functionName: 'curves', args: [t.token] });
  t.graduated = c[2];
  t.raised = Number(c[7]) / 1e18;
}

// A plain ERC-20 deployed outside the launchpad: the indexer should find it on its own, which is the aggregator's job.
async function deployExternal(name, symbol) {
  const artifact = JSON.parse(readFileSync(resolve(here, '../contracts/out/Base.t.sol/PlainToken.json'), 'utf8'));
  const hash = await walletFor(traders[0]).deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object });
  await wait(hash);
}

const FIRST = 12;
console.log('seeding history');
for (let i = 0; i < FIRST; i++) {
  await advance(rand(600, 1500));
  await launch(i);
  const active = tokens.slice(-5);
  for (let k = 0; k < 14; k++) {
    await advance(rand(10, 90));
    const t = pick(active);
    await tradeOnce(t);
    if (k % 3 === 1) {
      await advance(rand(5, 30));
      await placeOrder(t).catch(() => {});
    }
    if (k % 2 === 0) await fillOrders().catch(() => {});
    if (k === 7) await creatorMoves(tokens[tokens.length - 1]).catch(() => {});
  }
}
await advance(30);
await deployExternal();

// Push two tokens through the whole curve, so pools have real activity too.
for (const t of tokens.slice(0, 2)) {
  await advance(120);
  await wait(await walletFor(pick(traders)).writeContract({ address: dep.router, abi: ROUTER, functionName: 'buy', args: [t.token, 0n, pick(traders).address, deadline()], value: parseEther('7200') }));
  t.graduated = true;
  for (let k = 0; k < 18; k++) {
    await advance(rand(20, 120));
    await tradeOnce(t);
  }
}
// One close to the end of its curve, so "close to the pool" has a story.
await advance(60);
await wait(await walletFor(pick(traders)).writeContract({ address: dep.router, abi: ROUTER, functionName: 'buy', args: [tokens[3].token, 0n, traders[1].address, deadline()], value: parseEther('4400') }));

// Leave a book resting around the price on the tokens people will open first.
for (const t of tokens.slice(-6)) {
  for (let k = 0; k < 5; k++) {
    await advance(rand(5, 40));
    await placeOrder(t).catch(() => {});
  }
}

// Catch the chain's clock up with the real one, and switch to mining at a steady pace.
const realNow = Math.floor(Date.now() / 1000);
if (realNow > clock) await client.request({ method: 'evm_setNextBlockTimestamp', params: [realNow] });
await client.request({ method: 'anvil_mine', params: ['0x1'] });
await client.request({ method: 'evm_setIntervalMining', params: [1] });
LIVE_MODE = true;
console.log(`seeded ${tokens.length} tokens`);

if (!LIVE) process.exit(0);

console.log('live trading until stopped');
let launches = FIRST;
for (;;) {
  try {
    if (Math.random() < 0.04 && launches < NAMES.length) await launch(launches++);
    const t = Math.random() < 0.55 ? pick(tokens.slice(-5)) : pick(tokens);
    await tradeOnce(t);
    await refresh(t);
  } catch (err) {
    console.log('skip:', err.shortMessage ?? err.message);
  }
  await new Promise((r) => setTimeout(r, rand(400, 3000)));
}
