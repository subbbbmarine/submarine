'use client';

import { encodeFunctionData, maxUint256, parseEther, type Address } from 'viem';
import { getDeployment } from './api';
import { ERC20_ABI, ROUTER_ABI } from './config';
import { encodePad, gasKindOf, padOf, spenderOf } from './launchpads';
import { deadline, fillsCurve, forgetHeld, freshQuote, heldNow, knownAllowance, prepareSell, quoteBuy, quoteSell, readAllowance, setKnownAllowance, withSlippage } from './prep';
import { send } from './tx';
import { publicClient, useWallet } from './wallet';

export { quoteBuy, quoteSell };

export async function marketBuy(token: Address, symbol: string, zro: string, label?: string) {
  const startedAt = performance.now();
  const { account, slippageBps } = useWallet.getState();
  if (!account) throw new Error('Create a wallet first');
  const { router } = await getDeployment();
  const value = parseEther(zro);
  const pad = await padOf(token);
  const receipt = await send(
    pad
      ? {
          label: label ?? `Buy ${symbol} for ${zro} ZRO`,
          to: pad.contract,
          value,
          startedAt,
          build: async () => {
            if (!pad.buy) throw new Error(`Buying on ${pad.name} isn't connected yet`);
            const quote = freshQuote('buy', token, value) ?? (await quoteBuy(token, value));
            if (quote === 0n) throw new Error(`${pad.name} isn't selling this token right now`);
            return { estimate: true, data: encodePad(pad.buy, { token, zro: value, amount: value, minOut: floorOf(quote, slippageBps), to: account.address, deadline: deadline() }) };
          },
        }
      : {
          label: label ?? `Buy ${symbol} for ${zro} ZRO`,
          to: router,
          value,
          startedAt,
          gasKey: `buy:${token}`,
          gasKind: await gasKindOf(token, 'buy'),
          build: async () => {
            const [quote, fills] = await Promise.all([freshQuote('buy', token, value) ?? quoteBuy(token, value), fillsCurve(token, value)]);
            if (quote === 0n) throw new Error('No venue can trade this token yet');
            return { estimate: fills, data: encodeFunctionData({ abi: ROUTER_ABI, functionName: 'buy', args: [token, floorOf(quote, slippageBps), account.address, deadline()] }) };
          },
        },
  );
  void readyToSell(token, symbol);
  return receipt;
}

/** The least a trade may bring. With no quote to go on there's no floor, which only another launchpad's file can leave us with. */
const floorOf = (quote: bigint | null, bps: number) => (quote === null ? 0n : withSlippage(quote, bps));

/**
 * After a buy, so the first sale is one transaction and not two with a wait between them. Selling is usually when it matters
 * most. If this fails, the sale asks for the allowance itself.
 */
export async function readyToSell(token: Address, symbol: string) {
  const { account } = useWallet.getState();
  if (!account) return;
  const { router } = await getDeployment();
  const pad = await padOf(token);
  forgetHeld(token, account.address);
  void prepareSell(token, true);
  await ensureAllowance(token, symbol, pad ? spenderOf(pad) : router, 1n, true).catch(() => {});
  void prepareSell(token, true);
}

const approving = new Map<string, Promise<unknown>>();

/** Spend approval for a contract, sent only the first time. With 0x76 this folds into one atomic transaction. */
export async function ensureAllowance(token: Address, symbol: string, spender: Address, amount: bigint, quiet = false) {
  const { account } = useWallet.getState();
  if (!account) throw new Error('Create a wallet first');
  const key = `${account.address}:${token}:${spender}`;
  // One may already be on its way from the buy just before this.
  await approving.get(key)?.catch(() => {});
  const known = knownAllowance(account.address, token, spender);
  if (known !== undefined && known >= amount) return;
  if ((await readAllowance(account.address, token, spender)) >= amount) return;
  const sending = send({
    label: `Allow trading ${symbol}`,
    to: token,
    quiet,
    gasKey: `approve:${token}`,
    gasKind: 'approve',
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [spender, maxUint256] }),
  });
  approving.set(key, sending);
  try {
    await sending;
    setKnownAllowance(account.address, token, spender, maxUint256);
  } finally {
    approving.delete(key);
  }
}

export async function tokenBalance(token: Address, who: Address): Promise<bigint> {
  return publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [who] });
}

/** Sells a share of what this wallet holds. Used by the keyboard and by copying someone's sale. */
export async function sellShare(token: Address, symbol: string, percent: number, label?: string) {
  const startedAt = performance.now();
  const { account } = useWallet.getState();
  if (!account) throw new Error('Create a wallet first');
  const amountHeld = await heldNow(token, account.address);
  if (amountHeld === 0n) throw new Error(`You don't hold ${symbol}`);
  const amount = percent >= 100 ? amountHeld : (amountHeld * BigInt(Math.round(percent))) / 100n;
  return marketSell(token, symbol, amount, label ?? `Sell ${percent}% of ${symbol}`, startedAt);
}

export async function marketSell(token: Address, symbol: string, amount: bigint, label?: string, startedAt = performance.now()) {
  const { account, slippageBps } = useWallet.getState();
  if (!account) throw new Error('Create a wallet first');
  const { router } = await getDeployment();
  const pad = await padOf(token);
  const spender = pad ? spenderOf(pad) : router;
  const receipt = await send(
    pad
      ? {
          label: label ?? `Sell ${symbol}`,
          to: pad.contract,
          startedAt,
          build: async () => {
            if (!pad.sell) throw new Error(`Selling on ${pad.name} isn't connected yet`);
            await ensureAllowance(token, symbol, spender, amount);
            const quote = freshQuote('sell', token, amount) ?? (await quoteSell(token, amount));
            if (quote === 0n) throw new Error(`${pad.name} isn't buying this token back right now`);
            return { estimate: true, data: encodePad(pad.sell, { token, amount, minOut: floorOf(quote, slippageBps), to: account.address, deadline: deadline() }) };
          },
        }
      : {
          label: label ?? `Sell ${symbol}`,
          to: router,
          startedAt,
          gasKey: `sell:${token}`,
          gasKind: await gasKindOf(token, 'sell'),
          build: async () => {
            await ensureAllowance(token, symbol, router, amount);
            const quote = freshQuote('sell', token, amount) ?? (await quoteSell(token, amount));
            if (quote === 0n) throw new Error('No venue can trade this token yet');
            return { data: encodeFunctionData({ abi: ROUTER_ABI, functionName: 'sell', args: [token, amount, floorOf(quote, slippageBps), account.address, deadline()] }) };
          },
        },
  ).catch((err) => {
    // The allowance may have been revoked from elsewhere, so ask the chain next time.
    setKnownAllowance(account.address, token, spender, 0n);
    throw err;
  });
  forgetHeld(token, account.address);
  void prepareSell(token, true);
  return receipt;
}
