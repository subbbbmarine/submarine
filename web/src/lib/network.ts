'use client';

import { create } from 'zustand';
import { WS_URL } from './config';
import { attachSocket, settleReply } from './rpc';
import { publicClient } from './wallet';

interface NetworkState {
  connected: boolean;
  /** The newest block seen. */
  ordered: number;
  /** Milliseconds between blocks, smoothed. */
  blockMs: number | null;
  start: () => void;
}

let started = false;
let socket: WebSocket | null = null;
let nextId = 100; // far below the ids rpc.ts uses for requests over the same socket
let headsRequest: number | null = null;
let headsSub: string | null = null;
let polling: ReturnType<typeof setInterval> | null = null;

/** Called on every new block, the moment it's seen. What waits for the chain (a receipt, a quote) asks then, not on a timer. */
const blockListeners = new Set<(block: number) => void>();
export function onBlock(listener: (block: number) => void): () => void {
  blockListeners.add(listener);
  return () => blockListeners.delete(listener);
}

function rawSend(method: string, params: unknown[]): number {
  const id = nextId++;
  socket?.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  return id;
}

/**
 * The node's head: pushed over its WebSocket with the standard `eth_subscribe newHeads` where it has one, asked for every
 * 250 ms otherwise. The same socket carries the site's requests (rpc.ts), whose worst case over HTTP was several times slower.
 */
export const useNetwork = create<NetworkState>((set, get) => {
  let lastHeadAt = 0;

  const onHead = (ordered: number) => {
    const now = performance.now();
    const prev = get().ordered;
    if (ordered > prev) {
      const gap = lastHeadAt ? (now - lastHeadAt) / (ordered - prev) : null;
      lastHeadAt = now;
      const blockMs = gap === null ? get().blockMs : get().blockMs === null ? gap : get().blockMs! * 0.9 + gap * 0.1;
      set({ ordered, blockMs, connected: true });
      for (const listener of blockListeners) listener(ordered);
    } else if (ordered < prev) {
      // A local chain that was restarted: its numbers start again, and so do ours.
      lastHeadAt = 0;
      set({ ordered, blockMs: null, connected: true });
      for (const listener of blockListeners) listener(ordered);
    } else if (!get().connected) {
      set({ connected: true });
    }
  };

  const poll = async () => {
    try {
      onHead(Number(await publicClient.getBlockNumber({ cacheTime: 0 })));
    } catch {
      if (!socket) set({ connected: false });
    }
  };
  const startPolling = () => {
    polling ??= setInterval(() => void poll(), 250);
    void poll();
  };
  const stopPolling = () => {
    if (polling) clearInterval(polling);
    polling = null;
  };

  const openSocket = () => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      startPolling();
      return;
    }
    socket = ws;
    ws.onopen = () => {
      attachSocket(ws);
      headsSub = null;
      headsRequest = rawSend('eth_subscribe', ['newHeads']);
    };
    ws.onmessage = (ev) => {
      let msg: { id?: number; result?: unknown; error?: unknown; method?: string; params?: { subscription?: string; result?: { number?: string } } };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (settleReply(msg as never)) return;
      if (msg.id !== undefined && msg.id === headsRequest) {
        headsRequest = null;
        // A node whose socket can't push heads still answers requests on it: the head comes from polling then.
        if (typeof msg.result === 'string') {
          headsSub = msg.result;
          stopPolling();
        } else startPolling();
        return;
      }
      if (msg.method === 'eth_subscription' && msg.params?.subscription === headsSub && msg.params.result?.number) {
        onHead(parseInt(msg.params.result.number, 16));
      }
    };
    ws.onclose = () => {
      socket = null;
      headsSub = null;
      attachSocket(null);
      startPolling(); // the head keeps coming while the socket is away
      setTimeout(openSocket, 1500);
    };
    ws.onerror = () => ws.close();
  };

  return {
    connected: false,
    ordered: 0,
    blockMs: null,

    start() {
      if (started || typeof window === 'undefined') return;
      started = true;
      startPolling(); // until the socket says it pushes heads
      if (WS_URL) openSocket();
    },
  };
});
