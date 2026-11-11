import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { enqueue, Outbox, takeBatch } from './outbox.js';
import { backoffMs, followStream, SseParser, type SseEvent } from './sse.js';
import { dataPath, loadData, Store } from './store.js';

describe('SSE parser', () => {
  it('reads events split anywhere, with comments and CRLF', () => {
    const p = new SseParser();
    const text = ': connected\r\n\r\nevent: trade\r\ndata: {"a":1}\r\n\r\n: ping\n\nevent: order\ndata: {"id":7}\n\ndata: line one\ndata: line two\n\n';
    const got: SseEvent[] = [];
    // one character at a time: the worst case for line endings split across chunks
    for (const ch of text) got.push(...p.push(ch));
    assert.deepEqual(got, [
      { event: 'trade', data: '{"a":1}' },
      { event: 'order', data: '{"id":7}' },
      { event: 'message', data: 'line one\nline two' },
    ]);
  });
  it('handles a bare CR line ending, ids, retry, and a field without a value', () => {
    const p = new SseParser();
    const got = p.push('id: 5\rretry: 3000\revent: launch\rdata\r\r');
    assert.deepEqual(got, [{ event: 'launch', data: '', id: '5' }]);
    assert.equal(p.retry, 3000);
  });
  it('drops an event with no data and keeps an unfinished one', () => {
    const p = new SseParser();
    assert.deepEqual(p.push('event: x\n\nevent: trade\ndata: 1'), []);
    assert.deepEqual(p.push('\n\n'), [{ event: 'trade', data: '1' }]);
  });
});

describe('backoff', () => {
  it('doubles from 1 s up to 30 s', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 50].map((a) => backoffMs(a, 0.5)), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
  it('jitters by a fifth either way', () => {
    assert.equal(backoffMs(0, 0), 800);
    assert.equal(backoffMs(0, 1), 1200);
  });
});

describe('stream over HTTP', () => {
  it('reads events and reconnects after the server drops it', async () => {
    let connections = 0;
    const server = createServer((_req, res) => {
      connections++;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': connected\n\n');
      res.write(`event: trade\ndata: {"n":${connections}}\n\n`);
      if (connections === 1) setTimeout(() => res.destroy(), 50); // drop the first connection
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/stream`;
    const stop = new AbortController();
    const seen: string[] = [];
    let opens = 0;
    const done = new Promise<void>((resolve) => {
      void followStream(url, {
        signal: stop.signal,
        onOpen: () => opens++,
        onEvent: (e) => {
          seen.push(e.data);
          if (seen.length === 2) resolve();
        },
      });
    });
    await done;
    stop.abort();
    server.closeAllConnections();
    server.close();
    assert.deepEqual(seen, ['{"n":1}', '{"n":2}']);
    assert.equal(opens, 2);
  });
});

describe('outbox', () => {
  it('replaces a waiting message with the same key', () => {
    let q = enqueue([], { text: 'a' });
    q = enqueue(q, { text: '2 together', key: 'k' });
    q = enqueue(q, { text: 'b' });
    q = enqueue(q, { text: '3 together', key: 'k' });
    assert.deepEqual(q.map((m) => m.text), ['a', '3 together', 'b']);
  });
  it('merges what fits into one message', () => {
    const { text, rest } = takeBatch([{ text: 'one' }, { text: 'two' }, { text: 'x'.repeat(10) }], 12);
    assert.equal(text, 'one\n\ntwo');
    assert.equal(rest.length, 1);
    assert.equal(takeBatch([{ text: 'y'.repeat(20) }], 12).text.length, 12);
  });
  it('sends at most one message per chat per gap, merging a burst', async () => {
    const sent: Array<{ chat: number; text: string; at: number }> = [];
    const box = new Outbox(async (chat, text) => void sent.push({ chat, text, at: Date.now() }), 200);
    const stop = new AbortController();
    const running = box.run(stop.signal);
    box.push(1, { text: 'first' });
    await new Promise((r) => setTimeout(r, 20));
    box.push(1, { text: 'second' });
    box.push(1, { text: 'third' });
    box.push(2, { text: 'other chat' });
    await new Promise((r) => setTimeout(r, 400));
    stop.abort();
    await running;
    assert.deepEqual(sent.map((s) => [s.chat, s.text]), [[1, 'first'], [2, 'other chat'], [1, 'second\n\nthird']]);
    const ones = sent.filter((s) => s.chat === 1);
    assert.ok(ones[1]!.at - ones[0]!.at >= 190, 'second message to a chat waited for the gap');
  });
  it('tries a failed send again, then gives up', async () => {
    let calls = 0;
    const box = new Outbox(async () => {
      calls++;
      throw new Error('network down');
    }, 10, 3);
    const stop = new AbortController();
    const running = box.run(stop.signal);
    box.push(1, { text: 'hi' });
    await new Promise((r) => setTimeout(r, 150));
    stop.abort();
    await running;
    assert.equal(calls, 3);
    assert.equal(box.waiting, 0);
  });
});

describe('store', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'alerts-test-'));

  it('finds the file from ALERTS_DATA as a file or a folder', () => {
    assert.ok(dataPath(undefined, '/x/data').endsWith('subscriptions.json'));
    assert.ok(dataPath('/y/subs.json', '/x/data').endsWith('subs.json'));
    assert.ok(dataPath('  ', '/x/data').includes('data'));
  });
  it('writes atomically and reads back', () => {
    const path = join(dir(), 'nested', 'subs.json');
    const s = new Store(path);
    s.chat(42).watches.push({ wallet: '0x' + 'ab'.repeat(20), name: 'Bob' });
    s.setOffset(77);
    s.changed();
    s.flush();
    assert.deepEqual(readdirSync(join(path, '..')), ['subs.json'], 'no temp file left behind');
    const again = new Store(path);
    assert.equal(again.data.offset, 77);
    assert.equal(again.watchersOf('0x' + 'ab'.repeat(20))[0]?.chatId, 42);
  });
  it('forgets empty chats, moves and drops chats', () => {
    const s = new Store(join(dir(), 'subs.json'));
    s.chat(1);
    s.chat(2).orders.push({ wallet: 'w', seen: null });
    s.changed();
    assert.deepEqual(Object.keys(s.data.chats), ['2']);
    s.moveChat(2, -100);
    assert.equal(s.orderSubsOf('w')[0]?.chatId, -100);
    s.dropChat(-100);
    assert.deepEqual(s.orderWallets(), []);
  });
  it('moves a broken file aside instead of overwriting it', () => {
    const d = dir();
    const path = join(d, 'subs.json');
    writeFileSync(path, '{ not json');
    const data = loadData(path);
    assert.deepEqual(data.chats, {});
    const files = readdirSync(d);
    assert.equal(files.length, 1);
    assert.match(files[0]!, /^subs\.json\.broken-\d+$/);
    assert.equal(readFileSync(join(d, files[0]!), 'utf8'), '{ not json');
  });
});
