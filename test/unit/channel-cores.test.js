// Channel pure cores (C-01): the adapter contract's frozen shapes, typed
// session keys, the platform-aware segmenter (UTF-16 counting — inputs
// built with String.fromCharCode, never literal control chars), and the
// token-bucket reducer with retry-after feedback. Real inputs, real
// outputs, no clocks (now is always an argument).
import { describe, test, expect } from 'vitest';
import { makeMessageEvent, makeSendResult, validateAdapter, CHAT_TYPES } from '../../backend/services/channels/adapter-contract.js';
import { buildSessionKey, parseSessionKey } from '../../backend/services/channels/session-key.js';
import { segmentText } from '../../backend/services/channels/message-segmenter.js';
import { createBucket, consult, applyRetryAfter } from '../../backend/services/channels/rate-limiter.js';

const EVENT = Object.freeze({
  channelId: 'telegram',
  connectionId: 'conn-1',
  chat: { id: 12345, type: 'dm' },
  user: { id: 777, name: 'Founder' },
  text: 'hello there',
  messageId: 42,
});

describe('adapter-contract', () => {
  test('makeMessageEvent normalizes, stringifies ids, and freezes deep', () => {
    const e = makeMessageEvent(EVENT);
    expect(e.chat).toEqual({ id: '12345', type: 'dm' });
    expect(e.user).toEqual({ id: '777', name: 'Founder' });
    expect(e.messageId).toBe('42');
    expect(Object.isFrozen(e) && Object.isFrozen(e.chat) && Object.isFrozen(e.user)).toBe(true);
  });

  test('a malformed event fails LOUDLY at the boundary', () => {
    expect(() => makeMessageEvent({ ...EVENT, chat: { id: 1, type: 'broadcast' } })).toThrow(/chat/);
    expect(() => makeMessageEvent({ ...EVENT, text: null })).toThrow(/text/);
    expect(() => makeMessageEvent({ ...EVENT, user: {} })).toThrow(/user/);
    expect(() => makeMessageEvent(null)).toThrow();
  });

  test('makeSendResult carries only what happened', () => {
    expect(makeSendResult({ success: true, messageId: 9 })).toEqual({ success: true, messageId: '9', retryable: false });
    expect(makeSendResult({ success: false, error: 'flood', retryable: true, retryAfterMs: 3000 }))
      .toEqual({ success: false, error: 'flood', retryable: true, retryAfterMs: 3000 });
  });

  test('validateAdapter names every missing slot', () => {
    expect(validateAdapter({ id: 'x', capabilities: {}, limits: {}, checkRequirements: () => {}, connect: () => {}, disconnect: () => {}, send: () => {} }))
      .toEqual({ ok: true });
    const v = validateAdapter({ id: 'x', send: () => {} });
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual(['capabilities', 'limits', 'checkRequirements', 'connect', 'disconnect']);
  });

  test('chat types are the closed set the pipeline switches on', () => {
    expect(CHAT_TYPES).toEqual(['dm', 'group', 'thread']);
  });
});

describe('session-key', () => {
  const groupEvent = makeMessageEvent({ ...EVENT, chat: { id: 'g9', type: 'group', threadId: 't1' } });

  test('dm key is platform:type:chat and round-trips', () => {
    const k = buildSessionKey(makeMessageEvent(EVENT));
    expect(k.key).toBe('telegram:dm:12345');
    expect(parseSessionKey(k.key)).toMatchObject({ platform: 'telegram', chatType: 'dm', chatId: '12345', threadId: null, userId: null });
  });

  test('thread and per-user parts are TAGGED — a 4-part key is never ambiguous', () => {
    const withThread = buildSessionKey(groupEvent);
    expect(withThread.key).toBe('telegram:group:g9:t~t1');
    const perUser = buildSessionKey(makeMessageEvent({ ...EVENT, chat: { id: 'g9', type: 'group' } }), { groupSessionsPerUser: true });
    expect(perUser.key).toBe('telegram:group:g9:u~777');
    expect(parseSessionKey(withThread.key).threadId).toBe('t1');
    expect(parseSessionKey(withThread.key).userId).toBeNull();
    expect(parseSessionKey(perUser.key).userId).toBe('777');
    expect(parseSessionKey(perUser.key).threadId).toBeNull();
  });

  test('both toggles together yield all five parts, round-tripping', () => {
    const k = buildSessionKey(groupEvent, { groupSessionsPerUser: true });
    expect(k.key).toBe('telegram:group:g9:t~t1:u~777');
    expect(parseSessionKey(k.key)).toMatchObject({ threadId: 't1', userId: '777' });
  });

  test('threadSessions:false folds a thread into its chat session', () => {
    expect(buildSessionKey(groupEvent, { threadSessions: false }).key).toBe('telegram:group:g9');
  });

  test('hostile component characters survive the round trip', () => {
    const e = makeMessageEvent({ ...EVENT, chat: { id: 'a:b~c%d', type: 'dm' } });
    const k = buildSessionKey(e);
    expect(parseSessionKey(k.key).chatId).toBe('a:b~c%d');
  });

  test('malformed strings parse to null, never to a half-key', () => {
    for (const bad of [null, '', 'one:two', 'a:b:c:naked-tail', 'a:b:c:t~x:t~y', 'a::c']) {
      expect(parseSessionKey(bad)).toBeNull();
    }
  });
});

describe('message-segmenter (UTF-16 truth)', () => {
  test('short text is one untouched chunk; empty is none', () => {
    expect(segmentText('hello', 100)).toEqual(['hello']);
    expect(segmentText('', 100)).toEqual([]);
  });

  test('prefers paragraph, then line, then sentence boundaries', () => {
    const text = `${'a'.repeat(40)}\n\n${'b'.repeat(40)}`;
    const [c1, c2] = segmentText(text, 60);
    expect(c1).toBe('a'.repeat(40));
    expect(c2).toBe('b'.repeat(40));
    const lines = segmentText(`${'a'.repeat(40)}\n${'b'.repeat(40)}`, 60);
    expect(lines[0]).toBe('a'.repeat(40));
  });

  test('every chunk respects the cap in UTF-16 units', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} runs along. `).join('');
    for (const chunk of segmentText(text, 120)) expect(chunk.length).toBeLessThanOrEqual(120);
  });

  test('never splits a surrogate pair', () => {
    // astral char built from code units, per the harness-escape rule
    const astral = String.fromCharCode(0xd83d, 0xde00); // one emoji, two units
    const text = astral.repeat(50); // 100 units, no natural boundaries
    const chunks = segmentText(text, 33); // odd cap lands mid-pair
    for (const chunk of chunks) {
      expect(chunk.length % 2).toBe(0); // whole pairs only
      const last = chunk.charCodeAt(chunk.length - 1);
      expect(last >= 0xdc00 && last <= 0xdfff).toBe(true); // ends on a LOW surrogate
    }
    expect(chunks.join('')).toBe(text); // nothing lost
  });

  test('a code fence split across chunks is closed and reopened', () => {
    const code = Array.from({ length: 20 }, (_, i) => `line_${i}`).join('\n');
    const text = `look:\n\`\`\`js\n${code}\n\`\`\`\nafter`;
    const chunks = segmentText(text, 90);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const fences = (chunk.match(/```/g) || []).length;
      expect(fences % 2).toBe(0); // every chunk renders balanced
    }
    expect(chunks[1].startsWith('```js')).toBe(true); // reopened with its language
  });

  test('refuses an unusable cap', () => {
    expect(() => segmentText('x', 4)).toThrow(/maxUnits/);
    expect(() => segmentText('x', 23)).toThrow(/maxUnits/); // fence overhead floor
  });

  test("REGRESSION: a fenced block at the floor terminates — the reviewer's infinite-loop repro", () => {
    // Previously: reopen prefix ate the whole budget → empty piece → no
    // progress, forever. Must now return finite, cap-respecting chunks.
    const text = `\`\`\`\n${'x'.repeat(100)}\n\`\`\``;
    const chunks = segmentText(text, 24);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(24);
  });

  test('REGRESSION: a pathological fence language tag refuses loudly instead of spinning or over-cap chunks', () => {
    const text = `\`\`\`${'l'.repeat(53)}\n${'x'.repeat(200)}\n\`\`\``;
    expect(() => segmentText(text, 60)).toThrow(/language tag/);
  });
});

describe('rate-limiter reducer', () => {
  const T0 = 1_000_000;

  test('spends to dry, names the exact refill delay, and refills', () => {
    let b = createBucket({ capacity: 2, refillPerSec: 1 }, T0);
    let r = consult(b, T0);
    expect(r.allowed).toBe(true);
    r = consult(r.state, T0);
    expect(r.allowed).toBe(true);
    r = consult(r.state, T0);
    expect(r).toMatchObject({ allowed: false, delayMs: 1000 });
    r = consult(r.state, T0 + 1000);
    expect(r.allowed).toBe(true);
  });

  test('tokens never exceed capacity however long the idle', () => {
    const b = createBucket({ capacity: 3, refillPerSec: 10 }, T0);
    const r = consult(b, T0 + 60_000);
    expect(r.state.tokens).toBeLessThanOrEqual(3);
  });

  test('retry-after drains the bucket and holds until the named moment', () => {
    let b = createBucket({ capacity: 5, refillPerSec: 5 }, T0);
    b = applyRetryAfter(b, T0, 3000);
    const during = consult(b, T0 + 1000);
    expect(during).toMatchObject({ allowed: false, delayMs: 2000 });
    const after = consult(b, T0 + 3001);
    expect(after.allowed).toBe(true); // 3s of refill at 5/s refilled it
  });

  test('a later retry-after never SHORTENS an earlier hold', () => {
    let b = createBucket({ capacity: 1, refillPerSec: 1 }, T0);
    b = applyRetryAfter(b, T0, 10_000);
    b = applyRetryAfter(b, T0 + 1000, 1000);
    expect(consult(b, T0 + 5000).allowed).toBe(false);
  });

  test('rejects a bucket that could never flow', () => {
    expect(() => createBucket({ capacity: 0, refillPerSec: 1 }, T0)).toThrow();
    expect(() => createBucket({ capacity: 1, refillPerSec: 0 }, T0)).toThrow();
  });
});
