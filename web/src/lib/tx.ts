'use client';

import { create } from 'zustand';
import { BaseError, ContractFunctionRevertedError, decodeErrorResult, formatTransactionReceipt, keccak256, numberToHex, parseAbi, type Address, type Hex, type LocalAccount, type RpcTransactionReceipt, type TransactionReceipt } from 'viem';
import { onBlock } from './network';
import { CHAIN_ID } from './config';
import { forgetGas, gasPriceNow, knownGasLimit, nonceAccepted, nonceFinished, nonceRefused, rememberGas, takeNonce } from './prep';
import { extension, isExtension, publicClient, useWallet } from './wallet';

export type Stage = 'submitted' | 'ordered' | 'executed';
export const STAGES: Array<{ key: Stage; label: string; hint: string }> = [
  { key: 'submitted', label: 'Sent', hint: 'The node took the transaction' },
  { key: 'ordered', label: 'In a block', hint: 'Included in a block' },
  { key: 'executed', label: 'Executed', hint: 'The EVM ran it. Now you know if it succeeded' },
];

export type FlowStatus = 'pending' | 'success' | 'reverted' | 'failed';

export interface TxFlow {
  id: number;
  label: string;
  hash: string | null;
  status: FlowStatus;
  error: string | null;
  /** Milliseconds from the click to each stage, measured here. Nothing in this object is ever estimated. */
  stages: Partial<Record<Stage, number>>;
  closed: boolean;
}

interface TxState {
  flows: TxFlow[];
  dismiss: (id: number) => void;
  patch: (id: number, p: Partial<TxFlow>) => void;
  mark: (id: number, stage: Stage, ms: number) => void;
}

export const useTx = create<TxState>((set) => ({
  flows: [],
  dismiss: (id) => set((s) => ({ flows: s.flows.map((f) => (f.id === id ? { ...f, closed: true } : f)) })),
  patch: (id, p) => set((s) => ({ flows: s.flows.map((f) => (f.id === id ? { ...f, ...p } : f)) })),
  mark: (id, stage, ms) =>
    set((s) => ({
      flows: s.flows.map((f) => (f.id === id && f.stages[stage] === undefined ? { ...f, stages: { ...f.stages, [stage]: Math.round(ms) } } : f)),
    })),
}));

const CUSTOM_ERRORS = parseAbi([
  'error Slippage()',
  'error Expired()',
  'error AlreadyGraduated()',
  'error ZeroAmount()',
  'error NoRoute()',
  'error UnknownToken()',
  'error BadOrder()',
  'error NotYours()',
  'error NotOpen()',
  'error BadMetadata()',
  'error WrongLaunchFee()',
  'error NotYet()',
  'error BadRules()',
  'error NotFollowing()',
  'error NothingToCopy()',
  'error TooLittle()',
  'error BadReferrer()',
  'error AlreadyLinked()',
  'error NothingToClaim()',
  'error BoughtThisBlock()',
]);
const FRIENDLY: Record<string, string> = {
  NotYet: "Its condition hasn't come yet",
  BadRules: 'Those copy settings are out of range',
  NotFollowing: "You don't copy this wallet",
  NothingToCopy: 'There is no recent trade of that wallet to copy',
  TooLittle: 'The amount is too small or more than you have there',
  BadReferrer: "You can't link to yourself or to someone you brought",
  AlreadyLinked: 'This wallet is already linked to a referrer',
  NothingToClaim: 'Nothing to claim yet',
  BoughtThisBlock: 'Coins bought in this block can move from the next one, a fraction of a second away. Try again',
  Slippage: 'The price moved past your slippage limit',
  Expired: 'The transaction waited too long and expired',
  AlreadyGraduated: 'This token just moved to its pool. Try again',
  ZeroAmount: 'That amount is too small',
  NoRoute: 'No venue can trade this token yet',
  BadOrder: 'The order was rejected. Check amount, price and expiry',
  NotOpen: 'That order is already closed',
  BadMetadata: 'Name must be 1 to 64 characters, symbol 1 to 16',
};

function explain(err: unknown): string {
  const base = err instanceof BaseError ? err : null;
  const text = base?.details || base?.shortMessage || (err as Error)?.message || 'Transaction failed';
  const reverted = base?.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
  const name = reverted?.data?.errorName;
  if (name && FRIENDLY[name]) return FRIENDLY[name]!;
  const data = (base?.walk((e) => typeof (e as { data?: unknown }).data === 'string') as { data?: Hex } | null)?.data;
  if (data) {
    try {
      const decoded = decodeErrorResult({ abi: CUSTOM_ERRORS, data }).errorName;
      if (FRIENDLY[decoded]) return FRIENDLY[decoded]!;
    } catch {}
  }
  if (/insufficient funds/i.test(text)) return 'Not enough ZRO for this trade and its gas';
  return text.split('\n')[0]!.slice(0, 160);
}

let flowCounter = 0;

export interface Call {
  label: string;
  to: Address;
  data?: Hex;
  value?: bigint;
  /** Work that has to happen before the transaction can be made, like a quote. The card is already up while it runs. */
  build?: () => Promise<{ data: Hex; value?: bigint; estimate?: boolean }>;
  /** Which gas figure this call can use without estimating: this very call, then this kind of call on any token. */
  gasKey?: string;
  gasKind?: string;
  /** Sent in the background to get ready for something else. No card, because nothing was asked for. */
  quiet?: boolean;
  /** When the click happened, if there was work before this. The times on the card are always from the click. */
  startedAt?: number;
  /** Another of the user's own wallets to sign with, instead of the one in use. */
  as?: LocalAccount;
}

const errorText = (err: unknown) => {
  const e = err as { details?: string; shortMessage?: string; message?: string };
  return `${e?.details ?? ''} ${e?.shortMessage ?? ''} ${e?.message ?? ''}`;
};

/**
 * Signs and sends one call, then follows it up the confirmation ladder. Resolves when it has executed. What the UI shows
 * as "done" is only ever a receipt: a leader's promise and order finality say nothing about whether a call succeeded.
 *
 * When prep.ts has the gas, gas price and nonce ready, nothing here waits on the network until the send itself.
 */
export async function send(call: Call): Promise<TransactionReceipt> {
  const account = call.as ?? useWallet.getState().account;
  const id = ++flowCounter;
  const started = call.startedAt ?? performance.now();
  const since = () => performance.now() - started;
  const tx = useTx.getState();
  if (!call.quiet) useTx.setState((s) => ({ flows: [...s.flows.filter((f) => !f.closed).slice(-3), { id, label: call.label, hash: null, status: 'pending', error: null, stages: {}, closed: false }] }));

  let holdsNonce = false;
  let params: { to: Address; data: Hex; value: bigint } | null = null;
  try {
    if (!account) throw new Error('Create a wallet first');
    const built = call.build ? await call.build() : { data: call.data!, value: call.value, estimate: false };
    params = { to: call.to, data: built.data, value: built.value ?? call.value ?? 0n };

    // Some chains charge the declared limit, not the gas used, so this margin is kept just big enough to survive the
    // state moving between estimate and execution.
    let gas = built.estimate ? null : knownGasLimit(call.gasKey, call.gasKind);
    if (gas === null) {
      const estimate = await publicClient.estimateGas({ account: account.address, ...params });
      if (!built.estimate) rememberGas(call.gasKey, call.gasKind, estimate);
      gas = (estimate * 12n) / 10n;
    }

    let hash: Hex;
    let done: TransactionReceipt | null = null;
    if (isExtension(account)) {
      // A browser extension signs and sends in one step, behind its own popup. Nonce and price are its business.
      const provider = extension();
      if (!provider) throw new Error('The browser wallet extension is gone. Reconnect it in Portfolio');
      hash = (await provider.request({ method: 'eth_sendTransaction', params: [{ from: account.address, to: params.to, data: params.data, value: numberToHex(params.value), gas: numberToHex(gas) }] })) as Hex;
      tx.patch(id, { hash });
    } else for (let attempt = 0; ; attempt++) {
      const gasPrice = await gasPriceNow(attempt > 0);
      const nonce = await takeNonce(account.address);
      holdsNonce = true;
      const raw = await account.signTransaction({ type: 'eip1559', chainId: CHAIN_ID, nonce, ...params, gas, maxFeePerGas: gasPrice, maxPriorityFeePerGas: gasPrice });
      hash = keccak256(raw);
      tx.patch(id, { hash });

      try {
        const sent = await sendRaw(raw);
        nonceAccepted(nonce);
        if (sent) {
          // The node answered with the result itself: sent, in a block and executed, all in this one round trip.
          tx.mark(id, 'submitted', since());
          tx.mark(id, 'ordered', since());
          tx.mark(id, 'executed', since());
          done = sent;
        }
        break;
      } catch (err) {
        const text = errorText(err);
        if (/already known/i.test(text)) {
          nonceAccepted(nonce);
          break;
        }
        holdsNonce = false;
        await nonceRefused(account.address);
        // Another tab or device moved the nonce, or the gas floor went up. Both are ours to fix, once.
        if (attempt === 0 && /nonce|replacement|underpriced|below floor/i.test(text)) continue;
        throw err;
      }
    }
    if (!done) tx.mark(id, 'submitted', since());

    const receipt = done ?? (await follow(id, hash, since));
    void useWallet.getState().refreshBalance();
    if (receipt.status !== 'success') throw new TxReverted();
    useTx.getState().patch(id, { status: 'success', error: null });
    return receipt;
  } catch (err) {
    let message = explain(err);
    if (err instanceof TxReverted) {
      // The gas figure may have been too low for it, so don't use it again. Replaying the call says why, if it still fails.
      forgetGas(call.gasKey, call.gasKind);
      const why = params && account ? await publicClient.call({ account: account.address, ...params }).then(() => null, explain) : null;
      message = why ?? 'The transaction ran and reverted. Gas was charged, nothing else changed. Try again';
    }
    useTx.getState().patch(id, { status: err instanceof TxReverted ? 'reverted' : 'failed', error: message });
    throw new Error(message);
  } finally {
    if (holdsNonce) nonceFinished();
  }
}

class TxReverted extends Error {}

/**
 * Whether the node takes `eth_sendRawTransactionSync` (EIP-7966), which waits for the transaction's block and answers with its
 * receipt: one round trip where sending and then asking for the result is at least two, plus however long the asking waits.
 * Unknown until the first send, then remembered for the page.
 */
let syncSend: boolean | null = null;

/** Sends a signed transaction. Returns its receipt when the node handed it back, null when it has to be followed. */
async function sendRaw(raw: Hex): Promise<TransactionReceipt | null> {
  if (syncSend !== false) {
    try {
      const rpc = await publicClient.request({ method: 'eth_sendRawTransactionSync' as 'eth_sendRawTransaction', params: [raw] as never });
      syncSend = true;
      return rpc && typeof rpc === 'object' ? formatTransactionReceipt(rpc as unknown as RpcTransactionReceipt) : null;
    } catch (err) {
      const text = errorText(err);
      const code = (err as { code?: number; cause?: { code?: number } }).code ?? (err as { cause?: { code?: number } }).cause?.code;
      // Not a method this node knows, or not in this form: send the plain way, now and from here on. A request the node
      // couldn't read never reached its pool, so the transaction hasn't gone anywhere yet.
      if (code === -32601 || code === -32602 || /method.*(not (found|supported|available)|does not exist)|unknown method|not allowed|untagged enum|invalid params/i.test(text)) syncSend = false;
      // Taken but not in a block within the wait: it's on its way, so follow it like any other.
      else if (code === 4 || /timeout|timed out/i.test(text)) return null;
      else throw err;
    }
  }
  await publicClient.request({ method: 'eth_sendRawTransaction', params: [raw] });
  return null;
}

/** Resolves on the next block, or after `ms` if none comes first. */
function nextBlockOr(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => (stop(), resolve()), ms);
    const stop = onBlock(() => {
      clearTimeout(timer);
      stop();
      resolve();
    });
  });
}

async function follow(id: number, hash: Hex, since: () => number): Promise<TransactionReceipt> {
  const deadline = performance.now() + 60_000;
  let orderedBlock: number | null = null;
  for (;;) {
    if (performance.now() > deadline) throw new Error('No result after a minute. Check the wallet before retrying');
    const store = useTx.getState();
    // Both at once: asking one after the other would add a whole round trip to noticing each step.
    // -38004 means ordered but not executed yet, which viem reports the same way as "not found": keep asking.
    const askOrdered: Promise<{ blockNumber: bigint | null } | null> = orderedBlock === null ? publicClient.getTransaction({ hash }).catch(() => null) : Promise.resolve(null);
    const [t, receipt] = await Promise.all([askOrdered, publicClient.getTransactionReceipt({ hash }).catch(() => null)]);
    if (orderedBlock === null && t?.blockNumber != null) {
      orderedBlock = Number(t.blockNumber);
      store.mark(id, 'ordered', since());
    }
    if (receipt) {
      if (orderedBlock === null) {
        orderedBlock = Number(receipt.blockNumber);
        store.mark(id, 'ordered', since());
      }
      store.mark(id, 'executed', since());
      return receipt;
    }
    // Asked again when a block comes, which is when the answer can change. The timer covers a node with no pushed heads.
    await nextBlockOr(150);
  }
}

