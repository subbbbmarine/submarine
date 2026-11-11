'use client';

import { useEffect, useState } from 'react';
import { formatEther, type Address } from 'viem';
import { getDeployment } from './api';
import { rankFor, ROUTER_ABI } from './config';
import { publicClient } from './wallet';

const AGE_MS = 20_000;
const cache = new Map<string, { volume: number; at: number }>();
const waiting = new Map<string, Promise<number>>();

/** ZRO a wallet has traded through the terminal, straight from the router, which counts it for ranks. */
export async function volumeOf(address: string, fresh = false): Promise<number> {
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < AGE_MS) return hit.volume;
  const busy = waiting.get(key);
  if (busy) return busy;
  const read = (async () => {
    const { router } = await getDeployment();
    const v = Number(formatEther(await publicClient.readContract({ address: router, abi: ROUTER_ABI, functionName: 'volumeOf', args: [key as Address] })));
    cache.set(key, { volume: v, at: Date.now() });
    return v;
  })().finally(() => waiting.delete(key));
  waiting.set(key, read);
  return read;
}

/** A wallet's volume and rank, kept fresh while it's on screen. Null until the first read lands. */
export function useRank(address: string | null | undefined) {
  const [volume, setVolume] = useState<number | null>(() => (address ? cache.get(address.toLowerCase())?.volume ?? null : null));
  useEffect(() => {
    if (!address) return setVolume(null);
    let live = true;
    const read = () => void volumeOf(address).then((v) => live && setVolume(v)).catch(() => {});
    read();
    const t = setInterval(read, AGE_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [address]);
  return volume === null ? null : { volume, ...rankFor(volume) };
}
