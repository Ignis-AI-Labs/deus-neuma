// vessel-view — VESSEL's presentation decisions, proven with real inputs and
// outputs. Pure throughout: no mocks, no stubs. The through-line is the data
// law: a missing measurement degrades to null/'' (rendered —), never a
// fabricated zero or a fabricated trend.
import { describe, it, expect } from 'vitest';
import {
  trendGlyph, daysAgoLabel, fmtDelta, kindLabel, entryLine, benchmarkDue, markerPresent,
} from '../../frontend/app/RelinkShell/vessel-view.js';

describe('trendGlyph', () => {
  it('reads movement up, down, and level', () => {
    expect(trendGlyph(0.8, 0.7)).toBe('↑');
    expect(trendGlyph(0.7, 0.8)).toBe('↓');
    expect(trendGlyph(0.7, 0.7)).toBe('=');
  });

  it('is null when either end is missing — a one-ended trend is not a trend', () => {
    expect(trendGlyph(null, 0.7)).toBeNull();
    expect(trendGlyph(0.7, undefined)).toBeNull();
    expect(trendGlyph('x', 1)).toBeNull();
    expect(trendGlyph(null, null)).toBeNull();
  });
});

describe('daysAgoLabel', () => {
  // A fixed local afternoon — local-anchored inputs keep the read TZ-safe.
  const NOW = new Date(2026, 6, 18, 15).getTime();

  it('names today, yesterday, and a plain count of days', () => {
    expect(daysAgoLabel('2026-07-18T09:00:00', NOW)).toBe('today');
    expect(daysAgoLabel('2026-07-17T23:00:00', NOW)).toBe('yesterday');
    expect(daysAgoLabel('2026-07-10T12:00:00', NOW)).toBe('8 DAYS AGO');
  });

  it('floors a future timestamp at today', () => {
    expect(daysAgoLabel('2026-07-20T12:00:00', NOW)).toBe('today');
  });

  it('returns an empty string for garbage', () => {
    expect(daysAgoLabel('not-a-date', NOW)).toBe('');
    expect(daysAgoLabel(undefined, NOW)).toBe('');
    expect(daysAgoLabel('2026-07-18', NaN)).toBe('');
  });
});

describe('fmtDelta', () => {
  it('signs one decimal, minus as U+2212', () => {
    expect(fmtDelta(0.6)).toBe('+0.6');
    expect(fmtDelta(-0.6)).toBe('−0.6');
    expect(fmtDelta(-2.25)).toBe('−2.3');
    expect(fmtDelta(0)).toBe('+0.0');
  });

  it('is empty for a missing delta', () => {
    expect(fmtDelta(null)).toBe('');
    expect(fmtDelta(undefined)).toBe('');
    expect(fmtDelta(NaN)).toBe('');
  });
});

describe('kindLabel', () => {
  it('maps the four entry kinds to their tags', () => {
    expect(kindLabel('pr')).toBe('PR');
    expect(kindLabel('bodyweight')).toBe('BODYWEIGHT');
    expect(kindLabel('session')).toBe('SESSION');
    expect(kindLabel('life')).toBe('MARKER');
  });

  it('prints an unrecognized kind as itself, uppercased', () => {
    expect(kindLabel('vo2max')).toBe('VO2MAX');
    expect(kindLabel(undefined)).toBe('—');
  });
});

describe('entryLine', () => {
  it('pr: lift, weight with unit, reps after ×', () => {
    expect(entryLine({ kind: 'pr', lift: 'bench press', weight: 80, unit: 'kg', reps: 8 }))
      .toBe('bench press 80 kg × 8');
    expect(entryLine({ kind: 'pr', lift: 'deadlift', weight: 140, unit: 'kg' }))
      .toBe('deadlift 140 kg');
  });

  it('bodyweight: weight with unit', () => {
    expect(entryLine({ kind: 'bodyweight', weight: 82.5, unit: 'kg' })).toBe('82.5 kg');
    expect(entryLine({ kind: 'bodyweight', unit: 'kg' })).toBe('—');
  });

  it('session: title, duration when measured', () => {
    expect(entryLine({ kind: 'session', title: 'Push day', durationMin: 60 })).toBe('Push day · 60 min');
    expect(entryLine({ kind: 'session', title: 'Push day' })).toBe('Push day');
  });

  it('life: the marker, note after an em-dash when present', () => {
    expect(entryLine({ kind: 'life', marker: 'sunlight' })).toBe('sunlight');
    expect(entryLine({ kind: 'life', marker: 'social', note: 'climbing with M' })).toBe('social — climbing with M');
  });

  it('an unrecognized kind is an empty line', () => {
    expect(entryLine({ kind: 'vo2max', value: 52 })).toBe('');
    expect(entryLine(undefined)).toBe('');
  });
});

describe('benchmarkDue', () => {
  const NOW = Date.parse('2026-07-18T00:00:00.000Z');

  it('never measured is always due', () => {
    expect(benchmarkDue(null, NOW)).toBe(true);
    expect(benchmarkDue('garbage', NOW)).toBe(true);
  });

  it('measures the gap against the due window', () => {
    expect(benchmarkDue('2026-07-08T00:00:00.000Z', NOW)).toBe(false); // 10 days
    expect(benchmarkDue('2026-06-17T00:00:00.000Z', NOW)).toBe(true); // 31 days
    expect(benchmarkDue('2026-07-08T00:00:00.000Z', NOW, 7)).toBe(true); // tighter window
  });

  it('a broken clock raises no false alarm', () => {
    expect(benchmarkDue('2020-01-01T00:00:00.000Z', NaN)).toBe(false);
  });
});

describe('markerPresent', () => {
  it('answers membership honestly', () => {
    expect(markerPresent(['sunlight'], 'sunlight')).toBe(true);
    expect(markerPresent(['sunlight'], 'social')).toBe(false);
  });

  it('a missing list is an honest no', () => {
    expect(markerPresent(undefined, 'sunlight')).toBe(false);
    expect(markerPresent(null, 'sunlight')).toBe(false);
    expect(markerPresent('sunlight', 'sunlight')).toBe(false);
  });
});
