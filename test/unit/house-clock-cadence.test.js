/**
 * THE OPTIO'S CADENCE WINDOWS are counted from the operator's LOCAL midnight —
 * the same local time the quiet hours and the daily cap are judged in
 * (wake-gate.js). Proven under real time zones where the UTC day and the
 * local day differ: the process's own TZ is set, as an operator's machine
 * sets it, and restored after.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { cadenceSlot } from '../../backend/services/house-clock/wake-gate.js';
import { clockItems } from '../../backend/services/house-agenda/agenda-house.js';
import { agendaWindow } from '../../backend/services/house-agenda/agenda-time.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const savedTz = process.env.TZ;

// impure — run under one time zone, as the machine's own setting would
const inZone = (tz, fn) => {
  process.env.TZ = tz;
  return fn();
};

describe('the Optio\'s cadence windows', () => {
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  test('a daily review rolls over at local midnight, never at UTC midnight (Los Angeles, UTC-7)', () => {
    inZone('America/Los_Angeles', () => {
      const lateEvening = new Date(2026, 9, 19, 23, 30).getTime(); // 06:30 UTC on the 20th
      const justAfterMidnight = new Date(2026, 9, 20, 0, 30).getTime(); // 07:30 UTC on the 20th
      const afternoon = new Date(2026, 9, 20, 16, 30).getTime(); // 23:30 UTC on the 20th
      const evening = new Date(2026, 9, 20, 17, 30).getTime(); // 00:30 UTC on the 21st
      expect(new Date(lateEvening).toISOString().slice(0, 10)).toBe(new Date(justAfterMidnight).toISOString().slice(0, 10));
      // two local days, one UTC day: two windows
      expect(cadenceSlot(justAfterMidnight, DAY)).toBe(cadenceSlot(lateEvening, DAY) + 1);
      // one local day across UTC midnight: one window
      expect(cadenceSlot(evening, DAY)).toBe(cadenceSlot(justAfterMidnight, DAY));
      expect(cadenceSlot(afternoon, DAY)).toBe(cadenceSlot(evening, DAY));
    });
  });

  test('shorter windows start at local midnight too (Jakarta, UTC+N: 6-hour windows at 00, 06, 12, 18 local)', () => {
    inZone('Asia/Jakarta', () => {
      const at = (h, m = 0) => new Date(2026, 9, 20, h, m).getTime();
      expect(cadenceSlot(at(0, 0), 6 * HOUR)).toBe(cadenceSlot(at(5, 59), 6 * HOUR));
      expect(cadenceSlot(at(6, 0), 6 * HOUR)).toBe(cadenceSlot(at(5, 59), 6 * HOUR) + 1);
      // 07:00 local is UTC midnight: no window starts there
      expect(cadenceSlot(at(7, 0), 6 * HOUR)).toBe(cadenceSlot(at(6, 59), 6 * HOUR));
      expect(cadenceSlot(at(0, 0), 6 * HOUR)).toBe(cadenceSlot(at(23, 59) - DAY, 6 * HOUR) + 1);
    });
  });

  test('in UTC itself nothing moves: the window is the epoch count it always was', () => {
    inZone('UTC', () => {
      const now = Date.UTC(2026, 9, 20, 9, 15);
      expect(cadenceSlot(now, DAY)).toBe(Math.floor(now / DAY));
      expect(cadenceSlot(now, 6 * HOUR)).toBe(Math.floor(now / (6 * HOUR)));
    });
  });

  test('the calendar projects the review where it runs: at local midnight and noon on a 12-hour cadence (Jakarta)', () => {
    inZone('Asia/Jakarta', () => {
      const charter = { version: 1, approvedVersion: 1, approvedAt: '2026-10-01T00:00:00Z', cadence: { everyHours: 12 } };
      const wakes = clockItems(charter, 'optio', { win: agendaWindow('2026-10-20', '2026-10-21'), owned: new Set(['optio']) })
        .filter((i) => i.source === 'wake').map((i) => `${i.day} ${i.time}`);
      expect(wakes).toEqual(['2026-10-20 00:00', '2026-10-20 12:00', '2026-10-21 00:00', '2026-10-21 12:00']);
      // and each projected moment opens a window of its own
      const slots = ['2026-10-20T00:00', '2026-10-20T12:00'].map((t) => cadenceSlot(new Date(t).getTime(), 12 * HOUR));
      expect(slots[1]).toBe(slots[0] + 1);
    });
  });
});
