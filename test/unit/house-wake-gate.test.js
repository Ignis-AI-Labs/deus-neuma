/**
 * The wake gate (house-clock/wake-gate.js) — pure: whether a signal becomes a
 * queued wake, and whether a queued wake may run now. Real inputs, real
 * outputs; local times are built in local time, as the gate reads them.
 */
import { describe, test, expect } from 'vitest';
import {
  inQuietHours, takeGate, runGate, wakeKey, localDay, WAKE_CHAIN_MAX,
} from '../../backend/services/house-clock/wake-gate.js';

const at = (h, m = 0) => new Date(2026, 9, 16, h, m).getTime();
const charter = (patch = {}) => ({
  version: 1, approvedAt: '2026-10-16T00:00:00.000Z', approvedVersion: 1, paused: false,
  seats: [{ laneId: 'optio', dailyCap: 2 }],
  quietHours: null,
  ...patch,
});

describe('quiet hours', () => {
  test('a window inside one day: its start is quiet, its end is not', () => {
    const q = { start: '13:00', end: '15:00' };
    expect(inQuietHours(q, at(12, 59))).toBe(false);
    expect(inQuietHours(q, at(13, 0))).toBe(true);
    expect(inQuietHours(q, at(14, 30))).toBe(true);
    expect(inQuietHours(q, at(15, 0))).toBe(false);
  });
  test('a window across midnight', () => {
    const q = { start: '22:00', end: '07:00' };
    expect(inQuietHours(q, at(23, 30))).toBe(true);
    expect(inQuietHours(q, at(3))).toBe(true);
    expect(inQuietHours(q, at(7))).toBe(false);
    expect(inQuietHours(q, at(12))).toBe(false);
  });
  test('no window, never quiet', () => expect(inQuietHours(null, at(3))).toBe(false));
});

describe('taking a signal', () => {
  test('no charter: never taken', () => {
    expect(takeGate({ charter: null, seat: 'optio' })).toEqual({ ok: false, why: 'the charter is none' });
  });
  test('an unapproved or paused charter takes it, to hold until APPROVE / RESUME', () => {
    const pending = charter({ approvedVersion: null, approvedAt: null });
    expect(takeGate({ charter: pending, seat: 'optio' })).toEqual({ ok: true });
    expect(takeGate({ charter: charter({ paused: true }), seat: 'optio' })).toEqual({ ok: true });
    expect(runGate({ charter: pending, seat: 'optio', now: at(12), count: 0 }).why).toBe('the charter is unapproved');
    // the pending version's seats decide, as an active one's do
    expect(takeGate({ charter: pending, seat: 'stranger' }).why).toMatch(/not a seat/);
  });
  test('a seat the charter does not name is never taken', () => {
    expect(takeGate({ charter: charter(), seat: 'stranger' }).why).toMatch(/not a seat/);
  });
  test('a chain of wakes past its limit is refused', () => {
    expect(takeGate({ charter: charter(), seat: 'optio', depth: WAKE_CHAIN_MAX }).ok).toBe(true);
    expect(takeGate({ charter: charter(), seat: 'optio', depth: WAKE_CHAIN_MAX + 1 }).why).toMatch(/chain/);
  });
  test('an active charter naming the seat takes it', () => expect(takeGate({ charter: charter(), seat: 'optio' })).toEqual({ ok: true }));
});

describe('running a queued wake', () => {
  test('held while paused, in quiet hours, or past the seat\'s daily cap', () => {
    expect(runGate({ charter: charter({ paused: true }), seat: 'optio', now: at(12), count: 0 }).why).toMatch(/paused/);
    expect(runGate({ charter: charter({ quietHours: { start: '11:00', end: '13:00' } }), seat: 'optio', now: at(12), count: 0 }).why).toMatch(/quiet hours/);
    expect(runGate({ charter: charter(), seat: 'optio', now: at(12), count: 2 }).why).toMatch(/spent its 2 wakes/);
  });
  test('otherwise it runs', () => expect(runGate({ charter: charter(), seat: 'optio', now: at(12), count: 1 })).toEqual({ ok: true }));
});

test('the same work has one key; a day is the local day', () => {
  expect(wakeKey({ seat: 's', reason: 'post', ref: 'p1' })).toBe('s|post|p1');
  expect(localDay(at(0, 5))).toBe('2026-10-16');
});
