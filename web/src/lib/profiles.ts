'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { toHex, type Address } from 'viem';
import { API_URL } from './config';
import { get, onStream } from './api';
import { extension, isExtension, useWallet } from './wallet';

/**
 * Public profiles: the name and picture a wallet gave itself, the same for everyone who sees it. Looked up in batches as
 * wallets come on screen, kept for the visit, and updated live when anyone changes theirs.
 */
export interface Profile {
  name: string | null;
  image: string | null;
}

let known: Record<string, Profile | null> = {};
let version = 0;
const listeners = new Set<() => void>();
const changed = () => {
  version++;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const queue = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let live = false;

function flush() {
  timer = null;
  const batch = [...queue].slice(0, 100);
  batch.forEach((a) => queue.delete(a));
  if (queue.size) timer = setTimeout(flush, 30);
  if (!batch.length) return;
  get<{ profiles: Record<string, Profile> }>(`/api/v1/profiles?a=${batch.join(',')}`).then(
    (r) => {
      const next = { ...known };
      for (const a of batch) next[a] = r.profiles[a] ?? null;
      known = next;
      changed();
    },
    () => {
      // asked again the next time it's wanted
      const next = { ...known };
      for (const a of batch) delete next[a];
      known = next;
    },
  );
}

function want(address: string) {
  if (typeof window === 'undefined') return;
  if (!live) {
    live = true;
    onStream((type, data: { address: string } & Profile) => {
      if (type !== 'profile') return;
      known = { ...known, [data.address]: data.name || data.image ? { name: data.name, image: data.image } : null };
      changed();
    });
  }
  if (address in known || queue.has(address)) return;
  known = { ...known, [address]: null };
  queue.add(address);
  if (!timer) timer = setTimeout(flush, 40);
}

/** A wallet's public profile, or null when it hasn't made one. Asks for it the first time it's wanted. */
export function profileOf(address: string | null | undefined): Profile | null {
  if (!address) return null;
  const a = address.toLowerCase();
  if (!(a in known)) want(a);
  return known[a] ?? null;
}

/** Re-renders when any profile arrives or changes, for code that reads names with profileOf. */
export const useProfilesVersion = () => useSyncExternalStore(subscribe, () => version, () => 0);

export function useProfile(address: string | null | undefined): Profile | null {
  useProfilesVersion();
  const a = address?.toLowerCase();
  useEffect(() => {
    if (a) want(a);
  }, [a]);
  return a ? (known[a] ?? null) : null;
}

/** The text a wallet signs to change its profile. The indexer builds the same, so the signature covers exactly this change. */
export const profileMessage = (address: string, name: string, picture: string, time: number) =>
  `Submarine profile\nWallet: ${address.toLowerCase()}\nName: ${name || '(none)'}\nPicture: ${picture}\nTime: ${time}`;

async function sha256Hex(b64: string) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Signs and publishes a wallet's profile. `image` is a new picture as a data URL, 'same' to keep the one it has, or null to
 * remove it. A wallet kept in this browser signs by itself; one in an extension asks there.
 */
export async function publishProfile(address: string, name: string, image: string | null | 'same'): Promise<Profile> {
  const a = address.toLowerCase();
  const picture = image === null ? 'none' : image === 'same' ? 'same' : await sha256Hex(image.split(',')[1] ?? '');
  const time = Math.floor(Date.now() / 1000);
  const message = profileMessage(a, name.trim(), picture, time);
  const state = useWallet.getState();
  let signature: string;
  const inBrowser = state.accountsFor([a])[0];
  if (inBrowser) signature = await inBrowser.signMessage({ message });
  else if (state.account && isExtension(state.account) && state.account.address.toLowerCase() === a) {
    const p = extension();
    if (!p) throw new Error('The browser extension is gone. Connect it again.');
    signature = (await p.request({ method: 'personal_sign', params: [toHex(message), state.account.address as Address] })) as string;
  } else throw new Error("This wallet isn't in this browser, so it can't sign");
  const res = await fetch(`${API_URL}/api/v1/profile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: a, name: name.trim(), image: image === 'same' ? undefined : image, time, signature }),
  });
  const j = (await res.json().catch(() => ({}))) as Profile & { message?: string };
  if (!res.ok) throw new Error(j.message ?? 'The profile could not be saved');
  known = { ...known, [a]: j.name || j.image ? { name: j.name, image: j.image } : null };
  changed();
  return { name: j.name, image: j.image };
}

/** A picture from a file, cut to a centred square and made small enough to send: 256 px JPEG. */
export async function squarePicture(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("That file isn't a picture this browser can open"));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    c.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    return c.toDataURL('image/jpeg', 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}
