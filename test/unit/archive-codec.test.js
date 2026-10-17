import { describe, it, expect } from 'vitest';
import {
  ARCHIVE_SEGMENT_FORMAT,
  ARCHIVE_SEGMENT_VERSION,
  ANCHOR_VERSION,
  ORIGIN_COMPACTION,
  ORIGIN_BACKFILL,
  SEGMENT_FILE_PATTERN,
  contentSha8,
  segmentFileName,
  parseSegmentFileName,
  encodeSegment,
  decodeSegment,
  makeAnchor,
  regionCoverage,
  spanCoversTs,
} from '../../core/workspace/archive-codec.js';

const msg = (role, content, timestamp) => ({ role, content, timestamp });

const REGION = [
  msg('user', 'first thought', '2026-07-24T01:00:00.000Z'),
  msg('assistant', 'first reply', '2026-07-24T01:00:05.000Z'),
  msg('user', 'second thought', '2026-07-24T01:02:00.000Z'),
  msg('assistant', 'second reply', '2026-07-24T01:02:09.000Z'),
];

describe('contentSha8', () => {
  it('is the first 8 hex chars of sha256 over the full content', () => {
    // sha256('hello') = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(contentSha8('hello')).toBe('2cf24dba');
  });

  it('differs when content differs beyond a truncation boundary', () => {
    const base = 'x'.repeat(600);
    expect(contentSha8(`${base}a`)).not.toBe(contentSha8(`${base}b`));
  });

  it('rejects non-string content', () => {
    expect(() => contentSha8(42)).toThrow('contentSha8');
  });
});

describe('segment filename grammar', () => {
  it('round-trips canonical names', () => {
    expect(segmentFileName(0)).toBe('0.seg');
    expect(segmentFileName(7)).toBe('7.seg');
    expect(segmentFileName(999999)).toBe('999999.seg');
    expect(parseSegmentFileName('0.seg')).toBe(0);
    expect(parseSegmentFileName('999999.seg')).toBe(999999);
  });

  it('rejects non-canonical and hostile names', () => {
    for (const name of ['01.seg', '-1.seg', '1000000.seg', 'a.seg', '1.seg.tmp', '../1.seg', '1.SEG', '1seg', '']) {
      expect(parseSegmentFileName(name)).toBeNull();
    }
    expect(parseSegmentFileName(null)).toBeNull();
  });

  it('rejects out-of-range or non-integer ordinals at mint time', () => {
    for (const bad of [-1, 1000000, 1.5, '3', null]) {
      expect(() => segmentFileName(bad)).toThrow('segmentFileName');
    }
  });

  it('exposes the frozen pattern', () => {
    expect(Object.isFrozen(SEGMENT_FILE_PATTERN)).toBe(true);
    expect(SEGMENT_FILE_PATTERN.test('12.seg')).toBe(true);
  });
});

describe('encodeSegment', () => {
  it('builds a compaction segment with verbatim messages and computed bounds', () => {
    const shuffled = [REGION[2], REGION[0], REGION[3], REGION[1]];
    const seg = encodeSegment({
      sessionId: 'session-abc_1',
      origin: ORIGIN_COMPACTION,
      compactionCount: 3,
      messages: shuffled,
      archivedAt: '2026-07-24T01:05:00.000Z',
    });
    expect(seg.format).toBe(ARCHIVE_SEGMENT_FORMAT);
    expect(seg.v).toBe(ARCHIVE_SEGMENT_VERSION);
    expect(seg.compactionCount).toBe(3);
    expect(seg.firstTimestamp).toBe('2026-07-24T01:00:00.000Z');
    expect(seg.lastTimestamp).toBe('2026-07-24T01:02:09.000Z');
    expect(seg.messages).toEqual(shuffled);
    expect(Object.isFrozen(seg)).toBe(true);
    expect(Object.isFrozen(seg.messages)).toBe(true);
  });

  it('builds a backfill segment with no compactionCount field', () => {
    const seg = encodeSegment({
      sessionId: 'bf-cael-1753290000000',
      origin: ORIGIN_BACKFILL,
      messages: REGION,
      archivedAt: '2026-07-24T01:05:00.000Z',
    });
    expect('compactionCount' in seg).toBe(false);
    expect(seg.origin).toBe(ORIGIN_BACKFILL);
  });

  it('yields null bounds when no message carries a parseable timestamp', () => {
    const seg = encodeSegment({
      sessionId: 's1',
      origin: ORIGIN_COMPACTION,
      compactionCount: 0,
      messages: [{ role: 'user', content: 'legacy' }],
      archivedAt: '2026-07-24T01:05:00.000Z',
    });
    expect(seg.firstTimestamp).toBeNull();
    expect(seg.lastTimestamp).toBeNull();
  });

  it('fails closed on per-origin violations and hostile inputs', () => {
    const base = { sessionId: 's1', messages: REGION, archivedAt: '2026-07-24T01:05:00.000Z' };
    expect(() => encodeSegment({ ...base, origin: ORIGIN_COMPACTION })).toThrow('compactionCount');
    expect(() =>
      encodeSegment({ ...base, origin: ORIGIN_BACKFILL, compactionCount: 0 })
    ).toThrow('must not carry');
    expect(() => encodeSegment({ ...base, origin: 'other', compactionCount: 0 })).toThrow('origin');
    expect(() =>
      encodeSegment({ ...base, sessionId: '../escape', origin: ORIGIN_COMPACTION, compactionCount: 0 })
    ).toThrow('sessionId');
    expect(() =>
      encodeSegment({ ...base, origin: ORIGIN_COMPACTION, compactionCount: 0, messages: [] })
    ).toThrow('messages');
    expect(() =>
      encodeSegment({ ...base, origin: ORIGIN_COMPACTION, compactionCount: 0, messages: ['x'] })
    ).toThrow('must be an object');
    expect(() =>
      encodeSegment({ ...base, origin: ORIGIN_COMPACTION, compactionCount: 0, archivedAt: 'not-a-time' })
    ).toThrow('archivedAt');
    expect(() =>
      encodeSegment({ ...base, origin: ORIGIN_COMPACTION, compactionCount: 0, archivedAt: 'January 1, 2026' })
    ).toThrow('archivedAt');
  });
});

describe('decodeSegment', () => {
  const compactionSeg = encodeSegment({
    sessionId: 'session-abc',
    origin: ORIGIN_COMPACTION,
    compactionCount: 2,
    messages: REGION,
    archivedAt: '2026-07-24T01:05:00.000Z',
  });

  it('accepts a valid payload and returns it', () => {
    const out = decodeSegment(JSON.parse(JSON.stringify(compactionSeg)), {
      expectedSessionId: 'session-abc',
      expectedOrdinal: 2,
    });
    expect(out.messages).toEqual(REGION);
  });

  it('treats a backfill payload as ordinal 0', () => {
    const seg = encodeSegment({
      sessionId: 'bf-cael-1753290000000',
      origin: ORIGIN_BACKFILL,
      messages: REGION,
      archivedAt: '2026-07-24T01:05:00.000Z',
    });
    expect(() => decodeSegment(seg, { expectedOrdinal: 0 })).not.toThrow();
    expect(() => decodeSegment(seg, { expectedOrdinal: 1 })).toThrow('ordinal');
  });

  it('fails closed on identity and shape violations', () => {
    expect(() => decodeSegment(null)).toThrow('payload');
    expect(() => decodeSegment({ ...compactionSeg, format: 'other' })).toThrow('format');
    expect(() => decodeSegment({ ...compactionSeg, v: 99 })).toThrow('version');
    expect(() => decodeSegment({ ...compactionSeg, archivedAt: 'not-a-time' })).toThrow('archivedAt');
    expect(() => decodeSegment({ ...compactionSeg, messages: [] })).toThrow('non-empty');
    expect(() => decodeSegment({ ...compactionSeg, messages: ['x'] })).toThrow('must be an object');
    expect(() => decodeSegment({ ...compactionSeg, firstTimestamp: 42 })).toThrow('bounds do not match');
    expect(() => decodeSegment({ ...compactionSeg, lastTimestamp: '2026-07-24T09:09:09.000Z' })).toThrow(
      'bounds do not match'
    );
    expect(() =>
      decodeSegment(compactionSeg, { expectedSessionId: 'session-other' })
    ).toThrow('does not match location');
    expect(() => decodeSegment(compactionSeg, { expectedOrdinal: 3 })).toThrow('ordinal');
    expect(() => decodeSegment({ ...compactionSeg, compactionCount: undefined })).toThrow('compactionCount');
    const bf = JSON.parse(
      JSON.stringify(
        encodeSegment({
          sessionId: 'bf-cael-1753290000000',
          origin: ORIGIN_BACKFILL,
          messages: REGION,
          archivedAt: '2026-07-24T01:05:00.000Z',
        })
      )
    );
    bf.compactionCount = 1;
    expect(() => decodeSegment(bf)).toThrow('must not carry');
  });
});

describe('makeAnchor', () => {
  const user = msg('user', 'the full untruncated thought '.repeat(30), '2026-07-24T01:00:00.000Z');
  const assistant = msg('assistant', 'the full untruncated reply '.repeat(40), '2026-07-24T01:00:07.000Z');

  it('mints content-time coordinates from the full texts', () => {
    const anchor = makeAnchor({ sessionId: 'session-abc', userMessage: user, assistantMessage: assistant });
    expect(anchor.v).toBe(ANCHOR_VERSION);
    expect(anchor.span.fromTs).toBe(user.timestamp);
    expect(anchor.span.toTs).toBe(assistant.timestamp);
    expect(anchor.span.userSha8).toBe(contentSha8(user.content));
    expect(anchor.span.assistantSha8).toBe(contentSha8(assistant.content));
    expect('compactionCount' in anchor).toBe(false);
    expect(Object.isFrozen(anchor)).toBe(true);
    expect(Object.isFrozen(anchor.span)).toBe(true);
  });

  it('carries compactionCount only when minted on the compaction path', () => {
    const anchor = makeAnchor({
      sessionId: 'session-abc',
      userMessage: user,
      assistantMessage: assistant,
      compactionCount: 4,
    });
    expect(anchor.compactionCount).toBe(4);
  });

  it('fails closed on missing pieces', () => {
    expect(() => makeAnchor({ sessionId: 'bad/../id', userMessage: user, assistantMessage: assistant })).toThrow(
      'sessionId'
    );
    expect(() =>
      makeAnchor({ sessionId: 's1', userMessage: { content: 'x' }, assistantMessage: assistant })
    ).toThrow('userMessage');
    expect(() =>
      makeAnchor({ sessionId: 's1', userMessage: user, assistantMessage: { timestamp: user.timestamp } })
    ).toThrow('assistantMessage');
    expect(() =>
      makeAnchor({ sessionId: 's1', userMessage: user, assistantMessage: assistant, compactionCount: -2 })
    ).toThrow('compactionCount');
  });
});

describe('regionCoverage — the crash-retry rule', () => {
  it('identical → skip', () => {
    expect(regionCoverage(REGION, [...REGION])).toBe('identical');
  });

  it('prefix → grow-only re-stage (the likely retry shape)', () => {
    const grown = [...REGION, msg('user', 'a later thought', '2026-07-24T01:03:00.000Z')];
    expect(regionCoverage(REGION, grown)).toBe('prefix');
  });

  it('divergent → fail closed (second-writer tripwire)', () => {
    const mutated = [
      { ...REGION[0], content: 'rewritten history' },
      ...REGION.slice(1),
    ];
    expect(regionCoverage(REGION, mutated)).toBe('divergent');
    expect(regionCoverage(REGION, REGION.slice(0, 2))).toBe('divergent');
    expect(regionCoverage([], REGION)).toBe('divergent');
    const roleFlip = [{ ...REGION[0], role: 'assistant' }, ...REGION.slice(1)];
    expect(regionCoverage(roleFlip, REGION)).toBe('divergent');
  });

  it('rejects non-array input', () => {
    expect(() => regionCoverage(null, REGION)).toThrow('regionCoverage');
  });
});

describe('spanCoversTs', () => {
  const header = { firstTimestamp: '2026-07-24T01:00:00.000Z', lastTimestamp: '2026-07-24T01:02:09.000Z' };

  it('covers moments inside and on the boundaries', () => {
    expect(spanCoversTs(header, '2026-07-24T01:01:00.000Z')).toBe(true);
    expect(spanCoversTs(header, header.firstTimestamp)).toBe(true);
    expect(spanCoversTs(header, header.lastTimestamp)).toBe(true);
  });

  it('rejects moments outside, null bounds, and garbage', () => {
    expect(spanCoversTs(header, '2026-07-24T00:59:59.999Z')).toBe(false);
    expect(spanCoversTs(header, '2026-07-24T01:02:09.001Z')).toBe(false);
    expect(spanCoversTs({ firstTimestamp: null, lastTimestamp: null }, header.firstTimestamp)).toBe(false);
    expect(spanCoversTs(null, header.firstTimestamp)).toBe(false);
    expect(spanCoversTs(header, 'not-a-time')).toBe(false);
    expect(spanCoversTs(header, 'January 1, 2026')).toBe(false);
  });
});
