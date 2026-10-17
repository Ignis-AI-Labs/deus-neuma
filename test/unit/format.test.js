// Unit tests for the shared display formatters (frontend/utils/format.js).
// One grammar per datum: address truncation, relative time, counts, bytes,
// short date, date+time. Real calls only — these are pure functions.

import { describe, it, expect } from 'vitest';
import {
  formatAddress, formatRelativeTime, formatCount,
  formatDateTime, formatShortDate, formatBytes, formatClockStamp,
} from '../../frontend/utils/format.js';

const ADDR = '0x41ea1234567890abcdef1234567890abcdefB0CD';

describe('formatAddress', () => {
  it('truncates with the single-… ellipsis by default', () => {
    expect(formatAddress(ADDR)).toBe('0x41ea…B0CD');
    expect(formatAddress(ADDR)).not.toContain('...');
  });

  it('returns a short address whole', () => {
    expect(formatAddress('0x1234')).toBe('0x1234');
  });

  it('empty address → fallback (default empty string)', () => {
    expect(formatAddress('')).toBe('');
    expect(formatAddress(null)).toBe('');
    expect(formatAddress(null, { fallback: '—' })).toBe('—');
  });

  it('start/end options widen the kept head and tail', () => {
    expect(formatAddress(ADDR, { start: 10, end: 8 })).toBe('0x41ea1234…cdefB0CD');
  });

  it('uppercase uppercases the address but never the prefix', () => {
    expect(formatAddress('0xabcdef1234567890abcdef1234567890abcd', { uppercase: true })).toBe('0XABCD…ABCD');
    expect(formatAddress('0xabcdef1234567890abcdef1234567890abcd', { uppercase: true, prefix: 'WITNESS ' }))
      .toBe('WITNESS 0XABCD…ABCD');
  });

  it('prefix labels the truncated address', () => {
    expect(formatAddress(ADDR, { prefix: 'OPERATOR ' })).toBe('OPERATOR 0x41ea…B0CD');
  });
});

describe('formatRelativeTime', () => {
  it('renders the m/h/d ladder with a lowercase "just now"', () => {
    expect(formatRelativeTime(Date.now() - 30 * 1000)).toBe('just now');
    expect(formatRelativeTime(Date.now() - 5 * 60 * 1000)).toBe('5m ago');
    expect(formatRelativeTime(Date.now() - 3 * 60 * 60 * 1000)).toBe('3h ago');
    expect(formatRelativeTime(Date.now() - 2 * 24 * 60 * 60 * 1000)).toBe('2d ago');
  });
});

describe('formatCount', () => {
  it('groups a number in the viewer locale', () => {
    expect(formatCount(42)).toBe('42');
    expect(formatCount(1234567)).toBe((1234567).toLocaleString());
  });

  it('non-number → em dash', () => {
    expect(formatCount(null)).toBe('—');
    expect(formatCount(undefined)).toBe('—');
    expect(formatCount('123')).toBe('—');
  });
});

describe('formatDateTime', () => {
  it('renders month, day, year and time in the canonical grammar', () => {
    const out = formatDateTime(new Date(2026, 6, 4, 15, 30));
    expect(out).toContain('Jul');
    expect(out).toContain('2026');
    expect(out).toMatch(/\d{2}:\d{2}/);
  });

  it('empty input → "Unknown"; unparseable input → the raw string', () => {
    expect(formatDateTime('')).toBe('Unknown');
    expect(formatDateTime(null)).toBe('Unknown');
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });
});

describe('formatShortDate', () => {
  it('empty input → em dash', () => {
    expect(formatShortDate('')).toBe('—');
    expect(formatShortDate(null)).toBe('—');
  });
});

describe('locale follows the active UI language (frontend/i18n/active-locale.js)', () => {
  // The leaf is the seam the engine writes and the formatters read — set it
  // for real and watch a formatter answer in another language, then restore.
  it('formatDateTime renders Japanese grammar when the desk speaks ja', async () => {
    const { setActiveLocale, currentLocale } = await import('../../frontend/i18n/active-locale.js');
    const before = currentLocale();
    try {
      setActiveLocale('ja');
      const out = formatDateTime(new Date(2026, 6, 4, 15, 30));
      expect(out).toContain('2026');
      expect(out).toContain('7月');
      expect(out).not.toContain('Jul');
    } finally {
      setActiveLocale(before);
    }
    expect(formatDateTime(new Date(2026, 6, 4, 15, 30))).toContain('Jul');
  });
});

describe('formatBytes', () => {
  it('renders bytes and scaled units', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
    expect(formatBytes(512)).toBe('512 Bytes');
    expect(formatBytes(6246)).toBe('6.1 KB');
  });
});

describe('formatClockStamp — the stream message stamp', () => {
  // "now" is injected so the today/other-day judgment is deterministic.
  const NOW = new Date(2026, 6, 23, 9, 0); // Jul 23 2026, 9:00 AM

  it("today's message → the time alone", () => {
    expect(formatClockStamp(new Date(2026, 6, 23, 14, 32), NOW)).toBe('2:32 PM');
  });

  it("another day's message → date joined on, no year within the year", () => {
    expect(formatClockStamp(new Date(2026, 6, 20, 21, 7), NOW)).toBe('Jul 20 · 9:07 PM');
  });

  it("another year's message → the year joins the date", () => {
    expect(formatClockStamp(new Date(2025, 6, 23, 9, 0), NOW)).toBe('Jul 23, 2025 · 9:00 AM');
  });

  it('same clock-day boundary is calendar, not 24h distance', () => {
    // 11:59 PM yesterday is minutes away but still another day.
    expect(formatClockStamp(new Date(2026, 6, 22, 23, 59), NOW)).toBe('Jul 22 · 11:59 PM');
  });

  it('accepts ISO strings and epoch millis (the shapes the records carry)', () => {
    const d = new Date(2026, 6, 23, 8, 15);
    expect(formatClockStamp(d.toISOString(), NOW)).toBe('8:15 AM');
    expect(formatClockStamp(d.getTime(), NOW)).toBe('8:15 AM');
  });

  it('missing or unparseable input → empty string, never "Invalid Date"', () => {
    expect(formatClockStamp(null, NOW)).toBe('');
    expect(formatClockStamp(undefined, NOW)).toBe('');
    expect(formatClockStamp('', NOW)).toBe('');
    expect(formatClockStamp('not-a-date', NOW)).toBe('');
  });
});
