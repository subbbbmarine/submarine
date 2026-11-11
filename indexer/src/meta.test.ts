import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const folder = mkdtempSync(join(tmpdir(), 'meta-'));
process.env.DB_PATH = join(folder, 'test.db');
const { isPublicIp, saveMeta, sweepMeta } = await import('./meta.js');
const { META_DIR } = await import('./config.js');

const HOUR = 3_600_000;
const later = (hours: number) => Date.now() + hours * HOUR;
/** A PNG's opening bytes and a header saying `side` pixels square, then bytes that differ for each `seed`, so each is a new file. */
const picture = (seed: number, size = 1024 * 1024 - 8, side = 512) => {
  const bytes = Buffer.alloc(size + 8, seed);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(bytes);
  bytes.writeUInt32BE(side, 16);
  bytes.writeUInt32BE(side, 20);
  return `data:image/png;base64,${bytes.toString('base64')}`;
};
const uriOf = (saved: Awaited<ReturnType<typeof saveMeta>>) => {
  if ('error' in saved) throw new Error(saved.error);
  return saved.uri;
};
const files = () => readdirSync(META_DIR);

afterAll(() => rmSync(folder, { recursive: true, force: true }));

describe('what anyone can save', () => {
  it('stops one address after 10 MB an hour, and only that address', async () => {
    // Ten pictures a little under 1 MB, so they and the small JSON saved with each fit in the 10 MB together.
    for (let i = 0; i < 10; i++) expect('uri' in (await saveMeta({ image: picture(i, 1024 * 1024 - 4096) }, 'greedy'))).toBe(true);
    const refused = await saveMeta({ image: picture(50) }, 'greedy');
    expect('error' in refused && refused.error).toMatch(/Too much saved/);
    expect('uri' in (await saveMeta({ image: picture(51) }, 'someone else'))).toBe(true);
  });

  it('refuses a small file that opens into a huge picture', async () => {
    const bomb = await saveMeta({ image: picture(60, 1000, 16_000) }, 'bomber');
    expect('error' in bomb && bomb.error).toMatch(/at most 4096/);
  });

  it('stops one address after two dozen files an hour, however small', async () => {
    let refused: Awaited<ReturnType<typeof saveMeta>> | null = null;
    let saves = 0;
    for (let i = 0; i < 40 && !refused; i++) {
      const r = await saveMeta({ image: picture(200 + i, 100), description: `try ${i}` }, 'many');
      if ('error' in r) refused = r;
      else saves += 1;
    }
    expect(saves).toBe(12);
    expect(refused && 'error' in refused && refused.error).toMatch(/Too much saved/);
  });

  it('counts the JSON too, so a spent budget refuses a save with no picture', async () => {
    // What's left of the 10 MB after the pictures is a few dozen KB: words alone, each save new, run out of it too.
    let refused: Awaited<ReturnType<typeof saveMeta>> | null = null;
    for (let i = 0; i < 200 && !refused; i++) {
      const r = await saveMeta({ description: `${i} `.padEnd(590, 'x') }, 'greedy');
      if ('error' in r) refused = r;
    }
    expect(refused && 'error' in refused && refused.error).toMatch(/Too much saved/);
  });

  it("doesn't charge an address for a picture that's already there", async () => {
    expect('uri' in (await saveMeta({ image: picture(0, 1024 * 1024 - 4096) }, 'greedy'))).toBe(true);
  });
});

describe('sweeping', () => {
  it('keeps what a token points at, its picture too, and removes what no launch used', async () => {
    const used = uriOf(await saveMeta({ image: picture(100, 100), description: 'launched' }, 'a'));
    const abandoned = uriOf(await saveMeta({ image: picture(101, 100), description: 'abandoned' }, 'b'));
    const before = files().length;
    expect(before).toBeGreaterThan(4);

    expect(sweepMeta([used], later(1))).toBe(0); // nothing is old enough yet

    sweepMeta([used], later(7));
    const left = files();
    expect(left).toHaveLength(2);
    expect(left).toContain(`${used.split('/').pop()}.json`);
    expect(left).not.toContain(`${abandoned.split('/').pop()}.json`);
    expect(left.some((name) => name.endsWith('.png'))).toBe(true);
  });

  it("leaves a file alone when it's asked for again", async () => {
    const image = picture(102, 100);
    await saveMeta({ image, description: 'first try' }, 'c');
    const png = files().filter((name) => name.endsWith('.png'));
    sweepMeta([], later(5)); // old enough to be close, not old enough to go
    expect(files().filter((name) => name.endsWith('.png'))).toEqual(png);
  });

  it("never touches a file it didn't name", () => {
    const stray = join(META_DIR, 'notes.txt');
    writeFileSync(stray, 'x');
    sweepMeta([], later(100));
    expect(existsSync(stray)).toBe(true);
    expect(files()).toEqual(['notes.txt']);
  });
});

describe('other terminals asked for metadata', () => {
  it('are only asked at public addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.9.9', '192.168.1.1', '169.254.169.254', '100.64.0.7', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '2002:7f00:1::1']) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
    for (const ip of ['1.1.1.1', '172.32.0.1', '8.8.8.8', '2606:4700:4700::1111']) expect(isPublicIp(ip), ip).toBe(true);
  });
});
