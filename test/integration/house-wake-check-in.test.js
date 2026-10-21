/**
 * A CHECK-IN WAKES THE OPTIO ONLY WHEN IT IS NOTABLE (RULE 0) — the real watch,
 * the real house post, the clock's own signal sink and the real wake queue on a
 * temp house with an Optio seated and chartered.
 *
 * Ruled 2026-10-19: […] A run working along quietly used to spend
 * one of her daily wakes every check-in.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createStaffOfficeFixture, WALLET, OPTIO, HOUSEMATE } from '../helpers/staff-office-fixture.js';
import { writeCharter, approveCharter } from '../../backend/services/house-clock/charter-store.js';
import { setWakeSink } from '../../backend/services/house-clock/wake-signal.js';
import { setWakeRunner, configureWakeQueue, readWakeQueue, whenHouseIdle } from '../../backend/services/house-clock/wake-queue.js';
import { takeSignal } from '../../backend/services/house-clock/house-clock.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import { startWatch } from '../../backend/services/team-watch.js';

const until = async (check, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('a team check-in wakes the Optio only when it is notable', () => {
  let office;

  beforeEach(async () => {
    office = await createStaffOfficeFixture();
    configureWakeQueue({ settleMs: 0 });
    setWakeSink(takeSignal);
    setWakeRunner(null);
    const c = await writeCharter(WALLET, {
      goal: 'Prove a quiet check-in spends no wake.',
      seats: [{ laneId: OPTIO, dailyCap: 5 }, { laneId: HOUSEMATE, dailyCap: 5 }],
    }, { by: WALLET, ownedLanes: [OPTIO, HOUSEMATE] });
    await approveCharter(WALLET, { version: c.version, by: WALLET });
  });
  afterEach(async () => {
    await whenHouseIdle(WALLET);
    setWakeSink(null);
    configureWakeQueue({ settleMs: 3000, retryMs: 60_000 });
    await office.teardown();
  });

  const checkInPosts = async () => {
    const raw = await fs.readFile(path.join(office.ground, 'post', OPTIO, 'inbox.jsonl'), 'utf8').catch(() => '');
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((p) => p.re === 'Team run run-eye: check-in');
  };
  const optioItems = async () => (await readWakeQueue(WALLET)).items.filter((i) => i.seat === OPTIO);
  // a notable check-in's work: its post and the check-in itself, one wake's work
  const optioWakes = async () => (await optioItems()).filter((i) => i.reason === 'run-check-in');
  // n more check-ins land in her inbox, then the queue has had time to take any signal
  const moreCheckIns = async (n) => {
    const had = (await checkInPosts()).length;
    await until(async () => (await checkInPosts()).length >= had + n);
    await new Promise((r) => setTimeout(r, 100));
  };

  test('a quiet check-in posts and raises its card but queues no wake; a finished part, a question and a blocker each queue one', async () => {
    const entry = {
      id: 'run-eye', name: 'EYE', lead: 'Quae', startedAt: new Date().toISOString(), checkIn: 0.002, channel: [],
      board: [{ id: 'p', member: 'Cosi', state: 'working' }, { id: 'q', member: 'Quae', state: 'working' }],
    };
    startWatch(entry, { wallet: WALLET, lead: { neumaId: HOUSEMATE, name: 'Quae' } });
    try {
      // quiet: every part moving — in her inbox and on the tray, and no wake
      await moreCheckIns(2);
      const [quiet] = await checkInPosts();
      expect(quiet).toMatchObject({ from: HOUSEMATE, to: OPTIO });
      expect(quiet.body).toMatch(/^CHECK-IN — EYE — 0m in: 2 working/);
      const cards = (await readNotifications(WALLET)).records.filter((r) => r.kind === 'run_check_in' && r.ref?.runId === 'run-eye');
      expect(cards.length).toBeGreaterThanOrEqual(2);
      expect(cards[0].detail).toBe('every working part is moving');
      expect(await optioItems()).toEqual([]);

      // a finished part: one wake, and only the check-in after it
      entry.board = [{ id: 'p', member: 'Cosi', state: 'working' }, { id: 'q', member: 'Quae', state: 'done' }];
      await until(async () => (await optioWakes()).length === 1);
      const [finished] = await optioWakes();
      expect(finished).toMatchObject({ reason: 'run-check-in', detail: { from: HOUSEMATE, re: 'Team run run-eye: check-in' } });
      await moreCheckIns(2);
      expect(await optioWakes()).toHaveLength(1);
      expect((await checkInPosts()).some((p) => p.body.includes('Needs eyes: Quae finished q.'))).toBe(true);

      // a member's question on the team channel: one wake
      entry.channel = [{ n: 1, at: new Date().toISOString(), fromStep: 'p', from: 'Cosi', toStep: null, to: 'everyone', text: 'Which brand voice do we write in?' }];
      await until(async () => (await optioWakes()).length === 2);
      expect((await checkInPosts()).some((p) => p.body.includes('Cosi asks: Which brand voice do we write in?'))).toBe(true);

      await moreCheckIns(2);
      expect(await optioWakes()).toHaveLength(2);

      // a blocker: a part that failed
      entry.board = [{ id: 'p', member: 'Cosi', state: 'failed' }, { id: 'q', member: 'Quae', state: 'done' }];
      await until(async () => (await optioWakes()).length >= 3);
    } finally {
      entry.stopWatch();
    }
  }, 20000);
});
