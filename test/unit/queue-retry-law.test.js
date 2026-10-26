/**
 * TRY AGAIN's law (slice SDT-2, finding 29): why a send failed
 * (send-failure.js) and what returning a failed post to DRAFT does to it
 * (queue-retry.js) — and the doors from a paused mandate or a hold to what
 * tripped it or what it holds (mandate-sources.js), this house's queue only.
 * Pure functions on real inputs; no double (RULE 0). The route and the store
 * are proven in queue-retry-route.test.js.
 */
import { describe, it, expect } from 'vitest';
import { sendFailureCause } from '../../backend/services/social/send-failure.js';
import { restageFailed } from '../../backend/services/social/queue-retry.js';
import { pauseSource, holdSource } from '../../backend/services/marketing/mandate/mandate-sources.js';

const failed = (over) => ({ id: 'f1', status: 'failed', channelId: 'x', accountId: 'x-1', error: '', ...over });

describe('sendFailureCause', () => {
  it('reads the platform\'s status when kept, else the words', () => {
    expect(sendFailureCause(failed({ error: 'Too Many Requests', errorStatus: 429 }))).toBe('retry');
    expect(sendFailureCause(failed({ error: 'Gateway Timeout', errorStatus: 504 }))).toBe('retry');
    expect(sendFailureCause(failed({ error: 'X answered HTTP 502' }))).toBe('retry');
    expect(sendFailureCause(failed({ error: 'send lost mid-flight — the process died …; the copy is NOT live and wants a fresh decision' }))).toBe('retry');
    expect(sendFailureCause(failed({ error: 'interrupted by your operator before publishing' }))).toBe('retry');
    expect(sendFailureCause(failed({ error: 'Forbidden', errorStatus: 403 }))).toBe('keys');
    expect(sendFailureCause(failed({ error: 'invalid token' }))).toBe('keys');
    expect(sendFailureCause(failed({ error: 'media refused — not an image' }))).toBe('content');
    expect(sendFailureCause(failed({ error: 'flagged as spam', errorStatus: 403 }))).toBe('content');
  });

  it('never offers TRY AGAIN where the post may already be out', () => {
    expect(sendFailureCause(failed({ error: 'publishing was interrupted; the outcome is unknown — check LinkedIn before retrying' }))).toBe('other');
    expect(sendFailureCause(failed({ error: 'fetch failed' }))).toBe('other');
    expect(sendFailureCause(failed({ error: 'socket hang up' }))).toBe('other');
    expect(sendFailureCause({ status: 'sent' })).toBeNull();
    expect(sendFailureCause(null)).toBeNull();
  });
});

describe('restageFailed', () => {
  it('a stumble returns to DRAFT — the same entry, its failure kept, every decision cleared', () => {
    const entry = failed({
      error: 'X answered HTTP 503', errorStatus: 503, failedAt: '2026-10-24T09:52:00Z', decidedBy: '0xabc', decidedAt: '2026-10-24T09:00:00Z',
      decidedUnder: 'md_1', sendingAt: '2026-10-24T09:51:00Z', text: 'the words', scheduledFor: '2026-10-24T09:50:00Z',
    });
    expect(restageFailed(entry, { by: '0xabc', at: '2026-10-24T10:00:00Z' })).toBeNull();
    expect(entry).toEqual({
      id: 'f1', status: 'draft', channelId: 'x', accountId: 'x-1', text: 'the words', scheduledFor: '2026-10-24T09:50:00Z',
      attempts: [{ failedAt: '2026-10-24T09:52:00Z', error: 'X answered HTTP 503', errorStatus: 503 }],
      restagedBy: '0xabc', restagedAt: '2026-10-24T10:00:00Z',
    });
  });

  it('keeps at most ten past failures, oldest out first', () => {
    const entry = failed({ error: 'X answered HTTP 503', attempts: Array.from({ length: 10 }, (_, i) => ({ failedAt: `t${i}`, error: 'old' })) });
    restageFailed(entry, { by: 'w', at: 'now' });
    expect(entry.attempts).toHaveLength(10);
    expect(entry.attempts[0].failedAt).toBe('t1');
    expect(entry.attempts[9].error).toBe('X answered HTTP 503');
  });

  it('refuses a refusal of the keys or the words, and leaves the entry as it was', () => {
    for (const error of ['Unauthorized', 'duplicate content', 'fetch failed']) {
      const entry = failed({ error, errorStatus: error === 'Unauthorized' ? 401 : undefined });
      const before = JSON.stringify(entry);
      expect(restageFailed(entry, { by: 'w', at: 'now' })).toEqual({ error: expect.stringContaining('did not fail on a passing platform error') });
      expect(JSON.stringify(entry)).toBe(before);
    }
  });
});

describe('mandate-sources — the door to what tripped it or what it holds', () => {
  const entries = [{ id: 'f1', channelId: 'x' }, { id: 'r1', channelId: 'x', kind: 'reply', status: 'draft', reply: { toPostId: '1850000000000000009' } }];
  const paused = (ref) => ({ status: 'paused', laneId: 'kestrel', pause: { kind: 'spam', reason: 'r', ref } });

  it('a post that tripped it → its card, only when it is this house\'s; the seat\'s own lane → its chat', () => {
    expect(pauseSource(paused({ queueId: 'f1' }), entries)).toEqual({ kind: 'queue', channelId: 'x', entryId: 'f1' });
    expect(pauseSource(paused({ queueId: 'elsewhere' }), entries)).toBeNull();
    expect(pauseSource(paused({ laneId: 'kestrel' }), entries)).toEqual({ kind: 'chat', neumaId: 'kestrel' });
    expect(pauseSource(paused({ laneId: 'another-lane' }), entries)).toBeNull();
    expect(pauseSource({ status: 'active', laneId: 'kestrel' }, entries)).toBeNull();
  });

  it('a hold → the chat that read it, else a reply staged to a post the text named; nothing on record → no door', () => {
    expect(holdSource({ laneId: 'kestrel', sessionId: 's9', postIds: [] }, entries)).toEqual({ kind: 'chat', neumaId: 'kestrel', sessionId: 's9' });
    expect(holdSource({ laneId: 'kestrel', sessionId: null, postIds: ['1850000000000000009'] }, entries)).toEqual({ kind: 'queue', channelId: 'x', entryId: 'r1' });
    expect(holdSource({ laneId: 'kestrel', sessionId: null, postIds: ['1'] }, entries)).toBeNull();
  });
});
