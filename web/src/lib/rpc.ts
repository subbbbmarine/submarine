/**
 * Requests over the node's open WebSocket. Measured against the devnet the two paths have about the same typical round trip,
 * but HTTP sometimes takes over a second to answer and the socket didn't: its worst was 337 ms. For a click that has to feel
 * instant, that worst case is what counts. network.ts owns the socket and hands it here.
 */
let socket: WebSocket | null = null;
let nextId = 1_000_000_000; // far from the ids network.ts uses for its subscriptions

interface Waiting {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}
const waiting = new Map<number, Waiting>();

/** Nothing came back, so nothing is known about the request. The node's own errors aren't this: they are its answer. */
export class SocketFailure extends Error {}

export function attachSocket(ws: WebSocket | null) {
  socket = ws;
  if (ws) return;
  for (const [id, w] of waiting) {
    clearTimeout(w.timer);
    w.reject(new SocketFailure('The socket closed'));
    waiting.delete(id);
  }
}

export const socketOpen = () => socket?.readyState === WebSocket.OPEN;

/** Takes a message off the socket if it answers one of these requests. */
export function settleReply(msg: { id?: number; result?: unknown; error?: { code: number; message: string; data?: unknown } }): boolean {
  const w = msg.id === undefined ? undefined : waiting.get(msg.id);
  if (!w) return false;
  clearTimeout(w.timer);
  waiting.delete(msg.id!);
  if (msg.error) w.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code, data: msg.error.data }));
  else w.resolve(msg.result);
  return true;
}

export function overSocket(method: string, params: unknown, timeoutMs = 6000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!socketOpen()) return reject(new SocketFailure('The socket is not open'));
    const id = nextId++;
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new SocketFailure('No answer over the socket'));
    }, timeoutMs);
    waiting.set(id, { resolve, reject, timer });
    socket!.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? [] }));
  });
}
