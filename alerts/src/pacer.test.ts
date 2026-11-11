import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanText } from './format.js';
import { COMMANDS_PER_MINUTE, Pacer } from './pacer.js';
import { MAX_WAITING, Outbox } from './outbox.js';

describe('the limits Hermes asked for', () => {
  it('lets a chat send 20 commands a minute, warns once, then drops, and lets it go on after the minute', () => {
    const p = new Pacer();
    for (let i = 0; i < COMMANDS_PER_MINUTE; i++) assert.equal(p.allow(1, 1000 + i), 'ok');
    assert.equal(p.allow(1, 2000), 'warn');
    assert.equal(p.allow(1, 2001), 'drop');
    assert.equal(p.allow(2, 2001), 'ok'); // another chat isn't slowed
    assert.equal(p.allow(1, 1000 + 61_000), 'ok');
  });

  it('takes line breaks and other control characters out of a token name, and cuts it short', () => {
    assert.equal(cleanText('MOON\nbought 10 ZRO'), 'MOON bought 10 ZRO');
    assert.equal(cleanText('A B\tC‮D'), 'A B C D');
    assert.equal(cleanText('x'.repeat(80)).length, 32);
  });

  it("keeps only the newest messages for a chat that can't keep up", () => {
    const box = new Outbox(async () => {});
    for (let i = 0; i < MAX_WAITING + 50; i++) box.push(7, { text: String(i) });
    assert.equal(box.waiting, MAX_WAITING);
  });
});
