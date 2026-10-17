// The reconnect-reload decisions (Neuma Remote), called for real in Node.
import { describe, it, expect } from 'vitest';
import {
  awaitingReply, replyLanded, pollDelay, POLL_MIN_MS, POLL_MAX_MS, POLL_ATTEMPTS,
} from '../../frontend/app/RelinkShell/reconnect-reload.js';

describe('awaitingReply — over the reducer\'s rows', () => {
  it('is true when the last settled row is the operator\'s own words', () => {
    expect(awaitingReply([{ role: 'neuma' }, { role: 'user' }])).toBe(true);
  });
  it('is true while the being\'s reply was still streaming when the link died', () => {
    expect(awaitingReply([{ role: 'user' }, { role: 'neuma', streaming: true }])).toBe(true);
  });
  it('is false once the being has answered, and on an empty stream', () => {
    expect(awaitingReply([{ role: 'user' }, { role: 'neuma' }])).toBe(false);
    expect(awaitingReply([])).toBe(false);
  });
  it('ignores transient and queued rows when deciding', () => {
    expect(awaitingReply([{ role: 'user' }, { role: 'neuma' }, { role: 'user', transient: true }])).toBe(false);
    expect(awaitingReply([{ role: 'user' }, { role: 'neuma' }, { role: 'user', queued: true }])).toBe(false);
    expect(awaitingReply([{ role: 'neuma' }, { role: 'user' }, { role: 'user', transient: true }])).toBe(true);
  });
});

describe('replyLanded — over the session on disk', () => {
  it('reads the last row\'s role', () => {
    expect(replyLanded([{ role: 'user' }, { role: 'assistant' }])).toBe(true);
    expect(replyLanded([{ role: 'user' }])).toBe(false);
    expect(replyLanded([])).toBe(false);
  });
});

describe('pollDelay', () => {
  it('doubles from 5 s to a 30 s ceiling and asks for about twenty minutes', () => {
    const delays = Array.from({ length: 6 }, (_, i) => pollDelay(i));
    expect(delays).toEqual([5000, 10000, 20000, 30000, 30000, 30000]);
    expect(delays[0]).toBe(POLL_MIN_MS);
    const total = Array.from({ length: POLL_ATTEMPTS }, (_, i) => pollDelay(i)).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(15 * 60 * 1000);
    expect(total).toBeLessThan(25 * 60 * 1000);
    expect(POLL_MAX_MS).toBe(30000);
  });
});
