import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAddress, parseCap, parseCommand, splitCommand } from './commands.js';
import { formatZro, formatUsd, shortAddress } from './format.js';
import { alreadyPast, crossed, orderNews, type OrderRow } from './rules.js';
import { noteBuy, Together } from './together.js';

const A = '0x' + 'ab'.repeat(20);
const B = '0x' + 'cd'.repeat(20);

describe('formatting', () => {
  it('says dollars like a trader', () => {
    assert.equal(formatUsd(12_300), '$12.3K');
    assert.equal(formatUsd(12_345), '$12.3K');
    assert.equal(formatUsd(50_000), '$50K');
    assert.equal(formatUsd(1_200_000), '$1.2M');
    assert.equal(formatUsd(999_950), '$1M');
    assert.equal(formatUsd(2e9), '$2B');
    assert.equal(formatUsd(950), '$950');
    assert.equal(formatUsd(0.42), '$0.42');
    assert.equal(formatUsd(0.001), '<$0.01');
    assert.equal(formatUsd(Number.NaN), '$?');
  });
  it('says ZRO amounts', () => {
    assert.equal(formatZro(0.5), '0.5');
    assert.equal(formatZro(0.012345), '0.0123');
    assert.equal(formatZro(12.345), '12.3');
    assert.equal(formatZro(1234.5), '1,235');
    assert.equal(formatZro(0.00001), '<0.0001');
  });
  it('shortens addresses', () => assert.equal(shortAddress(A), '0xabab...abab'));
});

describe('cap parsing', () => {
  it('reads the usual ways of writing a cap', () => {
    assert.equal(parseCap('50k'), 50_000);
    assert.equal(parseCap('50K'), 50_000);
    assert.equal(parseCap('1.2m'), 1_200_000);
    assert.equal(parseCap('$50,000'), 50_000);
    assert.equal(parseCap('2b'), 2e9);
    assert.equal(parseCap('.5m'), 500_000);
    assert.equal(parseCap('75000'), 75_000);
  });
  it('rejects anything else', () => {
    for (const bad of ['', 'k', 'abc', '-5k', '0', '0k', '1.2.3m', '5x', '1e5', '5000t', '2000b']) assert.equal(parseCap(bad), null, bad);
  });
});

describe('command parsing', () => {
  it('splits a command and its words', () => {
    assert.deepEqual(splitCommand('/watch 0xabc Bob'), { name: 'watch', args: ['0xabc', 'Bob'] });
    assert.deepEqual(splitCommand('  /Alerts  '), { name: 'alerts', args: [] });
    assert.equal(splitCommand('hello'), null);
  });
  it('takes commands addressed to this bot and ignores ones for others', () => {
    assert.equal(splitCommand('/watch@SubmarineAlertsBot x', 'submarinealertsbot')?.name, 'watch');
    assert.equal(splitCommand('/watch@OtherBot x', 'SubmarineAlertsBot'), null);
  });
  it('checks addresses', () => {
    assert.ok(isAddress(A));
    assert.ok(isAddress('0x' + 'AbCd'.repeat(10)));
    assert.ok(!isAddress('0x123'));
    assert.ok(!isAddress('ab'.repeat(21)));
    assert.ok(!isAddress('0x' + 'zz'.repeat(20)));
  });
  it('parses /watch with and without a name', () => {
    assert.deepEqual(parseCommand(`/watch ${A.toUpperCase().replace('0X', '0x')} Big Whale`), { kind: 'watch', wallet: A, name: 'Big Whale' });
    assert.deepEqual(parseCommand(`/watch ${A}`), { kind: 'watch', wallet: A, name: null });
    const long = parseCommand(`/watch ${A} ${'x'.repeat(50)}`);
    assert.equal(long?.kind === 'watch' && long.name?.length, 32);
  });
  it('answers bad input with a plain error', () => {
    assert.equal(parseCommand('/watch')?.kind, 'error');
    assert.equal(parseCommand('/watch 0x123')?.kind, 'error');
    assert.equal(parseCommand('/unwatch nope')?.kind, 'error');
    assert.equal(parseCommand(`/alert ${A} sideways 50k`)?.kind, 'error');
    assert.equal(parseCommand(`/alert ${A} above lots`)?.kind, 'error');
    assert.equal(parseCommand(`/alert ${A} above`)?.kind, 'error');
    assert.equal(parseCommand('/alert 0x1 above 5k')?.kind, 'error');
    assert.equal(parseCommand('/unalert 0')?.kind, 'error');
    assert.equal(parseCommand('/unalert x')?.kind, 'error');
    assert.equal(parseCommand('/orders 0x1')?.kind, 'error');
  });
  it('parses /alert, /unalert, /orders and the rest', () => {
    assert.deepEqual(parseCommand(`/alert ${A} above 50k`), { kind: 'alert', token: A, direction: 'above', levelUsd: 50_000 });
    assert.deepEqual(parseCommand(`/alert ${A} BELOW 1.2 m`), { kind: 'alert', token: A, direction: 'below', levelUsd: 1_200_000 });
    assert.deepEqual(parseCommand('/unalert 2'), { kind: 'unalert', index: 2 });
    assert.deepEqual(parseCommand(`/orders ${B}`), { kind: 'orders', wallet: B });
    assert.deepEqual(parseCommand('/orders'), { kind: 'orders', wallet: null });
    assert.deepEqual(parseCommand('/start'), { kind: 'help' });
    assert.deepEqual(parseCommand('/watching'), { kind: 'watching' });
    assert.deepEqual(parseCommand('/frobnicate'), { kind: 'unknown', name: 'frobnicate' });
  });
});

describe('market cap crossing', () => {
  it('fires on the move across the level, not before', () => {
    assert.equal(crossed('above', 50_000, 40_000, 49_999), false);
    assert.equal(crossed('above', 50_000, 40_000, 50_000), true);
    assert.equal(crossed('above', 50_000, 40_000, 80_000), true);
    assert.equal(crossed('below', 50_000, 60_000, 50_001), false);
    assert.equal(crossed('below', 50_000, 60_000, 45_000), true);
  });
  it("doesn't fire while already past the level", () => {
    assert.equal(crossed('above', 50_000, 55_000, 60_000), false);
    assert.equal(crossed('below', 50_000, 45_000, 40_000), false);
  });
  it('without a previous cap, being past the level counts', () => {
    assert.equal(crossed('above', 50_000, null, 60_000), true);
    assert.equal(crossed('above', 50_000, null, 40_000), false);
    assert.equal(crossed('above', 50_000, null, Number.NaN), false);
  });
  it('knows an alert set on the wrong side', () => {
    assert.equal(alreadyPast('above', 50_000, 60_000), true);
    assert.equal(alreadyPast('below', 50_000, 60_000), false);
  });
});

describe('order news', () => {
  const order = (id: number, status: string, filled: number, share = 0): OrderRow => ({ id, token: A, symbol: 'PEPE', is_buy: true, status, kind: 'limit', filled_num: filled, filled_share: share, size_zro: 1 });

  it('only remembers on the first look', () => {
    const { news, seen } = orderNews(null, [order(1, 'filled', 1, 1), order(2, 'partial', 0.5, 0.5)]);
    assert.equal(news.length, 0);
    assert.deepEqual(seen, { '1': { status: 'filled', filled: 1 }, '2': { status: 'partial', filled: 0.5 } });
  });
  it('tells about a fill and a partial fill once each', () => {
    const first = orderNews(null, [order(1, 'open', 0), order(2, 'open', 0)]).seen;
    const second = orderNews(first, [order(1, 'filled', 1, 1), order(2, 'partial', 0.4, 0.4)]);
    assert.deepEqual(second.news.map((n) => [n.order.id, n.what]), [[1, 'filled'], [2, 'partial']]);
    const third = orderNews(second.seen, [order(1, 'filled', 1, 1), order(2, 'partial', 0.4, 0.4)]);
    assert.equal(third.news.length, 0);
    const fourth = orderNews(third.seen, [order(1, 'filled', 1, 1), order(2, 'partial', 0.7, 0.7)]);
    assert.deepEqual(fourth.news.map((n) => [n.order.id, n.what]), [[2, 'partial']]);
  });
  it('tells about a new order that filled between looks, and not about cancels', () => {
    const { news } = orderNews({}, [order(3, 'filled', 1, 1), order(4, 'cancelled', 0), order(5, 'open', 0)]);
    assert.deepEqual(news.map((n) => n.order.id), [3]);
  });
  it('tells about a part filled just before the order closed', () => {
    const seen = orderNews(null, [order(6, 'open', 0)]).seen;
    assert.deepEqual(orderNews(seen, [order(6, 'cancelled', 0.3, 0.3)]).news.map((n) => n.what), ['partial']);
  });
});

describe('together', () => {
  it('groups distinct wallets within the window', () => {
    let r = noteBuy([], { wallet: A, ts: 100 });
    assert.deepEqual(r.wallets, [A]);
    r = noteBuy(r.recent, { wallet: A, ts: 110 });
    assert.deepEqual(r.wallets, [A]);
    r = noteBuy(r.recent, { wallet: B, ts: 150 });
    assert.deepEqual(r.wallets, [A, B]);
  });
  it('lets old buys fall out of the window', () => {
    const r = noteBuy([{ wallet: A, ts: 100 }], { wallet: B, ts: 161 });
    assert.deepEqual(r.wallets, [B]);
    assert.equal(r.recent.length, 1);
  });
  it('keeps chats and tokens apart, and prunes', () => {
    const t = new Together(60);
    t.note(1, 'tok', { wallet: A, ts: 100 });
    assert.deepEqual(t.note(2, 'tok', { wallet: B, ts: 101 }), [B]);
    assert.deepEqual(t.note(1, 'other', { wallet: B, ts: 101 }), [B]);
    assert.deepEqual(t.note(1, 'tok', { wallet: B, ts: 102 }), [A, B]);
    t.prune(150);
    assert.equal(t.size, 3);
    t.prune(200);
    assert.equal(t.size, 0);
  });
});
