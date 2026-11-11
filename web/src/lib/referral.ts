'use client';

import { create } from 'zustand';
import { encodeFunctionData, isAddress, zeroAddress, type Address } from 'viem';
import { getDeployment } from './api';
import { REFERRALS_ABI } from './config';
import { send } from './tx';
import { publicClient, useWallet } from './wallet';

const REF_STORAGE = 'terminal.ref.v1';
const DISMISSED_STORAGE = 'terminal.ref.dismissed.v1';

interface RefState {
  /** The referrer from the last ?ref= link this browser opened, lowercase. */
  ref: string | null;
  /** The ref whose banner was closed, so a new link can still offer itself. */
  dismissed: string | null;
}

export const useStoredRef = create<RefState>(() => ({ ref: null, dismissed: null }));

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
};

const own = () => useWallet.getState().account?.address.toLowerCase() ?? null;

/** Takes ?ref=0x... from the address bar, if it's a real address and not this wallet's own, and keeps it. */
export function captureRef() {
  if (typeof window === 'undefined') return;
  const fromUrl = new URLSearchParams(window.location.search).get('ref')?.trim().toLowerCase();
  if (fromUrl && isAddress(fromUrl) && fromUrl !== zeroAddress && fromUrl !== own()) write(REF_STORAGE, fromUrl);
  useStoredRef.setState({ ref: read(REF_STORAGE), dismissed: read(DISMISSED_STORAGE) });
}

/** The stored referrer, unless it's the wallet now in this browser. */
export function storedRef(ref = useStoredRef.getState().ref): string | null {
  return ref && ref !== own() ? ref : null;
}

export function dismissRef() {
  const ref = useStoredRef.getState().ref;
  write(DISMISSED_STORAGE, ref);
  useStoredRef.setState({ dismissed: ref });
}

/** Who this wallet is linked to on chain, null for nobody, or undefined when there's no referrals contract here. */
export async function readReferrer(who: Address): Promise<string | null | undefined> {
  const { referrals } = await getDeployment();
  if (!referrals) return undefined;
  const referrer = await publicClient.readContract({ address: referrals, abi: REFERRALS_ABI, functionName: 'referrerOf', args: [who] });
  return referrer === zeroAddress ? null : referrer.toLowerCase();
}

/**
 * Links this wallet to `referrer` for good. The contract's own refusals have no friendly text in tx.ts, so the
 * common ones are checked here first and come back as plain errors before anything is sent.
 */
export async function linkReferrer(referrer: string) {
  const account = useWallet.getState().account;
  if (!account) throw new Error('Create a wallet first');
  if (!isAddress(referrer) || referrer.toLowerCase() === account.address.toLowerCase()) throw new Error("You can't link to your own wallet");
  const { referrals } = await getDeployment();
  if (!referrals) throw new Error("Referrals aren't on this network yet");
  const [mine, theirs] = await Promise.all([
    publicClient.readContract({ address: referrals, abi: REFERRALS_ABI, functionName: 'referrerOf', args: [account.address] }),
    publicClient.readContract({ address: referrals, abi: REFERRALS_ABI, functionName: 'referrerOf', args: [referrer as Address] }),
  ]);
  if (mine !== zeroAddress) throw new Error('This wallet is already linked');
  if (theirs.toLowerCase() === account.address.toLowerCase()) throw new Error("You referred this wallet, so it can't refer you");
  await send({ label: 'Link referrer', to: referrals, data: encodeFunctionData({ abi: REFERRALS_ABI, functionName: 'link', args: [referrer as Address] }) });
  write(REF_STORAGE, null);
  useStoredRef.setState({ ref: null });
}
