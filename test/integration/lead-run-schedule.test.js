/**
 * THE DAILY LEAD RUN (sales/lead-run-schedule.js) — Design note, 2026-11-22: […]
 *
 * A real house on tmp disk, its real routes and stores (RULE 0); the pass is handed the house and a `start` that
 * answers as the lead run answers, so each case names what the run said. Under proof: it is off until the operator
 * turns it on, and only for an approved audience; a due run starts once a day, from its hour; a paused house holds
 * every one; a full line is tried again and said to nobody; any other refusal is said to the operator once that day.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import process from 'node:process';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import revenueRouter from '../../backend/routes/revenue-routes.js';
import { fileSegment, setSegmentState } from '../../backend/services/sales/sales-store.js';
import { makeSegment } from '../../backend/services/sales/segment-shape.js';
import { scheduleTick, readSchedule, dueNow, foldSchedule, makeSetting, dayOf } from '../../backend/services/sales/lead-run-schedule.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();
const at = (day, hour) => new Date(2026, 10, day, hour, 5).getTime();

describe('the daily lead run', () => {
  let me, app, approved, draft;
  const as = (req) => req.set('Authorization', `Bearer ${me.token}`);
  const api = '/api/v1/revenue/lead-engine/run/schedule';
  const put = (body) => request(app).put(api).use(as).send(body);
  const pass = (now, over = {}) => { const told = []; const asked = []; return scheduleTick({ now, houses: async () => [me.address], paused: async () => false, tell: async (wallet, title, detail) => { told.push(`${title}: ${detail}`); },
    start: async (wallet, ask) => { asked.push(ask); return { ok: true, run: { id: `run-${asked.length}` } }; }, ...over }).then((r) => ({ ...r, told, asked })); };

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'lead-run-schedule-test-key';
    useTempRealm();
    const tmp = await createTempDir('lead-run-schedule');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
    me = await fullAuth();
    await workspace.create('merc');
    await fs.writeFile(path.join(tmp, 'workspaces', 'merc', 'owner.json'), JSON.stringify({ wallet: me.address, claimedAt: 1 }));
    app = express();
    app.use(express.json());
    app.use('/api/v1/revenue', revenueRouter);
    const make = (name) => makeSegment({ name, offer: 'A stake in what we are building', company: 'ignis', customerProblem: 'They look for the next thing to back', targetRole: 'Partner', targetGeography: 'United States', countries: ['US'], positiveCriteria: ['Active fund'], why: 'They invest in this', by: 'merc', now: new Date().toISOString() });
    approved = make('Funds');
    draft = make('Not yet');
    for (const s of [approved, draft]) await fileSegment(me.address, s);
    await setSegmentState(me.address, approved.id, 'approved', 'operator');
  }, 60000);

  afterAll(() => {
    setWorkspacesRoot(PRIOR_ROOT);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  test('off until the operator turns it on, for an approved audience only; a setting is kept within its bounds', async () => {
    expect((await request(app).get(api)).status).toBe(401);
    expect((await request(app).get(api).use(as)).body).toEqual({ schedule: [] });
    expect((await pass(at(23, 12))).asked).toEqual([]);
    expect((await put({ on: true })).body.error).toBe('segment: the audience this is the daily run of');
    expect((await put({ segment: 's-nope', on: true })).status).toBe(404);
    expect((await put({ segment: draft.id, on: true })).body.error).toBe('"Not yet" is draft, not approved — approve it before it runs by itself');
    const set = await put({ segment: approved.id, on: true, leads: 5000, credits: 30, hour: 9 });
    expect(set.body.schedule).toEqual([expect.objectContaining({ segmentId: approved.id, on: true, leads: 200, credits: 30, hour: 9, startedDay: null })]);
    expect(makeSetting({ segmentId: 's-1', on: 'yes', hour: 40 })).toEqual({ segmentId: 's-1', on: false, leads: 25, credits: 100, hour: 23 });
  });

  test('a due run starts once a day from its hour, as the operator\'s own press would; the next day it starts again', async () => {
    expect((await pass(at(23, 8))).asked).toEqual([]);
    const first = await pass(at(23, 9));
    expect(first.asked).toEqual([{ segmentId: approved.id, want: 200, credits: 30, refill: true }]);
    expect(first.started).toEqual([{ wallet: me.address, segmentId: approved.id, run: 'run-1' }]);
    expect((await readSchedule(me.address))[0]).toMatchObject({ startedDay: dayOf(at(23, 9)), lastRun: 'run-1' });
    expect((await pass(at(23, 15))).asked).toEqual([]);
    expect((await pass(at(24, 10))).asked).toHaveLength(1);
  });

  test('a paused house holds it; a full line is tried again and said to nobody; another refusal is said to the operator once that day', async () => {
    const day = 25;
    const paused = await pass(at(day, 10), { paused: async () => true });
    expect([paused.asked, paused.held]).toEqual([[], [{ wallet: me.address, segmentId: approved.id, why: 'the house clock is paused' }]]);
    const full = { ok: false, reason: '2 lead run(s) are working, and that is every place your model has for them' };
    const busy = await pass(at(day, 10), { start: async () => full });
    expect([busy.held[0].why, busy.told]).toEqual([full.reason, []]);
    const refused = { ok: false, reason: 'no one is seated as the sales member: a run files as the seat, and the seat is empty' };
    const once = await pass(at(day, 11), { start: async () => refused });
    expect(once.told).toEqual([`Today's lead run did not start: ${refused.reason}`]);
    expect((await pass(at(day, 12), { start: async () => refused })).told).toEqual([]);
    expect((await readSchedule(me.address))[0].held).toEqual({ day: dayOf(at(day, 11)), why: refused.reason });
    // Still owed: once the seat is filled it starts, and what held it is cleared.
    expect((await pass(at(day, 13))).started).toHaveLength(1);
    expect((await readSchedule(me.address))[0].held).toBeNull();
    // Turned off, nothing is due.
    await put({ segment: approved.id, on: false });
    expect(dueNow(await readSchedule(me.address), at(26, 12))).toEqual([]);
    expect(foldSchedule([{ type: 'started', runId: 'x' }])).toEqual([]);
  });
});
