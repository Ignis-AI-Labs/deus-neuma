// Vitals work — structured sessions (exercises/sets), the planned kind, and
// the PR fold over session sets. Pure module under test: real entries in,
// real aggregates out, no mocks. Byte-parity pins prove old logs validate
// and render exactly as they did before the work fields existed.

import { describe, it, expect } from 'vitest';
import {
  validateEntry, appendEntry, prsByLift, formatVitalsSection, normalizeExercises,
} from '../../core/vessel/vitals.js';

const NOW = '2026-07-18T12:00:00.000Z';
const DAYS = 86400000;
const ago = (n) => new Date(Date.parse(NOW) - n * DAYS).toISOString();
const stamp = (n) => ({ id: `v-${n}`, now: NOW });
const attempt = (args) => {
  try { return validateEntry(args); } catch (e) { return e; }
};

describe('vitals work — session exercises', () => {
  it('normalizes lifts to lowercase and keeps weighted and unweighted sets', () => {
    const out = validateEntry({
      kind: 'session', title: 'Push day', durationMin: 60,
      exercises: [
        { lift: ' Bench Press ', sets: [{ reps: 8, weight: 80, unit: 'kg' }, { reps: 6, weight: 85, unit: 'kg' }] },
        { lift: 'Dip', sets: [{ reps: 12 }, { reps: '10' }] },
      ],
    });
    expect(out).toEqual({
      kind: 'session', title: 'Push day', durationMin: 60,
      exercises: [
        { lift: 'bench press', sets: [{ reps: 8, weight: 80, unit: 'kg' }, { reps: 6, weight: 85, unit: 'kg' }] },
        { lift: 'dip', sets: [{ reps: 12 }, { reps: 10 }] },
      ],
    });
  });

  it('an empty exercises array reads as absent and is never stored', () => {
    expect(validateEntry({ kind: 'session', title: 'x', exercises: [] }))
      .toEqual({ kind: 'session', title: 'x' });
    expect(validateEntry({ kind: 'planned', title: 'x', scheduledFor: '2026-08-01', exercises: [] }))
      .toEqual({ kind: 'planned', title: 'x', scheduledFor: '2026-08-01' });
  });

  it('refuses malformed exercises with tagged corrections', () => {
    const bad = (exercises) => attempt({ kind: 'session', title: 'x', exercises });
    expect(bad('not-array').message).toMatch(/exercises must be an array/);
    expect(bad(Array(21).fill({ lift: 'a', sets: [{ reps: 1 }] })).message).toMatch(/20 or fewer/);
    expect(bad([{ lift: 'squat', sets: [] }]).message).toMatch(/at least one set/);
    expect(bad([{ lift: 'squat', sets: Array(21).fill({ reps: 1 }) }]).message).toMatch(/20 sets or fewer/);
    expect(bad([{ lift: '  ', sets: [{ reps: 1 }] }]).message).toMatch(/lift name/);
    expect(bad([{ lift: 'x'.repeat(61), sets: [{ reps: 1 }] }]).message).toMatch(/under 60/);
    expect(bad([{ lift: 'squat', sets: [{ reps: 0 }] }]).message).toMatch(/between 1 and 1000/);
    expect(bad([{ lift: 'squat', sets: [{ reps: 5, weight: 0.1, unit: 'kg' }] }]).message).toMatch(/between 0.5 and 2000/);
    expect(bad([{ lift: 'squat', sets: [{ reps: 5, weight: 100, unit: 'stone' }] }]).message).toMatch(/kg or lb/);
    expect(bad([{ lift: 'squat', sets: [{ reps: 5, unit: 'kg' }] }]).message).toMatch(/unit needs the set's weight/);
    expect(bad([{ lift: 'squat', sets: [{ reps: 5, weight: 100 }] }]).message).toMatch(/needs its unit/);
    expect(bad([{ lift: 'squat', sets: [{ reps: 5, unit: 'kg' }] }]).correction).toBe(true);
  });

  it('a session carries planId when it completes a plan', () => {
    expect(validateEntry({ kind: 'session', title: 'Push day', planId: 'plan-123' }))
      .toEqual({ kind: 'session', title: 'Push day', planId: 'plan-123' });
    expect(validateEntry({ kind: 'session', title: 'x', planId: '  ' })).toEqual({ kind: 'session', title: 'x' });
    expect(attempt({ kind: 'session', title: 'x', planId: 'p'.repeat(65) }).message).toMatch(/under 64/);
  });
});

describe('vitals work — the planned kind', () => {
  it('normalizes title, a real scheduledFor date, exercises, and a note', () => {
    const out = validateEntry({
      kind: 'planned', title: ' Heavy pull ', scheduledFor: '2026-09-01',
      exercises: [{ lift: 'Deadlift', sets: [{ reps: 5, weight: 180, unit: 'kg' }] }],
      note: 'last heavy day before travel',
    });
    expect(out).toEqual({
      kind: 'planned', title: 'Heavy pull', scheduledFor: '2026-09-01',
      exercises: [{ lift: 'deadlift', sets: [{ reps: 5, weight: 180, unit: 'kg' }] }],
      note: 'last heavy day before travel',
    });
  });

  it('refuses bad dates, title overflow, and never stores a duration', () => {
    expect(attempt({ kind: 'planned', title: 'x', scheduledFor: 'Sept 1' }).message).toMatch(/YYYY-MM-DD/);
    // Month 13 and Feb 30 both roll in JS Date math — a plan needs a real day.
    expect(attempt({ kind: 'planned', title: 'x', scheduledFor: '2026-13-01' }).message).toMatch(/real calendar date/);
    expect(attempt({ kind: 'planned', title: 'x', scheduledFor: '2026-02-30' }).message).toMatch(/real calendar date/);
    expect(attempt({ kind: 'planned', title: 'x'.repeat(121), scheduledFor: '2026-09-01' }).message).toMatch(/under 120/);
    expect(attempt({ kind: 'planned', title: 'x', scheduledFor: '2026-09-01', note: 'n'.repeat(281) }).message).toMatch(/under 280/);
    expect(attempt({ kind: 'planned', title: 'x' }).message).toMatch(/YYYY-MM-DD/);
    const out = validateEntry({ kind: 'planned', title: 'x', scheduledFor: '2026-09-01', durationMin: 60 });
    expect(out).toEqual({ kind: 'planned', title: 'x', scheduledFor: '2026-09-01' });
    expect('durationMin' in out).toBe(false);
  });
});

describe('vitals work — the PR board folds session sets', () => {
  it('a session set that outlifts the declared PR is the record', () => {
    let entries = [];
    ({ entries } = appendEntry(entries, { kind: 'pr', lift: 'bench press', weight: 80, reps: 8, unit: 'kg', occurredAt: ago(10) }, stamp(1)));
    ({ entries } = appendEntry(entries, {
      kind: 'session', title: 'Push day', occurredAt: ago(2),
      exercises: [{ lift: 'Bench Press', sets: [{ reps: 5, weight: 90, unit: 'kg' }, { reps: 8, weight: 82.5, unit: 'kg' }] }],
    }, stamp(2)));
    const board = prsByLift(entries);
    expect(board).toHaveLength(1);
    expect(board[0]).toEqual({ lift: 'bench press', weight: 90, reps: 5, unit: 'kg', occurredAt: ago(2) });
  });

  it('the declared PR wins when it is heavier; ties break by reps then recency', () => {
    let entries = [];
    ({ entries } = appendEntry(entries, {
      kind: 'session', title: 'old', occurredAt: ago(20),
      exercises: [{ lift: 'squat', sets: [{ reps: 5, weight: 100, unit: 'kg' }] }],
    }, stamp(1)));
    ({ entries } = appendEntry(entries, { kind: 'pr', lift: 'squat', weight: 100, reps: 8, unit: 'kg', occurredAt: ago(15) }, stamp(2)));
    // same weight, more reps → the PR entry stands
    expect(prsByLift(entries)[0]).toMatchObject({ weight: 100, reps: 8, occurredAt: ago(15) });
    ({ entries } = appendEntry(entries, {
      kind: 'session', title: 'recent', occurredAt: ago(1),
      exercises: [{ lift: 'squat', sets: [{ reps: 8, weight: 100, unit: 'kg' }] }],
    }, stamp(3)));
    // same weight and reps → the most recent stands
    expect(prsByLift(entries)[0]).toMatchObject({ weight: 100, reps: 8, occurredAt: ago(1) });
    ({ entries } = appendEntry(entries, { kind: 'pr', lift: 'squat', weight: 105, reps: 1, unit: 'kg', occurredAt: ago(30) }, stamp(4)));
    // heavier always wins, even older and fewer reps
    expect(prsByLift(entries)[0]).toMatchObject({ weight: 105, reps: 1, occurredAt: ago(30) });
  });

  it('unweighted sets never stand on the board; kg and lb stay separate lines', () => {
    let entries = [];
    ({ entries } = appendEntry(entries, {
      kind: 'session', title: 'calisthenics', occurredAt: ago(1),
      exercises: [
        { lift: 'pull-up', sets: [{ reps: 12 }, { reps: 10 }] },
        { lift: 'dip', sets: [{ reps: 8, weight: 20, unit: 'kg' }] },
        { lift: 'bench press', sets: [{ reps: 5, weight: 185, unit: 'lb' }] },
      ],
    }, stamp(1)));
    const board = prsByLift(entries);
    expect(board.map((p) => p.lift).sort()).toEqual(['bench press', 'dip']);
    expect(board.find((p) => p.lift === 'dip')).toMatchObject({ weight: 20, reps: 8, unit: 'kg' });
    expect(board.find((p) => p.lift === 'bench press')).toMatchObject({ weight: 185, unit: 'lb' });
  });

  it('normalizeExercises is the same law validateEntry applies', () => {
    expect(normalizeExercises([{ lift: ' Row ', sets: [{ reps: 10, weight: 60, unit: 'kg' }] }]))
      .toEqual([{ lift: 'row', sets: [{ reps: 10, weight: 60, unit: 'kg' }] }]);
    expect(() => normalizeExercises([{ lift: 'row', sets: [{ reps: 10, unit: 'kg' }] }])).toThrow(/unit needs/);
  });
});

describe('vitals work — old logs validate and render byte-identical', () => {
  it('sessions and PRs without exercises keep their exact shapes', () => {
    expect(validateEntry({ kind: 'session', title: 'Push day', durationMin: 60, note: 'felt strong' }))
      .toEqual({ kind: 'session', title: 'Push day', durationMin: 60, note: 'felt strong' });
    expect(validateEntry({ kind: 'pr', lift: 'Squat', weight: 100, reps: 5, unit: 'kg' }))
      .toEqual({ kind: 'pr', lift: 'squat', weight: 100, reps: 5, unit: 'kg' });
  });

  it('sessions without exercises contribute nothing to the PR board', () => {
    let entries = [];
    ({ entries } = appendEntry(entries, { kind: 'session', title: 'old school', occurredAt: ago(1) }, stamp(1)));
    ({ entries } = appendEntry(entries, { kind: 'pr', lift: 'squat', weight: 100, reps: 5, unit: 'kg', occurredAt: ago(2) }, stamp(2)));
    expect(prsByLift(entries)).toEqual([
      { lift: 'squat', weight: 100, reps: 5, unit: 'kg', occurredAt: ago(2) },
    ]);
  });

  it('the digest over a pre-work log is pinned byte for byte', () => {
    let entries = [];
    ({ entries } = appendEntry(entries, { kind: 'session', title: 'Push day', occurredAt: ago(2) }, stamp(1)));
    ({ entries } = appendEntry(entries, { kind: 'pr', lift: 'bench press', weight: 80, reps: 8, unit: 'kg', occurredAt: ago(1) }, stamp(2)));
    expect(formatVitalsSection(entries, NOW)).toBe(
      "## Your Operator's Vessel\n"
      + "The record of their body's maintenance — measurements they logged or asked you to log, never estimates. You may ask after it and nudge gently when the record goes quiet; never shame, and never invent a number that is not here.\n"
      + '- Last training session: "Push day" (2 days ago) · 1 this week\n'
      + '- PRs on record: 1 lift(s) — latest: bench press 80 kg × 8',
    );
  });
});

describe('vitals work — the Planned digest line', () => {
  // scheduledFor is judged against TODAY on the operator-local calendar (the
  // local-day law), so the fixtures compute local YYYY-MM-DD dates off NOW —
  // the assertions hold in any host timezone.
  const localYmd = (offsetDays = 0) => {
    const d = new Date(Date.parse(NOW) + offsetDays * DAYS);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const withSession = (plannedArgs) => {
    let entries = [];
    ({ entries } = appendEntry(entries, { kind: 'session', title: 'Push day', occurredAt: ago(2) }, stamp(1)));
    if (plannedArgs) ({ entries } = appendEntry(entries, plannedArgs, stamp(2)));
    return formatVitalsSection(entries, NOW);
  };

  it('names what is ahead — title, when, and the first exercise × sets', () => {
    const section = withSession({
      kind: 'planned', title: 'Push day', scheduledFor: localYmd(1),
      exercises: [{ lift: 'Bench Press', sets: [{ reps: 5, weight: 80, unit: 'kg' }, { reps: 5 }, { reps: 5 }, { reps: 5 }, { reps: 5 }] }],
    });
    expect(section).toContain(`- Planned: "Push day" (tomorrow) · bench press 5×5`);
  });

  it('speaks today / tomorrow / in N days, and no exercises means no preview', () => {
    expect(withSession({ kind: 'planned', title: 'A', scheduledFor: localYmd() }))
      .toContain('- Planned: "A" (today)');
    expect(withSession({ kind: 'planned', title: 'B', scheduledFor: localYmd(3) }))
      .toContain('- Planned: "B" (in 3 days)');
    expect(withSession({ kind: 'planned', title: 'B', scheduledFor: localYmd(3) })).not.toContain('×');
  });

  it('a plan whose day has passed stays quiet, and the nearest upcoming plan wins', () => {
    expect(withSession({ kind: 'planned', title: 'Missed', scheduledFor: localYmd(-1) }))
      .not.toContain('Planned');
    let entries = [];
    ({ entries } = appendEntry(entries, { kind: 'session', title: 'S', occurredAt: ago(2) }, stamp(1)));
    ({ entries } = appendEntry(entries, { kind: 'planned', title: 'Later', scheduledFor: localYmd(5) }, stamp(2)));
    ({ entries } = appendEntry(entries, { kind: 'planned', title: 'Sooner', scheduledFor: localYmd(2) }, stamp(3)));
    const section = formatVitalsSection(entries, NOW);
    expect(section).toContain('- Planned: "Sooner" (in 2 days)');
    expect(section).not.toContain('Later');
  });

  it('is purely additive — with no upcoming plan the digest is byte-identical', () => {
    const without = withSession(null);
    const withPast = withSession({ kind: 'planned', title: 'Missed', scheduledFor: localYmd(-1) });
    expect(withPast).toBe(without);
    expect(without).not.toContain('Planned');
  });
});
