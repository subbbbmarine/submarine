'use client';

import { encodeFunctionData, parseEther, zeroAddress, type Address } from 'viem';
import { getDeployment } from './api';
import { buyFeeNow, CHAIN_ID, CURVE, ERC20_ABI, LAUNCHPAD_ABI, ROUTER_ABI } from './config';
import { gasKindOf, padOf, readPad, spenderOf } from './launchpads';
import { publicClient, useWallet } from './wallet';

/**
 * What a transaction needs, worked out before the click, so the click itself costs one round trip: the send. Without this it
 * costs three or more: a quote, then the gas estimate, gas price and nonce, then the send. Everything here is a shortcut. When
 * something isn't ready, the caller asks the chain as before, so being wrong here costs time and not correctness.
 */

export const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 120);
/**
 * Auto slippage, the default: a trade may land at most this far below its quote. Blocks come every fraction of a second, so a
 * fresh quote barely moves before the trade lands, and a tight floor leaves a sandwich nothing worth taking.
 */
export const AUTO_SLIPPAGE_BPS = 100;
/** Zero stands for auto. */
export const slippageOf = (bps: number) => (bps > 0 ? bps : AUTO_SLIPPAGE_BPS);
export const withSlippage = (v: bigint, bps: number) => (v * BigInt(10_000 - slippageOf(bps))) / 10_000n;

// The nonce. The chain's count only includes what's ordered, so trades in a row have to count for themselves.

let nonce: { address: string; next: number } | null = null;
let syncing: Promise<void> | null = null;
let inFlight = 0;
let acceptedNext = 0;
let acceptedAt = 0;

function syncNonce(address: string): Promise<void> {
  syncing ??= publicClient
    .getTransactionCount({ address: address as Address, blockTag: 'latest' })
    .then((chainCount) => {
      const same = nonce?.address === address;
      // With something on its way the chain's count is behind us. Otherwise the chain is right, even if we thought more.
      const busy = same && (inFlight > 0 || Date.now() - acceptedAt < 4000);
      nonce = { address, next: busy ? Math.max(chainCount, acceptedNext, nonce!.next) : chainCount };
      if (!same) acceptedNext = 0;
    })
    .finally(() => {
      syncing = null;
    });
  return syncing;
}

export async function takeNonce(address: string): Promise<number> {
  if (nonce?.address !== address) await syncNonce(address);
  inFlight++;
  return nonce!.next++;
}

export function nonceAccepted(used: number) {
  acceptedNext = Math.max(acceptedNext, used + 1);
  acceptedAt = Date.now();
}

/** Its transaction has an outcome, or will never have one. */
export function nonceFinished() {
  inFlight = Math.max(0, inFlight - 1);
}

/** The node refused it, so the number was never used and has to be handed out again. */
export async function nonceRefused(address: string) {
  nonceFinished();
  if (nonce?.address === address && inFlight === 0) nonce.next = Math.max(acceptedNext, nonce.next - 1);
  await syncNonce(address);
}

// The gas price. A node may refuse anything under its floor, and eth_gasPrice is what it wants.

let price: { value: bigint; at: number } | null = null;

export async function gasPriceNow(force = false): Promise<bigint> {
  if (!force && price && Date.now() - price.at < 30_000) return price.value;
  const value = await publicClient.getGasPrice();
  price = { value, at: Date.now() };
  return value;
}

// Gas limits. Some chains charge the declared limit, so this has to be close and not generous: a recent estimate for this very
// call, or failing that the last one for the same kind of call on any token, with a wider margin. If that turns out too low
// the trade reverts, for almost nothing at these gas prices, the figure is dropped and the next try estimates afresh.

const EXACT_FOR_MS = 5 * 60_000;
const KIND_FOR_MS = 24 * 3_600_000;
const EXACT_MARGIN = 120n;
const KIND_MARGIN = 140n;
const SAVE = `terminal.gas.${CHAIN_ID}.v1`;

const exact = new Map<string, { gas: bigint; at: number }>();
let kinds: Record<string, { gas: string; at: number }> | null = null;

function kindsNow() {
  if (kinds) return kinds;
  try {
    kinds = JSON.parse(localStorage.getItem(SAVE) ?? '{}');
  } catch {
    kinds = {};
  }
  return kinds!;
}

/** A figure that will still be good by the time someone clicks, so there's no need to ask for it again now. */
const hasRecentGas = (key: string) => Date.now() - (exact.get(key)?.at ?? 0) < EXACT_FOR_MS - 60_000;

export function knownGasLimit(key?: string, kind?: string): bigint | null {
  const hit = key ? exact.get(key) : undefined;
  if (hit && Date.now() - hit.at < EXACT_FOR_MS) return (hit.gas * EXACT_MARGIN) / 100n;
  const k = kind ? kindsNow()[kind] : undefined;
  if (k && Date.now() - k.at < KIND_FOR_MS) return (BigInt(k.gas) * KIND_MARGIN) / 100n;
  return null;
}

export function rememberGas(key: string | undefined, kind: string | undefined, gas: bigint) {
  if (key) exact.set(key, { gas, at: Date.now() });
  if (!kind) return;
  const all = kindsNow();
  const old = all[kind] ? BigInt(all[kind]!.gas) : 0n;
  // A rare heavy call, like the buy that moves a token to its pool, shouldn't set the price of every ordinary one.
  if (old && gas > old * 2n) return;
  all[kind] = { gas: (gas > old ? gas : old).toString(), at: Date.now() };
  try {
    localStorage.setItem(SAVE, JSON.stringify(all));
  } catch {
    // it only means estimating again after a reload
  }
}

export function forgetGas(key?: string, kind?: string) {
  if (key) exact.delete(key);
  if (!kind) return;
  const all = kindsNow();
  delete all[kind];
  try {
    localStorage.setItem(SAVE, JSON.stringify(all));
  } catch {}
}

// The buy that fills a curve also opens the token's pool, far more work than any other trade, so no remembered gas figure
// will do for it. After that the token trades through another contract, so figures from before it don't count either.

const RAISE_TARGET = parseEther(String(CURVE.raiseTarget));
const curveRoom = new Map<string, { room: bigint | null; at: number; feeBps: number; antiSnipe: boolean; createdAt: number }>();

async function readRoom(token: Address): Promise<bigint | null> {
  const { launchpad } = await getDeployment();
  const [creator, createdAt, graduated, feeBps, , , antiSnipe, raised] = await publicClient.readContract({ address: launchpad, abi: LAUNCHPAD_ABI, functionName: 'curves', args: [token] });
  const room = creator === zeroAddress || graduated ? null : RAISE_TARGET - raised;
  if (room === null && curveRoom.get(token)?.room != null) {
    exact.delete(`buy:${token}`);
    exact.delete(`sell:${token}`);
  }
  curveRoom.set(token, { room, at: Date.now(), feeBps, antiSnipe, createdAt });
  return room;
}

/** Whether this buy fills the curve. Near the edge it may say yes when the fee would have left it short, which only costs an estimate. */
export async function fillsCurve(token: Address, zroIn: bigint): Promise<boolean> {
  const hit = curveRoom.get(token);
  const room = hit && Date.now() - hit.at < 4000 ? hit.room : await readRoom(token);
  return room !== null && zroIn >= room;
}

/** What a buy really takes. The one that fills the curve only pays for what was left, and the rest comes back. */
export async function zroUsed(token: Address, zroIn: bigint): Promise<bigint> {
  if (!(await fillsCurve(token, zroIn))) return zroIn;
  const curve = curveRoom.get(token)!;
  const keep = BigInt(Math.round((1 - buyFeeNow(curve.feeBps, curve.antiSnipe, curve.createdAt)) * 10_000));
  const used = (curve.room! * 10_000n) / keep + 1n;
  return used < zroIn ? used : zroIn;
}

// Quotes. A slightly old one is safe: if the price has run past the slippage limit, the trade reverts instead of filling badly.

const QUOTE_FOR_MS = 4000;
const quotes = new Map<string, { value: bigint; at: number }>();

export function freshQuote(side: 'buy' | 'sell', token: Address, amount: bigint): bigint | null {
  const hit = quotes.get(`${side}:${token}:${amount}`);
  return hit && Date.now() - hit.at < QUOTE_FOR_MS ? hit.value : null;
}

/** Null means nothing can say: another launchpad whose file names no quote function. Zero means no market will take it. */
export async function quoteBuy(token: Address, zroIn: bigint): Promise<bigint | null> {
  const pad = await padOf(token);
  if (pad && !pad.quoteBuy) return null;
  const { router } = await getDeployment();
  const value = pad
    ? await readPad(pad, pad.quoteBuy!, { token, amount: zroIn, zro: zroIn })
    : await publicClient.readContract({ address: router, abi: ROUTER_ABI, functionName: 'quoteBuy', args: [token, zroIn] });
  quotes.set(`buy:${token}:${zroIn}`, { value, at: Date.now() });
  return value;
}

export async function quoteSell(token: Address, tokensIn: bigint): Promise<bigint | null> {
  const pad = await padOf(token);
  if (pad && !pad.quoteSell) return null;
  const { router } = await getDeployment();
  const value = pad
    ? await readPad(pad, pad.quoteSell!, { token, amount: tokensIn })
    : await publicClient.readContract({ address: router, abi: ROUTER_ABI, functionName: 'quoteSell', args: [token, tokensIn] });
  quotes.set(`sell:${token}:${tokensIn}`, { value, at: Date.now() });
  return value;
}

// What this wallet holds and has allowed.

const HELD_FOR_MS = 4000;
const held = new Map<string, { value: bigint; at: number }>();
const allowances = new Map<string, bigint>();

async function readHeld(token: Address, owner: Address): Promise<bigint> {
  const value = await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] });
  held.set(`${owner}:${token}`, { value, at: Date.now() });
  return value;
}

export async function heldNow(token: Address, owner: Address): Promise<bigint> {
  const hit = held.get(`${owner}:${token}`);
  return hit && Date.now() - hit.at < HELD_FOR_MS ? hit.value : readHeld(token, owner);
}

export const forgetHeld = (token: Address, owner: Address) => held.delete(`${owner}:${token}`);

const allowanceKey = (owner: Address, token: Address, spender: Address) => `${owner}:${token}:${spender}`;
export const knownAllowance = (owner: Address, token: Address, spender: Address) => allowances.get(allowanceKey(owner, token, spender));
export const setKnownAllowance = (owner: Address, token: Address, spender: Address, v: bigint) => allowances.set(allowanceKey(owner, token, spender), v);

export async function readAllowance(owner: Address, token: Address, spender: Address): Promise<bigint> {
  const value = await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'allowance', args: [owner, spender] });
  setKnownAllowance(owner, token, spender, value);
  return value;
}

// Getting ready for a click that hasn't happened yet: while a token is open, and on hovering over something that trades.

const prepared = new Map<string, number>();
const once = (key: string, ms: number) => {
  if (Date.now() - (prepared.get(key) ?? 0) < ms) return false;
  prepared.set(key, Date.now());
  return true;
};

export async function prepareBuy(token: Address, zro: string): Promise<void> {
  const { account, slippageBps, balance } = useWallet.getState();
  if (!account || !once(`buy:${token}:${zro}`, 2000)) return;
  try {
    const value = parseEther(zro as `${number}`);
    if (value === 0n) return;
    // Another launchpad's gas is estimated on every trade: nothing is known about what it does as its curve fills.
    if (await padOf(token)) {
      await quoteBuy(token, value);
      return;
    }
    const { router } = await getDeployment();
    const [quote, room] = await Promise.all([quoteBuy(token, value), readRoom(token)]);
    // A wallet that can't pay for it can't estimate it, and the buy that fills the curve is estimated when it happens.
    if (quote === null || quote === 0n || Number(zro) > balance || hasRecentGas(`buy:${token}`) || (room !== null && value >= room)) return;
    const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: 'buy', args: [token, withSlippage(quote, slippageBps), account.address, deadline()] });
    rememberGas(`buy:${token}`, await gasKindOf(token, 'buy'), await publicClient.estimateGas({ account: account.address, to: router, value, data }));
  } catch {
    // nothing was ready, so the click asks for itself
  }
}

/** `now` is for right after a trade, when what's held has just changed. */
export async function prepareSell(token: Address, now = false): Promise<void> {
  const { account } = useWallet.getState();
  if (!account || (!once(`sell:${token}`, 2000) && !now)) return;
  try {
    const { router } = await getDeployment();
    const amount = await readHeld(token, account.address);
    if (amount === 0n) return;
    const pad = await padOf(token);
    if (pad) {
      const spender = spenderOf(pad);
      await Promise.all([readAllowance(account.address, token, spender), quoteSell(token, amount), quoteSell(token, amount / 2n)]);
      return;
    }
    const known = knownAllowance(account.address, token, router);
    const [allowance] = await Promise.all([known !== undefined && known >= amount ? known : readAllowance(account.address, token, router), quoteSell(token, amount), quoteSell(token, amount / 2n)]);
    if (allowance < amount || hasRecentGas(`sell:${token}`)) return; // the estimate needs the allowance in place
    const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: 'sell', args: [token, amount, 0n, account.address, deadline()] });
    rememberGas(`sell:${token}`, await gasKindOf(token, 'sell'), await publicClient.estimateGas({ account: account.address, to: router, data }));
  } catch {
    // nothing was ready, so the click asks for itself
  }
}

export function prepareToken(token: Address) {
  void prepareBuy(token, useWallet.getState().quickSize);
  void prepareSell(token);
}

/** Keeps the nonce and gas price current for as long as the page is open, and warms up signing, which is slow the first time. */
let warm = false;
let warmedFor = '';
export function warmUp() {
  if (warm) return;
  warm = true;
  const tick = () => {
    const { account } = useWallet.getState();
    void gasPriceNow(true).catch(() => {});
    if (!account) return;
    if (inFlight === 0) void syncNonce(account.address).catch(() => {});
    if (warmedFor !== account.address) {
      warmedFor = account.address;
      void account.signMessage({ message: 'warm up' }).catch(() => {});
    }
  };
  tick();
  setInterval(tick, 8000);
}
