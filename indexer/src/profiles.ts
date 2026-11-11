import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { isAddress, verifyMessage, type Address, type Hex } from 'viem';
import { all, db, one } from './db.js';
import { bus } from './chain.js';
import { saveMeta } from './meta.js';

/**
 * Public profiles: a name and a picture a wallet gives itself, shown to everyone wherever that wallet appears. Only the
 * wallet can set its own, by signing the exact change, so nobody can rename someone else. Kept until it changes again.
 */

/** Letters and digits in any script, spaces, and a few marks. Never something that reads as an address. */
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} _.\-]{0,22}[\p{L}\p{N}_.]$/u;
const WINDOW_SECONDS = 600;
const MIN_GAP_MS = 15_000;

/** What the wallet signs. The web app builds the same text, so a change can't be replayed with other contents. */
export function profileMessage(address: string, name: string, picture: string, time: number): string {
  return `Submarine profile\nWallet: ${address.toLowerCase()}\nName: ${name || '(none)'}\nPicture: ${picture}\nTime: ${time}`;
}

const lastChange = new Map<string, number>();

export async function profileSchema(): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS profiles (
    address TEXT PRIMARY KEY,
    name TEXT,
    image TEXT,
    updated_at INTEGER NOT NULL
  )`);
}

export function profileRoutes(app: FastifyInstance): void {
  // Up to a hundred wallets at once, for a page full of them.
  app.get('/api/v1/profiles', async (req, reply) => {
    const list = String((req.query as { a?: string }).a ?? '')
      .toLowerCase()
      .split(',')
      .filter((a) => /^0x[0-9a-f]{40}$/.test(a))
      .slice(0, 100);
    if (!list.length) return { profiles: {} };
    const rows = await all(`SELECT address, name, image FROM profiles WHERE address IN (${list.map(() => '?').join(',')})`, list);
    reply.header('cache-control', 'no-store');
    return { profiles: Object.fromEntries(rows.map((r) => [String(r.address), { name: r.name ? String(r.name) : null, image: r.image ? String(r.image) : null }])) };
  });

  app.post('/api/v1/profile', { bodyLimit: 3.5 * 1024 * 1024 }, async (req, reply) => {
    const body = (req.body ?? {}) as { address?: string; name?: string; image?: string | null; time?: number; signature?: string };
    const address = String(body.address ?? '').toLowerCase();
    if (!isAddress(address)) return reply.code(400).send({ message: 'Not a wallet address' });
    const name = String(body.name ?? '').trim().replace(/\s+/g, ' ');
    if (name && (!NAME.test(name) || /0x[0-9a-f]{6,}/i.test(name))) {
      return reply.code(400).send({ message: 'A name is 2 to 24 letters, digits, spaces, dots, dashes or underscores, and not an address' });
    }
    const time = Number(body.time);
    if (!Number.isInteger(time) || Math.abs(Date.now() / 1000 - time) > WINDOW_SECONDS) return reply.code(400).send({ message: 'This change is too old, or its clock is off. Try again.' });

    // The picture: a new one is named in the message by the hash of its bytes, 'same' keeps it, 'none' removes it.
    const image = body.image;
    let picture = 'same';
    if (image === null) picture = 'none';
    else if (typeof image === 'string' && image.startsWith('data:')) {
      const b64 = image.split(',')[1] ?? '';
      picture = createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');
    }
    const signature = String(body.signature ?? '') as Hex;
    const ok = await verifyMessage({ address: address as Address, message: profileMessage(address, name, picture, time), signature }).catch(() => false);
    if (!ok) return reply.code(401).send({ message: "The signature doesn't match this wallet" });

    const t = Date.now();
    if (t - (lastChange.get(address) ?? 0) < MIN_GAP_MS) return reply.code(429).send({ message: 'One change every 15 seconds' });

    const old = await one(`SELECT image FROM profiles WHERE address = ?`, [address]);
    let stored: string | null = old?.image ? String(old.image) : null;
    if (picture === 'none') stored = null;
    else if (picture !== 'same') {
      const saved = await saveMeta({ image }, req.ip);
      if ('error' in saved) return reply.code(400).send({ message: saved.error });
      stored = saved.image ?? null;
    }
    lastChange.set(address, t);
    await db.execute({
      sql: `INSERT INTO profiles (address, name, image, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(address) DO UPDATE SET name = excluded.name, image = excluded.image, updated_at = excluded.updated_at`,
      args: [address, name || null, stored, Math.floor(t / 1000)],
    });
    bus.emit('event', { type: 'profile', data: { address, name: name || null, image: stored } });
    return { address, name: name || null, image: stored };
  });
}
