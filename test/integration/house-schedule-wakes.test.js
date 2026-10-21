/**
 * THE CALENDAR WAKES THE HOUSE, FOR REAL (RULE 0: a real house — real wake
 * turns on synthetic connections, the real task ledger and dispatch drawer on
 * disk, the real queue and ledger; the model a loopback OpenAI-wire server).
 * Design note, 2026-10-17: once the calendar works, attach the scheduling to it.
 *
 * Under proof:
 *  - a member's own timed task, still open, wakes that member at its moment,
 *    the note naming it; a second look wakes nothing (one moment, one wake);
 *  - a charge reaching its due time while open wakes its holder, the note
 *    naming the charge;
 *  - the operator's own timed task wakes no one;
 *  - a moment coming due while the charter is paused is held, and wakes its
 *    member on RESUME;
 *  - a moment missed while the clock was not running (the app closed, the
 *    machine asleep) wakes its member on the next tick, the note saying it
 *    "was due at" — back to the clock's last look, never past 12 hours.
 */
import { randomUUID } from 'crypto';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createWakeHouse, userText, until, WALLET, OPTIO, HOUSEMATE } from '../helpers/house-wake-kit.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { addTask } from '../../core/tasks/task-ledger.js';
import { scheduleTick } from '../../backend/services/house-clock/schedule-tick.js';
import { whenHouseIdle, readWakeQueue, pumpHouse, stampTick, readLastTick } from '../../backend/services/house-clock/wake-queue.js';
import { setCharterPaused } from '../../backend/services/house-clock/charter-store.js';
import { readWakeLedger } from '../../backend/services/house-clock/wake-ledger.js';
import { stampOf } from '../../backend/services/house-agenda/agenda-time.js';
import { fileDispatch, makeCharge } from '../../backend/services/staff/dispatch-store.js';
import { addUserTask } from '../../backend/services/user-tasks.js';

// impure — one task on a lane's own ledger, through the ledger's real add
const ledgerTask = (lane, fields) => neumaWorkspace.updateTaskLedger(lane, (ledger) => addTask(
  ledger || { tasks: [] }, fields, { id: randomUUID(), now: new Date().toISOString(), mintId: () => randomUUID() },
).ledger);

describe('the calendar wakes the member a scheduled moment belongs to', () => {
  let house;
  beforeEach(async () => { house = await createWakeHouse(); });
  afterEach(async () => { await house.teardown(); });

  test('a member\'s own timed task wakes it once, at its moment', async () => {
    await house.serve([{ reply: 'Taking up the digest now.' }]);
    await house.charter();
    const now = Date.now();
    const { day, time } = stampOf(now - 60_000);
    await ledgerTask(HOUSEMATE, { title: 'Draft the digest', dueDate: day, dueTime: time });
    const [taken] = await scheduleTick(WALLET, now);
    expect(taken).toMatchObject({ queued: true, item: { seat: HOUSEMATE, reason: 'scheduled' } });
    const [row] = await house.ledgerRows(1);
    expect(row).toMatchObject({ seat: HOUSEMATE, outcome: 'done' });
    expect(userText(house.provider.turns[0])).toContain(`"Draft the digest" on your calendar is due now (${time})`);

    expect(await scheduleTick(WALLET, now + 5000)).toEqual([expect.objectContaining({ queued: false })]);
    await whenHouseIdle(WALLET);
    expect((await readWakeLedger(WALLET, { limit: 10 })).rows).toHaveLength(1);
  }, 60000);

  test('a charge reaching its due time while open wakes its holder', async () => {
    await house.serve([{ reply: 'Taking the charge.' }, { reply: 'Finishing the charge.' }]);
    await house.charter();
    const now = Date.now();
    const charge = await fileDispatch(OPTIO, makeCharge({
      from: OPTIO, to: HOUSEMATE, by: WALLET, title: 'Draft the digest', body: 'Done looks like: digest.md filed.',
      dueAt: new Date(now - 60_000).toISOString(), filedAt: new Date(now - 3_600_000).toISOString(),
    }));
    const [taken] = await scheduleTick(WALLET, now);
    expect(taken).toMatchObject({ queued: true, item: { seat: HOUSEMATE, reason: 'charge-due' } });
    const row = await until(async () => (await readWakeLedger(WALLET, { limit: 10 })).rows
      .find((r) => r.items.some((i) => i.reason === 'charge-due')) ?? null);
    expect(row).toMatchObject({ seat: HOUSEMATE });
    const note = house.provider.turns.map(userText).find((t) => t.includes('reached its due time'));
    expect(note).toContain(`Your charge [${charge.id}] "Draft the digest"`);
  }, 60000);

  test('the operator\'s own timed task wakes no one', async () => {
    await house.serve([]);
    await house.charter();
    const now = Date.now();
    const { day, time } = stampOf(now - 60_000);
    await addUserTask(WALLET, { title: 'Chest + core', cadence: 'once', dueDate: day, dueTime: time });
    expect(await scheduleTick(WALLET, now)).toEqual([]);
    expect((await readWakeQueue(WALLET)).items).toEqual([]);
  }, 60000);

  test('a moment coming due while the charter is paused is held, and wakes its member on RESUME', async () => {
    await house.serve([{ reply: 'Taking up the digest after the pause.' }]);
    await house.charter();
    await setCharterPaused(WALLET, true);
    const now = Date.now();
    const { day, time } = stampOf(now - 60_000);
    await ledgerTask(HOUSEMATE, { title: 'Draft the digest', dueDate: day, dueTime: time });
    const [taken] = await scheduleTick(WALLET, now);
    expect(taken).toMatchObject({ queued: true, item: { seat: HOUSEMATE, reason: 'scheduled' } });
    expect((await readWakeQueue(WALLET)).held).toEqual([{ seat: HOUSEMATE, why: 'the charter is paused' }]);
    expect(house.provider.turns).toHaveLength(0);
    await setCharterPaused(WALLET, false);
    // the queue moves (the clock's next tick, or the enqueue's own pump still pending)
    await pumpHouse(WALLET);
    const [row] = await house.ledgerRows(1);
    expect(row).toMatchObject({ seat: HOUSEMATE, reason: 'scheduled', outcome: 'done' });
  }, 60000);

  test('a moment missed while the clock was not running wakes on the next tick, "was due at"; never past 12 hours', async () => {
    await house.serve([{ reply: 'Taking up the block I missed.' }]);
    await house.charter();
    const HOUR = 3_600_000;
    const now = Date.now();
    const missed = stampOf(now - 3 * HOUR);
    const stale = stampOf(now - 13 * HOUR);
    await ledgerTask(HOUSEMATE, { title: 'Missed block', dueDate: missed.day, dueTime: missed.time });
    await ledgerTask(HOUSEMATE, { title: 'Stale block', dueDate: stale.day, dueTime: stale.time });
    // the clock last looked 20 hours ago — the app was closed since
    await stampTick(WALLET, now - 20 * HOUR);
    const taken = await scheduleTick(WALLET, now);
    expect(taken.map((t) => t.item?.detail?.title)).toEqual(['Missed block']);
    expect(await readLastTick(WALLET)).toBe(now);
    const [row] = await house.ledgerRows(1);
    expect(row).toMatchObject({ seat: HOUSEMATE, reason: 'scheduled', outcome: 'done' });
    const note = userText(house.provider.turns[0]);
    expect(note).toContain(`"Missed block" on your calendar was due at ${missed.time}`);
    expect(note).not.toContain('is due now');
    // the next tick looks back only to this one: nothing wakes twice
    expect(await scheduleTick(WALLET, now + 60_000)).toEqual([]);
  }, 60000);
});
