/**
 * Dailies — the all-dailies streak law, proven pure (RULE 0: real inputs,
 * real outputs, no mock anywhere). The scenarios reproduce Founder's 2026-08-28
 * ask: a day counts only when EVERY daily in force that day landed; the
 * streak is continuous; history from before dailies existed keeps the old
 * session law; editing today's board never retro-breaks yesterday.
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeDailyItems, resolveDailyCompletion, dayComplete,
  dailyStreakDays, dailiesTodayView, dailiesDigestLine, DAILIES_MAX,
  canRestOn, isRestDay, restDaysUsedInMonth,
  REST_DAYS_PER_MONTH, REST_DAYS_TRAINING_BETWEEN,
} from '../../core/vessel/dailies.js';
import { appendEntry, validateEntry } from '../../core/vessel/vitals.js';

const NOW = '2026-08-28T12:00:00Z';
const day = (offset, time = 'T10:00:00Z') => {
  const d = new Date(Date.parse('2026-08-28T00:00:00Z') + offset * 86400000);
  return d.toISOString().slice(0, 10) + time;
};
const setDef = (at, items) => ({ kind: 'dailies-set', items, occurredAt: at });
const done = (at, dailyId) => ({ kind: 'daily', dailyId, occurredAt: at });
const session = (at) => ({ kind: 'session', title: 'push day', occurredAt: at });

const A = { id: 'a', title: 'Pre-desk 15 min' };
const B = { id: 'b', title: 'Stretch' };

describe('the streak law — every daily, every day', () => {
  it('consecutive all-done days count; an unfinished today never breaks the run', () => {
    const entries = [
      setDef(day(-2), [A, B]),
      done(day(-2), 'a'), done(day(-2), 'b'),
      done(day(-1), 'a'), done(day(-1), 'b'),
    ];
    expect(dailyStreakDays(entries, NOW)).toBe(2);
  });

  it('one missing daily breaks that day, and the streak restarts after it', () => {
    const entries = [
      setDef(day(-2), [A, B]),
      done(day(-2), 'a'), done(day(-2), 'b'),
      done(day(-1), 'a'), // B never landed yesterday
      done(day(0), 'a'), done(day(0), 'b'),
    ];
    expect(dayComplete(entries, Math.floor(Date.parse(day(-1)) / 86400000))).toBe(false);
    expect(dailyStreakDays(entries, NOW)).toBe(1);
  });

  it('a fully-done today extends the run immediately — the auto-update is the fold', () => {
    const entries = [
      setDef(day(-1), [A]),
      done(day(-1), 'a'),
      done(day(0), 'a'),
    ];
    expect(dailyStreakDays(entries, NOW)).toBe(2);
  });

  it('days before any definition keep the session law — a standing streak survives setup', () => {
    const entries = [
      session(day(-3)), session(day(-2)),
      setDef(day(-1), [A]),
      done(day(-1), 'a'), done(day(0), 'a'),
    ];
    expect(dailyStreakDays(entries, NOW)).toBe(4);
  });

  it('each day is judged by the definition in force ON that day — adding a daily never retro-breaks', () => {
    const entries = [
      setDef(day(-2), [A]),
      done(day(-2), 'a'),
      setDef(day(-1), [A, B]),
      done(day(-1), 'a'), done(day(-1), 'b'),
      done(day(0), 'a'), // B still open today
    ];
    expect(dailyStreakDays(entries, NOW)).toBe(2);
  });
});

describe('the definition and the board', () => {
  it('normalize refuses more than the completable cap, blank titles, and duplicate ids', () => {
    const flood = Array.from({ length: DAILIES_MAX + 1 }, (_, i) => ({ id: `i${i}`, title: `t${i}` }));
    expect(() => normalizeDailyItems(flood)).toThrow(/at most/);
    expect(() => normalizeDailyItems([{ id: 'x', title: ' ' }])).toThrow(/title/);
    expect(() => normalizeDailyItems([A, { id: 'a', title: 'twin' }])).toThrow(/unique/);
    expect(normalizeDailyItems([])).toEqual([]);
  });

  it('the today view is null before setup, and counts the board honestly after', () => {
    expect(dailiesTodayView([session(day(0))], NOW)).toBeNull();
    const view = dailiesTodayView([setDef(day(-1), [A, B]), done(day(0), 'a')], NOW);
    expect(view.done).toBe(1);
    expect(view.total).toBe(2);
    expect(view.items.find((i) => i.id === 'b').done).toBe(false);
  });

  it('a completion resolves by id or by title, case-insensitive — the neuma\'s road', () => {
    const entries = [setDef(day(-1), [A, B])];
    expect(resolveDailyCompletion(entries, { title: 'stretch' })).toEqual({ dailyId: 'b', title: 'Stretch' });
    expect(resolveDailyCompletion(entries, { dailyId: 'a' })).toEqual({ dailyId: 'a', title: 'Pre-desk 15 min' });
    expect(() => resolveDailyCompletion(entries, { title: 'yoga' })).toThrow(/current dailies are/);
    expect(() => resolveDailyCompletion([], { title: 'stretch' })).toThrow(/no dailies/);
  });

  it('appendEntry admits a daily only against the log, stamped with the definition\'s own title', () => {
    const prior = [setDef(day(-1), [A])];
    const { entry } = appendEntry(prior, { kind: 'daily', title: 'pre-desk 15 min' }, { id: 'e1', now: NOW });
    expect(entry).toMatchObject({ kind: 'daily', dailyId: 'a', title: 'Pre-desk 15 min' });
    expect(() => appendEntry([], { kind: 'daily', title: 'anything' }, { id: 'e2', now: NOW }))
      .toThrow(/no dailies/);
  });

  it('a completion may carry the operator\'s proof line — stored when given, absent when blank', () => {
    const prior = [setDef(day(-1), [A])];
    const { entry } = appendEntry(prior,
      { kind: 'daily', dailyId: 'a', note: 'photo in camera roll, 07:12' }, { id: 'e1', now: NOW });
    expect(entry.note).toBe('photo in camera roll, 07:12');
    const { entry: bare } = appendEntry(prior, { kind: 'daily', dailyId: 'a', note: '   ' }, { id: 'e2', now: NOW });
    expect(bare).not.toHaveProperty('note');
  });

  // Design note, 2026-09-02, seven minutes past midnight: the day was DONE and never
  // marked, and an unmarked yesterday breaks the run outright. The fix road is
  // occurredAt — stamp the day it happened; recordedAt keeps the honest moment.
  it('a day done but never marked counts when stamped for THAT day — and the streak is whole again', () => {
    const entries = [setDef(day(-2), [A]), done(day(-2), 'a')];
    // Yesterday lived but unlogged: the run is broken — 0, not 1.
    expect(dailyStreakDays(entries, NOW)).toBe(0);
    const { entries: after, entry } = appendEntry(entries,
      { kind: 'daily', dailyId: 'a', occurredAt: day(-1) }, { id: 'fix', now: NOW });
    expect(dailyStreakDays(after, NOW)).toBe(2);
    expect(entry.occurredAt).toBe(day(-1));
    expect(entry.recordedAt).toBe(NOW);
  });
});

describe('the digest line — what the being reads', () => {
  it('absent before setup; names what is still open; carries the word-law', () => {
    expect(dailiesDigestLine([session(day(0))], NOW)).toBe('');
    const line = dailiesDigestLine([setDef(day(-1), [A, B]), done(day(-1), 'a'), done(day(-1), 'b'), done(day(0), 'a')], NOW);
    expect(line).toContain('1/2 today');
    expect(line).toContain('open: Stretch');
    expect(line).toContain('1-day streak');
    expect(line).toContain('at their word');
  });

  it('an all-done day says so plainly', () => {
    const line = dailiesDigestLine([setDef(day(-1), [A]), done(day(0), 'a')], NOW);
    expect(line).toContain('all done today');
  });
});

// ── Rest days (Design note, 2026-09-05: […]) ────
describe('rest days — recovery the streak honors', () => {
  const rest = (at) => ({ kind: 'rest-day', occurredAt: at });
  const dayK = (offset) => Math.floor(Date.parse(day(offset)) / 86400000);

  it('a claimed rest day completes the day by recovery, and the streak holds across it', () => {
    const entries = [
      setDef(day(-3), [A]),
      done(day(-3), 'a'),
      rest(day(-2)),
      done(day(-1), 'a'),
      done(day(0), 'a'),
    ];
    expect(isRestDay(entries, dayK(-2))).toBe(true);
    expect(dayComplete(entries, dayK(-2))).toBe(true);
    expect(dailyStreakDays(entries, NOW)).toBe(4);
  });

  it('the door refuses and explains: allowance, spacing, and double-claim', () => {
    const fourRests = [rest(day(-9)), rest(day(-6)), rest(day(-3)), rest(day(0))];
    // The month is spent — a fifth August claim refuses, naming the count.
    expect(canRestOn(fourRests, dayK(3))).toMatchObject({ ok: false, reason: /no rest days left this month/ });
    expect(restDaysUsedInMonth(fourRests, dayK(3))).toBe(REST_DAYS_PER_MONTH);
    // Spacing: rest yesterday, claim today — two training days must sit between.
    const restedYesterday = [rest(day(-1))];
    expect(canRestOn(restedYesterday, dayK(0))).toMatchObject({ ok: false, reason: /too close to another rest day/ });
    expect(canRestOn(restedYesterday, dayK(1))).toMatchObject({ ok: false, reason: /too close to another rest day/ });
    // Two full training days between: legal again.
    expect(canRestOn(restedYesterday, dayK(2))).toEqual({ ok: true });
    // …and the law is symmetric: a rest day already standing refuses a claim
    // beside it in the OTHER direction (claiming yesterday beside today).
    expect(canRestOn([rest(day(0))], dayK(-1))).toMatchObject({ ok: false, reason: /too close to another rest day/ });
    // A day already claimed refuses a second stamp.
    expect(canRestOn([rest(day(0))], dayK(0))).toMatchObject({ ok: false, reason: /already claimed/ });
  });

  it('the allowance resets at the local calendar month; the spacing law does not', () => {
    const fourRests = [rest(day(-9)), rest(day(-6)), rest(day(-3)), rest(day(0))];
    // day(6) = Sep 3 — a new month, allowance restored, spacing long satisfied.
    expect(canRestOn(fourRests, dayK(6))).toEqual({ ok: true });
  });

  it('the append door judges the claim against the log of the day it claims', () => {
    const prior = [rest(day(-1))];
    expect(() => appendEntry(prior, { kind: 'rest-day', occurredAt: day(0) }, { id: 'r1', now: NOW }))
      .toThrow(/training day/);
    const { entry } = appendEntry(prior, { kind: 'rest-day', occurredAt: day(2) }, { id: 'r2', now: NOW });
    expect(entry).toMatchObject({ kind: 'rest-day', occurredAt: day(2), recordedAt: NOW });
    // validateEntry alone cannot admit it — the law needs the log in hand.
    expect(() => validateEntry({ kind: 'rest-day' })).toThrow(/through appendEntry/);
  });

  it('the board and the digest say plainly that the body is resting', () => {
    const entries = [setDef(day(-1), [A]), rest(day(0))];
    const view = dailiesTodayView(entries, NOW);
    expect(view.resting).toBe(true);
    expect(view.restDaysLeft).toBe(REST_DAYS_PER_MONTH - 1);
    const line = dailiesDigestLine(entries, NOW);
    expect(line).toContain('rest day');
    expect(line).toContain('recovery is part of the practice');
    expect(line).toContain('left this month');
  });

  it('the spacing constants are the ones Founder named — four a month, two days between', () => {
    expect(REST_DAYS_PER_MONTH).toBe(4);
    expect(REST_DAYS_TRAINING_BETWEEN).toBe(2);
  });
});
