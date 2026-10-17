/**
 * Local-day streak law — the vessel day boundary is the OPERATOR's calendar
 * day, not UTC's (core/vessel/day-key.js; server-local = operator-local is
 * the design basis — the backend runs on the operator's machine, UTC+N).
 * Pure proofs, RULE 0: real timestamps in, real keys/aggregates out, no mock
 * anywhere. Local times are built with local Date constructors so the law
 * proofs hold in any host timezone; the two "what UTC did" assertions are
 * pinned to the operator's local offset explicitly.
 */
import { describe, expect, it } from 'vitest';
import { localDayKey } from '../../core/vessel/day-key.js';
import { dayComplete, dailiesInForce, dailyStreakDays } from '../../core/vessel/dailies.js';

const DAY_MS = 86400000;
/** The OLD law — UTC epoch days — kept here only to document what broke. */
const utcDayKey = (iso) => Math.floor(Date.parse(iso) / DAY_MS);

/** A timestamp from explicit LOCAL components (host-timezone agnostic). */
const at = (y, m, d, h = 12, min = 0) => new Date(y, m, d, h, min).toISOString();

const A = { id: 'a', title: 'Pre-desk 15 min' };
const B = { id: 'b', title: 'Stretch' };
const setDef = (iso, items) => ({ kind: 'dailies-set', items, occurredAt: iso });
const done = (iso, dailyId) => ({ kind: 'daily', dailyId, occurredAt: iso });

describe('localDayKey — the contract', () => {
  it('two timestamps on the same local day share a key — even when UTC splits them', () => {
    const early = at(2026, 7, 31, 6, 30); // 06:30 local
    const late = at(2026, 7, 31, 23, 30); // 23:30 local, same local day
    expect(localDayKey(early)).toBe(localDayKey(late));
    // What the old law did with the morning log, on the operator's local:
    expect(utcDayKey('2026-08-31T06:30:00+07:00')).toBe(utcDayKey('2026-08-31T23:30:00+07:00') - 1);
    expect(localDayKey('2026-08-31T06:30:00+07:00')).toBe(localDayKey('2026-08-31T23:30:00+07:00'));
  });

  it('adjacent local days differ by exactly 1 — month, year, and leap-day boundaries', () => {
    expect(localDayKey(at(2026, 8, 1, 0, 1))).toBe(localDayKey(at(2026, 7, 31, 23, 59)) + 1);
    expect(localDayKey(at(2027, 0, 1, 0, 1))).toBe(localDayKey(at(2026, 11, 31, 23, 59)) + 1);
    const feb28 = localDayKey(at(2028, 1, 28));
    expect(localDayKey(at(2028, 1, 29))).toBe(feb28 + 1); // 2028 is a leap year
    expect(localDayKey(at(2028, 2, 1))).toBe(feb28 + 2);
  });

  it('accepts epoch ms like an ISO string, and nulls garbage (the dayKey contract)', () => {
    const iso = at(2026, 7, 31, 6, 30);
    expect(localDayKey(Date.parse(iso))).toBe(localDayKey(iso));
    expect(localDayKey('not a date')).toBeNull();
  });
});

describe('the streak law on local days — the case UTC broke', () => {
  it('a completion at 06:30 local today counts for TODAY, and the run continues', () => {
    const NOW = at(2026, 7, 31, 8, 0); // today, 08:00 local
    const entries = [
      setDef(at(2026, 7, 30, 9, 0), [A]),
      done(at(2026, 7, 30, 21, 0), 'a'), // yesterday local, done
      done(at(2026, 7, 31, 6, 30), 'a'), // today local, 06:30 — the morning log
    ];
    expect(dailyStreakDays(entries, NOW)).toBe(2);
    // Under the old UTC law (host UTC+N) that morning log was filed to
    // YESTERDAY: today's day looked unfinished and the anchor slipped back.
    expect(utcDayKey(at(2026, 7, 31, 6, 30))).toBe(utcDayKey(NOW) - 1);
  });

  it('dailiesInForce turns at local midnight — a 00:30 snapshot rules today, not yesterday', () => {
    const entries = [
      setDef(at(2026, 7, 30, 23, 30), [A]),
      setDef(at(2026, 7, 31, 0, 30), [A, B]), // 00:30 local today
    ];
    expect(dailiesInForce(entries, localDayKey(at(2026, 7, 31, 12)))).toEqual([A, B]);
    expect(dailiesInForce(entries, localDayKey(at(2026, 7, 30, 12)))).toEqual([A]);
  });

  it('dayComplete judges each local day by its own completions', () => {
    const entries = [
      setDef(at(2026, 7, 30, 9, 0), [A]),
      done(at(2026, 7, 31, 6, 30), 'a'),
    ];
    expect(dayComplete(entries, localDayKey(at(2026, 7, 31, 12)))).toBe(true);
    expect(dayComplete(entries, localDayKey(at(2026, 7, 30, 12)))).toBe(false);
  });
});
