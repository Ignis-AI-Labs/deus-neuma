/**
 * The calendar wakes the house — the pure decision of which scheduled moments
 * wake whom (schedule-tick.js): a member's own timed task still owed, and a
 * charge reaching its due time while open; never the operator's own list, a
 * seat the charter does not hold, a settled item, a projected one, or a moment
 * gone stale; how far back a tick looks (to the clock's last look, capped);
 * and the wake's note for a moment woken for late ("was due at", never "now").
 */
import { describe, test, expect } from 'vitest';
import { dueScheduled, lookbackFor, SCHEDULE_LOOKBACK_MS, SCHEDULE_CATCHUP_MAX_MS } from '../../backend/services/house-clock/schedule-tick.js';
import { wakeThought } from '../../backend/services/house-clock/wake-thought.js';
import { normalizeCharter } from '../../backend/services/house-clock/charter-shape.js';
import { stampOf } from '../../backend/services/house-agenda/agenda-time.js';

const charter = normalizeCharter({
  goal: 'Ship one digest a week.',
  seats: [{ laneId: 'optio', dailyCap: 4 }, { laneId: 'mate', dailyCap: 4 }],
});
// a fixed local minute, and the agenda stamp of a moment some minutes before it
const now = new Date(2026, 9, 18, 17, 0, 30).getTime();
const at = (minutesAgo) => stampOf(now - minutesAgo * 60_000);
const task = (patch) => ({ id: 'task:mate:t1:x', source: 'task', lane: 'mate', title: 'Draft the digest', status: 'open', ...at(1), ...patch });
const charge = (patch) => ({ id: 'c1', to: 'mate', from: 'optio', title: 'Draft the digest', status: 'received', dueAt: new Date(now - 60_000).toISOString(), ...patch });
const wakes = (tasks, charges = []) => dueScheduled({ tasks, charges, charter, now });

describe('which scheduled moments wake a member', () => {
  test('a time block at its start, and a deadline at its time, wake the member whose task it is', () => {
    const [block] = wakes([task({ endTime: '18:00' })]);
    expect(block).toMatchObject({ seat: 'mate', reason: 'scheduled', detail: { title: 'Draft the digest', endTime: '18:00' } });
    expect(block.ref).toBe(`task:mate:t1:x@${at(1).time}`);
    expect(wakes([task({})])[0]).toMatchObject({ seat: 'mate', reason: 'scheduled', detail: { endTime: null } });
  });
  test('never a settled, untimed, projected, future or stale one', () => {
    expect(wakes([task({ status: 'done' }), task({ status: 'dropped' })])).toEqual([]);
    expect(wakes([task({ time: undefined })])).toEqual([]);
    expect(wakes([task({ projected: true })])).toEqual([]);
    expect(wakes([task(at(-2))])).toEqual([]);
    expect(wakes([task(at(SCHEDULE_LOOKBACK_MS / 60_000 + 1))])).toEqual([]);
  });
  test('never the operator\'s own list, nor a lane the charter does not seat', () => {
    expect(wakes([task({ lane: 'me' }), task({ lane: 'stranger' })])).toEqual([]);
  });
  test('a charge reaching its due time while open wakes its holder; a closed or far one does not', () => {
    expect(wakes([], [charge({})])).toEqual([{
      seat: 'mate', reason: 'charge-due', ref: `c1@${charge({}).dueAt}`,
      detail: { id: 'c1', title: 'Draft the digest', from: 'optio', dueAt: charge({}).dueAt },
    }]);
    expect(wakes([], [charge({ status: 'done' }), charge({ status: 'withdrawn' })])).toEqual([]);
    expect(wakes([], [charge({ dueAt: new Date(now + 60_000).toISOString() }), charge({ dueAt: undefined })])).toEqual([]);
    expect(wakes([], [charge({ to: 'stranger' })])).toEqual([]);
  });
});

describe('how far back a tick looks, and how a late moment is told', () => {
  const HOUR = 3_600_000;
  test('to the clock\'s last look; never less than the fresh window, never more than 12 hours', () => {
    expect(SCHEDULE_CATCHUP_MAX_MS).toBe(12 * HOUR);
    expect(lookbackFor(now, null)).toBe(SCHEDULE_LOOKBACK_MS);
    expect(lookbackFor(now, now - 60_000)).toBe(SCHEDULE_LOOKBACK_MS);
    expect(lookbackFor(now, now - 5 * HOUR)).toBe(5 * HOUR);
    expect(lookbackFor(now, now - 30 * HOUR)).toBe(12 * HOUR);
  });
  test('a moment missed while the clock was not running wakes, inside the catch-up', () => {
    const missed = (lookbackMs) => dueScheduled({ tasks: [task(at(5 * 60))], charges: [charge({ dueAt: new Date(now - 5 * HOUR).toISOString() })], charter, now, lookbackMs });
    expect(missed(SCHEDULE_LOOKBACK_MS)).toEqual([]);
    expect(missed(lookbackFor(now, now - 6 * HOUR)).map((w) => w.reason)).toEqual(['scheduled', 'charge-due']);
  });
  test('the note says "was due at" for a moment passed more than two minutes before the wake, "now" otherwise', () => {
    const note = (item, wokeAt) => wakeThought({ items: [item], charter, now: wokeAt });
    const [block] = dueScheduled({ tasks: [task({ ...at(90), endTime: '23:59' })], charges: [], charter, now, lookbackMs: 2 * HOUR });
    expect(note(block, now)).toContain(`Your time block "Draft the digest" on your calendar was due at ${at(90).time} (${at(90).time}–23:59)`);
    expect(note(block, now)).not.toContain('starts now');
    const [deadline] = dueScheduled({ tasks: [task(at(1))], charges: [], charter, now });
    expect(note(deadline, now)).toContain(`"Draft the digest" on your calendar is due now (${at(1).time})`);
    expect(note(deadline, now + 10 * 60_000)).toContain(`"Draft the digest" on your calendar was due at ${at(1).time} and is still open`);
    const [due] = dueScheduled({ tasks: [], charges: [charge({ dueAt: new Date(now - 3 * HOUR).toISOString() })], charter, now, lookbackMs: 4 * HOUR });
    expect(note(due, now)).toContain(`Your charge [c1] "Draft the digest" from optio was due at ${at(180).time} and is still open`);
    expect(note({ ...due, detail: { ...due.detail, dueAt: new Date(now - 60_000).toISOString() } }, now)).toContain('reached its due time and is still open');
    // a moment on an earlier day names its day
    const [yesterday] = dueScheduled({ tasks: [task(at(20 * 60))], charges: [], charter, now, lookbackMs: 21 * HOUR });
    expect(note(yesterday, now)).toContain(`was due at ${at(20 * 60).time} on ${at(20 * 60).day}`);
  });
});
