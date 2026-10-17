// S5 — the mem_ ref grammar (reconciliation R1): a ref is a rendering of an
// anchor's content-time coordinates, parsed from the right, frozen charset
// that can never traverse. Pure functions, real inputs (RULE 0).

import { describe, it, expect } from 'vitest';
import {
  MEMORY_REF_PATTERN,
  formatMemoryRef,
  parseMemoryRef,
} from '../../core/memory/memory-query.js';
import { makeAnchor, contentSha8 } from '../../core/workspace/archive-codec.js';

const USER = { content: 'the full remembered thought', timestamp: '2026-07-24T01:00:00.000Z' };
const ASSISTANT = { content: 'the full remembered reply', timestamp: '2026-07-24T01:00:07.000Z' };

describe('formatMemoryRef', () => {
  it('renders an anchor as mem_<sessionId>_<epochMs>_<sha8> and round-trips', () => {
    const anchor = makeAnchor({ sessionId: 'session-1753290000000', userMessage: USER, assistantMessage: ASSISTANT });
    const ref = formatMemoryRef(anchor);
    expect(ref).toBe(`mem_session-1753290000000_${Date.parse(USER.timestamp)}_${contentSha8(USER.content)}`);
    expect(MEMORY_REF_PATTERN.test(ref)).toBe(true);

    const parsed = parseMemoryRef(ref);
    expect(parsed).toEqual({
      ok: true,
      sessionId: 'session-1753290000000',
      epochMs: Date.parse(USER.timestamp),
      sha8: contentSha8(USER.content),
    });
  });

  it('admits bf- pseudo-session ids with NO grammar change (R2)', () => {
    const anchor = makeAnchor({ sessionId: 'bf-cael-1753290000000', userMessage: USER, assistantMessage: ASSISTANT });
    const ref = formatMemoryRef(anchor);
    expect(ref).not.toBeNull();
    expect(parseMemoryRef(ref).sessionId).toBe('bf-cael-1753290000000');
  });

  it('parses from the RIGHT — hyphens in the id slot never confuse the split', () => {
    const ref = 'mem_a-b-c-d-9_1753290000000_deadbeef';
    const parsed = parseMemoryRef(ref);
    expect(parsed.sessionId).toBe('a-b-c-d-9');
    expect(parsed.epochMs).toBe(1753290000000);
    expect(parsed.sha8).toBe('deadbeef');
  });

  it('mints NOTHING for unlawful anchors — null, never a throw (mint-time law)', () => {
    expect(formatMemoryRef(null)).toBeNull();
    expect(formatMemoryRef({})).toBeNull();
    expect(formatMemoryRef({ sessionId: 'UpperCase', span: { fromTs: USER.timestamp, userSha8: 'deadbeef' } })).toBeNull();
    expect(formatMemoryRef({ sessionId: 'has_underscore', span: { fromTs: USER.timestamp, userSha8: 'deadbeef' } })).toBeNull();
    expect(formatMemoryRef({ sessionId: 'x'.repeat(65), span: { fromTs: USER.timestamp, userSha8: 'deadbeef' } })).toBeNull();
    expect(formatMemoryRef({ sessionId: 'ok-id', span: { fromTs: 'not-a-time', userSha8: 'deadbeef' } })).toBeNull();
    expect(formatMemoryRef({ sessionId: 'ok-id', span: { fromTs: USER.timestamp, userSha8: 'BADHEX!!' } })).toBeNull();
  });
});

describe('parseMemoryRef — the regex is the law of what a ref may carry', () => {
  it('rejects hostile and foreign shapes', () => {
    for (const bad of [
      'tr_deadbeef_1_cafebabe',              // wrong family
      'mem_../etc/passwd_1_deadbeef',        // traversal
      'mem_%2e%2e_1_deadbeef',               // encoded traversal
      'mem_a_b_1_deadbeef',                  // underscore abuse in id slot
      'mem_ok-id_1753290000000_DEADBEEF',    // uppercase sha
      'mem_ok-id_1234567890123456_deadbeef', // 16-digit epoch (>15)
      'mem_ok-id_1753290000000_deadbee',     // 7-char sha
      'mem_-leading_1_deadbeef',             // id must start [a-z0-9]
      'mem_ok-id_1_deadbeef ',               // trailing space
      '',
      42,
      null,
    ]) {
      const parsed = parseMemoryRef(bad);
      expect(parsed.ok).toBe(false);
    }
  });

  it('the pattern object itself is frozen', () => {
    expect(Object.isFrozen(MEMORY_REF_PATTERN)).toBe(true);
  });
});
