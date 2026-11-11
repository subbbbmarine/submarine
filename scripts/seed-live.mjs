// Keeps a local chain's demo market moving after seed-local.mjs has run. Local chain only, and the UI says it's test data.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, parseAbi, parseEther } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

const here = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.RPC_URL || 'http://127.0.0.1:8546';
const chain = { id: 31337, name: 'Local', nativeCurrency: { name: 'ZRO', symbol: 'ZRO', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const client = createPublicClient({ chain, transport: http(RPC), pollingInterval: 200 });
if ((await client.getChainId()) !== 31337) throw new Error('Refusing to run: this is not the local chain');

const dep = JSON.parse(readFileSync(resolve(here, '../contracts/deployments/31337.json'), 'utf8'));
const MNEMONIC = 'test test test test test test test test test test test junk';
const traders = Array.from({ length: 12 }, (_, i) => mnemonicToAccount(MNEMONIC, { addressIndex: i + 2 }));
const walletFor = (account) => createWalletClient({ chain, transport: http(RPC), account });

const PAD = parseAbi([
  'function launch(string name, string symbol, string uri, uint256 minTokensOut) payable returns (address)',
  'function tokensCount() view returns (uint256)',
  'function tokenAt(uint256) view returns (address)',
]);
const ROUTER = parseAbi([
  'function buy(address token, uint256 minOut, address recipient, uint256 deadline) payable returns (uint256)',
  'function sell(address token, uint256 tokensIn, uint256 minOut, address recipient, uint256 deadline) returns (uint256)',
]);
const ERC20 = parseAbi(['function approve(address, uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
const LIMITS = parseAbi([
  'function placeBuy(address token, uint256 minOut, uint40 expiry) payable returns (uint256)',
  'function placeSell(address token, uint256 amount, uint256 minOut, uint40 expiry) returns (uint256)',
  'function cancel(uint256 id)',
  'function openIds(uint256 from, uint256 count) view returns (uint256[])',
  'function ordersCount() view returns (uint256)',
  'function getOrder(uint256 id) view returns ((address owner, uint40 expiry, bool isBuy, bool open, uint16 feeBps, address token, uint96 runFee, uint128 left, uint128 total, uint128 minOut))',
]);
const QUOTES = parseAbi(['function quoteBuy(address token, uint256 zroIn) view returns (uint256)']);

// Placeholder pictures for demo tokens, from a public avatar service. Only the ticker is sent, and only by the browser.
const art = (symbol) => `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${symbol}`;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const NEW = [['Mild Panic', 'MILD'], ['Hollow Oak', 'OAK'], ['Salt Road', 'SALT'], ['Ninth Inning', 'NINTH'], ['Velvet Anvil', 'VELV'], ['Rust Garden', 'RUST']];

// Keeps a book resting around the price, so the heatmap and partial fills have something real to show.
async function placeOrder(token, trader, balance) {
  const out = await client.readContract({ address: dep.router, abi: QUOTES, functionName: 'quoteBuy', args: [token, parseEther('0.4')] });
  if (out === 0n) return;
  const price = 4e17 / Number(out);
  const wallet = walletFor(trader);
  const away = rand(0.01, 0.18);
  if (balance > parseEther('1000') && Math.random() < 0.45) {
    const amount = (balance * BigInt(Math.floor(rand(25, 80)))) / 100n;
    const hash = await wallet.writeContract({ address: token, abi: ERC20, functionName: 'approve', args: [dep.limitOrders, amount] });
    await client.waitForTransactionReceipt({ hash });
    await wallet.writeContract({ address: dep.limitOrders, abi: LIMITS, functionName: 'placeSell', args: [token, amount, parseEther(((Number(amount) / 1e18) * price * (1 + away)).toFixed(12)), 0] });
  } else {
    const size = rand(80, 1000);
    await wallet.writeContract({ address: dep.limitOrders, abi: LIMITS, functionName: 'placeBuy', args: [token, parseEther((size / (price * (1 - away))).toFixed(6)), 0], value: parseEther(size.toFixed(4)) });
  }
}

// Now and then someone gives up on an order, so history isn't all fills.
async function cancelOne() {
  const count = await client.readContract({ address: dep.limitOrders, abi: LIMITS, functionName: 'ordersCount' });
  const ids = await client.readContract({ address: dep.limitOrders, abi: LIMITS, functionName: 'openIds', args: [0n, count] });
  if (!ids.length) return;
  const id = pick(ids);
  const o = await client.readContract({ address: dep.limitOrders, abi: LIMITS, functionName: 'getOrder', args: [id] });
  const owner = traders.find((t) => t.address.toLowerCase() === o.owner.toLowerCase());
  if (owner) await walletFor(owner).writeContract({ address: dep.limitOrders, abi: LIMITS, functionName: 'cancel', args: [id] });
}

async function step() {
  const count = Number(await client.readContract({ address: dep.launchpad, abi: PAD, functionName: 'tokensCount' }));
  if (NEW.length && Math.random() < 0.03) {
    const [name, symbol] = NEW.shift();
    await walletFor(pick(traders)).writeContract({ address: dep.launchpad, abi: PAD, functionName: 'launch', args: [name, symbol, art(symbol), 0n], value: parseEther(rand(20, 200).toFixed(2)) });
    return;
  }
  const index = Math.random() < 0.6 ? Math.max(0, count - 1 - Math.floor(rand(0, 5))) : Math.floor(rand(0, count));
  const token = await client.readContract({ address: dep.launchpad, abi: PAD, functionName: 'tokenAt', args: [BigInt(index)] });
  const trader = pick(traders);
  const wallet = walletFor(trader);
  const balance = await client.readContract({ address: token, abi: ERC20, functionName: 'balanceOf', args: [trader.address] });
  if (Math.random() < 0.015) return cancelOne();
  if (Math.random() < 0.1) return placeOrder(token, trader, balance);
  if (balance > 0n && Math.random() < 0.34) {
    const hash = await wallet.writeContract({ address: token, abi: ERC20, functionName: 'approve', args: [dep.router, balance] });
    await client.waitForTransactionReceipt({ hash });
    await wallet.writeContract({ address: dep.router, abi: ROUTER, functionName: 'sell', args: [token, (balance * BigInt(Math.floor(rand(20, 100)))) / 100n, 0n, trader.address, 9_999_999_999n] });
  } else {
    await wallet.writeContract({ address: dep.router, abi: ROUTER, functionName: 'buy', args: [token, 0n, trader.address, 9_999_999_999n], value: parseEther(rand(8, 360).toFixed(2)) });
  }
}

console.log('demo market running');
for (;;) {
  try {
    await step();
  } catch (err) {
    console.log('skip:', err.shortMessage ?? err.message);
  }
  await new Promise((r) => setTimeout(r, rand(500, 3500)));
}
