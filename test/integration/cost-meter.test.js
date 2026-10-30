/**
 * THE COST METER through the real stack (RULE 0, nothing faked): the real
 * treasury routes behind real session tokens, the real stores on a temp realm,
 * two real houses on one temp ground, and the meter's real minute — the real
 * nvidia-smi read on this machine (a machine with no NVIDIA driver proves the
 * other branch: nothing is written, and the minute stands unread).
 *
 * Under proof: the meter is off until the operator sets a rate with its
 * source, and off it reads nothing; on, its minute writes the GPU's draw into
 * that house alone and the month's statement counts it; hardware and bills
 * are the operator's entries, refused without a source; a wrong one is voided
 * with why and never edited; one house never reads, writes or voids another's.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import treasuryRouter from '../../backend/routes/treasury-routes.js';
import { costMeterTick } from '../../backend/services/cost-meter/cost-meter-scheduler.js';
import { officeFile } from '../../backend/services/house-office.js';
import { monthOf } from '../../backend/services/cost-meter/cost-shape.js';

const PRIOR_ROOT = getWorkspacesRoot();
const HAS_DRIVER = ['/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi'].some((p) => existsSync(p));
const RATE = { currency: 'USD', pricePerKwh: 0.2, priceSource: 'bill: Metro Power, September 2026' };

describe('THE COST METER through the real stack', () => {
  let a, b, app;
  const as = (who) => (req) => req.set('Authorization', `Bearer ${who.token}`);
  const costs = async (who = a) => {
    const res = await request(app).get('/api/v1/treasury/costs').use(as(who));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body;
  };
  const powerLines = async (who) => {
    try {
      return (await fs.readFile(officeFile(who.address, 'treasury', `power-${monthOf(Date.now())}.jsonl`), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };

  beforeAll(async () => {
    useTempRealm();
    const tmp = await createTempDir('cost-meter');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
    a = await fullAuth();
    b = await fullAuth();
    for (const [laneId, who] of [['keir', a], ['brook', b]]) {
      await workspace.create(laneId);
      await fs.writeFile(path.join(workspace.pathFor(laneId), 'owner.json'), JSON.stringify({ wallet: who.address, claimedAt: 1 }));
    }
    app = express();
    app.use(express.json());
    app.use('/api/v1/treasury', treasuryRouter);
  });

  afterAll(() => setWorkspacesRoot(PRIOR_ROOT));

  test('off until the operator sets the rate — and off, the minute reads nothing', async () => {
    expect((await request(app).get('/api/v1/treasury/costs')).status).toBe(401);
    const off = await costs();
    expect(off).toMatchObject({ on: false, setup: null, costs: [], bills: [] });
    expect(off.months.map((m) => m.month)).toEqual([off.statement.month, expect.any(String)]);
    expect(off.statement.missing[0]).toBe('the meter is off — set your electricity rate to start it');
    expect(await costMeterTick()).toEqual({ houses: 0 });
    expect(await powerLines(a)).toEqual([]);
  });

  test('a rate with no source is refused; with one, the meter stands on for that house alone', async () => {
    const bad = await request(app).put('/api/v1/treasury/costs/setup').use(as(a)).send({ ...RATE, priceSource: 'about right' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/^priceSource: where the rate comes from — a source is/);
    const set = await request(app).put('/api/v1/treasury/costs/setup').use(as(a)).send({ ...RATE, by: 'a being', sharePct: 50 });
    expect(set.status).toBe(200);
    expect(set.body.setup).toMatchObject({ on: true, currency: 'USD', pricePerKwh: 0.2, sharePct: 50, by: 'operator' });
    expect((await costs()).on).toBe(true);
    expect((await costs(b)).on).toBe(false);
  });

  test('its minute writes the GPU\'s real draw into that house, and the month counts it', async () => {
    const tick = await costMeterTick();
    const lines = await powerLines(a);
    expect(await powerLines(b)).toEqual([]);
    if (!HAS_DRIVER) {
      expect(tick).toEqual({ houses: 1, watts: null });
      expect(lines).toEqual([]);
      return;
    }
    expect(tick.houses).toBe(1);
    expect(tick.watts).toBeGreaterThan(0);
    expect(lines).toEqual([{ m: expect.stringMatching(/:00\.000Z$/), w: tick.watts }]);
    const { statement } = await costs();
    expect(statement.energy).toMatchObject({ measuredMinutes: 1, machineKwh: Math.round((tick.watts / 60000) * 1000) / 1000 });
    expect(statement.energy.segments).toEqual([expect.objectContaining({ currency: 'USD', pricePerKwh: 0.2, sharePct: 50 })]);
  });

  test('hardware and bills are the operator\'s entries, each with its source; a wrong one is voided with why', async () => {
    const month = monthOf(Date.now());
    const noSource = await request(app).post('/api/v1/treasury/costs/bills').use(as(a)).send({ provider: 'Anthropic', month, amount: 12.5, currency: 'USD' });
    expect(noSource.status).toBe(400);
    const rig = await request(app).post('/api/v1/treasury/costs/fixed').use(as(a))
      .send({ kind: 'hardware', what: 'the rig', price: 3600, months: 36, currency: 'USD', since: month, source: 'receipt: Micro Center, 2026-01-04' });
    expect(rig.status).toBe(200);
    const bill = await request(app).post('/api/v1/treasury/costs/bills').use(as(a))
      .send({ provider: 'Anthropic', month, amount: 12.5, currency: 'USD', source: 'invoice: INV-2026-1182' });
    expect(bill.status).toBe(200);
    const twice = await request(app).post('/api/v1/treasury/costs/bills').use(as(a))
      .send({ provider: 'Anthropic', month, amount: 12.5, currency: 'USD', source: 'invoice: INV-2026-1182' });
    let read = await costs();
    expect(read.statement.fixed).toEqual([expect.objectContaining({ what: 'the rig', amount: 100 })]);
    expect(read.statement.bills).toHaveLength(2);
    const energy = read.statement.energy.segments.reduce((sum, g) => sum + g.cost, 0);
    expect(read.statement.totals).toEqual([{ currency: 'USD', amount: Math.round((energy + 125) * 100) / 100 }]);

    const id = twice.body.bill.id;
    expect((await request(app).post(`/api/v1/treasury/costs/${id}/void`).use(as(a)).send({ reason: '' })).status).toBe(400);
    // another house cannot void this house's entry: it is not on that house's meter
    expect((await request(app).post(`/api/v1/treasury/costs/${id}/void`).use(as(b)).send({ reason: 'not mine to keep' })).status).toBe(404);
    expect((await request(app).post(`/api/v1/treasury/costs/${id}/void`).use(as(a)).send({ reason: 'entered twice' })).status).toBe(200);
    expect((await request(app).post(`/api/v1/treasury/costs/${id}/void`).use(as(a)).send({ reason: 'entered twice' })).status).toBe(404);
    read = await costs();
    expect(read.bills.map((x) => x.id)).toEqual([bill.body.bill.id]);
    expect(read.statement.bills).toHaveLength(1);
    expect(await costs(b)).toMatchObject({ costs: [], bills: [] });
  });

  test('the operator stops the meter: its minute reads nothing more', async () => {
    expect((await request(app).put('/api/v1/treasury/costs/setup').use(as(a)).send({ on: false })).status).toBe(200);
    const before = (await powerLines(a)).length;
    expect(await costMeterTick()).toEqual({ houses: 0 });
    expect(await powerLines(a)).toHaveLength(before);
    expect((await costs()).on).toBe(false);
  });
});
