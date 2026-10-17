/**
 * THE OPERATOR'S ZONE — pinned (2026-09-25). A zone the desk names is
 * validated before any clock renders in it; offsets are computed per-instant
 * (DST-honest) and speak the UTC±hh:mm wording PRESENT MOMENT has always
 * carried.
 *
 * Pure functions, real inputs, no mock anywhere (RULE 0).
 */
import { describe, expect, it } from 'vitest';
import { isValidTimeZone, zoneOffsetMinutes, zoneOffsetLabel } from '../../core/runtime/time-zone.js';

describe('isValidTimeZone — the boundary guard', () => {
  it('accepts real IANA zones', () => {
    expect(isValidTimeZone('Asia/Jakarta')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });

  it('refuses garbage, non-strings, and emptiness — fail closed', () => {
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('../../etc/passwd')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
    expect(isValidTimeZone(420)).toBe(false);
  });
});

describe('zoneOffsetMinutes — the offset is a property of the instant', () => {
  it('reads a fixed offset', () => {
    expect(zoneOffsetMinutes('Asia/Jakarta', new Date('2026-09-25T05:00:00Z'))).toBe(420);
  });

  it('honors DST — New York summer vs winter', () => {
    expect(zoneOffsetMinutes('America/New_York', new Date('2026-07-04T12:00:00Z'))).toBe(-240);
    expect(zoneOffsetMinutes('America/New_York', new Date('2026-01-04T12:00:00Z'))).toBe(-300);
  });

  it('reads local midnight honestly (the hour-24 edge)', () => {
    // 17:00Z is 00:00 the next day in Jakarta — some runtimes name it hour 24.
    expect(zoneOffsetMinutes('Asia/Jakarta', new Date('2026-09-24T17:00:00Z'))).toBe(420);
  });
});

describe('zoneOffsetLabel — the PRESENT MOMENT wording', () => {
  it('speaks UTC±hh:mm', () => {
    expect(zoneOffsetLabel('Asia/Jakarta', new Date('2026-09-25T05:00:00Z'))).toBe('UTC+07:00');
    expect(zoneOffsetLabel('America/New_York', new Date('2026-07-04T12:00:00Z'))).toBe('UTC-04:00');
    expect(zoneOffsetLabel('UTC', new Date('2026-07-04T12:00:00Z'))).toBe('UTC+00:00');
  });
});
