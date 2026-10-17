// Vitals — the human vessel's record. Pure module under test: real entries
// in, real aggregates out, no mocks.

import { describe, it, expect } from 'vitest';
import {
  validateEntry, appendEntry, prsByLift, bodyweightTrend, sessionsSummary,
  streakDays, markersToday, formatVitalsSection,
} from '../../core/vessel/vitals.js';

const NOW = '2026-07-18T12:00:00.000Z';
const DAYS = 86400000;
const ago = (n) => new Date(Date.parse(NOW) - n * DAYS).toISOString();
const stamp = (n) => ({ id: `v-${n}`, now: NOW });

describe('vitals — validation', () => {
  it('normalizes each kind; pr lifts fold to lowercase', () => {
    expect(validateEntry({ kind: 'pr', lift: ' Bench Press ', weight: 80, reps: 8, unit: 'kg' }))
      .toEqual({ kind: 'pr', lift: 'bench press', weight: 80, reps: 8, unit: 'kg' });
    expect(validateEntry({ kind: 'bodyweight', weight: '82.5', unit: 'lb' }))
      .toEqual({ kind: 'bodyweight', weight: 82.5, unit: 'lb' });
    expect(validateEntry({ kind: 'session', title: 'Push day', durationMin: '60' }))
      .toEqual({ kind: 'session', title: 'Push day', durationMin: 60 });
    expect(validateEntry({ kind: 'life', marker: 'sunlight' })).toEqual({ kind: 'life', marker: 'sunlight' });
  });

  it('refuses malformed entries with tagged corrections', () => {
    const attempt = (args) => {
      try { validateEntry(args); return null; } catch (e) { return e; }
    };
    let e = attempt({ kind: 'vibe' });
    expect(e.message).toMatch(/kind must be one of/);
    expect(e.correction).toBe(true);
    expect(attempt({ kind: 'pr', lift: '  ', weight: 80, unit: 'kg' }).message).toMatch(/lift name/);
    expect(attempt({ kind: 'pr', lift: 'squat', weight: 9000, unit: 'kg' }).message).toMatch(/between/);
    expect(attempt({ kind: 'pr', lift: 'squat', weight: 100, reps: 2.5, unit: 'kg' }).message).toMatch(/whole number/);
    expect(attempt({ kind: 'pr', lift: 'squat', weight: 100, unit: 'stone' }).message).toMatch(/kg or lb/);
    expect(attempt({ kind: 'bodyweight', weight: 2, unit: 'kg' }).message).toMatch(/between/);
    expect(attempt({ kind: 'session', title: '  ' }).message).toMatch(/session title/);
    expect(attempt({ kind: 'life', marker: 'vibes' }).message).toMatch(/marker must be one of/);
    expect(attempt({ kind: 'life', marker: 'sunlight', note: 'x'.repeat(281) }).message).toMatch(/under 280/);
  });

  it('appendEntry defaults occurredAt to now and stamps recordedAt', () => {
    const { entries, entry } = appendEntry([], { kind: 'session', title: 'Push day' }, stamp(1));
    expect(entry.occurredAt).toBe(NOW);
    expect(entry.recordedAt).toBe(NOW);
    expect(entries).toHaveLength(1);
    const back = appendEntry([], { kind: 'session', title: 'x', occurredAt: '2026-07-01' }, stamp(2));
    expect(back.entry.occurredAt).toBe('2026-07-01');
    expect(() => appendEntry([], { kind: 'session', title: 'x', occurredAt: 'not a date' }, stamp(3))).toThrow(/ISO date/);
  });
});

describe('vitals — aggregates', () => {
  it('the PR board keeps the heaviest per lift+unit, reps tiebreak, units separate', () => {
    let entries = [];
    ({ entries } = appendEntry(entries, { kind: 'pr', lift: 'bench press', weight: 70, reps: 10, unit: 'kg', occurredAt: ago(40) }, stamp(1)));
    ({ entries } = appendEntry(entries, { kind: 'pr', lift: 'bench press', weight: 80, reps: 8, unit: 'kg', occurredAt: ago(10) }, stamp(2)));
    ({ entries } = appendEntry(entries, { kind: 'pr', lift: 'bench press', weight: 75, reps: 12, unit: 'kg', occurredAt: ago(2) }, stamp(3)));
    ({ entries } = appendEntry(entries, { kind: 'pr', lift: 'bench press', weight: 185, reps: 5, unit: 'lb', occurredAt: ago(1) }, stamp(4)));
    ({ entries } = appendEntry(entries, { kind: 'pr', lift: 'squat', weight: 80, reps: 8, unit: 'kg', occurredAt: ago(1) }, stamp(5)));

    const board = prsByLift(entries);
    const kgBench = board.find((p) => p.lift === 'bench press' && p.unit === 'kg');
    expect(kgBench).toMatchObject({ weight: 80, reps: 8 });
    // kg and lb are separate lines, and the most recent records lead
    expect(board.filter((p) => p.lift === 'bench press')).toHaveLength(2);
    expect(board[0].occurredAt >= board[board.length - 1].occurredAt).toBe(true);
  });

  it('bodyweight trend: latest, delta against the nearest 30d-old reading, null cases', () => {
    expect(bodyweightTrend([], NOW)).toBeNull();
    let entries = [];
    ({ entries } = appendEntry(entries, { kind: 'bodyweight', weight: 83.1, unit: 'kg', occurredAt: ago(45) }, stamp(1)));
    ({ entries } = appendEntry(entries, { kind: 'bodyweight', weight: 82.5, unit: 'kg', occurredAt: ago(2) }, stamp(2)));
    const trend = bodyweightTrend(entries, NOW);
    expect(trend.latest.weight).toBe(82.5);
    expect(trend.delta30d).toBe(-0.6);
    expect(trend.series).toHaveLength(2);
    // A lone fresh reading has no 30d reference → no delta
    expect(bodyweightTrend(entries.slice(-1), NOW).delta30d).toBeNull();
  });

  it('sessions summary: totals, days since, this-week count', () => {
    expect(sessionsSummary([], NOW)).toEqual({ total: 0, lastAt: null, lastTitle: null, daysSince: null, perWeek: 0 });
    let entries = [];
    ({ entries } = appendEntry(entries, { kind: 'session', title: 'old', occurredAt: ago(20) }, stamp(1)));
    ({ entries } = appendEntry(entries, { kind: 'session', title: 'recent', occurredAt: ago(3) }, stamp(2)));
    ({ entries } = appendEntry(entries, { kind: 'session', title: 'yesterday', occurredAt: ago(1) }, stamp(3)));
    const s = sessionsSummary(entries, NOW);
    expect(s.total).toBe(3);
    expect(s.lastTitle).toBe('yesterday');
    expect(s.daysSince).toBe(1);
    expect(s.perWeek).toBe(2);
  });

  it('streak: consecutive session days, anchored at today or yesterday', () => {
    let entries = [];
    for (const [i, d] of [[1, 3], [2, 2], [3, 1]]) {
      ({ entries } = appendEntry(entries, { kind: 'session', title: `d${d}`, occurredAt: ago(d) }, stamp(i)));
    }
    expect(streakDays(entries, NOW)).toBe(3); // yesterday-anchored
    ({ entries } = appendEntry(entries, { kind: 'session', title: 'today', occurredAt: NOW }, stamp(4)));
    expect(streakDays(entries, NOW)).toBe(4); // today-anchored
    ({ entries } = appendEntry(entries, { kind: 'session', title: 'gap before', occurredAt: ago(10) }, stamp(5)));
    expect(streakDays(entries, NOW)).toBe(4); // the gap does not leak through
    expect(streakDays([], NOW)).toBe(0);
  });

  it('markers today dedup and never reach into yesterday', () => {
    let entries = [];
    ({ entries } = appendEntry(entries, { kind: 'life', marker: 'sunlight', occurredAt: NOW }, stamp(1)));
    ({ entries } = appendEntry(entries, { kind: 'life', marker: 'sunlight', occurredAt: NOW }, stamp(2)));
    ({ entries } = appendEntry(entries, { kind: 'life', marker: 'social', occurredAt: ago(1) }, stamp(3)));
    expect(markersToday(entries, NOW)).toEqual(['sunlight']);
  });
});

describe('vitals — the OPERATOR VESSEL prompt digest', () => {
  it('is empty with no entries and speaks the record when some exist', () => {
    expect(formatVitalsSection([], NOW)).toBe('');
    expect(formatVitalsSection(null, NOW)).toBe('');

    let entries = [];
    ({ entries } = appendEntry(entries, { kind: 'session', title: 'Push day', occurredAt: ago(2) }, stamp(1)));
    ({ entries } = appendEntry(entries, { kind: 'session', title: 'Pull day', occurredAt: ago(1) }, stamp(2)));
    ({ entries } = appendEntry(entries, { kind: 'bodyweight', weight: 82.5, unit: 'kg', occurredAt: ago(3) }, stamp(3)));
    ({ entries } = appendEntry(entries, { kind: 'pr', lift: 'bench press', weight: 80, reps: 8, unit: 'kg', occurredAt: ago(1) }, stamp(4)));
    ({ entries } = appendEntry(entries, { kind: 'life', marker: 'sunlight', occurredAt: NOW }, stamp(5)));

    const section = formatVitalsSection(entries, NOW);
    expect(section).toContain("## Your Operator's Vessel");
    expect(section).toContain('"Pull day" (yesterday)');
    expect(section).toContain('82.5 kg');
    expect(section).toContain('bench press 80 kg × 8');
    expect(section).toContain('sunlight');
    // The register is care, not judgment — pinned in the text itself.
    expect(section).toMatch(/never shame/);
    expect(section).toMatch(/never invent/);
  });
});
