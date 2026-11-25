import { describe, test, expect } from 'vitest';
import { normalizeRule, dueTime, crossing, momentOf, ruleWords } from '../../backend/services/house-clock/wake-rules.js';

const NOW = new Date(2026, 10, 15, 10, 0).getTime(); // Sun 2026-11-15 10:00 local

describe('a wake rule as the member writes it', () => {
  test('time: once, daily on chosen days, every N minutes', () => {
    expect(normalizeRule({ kind: 'time', at: '2026-11-15T18:30', label: 'evening book', note: 'read lp_book' }, { now: NOW })).toEqual({ kind: 'time', at: new Date(2026, 10, 15, 18, 30).toISOString(), label: 'evening book', note: 'read lp_book' });
    expect(normalizeRule({ kind: 'time', daily: '08:00', days: ['mon', 'Fri'] }, { now: NOW })).toMatchObject({ daily: '08:00', days: ['mon', 'fri'] });
    expect(normalizeRule({ kind: 'time', daily: '08:00' }, { now: NOW }).days).toHaveLength(7);
    expect(normalizeRule({ kind: 'time', everyMinutes: 30 }, { now: NOW })).toMatchObject({ everyMinutes: 30 });
  });

  test('events and posts', () => {
    expect(normalizeRule({ kind: 'price', token: 'VIRTUAL', below: 0.45 }, { now: NOW })).toMatchObject({ kind: 'price', token: 'VIRTUAL', below: 0.45 });
    expect(normalizeRule({ kind: 'lp-value', above: 600 }, { now: NOW })).toMatchObject({ above: 600 });
    expect(normalizeRule({ kind: 'new-pools' }, { now: NOW })).toMatchObject({ network: 'base', minLiquidityUsd: 25000 });
    expect(normalizeRule({ kind: 'posts', from: ['staff-fixture-optio'] }, { now: NOW })).toMatchObject({ from: ['staff-fixture-optio'] });
    expect(normalizeRule({ kind: 'posts' }, { now: NOW })).toMatchObject({ from: 'anyone' });
  });

  test('what is refused, with a reason the member can act on', () => {
    const bad = (raw) => { try { normalizeRule(raw, { now: NOW }); return null; } catch (e) { return e.message; } };
    expect(bad({ kind: 'time', at: '2026-11-15T09:00' })).toMatch(/already past/);
    expect(bad({ kind: 'time', daily: '25:00' })).toMatch(/"HH:MM"/);
    expect(bad({ kind: 'time', everyMinutes: 5 })).toMatch(/from 15/);
    expect(bad({ kind: 'time', daily: '08:00', everyMinutes: 30 })).toMatch(/names one of/);
    expect(bad({ kind: 'price', token: 'VIRTUAL', above: 1, below: 0.5 })).toMatch(/one level/);
    expect(bad({ kind: 'new-pools', minLiquidityUsd: 50 })).toMatch(/at least 1000/);
    expect(bad({ kind: 'posts', from: ['Not A Lane!'] })).toMatch(/"anyone", "nobody"/);
    expect(bad({ kind: 'moon' })).toMatch(/kind is one of/);
  });

  test('a moment in local time or with its zone', () => {
    expect(momentOf('2026-11-15T18:30')).toBe(new Date(2026, 10, 15, 18, 30).getTime());
    expect(momentOf('2026-11-15T11:30:00Z')).toBe(Date.parse('2026-11-15T11:30:00Z'));
    expect(momentOf('tomorrow')).toBeNull();
  });
});

describe('when a rule fires', () => {
  test('time: inside the window since the last look, once per occurrence', () => {
    const at = { kind: 'time', at: new Date(2026, 10, 15, 10, 0).toISOString() };
    expect(dueTime(at, NOW - 60_000, NOW)).toBe(`at-${NOW}`);
    expect(dueTime(at, NOW, NOW + 60_000)).toBeNull();
    const daily = { kind: 'time', daily: '10:00', days: ['sun'] };
    expect(dueTime(daily, NOW - 60_000, NOW)).toBe('daily-2026-11-15');
    expect(dueTime({ ...daily, days: ['mon'] }, NOW - 60_000, NOW)).toBeNull();
    // a window reaching back across midnight still finds yesterday's moment
    expect(dueTime({ kind: 'time', daily: '23:30', days: ['sat'] }, new Date(2026, 10, 14, 23, 0).getTime(), new Date(2026, 10, 15, 0, 5).getTime())).toBe('daily-2026-11-14');
    const every = { kind: 'time', everyMinutes: 30 };
    const slot = dueTime(every, NOW - 60_000, NOW);
    expect(slot).toMatch(/^every-30m-\d+$/);
    expect(dueTime(every, NOW, NOW + 60_000)).toBeNull();
  });

  test('a level fires when the value crosses into it, not every look while it stays there', () => {
    const r = { kind: 'price', below: 0.45 };
    expect(crossing(r, 0.5)).toEqual({ fire: false, inside: false });
    expect(crossing({ ...r, inside: false }, 0.44)).toEqual({ fire: true, inside: true });
    expect(crossing({ ...r, inside: true }, 0.43)).toEqual({ fire: false, inside: true });
    expect(crossing({ kind: 'lp-value', above: 600 }, 601)).toEqual({ fire: true, inside: true });
  });

  test('a rule in a few words', () => {
    expect(ruleWords({ id: 'w-1', kind: 'price', token: 'VIRTUAL', below: 0.45, label: 'dip', note: 'add to #156' })).toBe('w-1 "dip" VIRTUAL price below $0.45 · note: add to #156');
    expect(ruleWords({ id: 'w-2', kind: 'posts', from: 'nobody' })).toBe('w-2 house posts wake me from: nobody');
  });
});
