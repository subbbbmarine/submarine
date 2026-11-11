import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { parseCommand } from './commands.js';
import { asTrade, Engine, type Trade } from './engine.js';
import type { IndexerApi, TokenInfo } from './indexer.js';
import type { Message } from './outbox.js';
import type { OrderRow } from './rules.js';
import { Store } from './store.js';

const TOKEN = '0x' + '11'.repeat(20);
const ALICE = '0x' + 'aa'.repeat(20);
const BOB = '0x' + 'bb'.repeat(20);
const CAROL = '0x' + 'cc'.repeat(20);
const NOW_S = 1_800_000_000;
const CHAT = 5;

class FakeIndexer implements IndexerApi {
  info: TokenInfo | null = { address: TOKEN, name: 'Pepe', symbol: 'PEPE', market_cap: 10, price: 1e-8, total_supply: 1e9 };
  ordersOf = new Map<string, OrderRow[]>();
  async token() {
    return this.info;
  }
  async tokenNow() {
    return this.info;
  }
  async orders(owner?: string) {
    if (!owner) return [...this.ordersOf.entries()].flatMap(([o, rows]) => rows.map((r) => ({ ...r, owner: o })));
    return this.ordersOf.get(owner) ?? [];
  }
  async zroUsd() {
    return 600;
  }
}

let n = 0;
const trade = (trader: string, isBuy: boolean, price: number, ts = NOW_S, zro = 0.5): Trade => ({ tx: `0x${(++n).toString(16)}`, idx: 0, block: 1, ts, token: TOKEN, trader, isBuy, zro, amount: 1, price, venue: 'curve' });

describe('engine', () => {
  let store: Store;
  let indexer: FakeIndexer;
  let sent: Array<{ chat: number; msg: Message }>;
  let engine: Engine;
  const run = (text: string) => engine.command(CHAT, parseCommand(text)!);

  beforeEach(() => {
    store = new Store(join(mkdtempSync(join(tmpdir(), 'alerts-engine-')), 'subs.json'));
    indexer = new FakeIndexer();
    sent = [];
    engine = new Engine({ store, indexer, siteUrl: 'https://terminal.example', push: (chat, msg) => sent.push({ chat, msg }), now: () => NOW_S * 1000 });
    engine.zroUsd = 600;
  });

  it('checks the trade event shape', () => {
    assert.equal(asTrade({ token: TOKEN, trader: 'x' }), null);
    assert.equal(asTrade(null), null);
    assert.equal(asTrade({ tx: '0x1', token: TOKEN.toUpperCase(), trader: ALICE, isBuy: true, ts: 1, zro: 1, amount: 1, price: 1 })?.token, TOKEN);
  });

  it('announces a watched wallet trade with its name, cap and link', async () => {
    assert.match((await run(`/watch ${ALICE} Alice`))!, /Watching Alice/);
    // 2.05e-8 ZRO a token x 1e9 tokens = 20.5 ZRO, at $600 that's $12.3K
    await engine.onTrade(trade(ALICE, true, 2.05e-8));
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.msg.text, `Alice bought 0.5 ZRO of PEPE at $12.3K cap\nhttps://terminal.example/tokens/${TOKEN}`);
    await engine.onTrade(trade(ALICE, false, 2e-8));
    assert.match(sent[1]!.msg.text, /^Alice sold 0\.5 ZRO of PEPE at \$12K cap/);
  });

  it('ignores unwatched wallets, repeats and stale trades', async () => {
    await run(`/watch ${ALICE}`);
    await engine.onTrade(trade(BOB, true, 1e-8));
    const t = trade(ALICE, true, 1e-8);
    await engine.onTrade(t);
    await engine.onTrade(t);
    await engine.onTrade(trade(ALICE, true, 1e-8, NOW_S - 3600));
    assert.equal(sent.length, 1);
  });

  it('groups watched wallets buying the same token within a minute', async () => {
    await run(`/watch ${ALICE} Alice`);
    await run(`/watch ${BOB} Bob`);
    await run(`/watch ${CAROL}`);
    await engine.onTrade(trade(ALICE, true, 1e-8, NOW_S - 50));
    await engine.onTrade(trade(BOB, true, 1e-8, NOW_S - 20));
    await engine.onTrade(trade(CAROL, true, 1e-8, NOW_S));
    assert.equal(sent.length, 3);
    assert.match(sent[0]!.msg.text, /^Alice bought/);
    assert.match(sent[1]!.msg.text, /^2 wallets you watch bought PEPE in the last minute: Alice, Bob\./);
    assert.match(sent[2]!.msg.text, /^3 wallets you watch bought PEPE in the last minute: Alice, Bob, 0xcccc\.\.\.cccc\./);
    // the same key, so the outbox sends only the newest if both are still waiting
    assert.equal(sent[1]!.msg.key, sent[2]!.msg.key);
  });

  it('sets a cap alert, refuses one already past, and fires once on the crossing', async () => {
    indexer.info = { ...indexer.info!, market_cap: 50 }; // 50 ZRO = $30K
    assert.match((await run(`/alert ${TOKEN} below 40k`))!, /already below \$40K \(it's \$30K now\)/);
    assert.match((await run(`/alert ${TOKEN} above 50k`))!, /tell you once when PEPE's market cap goes above \$50K\. It's \$30K now/);
    assert.match((await run('/alerts'))!, /1\. PEPE above \$50K, last seen at \$30K/);
    await engine.onTrade(trade(BOB, true, 8e-8)); // $48K
    assert.equal(sent.length, 0);
    await engine.onTrade(trade(BOB, true, 9e-8)); // $54K
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.msg.text, /^PEPE market cap went above \$50K\. It's \$54K now\./);
    await engine.onTrade(trade(BOB, true, 1e-7));
    assert.equal(sent.length, 1, 'one-shot');
    assert.match((await run('/alerts'))!, /no market cap alerts/);
  });

  it("can't set a cap alert without a ZRO price or for an unknown token", async () => {
    engine.zroUsd = null;
    assert.match((await run(`/alert ${TOKEN} above 50k`))!, /ZRO price/);
    engine.zroUsd = 600;
    indexer.info = null;
    assert.match((await run(`/alert ${TOKEN} above 50k`))!, /doesn't know a token/);
  });

  it('removes alerts and watches by command', async () => {
    await run(`/alert ${TOKEN} above 50k`);
    assert.match((await run('/unalert 2'))!, /no alert number 2/);
    assert.match((await run('/unalert 1'))!, /Removed: PEPE above \$50K/);
    await run(`/watch ${ALICE} Alice`);
    assert.match((await run('/watching'))!, new RegExp(`1\\. Alice: ${ALICE}`));
    assert.match((await run(`/unwatch ${ALICE}`))!, /Stopped watching Alice/);
    assert.match((await run(`/unwatch ${ALICE}`))!, /not watching/);
  });

  it('follows a wallet\'s orders and tells about fills, not old ones', async () => {
    const row = (id: number, status: string, filled: number): OrderRow => ({ id, token: TOKEN, symbol: 'PEPE', is_buy: true, status, kind: 'limit', filled_num: filled, filled_share: filled, size_zro: 1 });
    indexer.ordersOf.set(ALICE, [row(1, 'filled', 1), row(2, 'open', 0)]);
    assert.match((await run(`/orders ${ALICE}`))!, /It has 1 open order now/);

    indexer.ordersOf.set(ALICE, [row(1, 'filled', 1), row(2, 'partial', 0.25)]);
    engine.onOrderEvent(2);
    await engine.flushOrders();
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.msg.text, /^Buy order #2 on PEPE \(1 ZRO\) from 0xaaaa\.\.\.aaaa partly filled, 25% done\./);

    // an order it hasn't seen yet: the latest orders say whose it is
    indexer.ordersOf.set(ALICE, [row(3, 'filled', 1), row(1, 'filled', 1), row(2, 'filled', 1)]);
    engine.onOrderEvent(3);
    await engine.flushOrders();
    assert.deepEqual(sent.slice(1).map((s) => s.msg.text.split(' from ')[0]), ['Buy order #3 on PEPE (1 ZRO)', 'Buy order #2 on PEPE (1 ZRO)']);

    assert.match((await run(`/unorders ${ALICE}`))!, /Stopped order alerts/);
    assert.match((await run('/orders'))!, /not following/);
  });
});
