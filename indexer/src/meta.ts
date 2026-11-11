import { createHash } from 'node:crypto';
import { lookup, type LookupAddress } from 'node:dns';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, utimesSync } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { META_DIR, PUBLIC_API_URL } from './config.js';

/**
 * A token's picture, description and links. They're too big for the chain, so they're saved here under the hash of what they
 * say, and the token's uri on the chain is the address of that. Nothing can be changed after a launch without changing the hash.
 */
export interface Meta {
  image?: string;
  description?: string;
  links?: Record<string, string>;
}

const TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 4).toString('hex') === '89504e47' },
  'image/jpeg': { ext: 'jpg', magic: (b) => b.subarray(0, 3).toString('hex') === 'ffd8ff' },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'image/gif': { ext: 'gif', magic: (b) => b.subarray(0, 3).toString() === 'GIF' },
};
export const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const MAX_IMAGE = 2 * 1024 * 1024; // the site resizes to 512 px, but keeps a GIF whole
/** A picture's size in pixels decides the memory a browser needs to show it, whatever the file weighs. */
const MAX_SIDE = 4096;
const MAX_PIXELS = 16_000_000;
const LINKS = ['website', 'twitter', 'telegram', 'discord'];

// Anyone can save here without signing anything, because a launch is free to try. These keep that from filling the disk.
const HOUR = 3_600_000;
const MAX_BYTES_PER_ADDRESS_PER_HOUR = 10 * 1024 * 1024;
/** A launch saves two files, a picture and its JSON, so this is a dozen tries an hour. */
const MAX_FILES_PER_ADDRESS_PER_HOUR = 24;
const MAX_BYTES_ON_DISK = 1024 * 1024 * 1024;
/** Small files add up in inodes as well as bytes, so their number is capped too. */
const MAX_FILES_ON_DISK = 200_000;
const UNCLAIMED_FOR = 6 * HOUR; // far longer than it takes to go from saving to launching
const saved = new Map<string, { since: number; bytes: number; files: number }>();
let onDisk = 0;
let filesOnDisk = 0;
let measuring: Promise<void> | null = null;

/**
 * Adds up what's on disk in the background, so a request never waits on a walk through every file: the indexer is one thread,
 * and the API and the live stream would stall with it. Until the first count lands, saving goes by what's been added since.
 */
export function measureDisk(): Promise<void> {
  measuring ??= (async () => {
    try {
      const names = existsSync(META_DIR) ? await readdir(META_DIR) : [];
      let bytes = 0;
      for (const name of names) bytes += (await stat(resolve(META_DIR, name)).catch(() => ({ size: 0 }))).size;
      onDisk = bytes;
      filesOnDisk = names.length;
    } finally {
      measuring = null;
    }
  })();
  return measuring;
}
void measureDisk();

const isLink = (v: unknown): v is string => {
  if (typeof v !== 'string' || v.length > 300) return false;
  try {
    return ['http:', 'https:'].includes(new URL(v).protocol);
  } catch {
    return false;
  }
};

/**
 * Width and height from a picture's header, without decoding it: PNG's IHDR, GIF's screen, JPEG's first frame, WebP's VP8,
 * VP8L or VP8X chunk. Null when the header can't be read, which is refused like a picture too big.
 */
export function imageSize(b: Buffer, ext: string): { width: number; height: number } | null {
  try {
    if (ext === 'png') return b.subarray(12, 16).toString() === 'IHDR' ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : null;
    if (ext === 'gif') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    if (ext === 'webp') {
      const chunk = b.subarray(12, 16).toString();
      if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const bits = b.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
      return null;
    }
    if (ext === 'jpg') {
      let at = 2;
      while (at + 9 < b.length) {
        if (b[at] !== 0xff) return null;
        const marker = b[at + 1]!;
        if (marker === 0xff) {
          at += 1;
          continue;
        }
        // A start of frame, of any kind; 0xc4, 0xc8 and 0xcc sit in the same range but are tables.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: b.readUInt16BE(at + 7), height: b.readUInt16BE(at + 5) };
        }
        at += 2 + b.readUInt16BE(at + 2);
      }
      return null;
    }
  } catch {
    // a header cut short
  }
  return null;
}

/** Checks what a browser sent and saves it. Returns the uri to put on the chain, or a reason it was refused. */
export async function saveMeta(body: Record<string, unknown>, from = 'local'): Promise<{ uri: string; image?: string } | { error: string }> {
  const meta: Meta = {};
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (description.length > 600) return { error: 'The description is over 600 characters' };
  if (description) meta.description = description;

  const links: Record<string, string> = {};
  for (const key of LINKS) {
    const value = body[key];
    if (value === undefined || value === '') continue;
    if (!isLink(value)) return { error: `The ${key} link isn't a web address` };
    links[key] = value;
  }
  if (Object.keys(links).length) meta.links = links;

  mkdirSync(META_DIR, { recursive: true });
  // Everything new this save would write, pictures and the small JSON beside them alike, counts against the same budget.
  let picture: { path: string; bytes: Buffer } | null = null;
  if (typeof body.image === 'string' && body.image) {
    const found = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(body.image);
    const type = found && TYPES[found[1]!];
    if (!found || !type) return { error: 'The picture has to be PNG, JPEG, WebP or GIF' };
    const bytes = Buffer.from(found[2]!, 'base64');
    if (bytes.length > MAX_IMAGE) return { error: 'The picture is over 2 MB' };
    if (!type.magic(bytes)) return { error: "That file isn't the picture it says it is" };
    const size = imageSize(bytes, type.ext);
    if (!size || !size.width || !size.height || size.width > MAX_SIDE || size.height > MAX_SIDE || size.width * size.height > MAX_PIXELS) {
      return { error: `The picture has to be at most ${MAX_SIDE} by ${MAX_SIDE} pixels` };
    }
    const file = `${createHash('sha256').update(bytes).digest('hex')}.${type.ext}`;
    picture = { path: resolve(META_DIR, file), bytes };
    meta.image = `/api/v1/images/${file}`;
  } else if (body.imageUrl !== undefined && body.imageUrl !== '') {
    if (!isLink(body.imageUrl)) return { error: "The picture link isn't a web address" };
    meta.image = body.imageUrl;
  }

  const text = JSON.stringify(meta);
  const hash = createHash('sha256').update(text).digest('hex');
  const jsonPath = resolve(META_DIR, `${hash}.json`);
  const newPicture = picture !== null && !existsSync(picture.path);
  const newJson = !existsSync(jsonPath);
  const adding = (newPicture ? picture!.bytes.length : 0) + (newJson ? text.length : 0);
  const files = (newPicture ? 1 : 0) + (newJson ? 1 : 0);
  if (adding > 0) {
    const t = Date.now();
    const earlier = saved.get(from);
    const spent = earlier && t - earlier.since < HOUR ? earlier : { since: t, bytes: 0, files: 0 };
    if (spent.bytes + adding > MAX_BYTES_PER_ADDRESS_PER_HOUR || spent.files + files > MAX_FILES_PER_ADDRESS_PER_HOUR) {
      return { error: 'Too much saved from this address. Try again in an hour.' };
    }
    if (onDisk + adding > MAX_BYTES_ON_DISK || filesOnDisk + files > MAX_FILES_ON_DISK) return { error: 'There is no room for new pictures right now. Launch without one, or try again later.' };
    saved.set(from, { since: spent.since, bytes: spent.bytes + adding, files: spent.files + files });
  }
  // Counted before the writes, so a save that arrives while one is being written sees the room it takes. Rewriting a file
  // that was there already took no new room.
  onDisk += adding;
  filesOnDisk += files;

  // Written without blocking: the indexer is one thread, and the API and the live stream would wait on a big picture.
  const at = new Date();
  if (picture) {
    if (newPicture) await writeFile(picture.path, picture.bytes);
    else utimesSync(picture.path, at, at); // wanted again, so it doesn't count as abandoned
  }
  if (newJson) await writeFile(jsonPath, text);
  else utimesSync(jsonPath, at, at);
  return { uri: `${PUBLIC_API_URL}/api/v1/meta/${hash}`, ...(meta.image ? { image: absolute(meta.image) } : {}) };
}

/**
 * Removes what was saved but never launched with. `uris` must be every token's uri on the chain, so only call this once the
 * indexer has caught up: anything a token points at stays for good, as its uri promises. Returns how many files went.
 */
export function sweepMeta(uris: string[], at = Date.now()): number {
  if (!existsSync(META_DIR)) return 0;
  const claimed = new Set<string>();
  for (const uri of uris) {
    const hash = /\/api\/v1\/meta\/([0-9a-f]{64})$/.exec(uri)?.[1];
    if (hash) {
      claimed.add(`${hash}.json`);
      const image = readMeta(hash)?.image;
      const file = image && /\/api\/v1\/images\/([0-9a-f]{64}\.[a-z]+)$/.exec(image)?.[1];
      if (file) claimed.add(file);
    }
    const direct = /\/api\/v1\/images\/([0-9a-f]{64}\.[a-z]+)$/.exec(uri)?.[1];
    if (direct) claimed.add(direct);
  }
  let removed = 0;
  for (const name of readdirSync(META_DIR)) {
    if (claimed.has(name) || !/^[0-9a-f]{64}\.(json|png|jpg|webp|gif)$/.test(name)) continue;
    const path = resolve(META_DIR, name);
    if (at - statSync(path).mtimeMs < UNCLAIMED_FOR) continue;
    unlinkSync(path);
    removed += 1;
  }
  void measureDisk();
  for (const [from, entry] of saved) if (at - entry.since >= HOUR) saved.delete(from);
  return removed;
}

const absolute = (image: string) => (image.startsWith('/') ? `${PUBLIC_API_URL}${image}` : image);

export function readMeta(hash: string): Meta | null {
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  try {
    return JSON.parse(readFileSync(resolve(META_DIR, `${hash}.json`), 'utf8')) as Meta;
  } catch {
    return null;
  }
}

/**
 * What a token's uri on the chain comes to. One of ours opens up into its picture, description and links, whatever address it
 * was saved under, so a move to another domain doesn't lose anything. Anything else is taken to be a link to a picture.
 */
/** A creator's links, kept only as plain web addresses under the names the site knows, so none can run script when clicked. */
const LINK_KEYS = ['website', 'twitter', 'telegram', 'discord'];
function safeLinks(links: unknown): string | null {
  if (!links || typeof links !== 'object') return null;
  const kept: Record<string, string> = {};
  for (const key of LINK_KEYS) {
    const v = (links as Record<string, unknown>)[key];
    if (typeof v !== 'string' || v.length > 300) continue;
    try {
      const url = new URL(v.trim());
      if (url.protocol === 'https:' || url.protocol === 'http:') kept[key] = url.href;
    } catch {
      // not an address
    }
  }
  return Object.keys(kept).length ? JSON.stringify(kept) : null;
}

export function openUri(uri: string | null): { image: string | null; description: string | null; links: string | null } {
  const hash = /\/api\/v1\/meta\/([0-9a-f]{64})$/.exec(uri ?? '')?.[1];
  const meta = hash ? readMeta(hash) : null;
  if (!meta) return { image: uri, description: null, links: null };
  return { image: meta.image ? absolute(meta.image) : null, description: meta.description ?? null, links: safeLinks(meta.links) };
}

/**
 * A uri naming another terminal's metadata: a token launched from the public site while this indexer runs somewhere else,
 * say on a laptop. Fetched once and kept only if it hashes to the name in the uri, so that terminal can't swap it later.
 * Its picture stays where that terminal serves it.
 */
export async function openRemoteUri(uri: string | null): Promise<{ image: string | null; description: string | null; links: string | null } | null> {
  const found = uri ? /^(https:\/\/([^/:]+)(?::\d+)?)\/api\/v1\/meta\/([0-9a-f]{64})$/.exec(uri) : null;
  // Anyone can put a uri on the chain, so the host is only asked once its address proves public: see publicLookup.
  if (!found || found[1] === PUBLIC_API_URL) return null;
  try {
    const text = await getSmall(uri!, 20_000);
    if (text === null || createHash('sha256').update(text).digest('hex') !== found[3]) return null;
    const meta = JSON.parse(text) as Meta;
    let image: string | null = typeof meta.image === 'string' ? new URL(meta.image, found[1]).href : null;
    if (image && !/^https?:\/\//.test(image)) image = null;
    return { image, description: typeof meta.description === 'string' ? meta.description.slice(0, 600) : null, links: safeLinks(meta.links) };
  } catch {
    return null;
  }
}

/** Only addresses out on the internet: never this machine, its network, a cloud's metadata service or anything reserved. */
export function isPublicIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 169 && b === 254) return false; // link-local, where cloud metadata lives
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (isIP(ip) === 6) {
    // Global unicast only. Mapped and embedded IPv4, loopback, link-local and private ranges all fall outside 2000::/3.
    const lower = ip.toLowerCase();
    const first = parseInt(lower.split(':')[0] || '0', 16);
    return first >= 0x2000 && first <= 0x3fff && !lower.startsWith('2002:') && !lower.startsWith('2001:db8:');
  }
  return false;
}

/**
 * A name lookup that refuses any answer pointing inside. It runs on the very connection being made, so a name can't answer
 * one address to a check and another to the request.
 */
function publicLookup(host: string, options: object, done: (...args: unknown[]) => void): void {
  lookup(host, { ...options, all: true }, (err, addresses) => {
    if (err) return done(err);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => !isPublicIp(a.address))) return done(new Error('Not a public address'));
    if ((options as { all?: boolean }).all) return done(null, list);
    done(null, list[0]!.address, list[0]!.family);
  });
}

/** A small https answer: no redirects, read as it arrives and dropped past `max` bytes, six seconds at most. */
function getSmall(url: string, max: number): Promise<string | null> {
  return new Promise((done) => {
    const req = request(url, { lookup: publicLookup as never, headers: { accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) {
        req.destroy();
        return done(null);
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > max) {
          req.destroy();
          return done(null);
        }
        chunks.push(chunk);
      });
      res.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
      res.on('error', () => done(null));
    });
    const timer = setTimeout(() => req.destroy(), 6_000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', () => done(null));
    req.end();
  });
}
