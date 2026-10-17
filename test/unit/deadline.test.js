// deadline.js — pure proofs: normalization is strict, the state derivation
// is the ONE law every surface renders, and local time is the truth.

import { describe, it, expect } from 'vitest';
import {
  normalizeDueDate, normalizeDueTime, dueInstantOf, dueStateOf, dueLabel,
} from '../../core/tasks/deadline.js';

const attempt = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

// Explicit LOCAL components — the local-day law is pinned in any host TZ.
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

describe('deadline — normalization', () => {
  it('dueDate: strict real-day YYYY-MM-DD, undefined untouched, null clears', () => {
    expect(normalizeDueDate(' 2026-09-21 ')).toBe('2026-09-21');
    expect(normalizeDueDate(undefined)).toBeUndefined();
    expect(normalizeDueDate(null)).toBeNull();
    expect(attempt(() => normalizeDueDate('2026-02-30'))).toMatch(/real calendar day/); // rolled by Date.parse — refused
    expect(attempt(() => normalizeDueDate('next friday'))).toMatch(/real calendar day/);
    expect(attempt(() => normalizeDueDate('2026-9-1'))).toMatch(/real calendar day/);
  });

  it('dueTime: strict HH:MM, undefined untouched, null clears', () => {
    expect(normalizeDueTime(' 06:05 ')).toBe('06:05');
    expect(normalizeDueTime('23:59')).toBe('23:59');
    expect(normalizeDueTime(undefined)).toBeUndefined();
    expect(normalizeDueTime(null)).toBeNull();
    expect(attempt(() => normalizeDueTime('24:00'))).toMatch(/HH:MM/);
    expect(attempt(() => normalizeDueTime('6pm'))).toMatch(/HH:MM/);
    expect(attempt(() => normalizeDueTime('9:99'))).toMatch(/HH:MM/);
  });
});

describe('deadline — dueStateOf, the one derivation', () => {
  it('an explicit dueDate pins the day; 23:59 when no time is given', () => {
    const state = dueStateOf({ dueDate: '2026-09-21' }, at(2026, 9, 21, 12));
    expect(state.state).toBe('due');
    expect(dueInstantOf({ dueDate: '2026-09-21' }).getHours()).toBe(23);
    expect(dueStateOf({ dueDate: '2026-09-21' }, at(2026, 9, 21, 23, 59)).state).toBe('due');
    expect(dueStateOf({ dueDate: '2026-09-21' }, at(2026, 9, 22, 0, 1)).state).toBe('overdue');
  });

  it('a bare dueTime is due TODAY at that time — the recurring roll instance', () => {
    expect(dueStateOf({ dueTime: '18:00' }, at(2026, 9, 21, 17)).state).toBe('due');
    expect(dueStateOf({ dueTime: '18:00' }, at(2026, 9, 21, 19)).state).toBe('overdue');
    // Every day: the same bare time is due again tomorrow.
    expect(dueStateOf({ dueTime: '18:00' }, at(2026, 9, 22, 17)).state).toBe('due');
  });

  it('future dates are upcoming; no fields is no deadline', () => {
    expect(dueStateOf({ dueDate: '2026-10-01', dueTime: '09:00' }, at(2026, 9, 21)).state).toBe('upcoming');
    expect(dueStateOf({}, at(2026, 9, 21))).toBeNull();
  });
});

describe('deadline — dueLabel, the one fragment', () => {
  it('renders date+time, marks overdue in caps, says nothing without a deadline', () => {
    expect(dueLabel({ dueDate: '2026-10-01', dueTime: '09:00' }, at(2026, 9, 21)))
      .toBe(' — DUE 2026-10-01 09:00');
    expect(dueLabel({ dueDate: '2026-09-20', dueTime: '18:00' }, at(2026, 9, 21, 9)))
      .toBe(' — DUE 2026-09-20 18:00 — OVERDUE');
    expect(dueLabel({ dueTime: '18:00' }, at(2026, 9, 21, 19)))
      .toMatch(/ — DUE \d{4}-\d{2}-\d{2} 18:00 — OVERDUE/);
    expect(dueLabel({}, at(2026, 9, 21))).toBe('');
  });
});
