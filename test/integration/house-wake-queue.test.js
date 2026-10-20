/**
 * THE WAKE QUEUE AND ITS TRIGGERS (RULE 0) — the real queue on a real temp
 * realm, the real charter store, the real producers raising their real
 * signals: a house post through appendPost, a charge through fileDispatch, a
 * team run's end through the real background run, the run's watch posting to
 * the seated Optio, the Optio's cadence, and a run LOST to a restart found at
 * boot. A real recorder function stands where the wake turn sits (the way
 * chat-watch.test.js stands a deliverer), so what the queue hands the turn is
 * exactly what is checked.
 */
import { spawn, spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createStaffOfficeFixture, WALLET, OPTIO, HOUSEMATE, BYSTANDER } from '../helpers/staff-office-fixture.js';
import { writeCharter, approveCharter, setCharterPaused } from '../../backend/services/house-clock/charter-store.js';
import { setWakeSink } from '../../backend/services/house-clock/wake-signal.js';
import {
  setWakeRunner, configureWakeQueue, pumpHouse, readWakeQueue, whenHouseIdle, enqueueWake,
} from '../../backend/services/house-clock/wake-queue.js';
import { readWakeLedger, clockDir, readAsks } from '../../backend/services/house-clock/wake-ledger.js';
import { localDay, cadenceSlot } from '../../backend/services/house-clock/wake-gate.js';
import { takeSignal, cadenceTick, lostRunsTick } from '../../backend/services/house-clock/house-clock.js';
import { makePost, appendPost } from '../../backend/services/house-post.js';
import { makeCharge, fileDispatch } from '../../backend/services/staff/dispatch-store.js';
import { startWatch } from '../../backend/services/team-watch.js';
import { startTeamRun } from '../../backend/services/team-run-start.js';
import { createRun, updateRun } from '../../backend/services/team-run-store.js';
import { wakePlanRoute } from '../../backend/services/house-clock/wake-plan.js';
import neumaWorkspace, { getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import { KIND } from '../../core/runtime/notification-record.js';

const until = async (check, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

const chartered = async (patch = {}) => {
  const c = await writeCharter(WALLET, {
    goal: 'Prove the house wakes for its own work.',
    seats: [{ laneId: OPTIO, dailyCap: 5 }, { laneId: HOUSEMATE, dailyCap: 5 }],
    ...patch,
  }, { by: WALLET, ownedLanes: [OPTIO, HOUSEMATE, BYSTANDER] });
  return approveCharter(WALLET, { version: c.version, by: WALLET });
};

describe('the house wakes for its own work — queue and triggers', () => {
  let office, ran;

  beforeEach(async () => {
    office = await createStaffOfficeFixture();
    ran = [];
    configureWakeQueue({ settleMs: 0 });
    setWakeSink(takeSignal); // exactly as startHouseClock wires it
    setWakeRunner(async (wake) => { ran.push(wake); return { outcome: 'done', sessionId: `sitting-${ran.length}` }; });
  });
  afterEach(async () => {
    await whenHouseIdle(WALLET);
    setWakeSink(null);
    setWakeRunner(null);
    configureWakeQueue({ settleMs: 3000, retryMs: 60_000 });
    await office.teardown();
  });

  const post = (to, body, from = OPTIO) => appendPost(office.ground, makePost({ from, to, body, now: new Date().toISOString() }));

  test('no charter: a post wakes nobody; an unapproved or paused one holds it in view, and it runs on APPROVE / RESUME', async () => {
    await post(HOUSEMATE, 'Before any charter.');
    await new Promise((r) => setTimeout(r, 100));
    expect((await readWakeQueue(WALLET)).items).toEqual([]);
    const c = await writeCharter(WALLET, { goal: 'Pending.', seats: [{ laneId: HOUSEMATE, dailyCap: 2 }] }, { by: WALLET, ownedLanes: [HOUSEMATE] });
    const pending = await post(HOUSEMATE, 'Charter written, not approved.');
    const held = async (why) => until(async () => {
      const q = await readWakeQueue(WALLET);
      return q.held.some((h) => h.seat === HOUSEMATE && h.why === why) ? q : null;
    });
    let q = await held('the charter is unapproved');
    expect(q.items.map((i) => i.ref)).toEqual([pending.id]);
    await new Promise((r) => setTimeout(r, 50));
    expect(ran).toEqual([]);
    await approveCharter(WALLET, { version: c.version, by: WALLET });
    await pumpHouse(WALLET);
    await whenHouseIdle(WALLET);
    expect(ran.map((w) => w.items.map((i) => i.ref))).toEqual([[pending.id]]);
    await setCharterPaused(WALLET, true);
    const paused = await post(HOUSEMATE, 'Charter paused.');
    q = await held('the charter is paused');
    expect(q.items.map((i) => i.ref)).toEqual([paused.id]);
    await new Promise((r) => setTimeout(r, 50));
    expect(ran).toHaveLength(1);
    await setCharterPaused(WALLET, false);
    await pumpHouse(WALLET);
    await whenHouseIdle(WALLET);
    expect(ran.map((w) => w.items.map((i) => i.ref))).toEqual([[pending.id], [paused.id]]);
    // the post sent before any charter was never taken: it waits in the inbox for the seat's next turn
    expect((await readWakeLedger(WALLET)).total).toBe(2);
  });

  test('a post to a chartered seat wakes it; a charge and its post are ONE wake; the row lands on the ledger', async () => {
    await chartered();
    // the settle the clock keeps in production: work that lands together is taken together
    configureWakeQueue({ settleMs: 300 });
    // the Optio's dispatch act lands the delivery post, then the charge (intents/staff-acts.js)
    const delivery = await post(HOUSEMATE, 'Charge: draft the digest.');
    await fileDispatch(OPTIO, makeCharge({
      from: OPTIO, to: HOUSEMATE, title: 'Draft the digest', body: 'Done looks like: a draft in the house repo.',
      filedAt: new Date().toISOString(), by: WALLET,
    }));
    const { rows } = await until(async () => { const l = await readWakeLedger(WALLET); return l.total ? l : null; });
    expect(ran).toHaveLength(1);
    expect(ran[0].seat).toBe(HOUSEMATE);
    expect(ran[0].items.map((i) => i.reason)).toEqual(['post', 'dispatch']);
    expect(rows[0]).toMatchObject({
      seat: HOUSEMATE, reason: 'post', ref: delivery.id, outcome: 'done', sessionId: 'sitting-1',
    });
    expect(rows[0].items.map((i) => i.reason)).toEqual(['post', 'dispatch']);
    expect(rows[0].startedAt <= rows[0].endedAt).toBe(true);
    // finished work never queues again
    expect((await enqueueWake(WALLET, { seat: HOUSEMATE, reason: 'post', ref: delivery.id })).queued).toBe(false);
    expect((await readWakeQueue(WALLET)).items).toEqual([]);
  });

  test('the same work queues once; the queue is the disk\'s, so a restart keeps it', async () => {
    await chartered();
    setWakeRunner(null); // nothing runs: the work waits
    const signal = { seat: HOUSEMATE, reason: 'post', ref: 'post-1' };
    expect((await enqueueWake(WALLET, signal)).queued).toBe(true);
    expect((await enqueueWake(WALLET, signal)).queued).toBe(false);
    const onDisk = JSON.parse(await fs.readFile(path.join(clockDir(WALLET), 'queue.json'), 'utf8'));
    expect(onDisk.items.map((i) => i.ref)).toEqual(['post-1']);
    const view = await readWakeQueue(WALLET);
    expect(view.items).toHaveLength(1);
    expect(view.held).toEqual([]);
    expect(await pumpHouse(WALLET)).toEqual({ started: [], held: [{ seat: HOUSEMATE, why: 'the house clock is not running' }] });
  });

  test('held by quiet hours and a spent cap, released when they pass; paused after queueing holds too', async () => {
    const now = new Date(); now.setHours(12, 0, 0, 0);
    await chartered({ seats: [{ laneId: HOUSEMATE, dailyCap: 1 }], quietHours: { start: '11:00', end: '13:00' } });
    setWakeRunner(null);
    await enqueueWake(WALLET, { seat: HOUSEMATE, reason: 'post', ref: 'q-1' });
    // the enqueue's own pump (at the real clock, with no runner) passes first
    await new Promise((r) => setTimeout(r, 100));
    setWakeRunner(async (wake) => { ran.push(wake); return { outcome: 'done' }; });
    expect((await pumpHouse(WALLET, now.getTime())).held[0].why).toMatch(/quiet hours/);
    const later = now.getTime() + 90 * 60_000;
    expect((await pumpHouse(WALLET, later)).started).toHaveLength(1);
    await whenHouseIdle(WALLET);
    await enqueueWake(WALLET, { seat: HOUSEMATE, reason: 'post', ref: 'q-2' });
    expect((await pumpHouse(WALLET, later)).held[0].why).toMatch(/spent its 1 wakes/);
    await setCharterPaused(WALLET, true);
    expect((await pumpHouse(WALLET, later + 86_400_000)).held[0].why).toMatch(/paused/);
    expect(ran).toHaveLength(1);
  });

  test('one wake at a time per seat: work landing mid-wake waits, then runs as the next wake', async () => {
    await chartered();
    let release;
    const gate = new Promise((r) => { release = r; });
    setWakeRunner(async (wake) => { ran.push(wake); if (ran.length === 1) await gate; return { outcome: 'done' }; });
    await enqueueWake(WALLET, { seat: HOUSEMATE, reason: 'post', ref: 'a' });
    await until(() => ran.length === 1);
    await enqueueWake(WALLET, { seat: HOUSEMATE, reason: 'post', ref: 'b' });
    await new Promise((r) => setTimeout(r, 50));
    expect(ran).toHaveLength(1);
    expect(Object.keys((await readWakeQueue(WALLET)).running)).toEqual([HOUSEMATE]);
    release();
    await until(() => ran.length === 2);
    expect(ran[1].items.map((i) => i.ref)).toEqual(['b']);
    await whenHouseIdle(WALLET);
    expect((await readWakeQueue(WALLET)).today).toEqual({ [HOUSEMATE]: 2 }); // two real wakes count two
  });

  test('a wake whose backend died mid-turn is written LOST and its work runs again', async () => {
    await chartered();
    setWakeRunner(null);
    const { item } = await enqueueWake(WALLET, { seat: HOUSEMATE, reason: 'post', ref: 'crashed' });
    const dead = spawnSync('true').pid;
    const file = path.join(clockDir(WALLET), 'queue.json');
    const state = JSON.parse(await fs.readFile(file, 'utf8'));
    state.running[HOUSEMATE] = { wakeId: 'w-dead', startedAt: new Date().toISOString(), itemIds: [item.id], host: { pid: dead } };
    // the dead backend counted the wake when it started it, as pumpHouse does
    state.day = localDay(Date.now());
    state.counts = { [HOUSEMATE]: 1 };
    await fs.writeFile(file, JSON.stringify(state));
    setWakeRunner(async (wake) => { ran.push(wake); return { outcome: 'done' }; });
    await pumpHouse(WALLET);
    await whenHouseIdle(WALLET);
    const { rows } = await readWakeLedger(WALLET);
    expect(rows.map((r) => r.outcome).sort()).toEqual(['done', 'lost']);
    expect(rows.find((r) => r.outcome === 'lost')).toMatchObject({ id: 'w-dead', ref: 'crashed' });
    expect(ran[0].items.map((i) => i.ref)).toEqual(['crashed']);
    // lost, then run again: one piece of work, counted once against the cap
    expect((await readWakeQueue(WALLET)).today).toEqual({ [HOUSEMATE]: 1 });
  });

  test('a reused pid never wedges a seat: a wake from before this boot, or one whose pid now names a later process, is LOST; a living host keeps its wake', async () => {
    await chartered();
    setWakeRunner(null);
    const before = await enqueueWake(WALLET, { seat: HOUSEMATE, reason: 'post', ref: 'before-boot' });
    const reused = await enqueueWake(WALLET, { seat: OPTIO, reason: 'post', ref: 'pid-reused' });
    const file = path.join(clockDir(WALLET), 'queue.json');
    const state = JSON.parse(await fs.readFile(file, 'utf8'));
    // pid 1 is alive (and not ours to signal: EPERM) — the shape of a dead backend's pid now held by a daemon
    state.running[HOUSEMATE] = { wakeId: 'w-before-boot', startedAt: '2000-01-01T00:00:00.000Z', itemIds: [before.item.id], host: { pid: 1 } };
    state.running[OPTIO] = { wakeId: 'w-pid-reused', startedAt: new Date().toISOString(), itemIds: [reused.item.id], host: { pid: 1, start: 'not-its-start' } };
    // another backend, alive and mid-wake: its process and its start, as it recorded them (Linux /proc field 22)
    const other = spawn('sleep', ['30']);
    try {
      const stat = readFileSync(`/proc/${other.pid}/stat`, 'utf8');
      const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
      state.running[BYSTANDER] = { wakeId: 'w-alive', startedAt: new Date().toISOString(), itemIds: [], host: { pid: other.pid, start } };
      await fs.writeFile(file, JSON.stringify(state));
      setWakeRunner(async (wake) => { ran.push(wake); return { outcome: 'done' }; });
      await pumpHouse(WALLET);
      await whenHouseIdle(WALLET);
      const { rows } = await readWakeLedger(WALLET);
      expect(rows.filter((r) => r.outcome === 'lost').map((r) => r.id).sort()).toEqual(['w-before-boot', 'w-pid-reused']);
      expect(ran.map((w) => w.items[0].ref).sort()).toEqual(['before-boot', 'pid-reused']);
      expect(Object.keys((await readWakeQueue(WALLET)).running)).toEqual([BYSTANDER]);
    } finally {
      other.kill();
    }
  });

  test('a FAILED wake is tried again after a backoff, 3 attempts in all, counted once; the last raises ONE tray card', async () => {
    await chartered();
    configureWakeQueue({ retryMs: 1000 });
    setWakeRunner(async (wake) => { ran.push(wake); return { outcome: 'failed', sessionId: `sitting-${ran.length}`, error: 'the model is down' }; });
    const { item } = await enqueueWake(WALLET, { seat: HOUSEMATE, reason: 'post', ref: 'p-fail' });
    const attempt = async (n) => {
      const { rows } = await until(async () => { const l = await readWakeLedger(WALLET); return l.total >= n ? l : null; });
      await whenHouseIdle(WALLET);
      return rows[0];
    };
    const first = await attempt(1);
    expect(first).toMatchObject({ outcome: 'failed', error: 'the model is down', ref: 'p-fail' });
    expect(first.note).toMatch(/^attempt 1 of 3 failed — its work is tried again at \d\d:\d\d\. The error: the model is down$/);
    // back on the queue with its attempt counted, held until its backoff passes — never hammered
    let view = await readWakeQueue(WALLET);
    expect(view.items).toEqual([expect.objectContaining({ id: item.id, attempts: 1 })]);
    const retryAt = Date.parse(view.items[0].retryAt);
    expect(retryAt - Date.parse(first.endedAt)).toBe(1000);
    expect(view.held).toEqual([{ seat: HOUSEMATE, why: expect.stringMatching(/its last wake failed — tried again at \d\d:\d\d \(attempt 2 of 3\)/) }]);
    expect((await pumpHouse(WALLET, retryAt - 1)).started).toEqual([]);
    // the same work is not queued twice while it waits to be tried again
    expect((await enqueueWake(WALLET, { seat: HOUSEMATE, reason: 'post', ref: 'p-fail' })).queued).toBe(false);
    // the failed attempt is given back, as a lost one is: one piece of work counts once
    expect(view.today).toEqual({ [HOUSEMATE]: 0 });
    expect((await pumpHouse(WALLET, retryAt)).started).toHaveLength(1);
    const second = await attempt(2);
    expect(second.note).toMatch(/^attempt 2 of 3 failed — its work is tried again at/);
    view = await readWakeQueue(WALLET);
    // the backoff doubles for the last attempt
    const lastAt = Date.parse(view.items[0].retryAt);
    expect(lastAt - Date.parse(second.endedAt)).toBe(2000);
    expect((await readNotifications(WALLET)).records.filter((n) => n.kind === KIND.houseWake)).toEqual([]);
    expect((await pumpHouse(WALLET, lastAt)).started).toHaveLength(1);
    const third = await attempt(3);
    expect(third.note).toBe('attempt 3 of 3 failed — its work is not tried again; the operator is told. The error: the model is down');
    expect(ran).toHaveLength(3);
    view = await readWakeQueue(WALLET);
    expect(view.items).toEqual([]);
    expect(view.today).toEqual({ [HOUSEMATE]: 1 });
    const cards = await until(async () => {
      const c = (await readNotifications(WALLET)).records.filter((n) => n.kind === KIND.houseWake);
      return c.length ? c : null;
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ actor: { id: HOUSEMATE }, ref: { wakeId: third.id, sessionId: 'sitting-3' } });
    expect(cards[0].title).toBe(`${HOUSEMATE}'s wake failed 3 times — its work was not done`);
    expect(cards[0].detail).toBe('Woken for: house post. Error: the model is down');
    // done with: the same work never queues again
    expect((await enqueueWake(WALLET, { seat: HOUSEMATE, reason: 'post', ref: 'p-fail' })).queued).toBe(false);
  });

  test('a team run ending wakes its lead; its watch wakes the seated Optio', async () => {
    await chartered();
    setWakeRunner(null);
    const started = await startTeamRun({
      plan: Object.freeze({
        name: 'WAKE CREW', goal: 'Prove a run end wakes its lead.',
        steps: Object.freeze([Object.freeze({ id: 'one', neumaId: BYSTANDER, task: 'say one thing', needs: Object.freeze([]) })]),
        memberNames: Object.freeze({ [BYSTANDER]: 'Cosi' }),
      }),
      lead: { neumaId: HOUSEMATE, name: 'Quae' },
      wallet: WALLET,
      deps: {
        checkSubstrate: async () => true,
        getCapacity: async () => ({ maxParallel: 2 }),
        ask: async () => 'one thing said\nSTATUS:\ndone',
      },
    });
    expect(started.ok).toBe(true);
    const queued = await until(async () => (await readWakeQueue(WALLET)).items.find((i) => i.reason === 'run-ended'));
    expect(queued).toMatchObject({ seat: HOUSEMATE, ref: started.runId, detail: { status: 'done' } });

    // the run's watch: a part gave up → an alert posted to the seated Optio
    const entry = { id: 'run-w', name: 'WATCHED', lead: 'Quae', startedAt: new Date().toISOString(), board: [{ id: 'p', member: 'Cosi', state: 'failed' }] };
    startWatch(entry, { wallet: WALLET, lead: { neumaId: HOUSEMATE, name: 'Quae' }, notify: async () => {} });
    entry.onPartGaveUp('p', 'it ran out of attempts');
    entry.stopWatch();
    const reasons = await until(async () => {
      const r = (await readWakeQueue(WALLET)).items.filter((i) => i.seat === OPTIO).map((i) => i.reason).sort();
      return r.length === 2 ? r : null;
    });
    // the alert's own post into the inbox, and the alert itself: one wake's work
    expect(reasons).toEqual(['post', 'run-alert']);
  });

  test('the Optio\'s cadence wakes it once per window; a LOST run wakes its lead at boot', async () => {
    await chartered({ cadence: { everyHours: 24 } });
    setWakeRunner(null);
    const now = Date.now();
    expect((await cadenceTick(WALLET, now)).queued).toBe(true);
    expect((await cadenceTick(WALLET, now + 60_000)).queued).toBe(false);
    expect((await cadenceTick(WALLET, now + 25 * 3_600_000)).queued).toBe(true);

    const id = await createRun({
      runAt: new Date().toISOString(), by: WALLET, name: 'LOST CREW', goal: 'g', lane: 'lead', status: 'running',
      lead: { neumaId: HOUSEMATE, name: 'Quae' }, steps: [{ id: 's', neumaId: BYSTANDER, task: 't', needs: [] }],
    });
    await updateRun(id, WALLET, {
      name: 'LOST CREW', goal: 'g', lane: 'lead', status: 'running', lead: { neumaId: HOUSEMATE, name: 'Quae' },
      steps: [{ id: 's', neumaId: BYSTANDER, task: 't', needs: [] }], host: { pid: spawnSync('true').pid, startedAt: new Date().toISOString() },
    });
    const taken = await lostRunsTick(WALLET);
    expect(taken.map((t) => t.queued)).toEqual([true]);
    const items = (await readWakeQueue(WALLET)).items;
    // the next window's review supersedes one still waiting: one review, the newest (2026-10-18)
    expect(items.filter((i) => i.reason === 'cadence').map((i) => [i.seat, i.ref])).toEqual([[OPTIO, `every-24h-${cadenceSlot(now + 25 * 3_600_000, 24 * 3_600_000)}`]]);
    expect(items.find((i) => i.reason === 'run-lost')).toMatchObject({ seat: HOUSEMATE, ref: id });
  });

  test('a second house on the machine: its clock never wakes, and its plans never reach, the first house\'s Optio', async () => {
    const OTHER = '0x3333333333333333333333333333333333333333';
    const OTHER_OPTIO = 'other-house-optio';
    const OTHER_LEAD = 'other-house-lead';
    for (const id of [OTHER_OPTIO, OTHER_LEAD]) {
      await neumaWorkspace.create(id).catch(() => {});
      await fs.writeFile(path.join(getWorkspacesRoot(), id, 'owner.json'), JSON.stringify({ wallet: OTHER, claimedAt: Date.now() }));
    }
    const c = await writeCharter(OTHER, {
      goal: 'The second house works its own work.',
      seats: [{ laneId: OTHER_OPTIO, dailyCap: 5 }, { laneId: OTHER_LEAD, dailyCap: 5 }],
      cadence: { everyHours: 24 },
      delegation: { teamPlans: true },
    }, { by: OTHER, ownedLanes: [OTHER_OPTIO, OTHER_LEAD] });
    const charter = await approveCharter(OTHER, { version: c.version, by: OTHER });
    setWakeRunner(null);
    const now = Date.now();

    // The first house's Optio is seated (the fixture); the second seats none.
    expect(await cadenceTick(OTHER, now)).toBeNull();
    const wake = { wallet: OTHER, seat: OTHER_LEAD, name: 'Other Lead', wakeId: 'wake-x', sessionId: 's-x', charter, escalations: [] };
    const routed = await wakePlanRoute(wake)(null, { goal: 'Ship it.', steps: [{ id: 'a', neumaId: OTHER_LEAD, task: 't', needs: [] }] });
    expect(routed.status).toBe('escalated');
    expect(wake.escalations[0].why).toContain('no Optio is seated');
    await until(async () => (await readAsks(OTHER)).length === 1);

    // Its own Optio, seated: its cadence wakes ITS Optio, in ITS queue only.
    await office.cosDesignation.designate(OTHER, OTHER_OPTIO);
    expect((await cadenceTick(OTHER, now)).queued).toBe(true);
    expect((await readWakeQueue(OTHER)).items.map((i) => i.seat)).toEqual([OTHER_OPTIO]);
    expect((await readWakeQueue(WALLET)).items).toEqual([]);
    expect((await office.cosDesignation.getOfficer(WALLET)).laneId).toBe(OPTIO);
  });
});
