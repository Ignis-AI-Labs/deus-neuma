/**
 * The charter routes (/api/v1/house-clock/charter) — RULE 0: a real wallet
 * with a real session token, the real router, the real store on a real temp
 * realm, the real workspace owner records. Under proof:
 *  - a charter is written pending approval, and approved only at the version
 *    the operator read;
 *  - editing it re-requires approval, and the superseded version is kept;
 *  - pause is the master switch, and an edit never releases it;
 *  - a house only ever touches its own charter; no token, no charter.
 */
import express from 'express';
import request from 'supertest';
import path from 'path';
import { describe, test, expect, beforeEach } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

describe('the house charter, through its routes', () => {
  let app, operator, stranger;
  const saved = {};
  const ENV = ['WORKSPACES_ROOT', 'NEUMA_REALM_ROOT'];

  const charter = (patch = {}) => ({
    goal: 'Find a real gap and build the product for it.',
    seats: [{ laneId: 'clock-optio', dailyCap: 4 }],
    cadence: { everyHours: 24 },
    ...patch,
  });

  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV) saved[k] = process.env[k];
    const root = await createTempDir('house-charter-routes');
    process.env.WORKSPACES_ROOT = path.join(root, 'workspaces');
    process.env.NEUMA_REALM_ROOT = path.join(root, 'realm');
    const { setRealmRoot } = await import('../../backend/services/user-realm.js');
    setRealmRoot(process.env.NEUMA_REALM_ROOT);
    const { witnessFor, strangerWitness } = await import('../helpers/witness.js');
    operator = await witnessFor(process.env.WORKSPACES_ROOT, 'clock-optio');
    stranger = strangerWitness();
    const { default: router } = await import('../../backend/routes/house-clock-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/house-clock', router);
    return () => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
  });

  const as = (who, req) => req.set('Authorization', `Bearer ${who.token}`);

  test('no token, no charter', async () => {
    expect((await request(app).get('/api/v1/house-clock/charter')).status).toBe(401);
  });

  test('written pending approval; approved only at the version read; an edit re-requires it', async () => {
    let res = await as(operator, request(app).get('/api/v1/house-clock/charter'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ charter: null, standing: 'none', history: [] });

    res = await as(operator, request(app).put('/api/v1/house-clock/charter').send(charter()));
    expect(res.status).toBe(200);
    expect(res.body.standing).toBe('unapproved');
    expect(res.body.charter).toMatchObject({ version: 1, approvedAt: null, paused: false, escalate: ['intents/wallet.send'] });

    // approving a version the operator did not read is refused
    res = await as(operator, request(app).post('/api/v1/house-clock/charter/approve').send({ version: 2 }));
    expect(res.status).toBe(409);
    res = await as(operator, request(app).post('/api/v1/house-clock/charter/approve').send({}));
    expect(res.status).toBe(400);

    res = await as(operator, request(app).post('/api/v1/house-clock/charter/approve').send({ version: 1 }));
    expect(res.status).toBe(200);
    expect(res.body.standing).toBe('active');
    expect(res.body.charter.approvedBy).toEqual({ wallet: operator.address.toLowerCase(), via: 'desk' });

    // EDITING RESETS APPROVAL — and the approved version is kept
    res = await as(operator, request(app).put('/api/v1/house-clock/charter').send(charter({ cadence: { everyHours: 12 } })));
    expect(res.body.standing).toBe('unapproved');
    expect(res.body.charter.version).toBe(2);
    res = await as(operator, request(app).get('/api/v1/house-clock/charter'));
    expect(res.body.history.map((h) => [h.version, h.approvedVersion])).toEqual([[1, 1]]);
  });

  test('pause is the master switch: it holds through an edit and never withdraws approval', async () => {
    await as(operator, request(app).put('/api/v1/house-clock/charter').send(charter()));
    await as(operator, request(app).post('/api/v1/house-clock/charter/approve').send({ version: 1 }));
    let res = await as(operator, request(app).post('/api/v1/house-clock/charter/pause'));
    expect(res.body.standing).toBe('paused');
    expect(res.body.charter.pausedAt).toBeTruthy();
    res = await as(operator, request(app).post('/api/v1/house-clock/charter/resume'));
    expect(res.body.standing).toBe('active');

    await as(operator, request(app).post('/api/v1/house-clock/charter/pause'));
    res = await as(operator, request(app).put('/api/v1/house-clock/charter').send(charter({ goal: 'A new goal.' })));
    expect(res.body.charter.paused).toBe(true);
    await as(operator, request(app).post('/api/v1/house-clock/charter/approve').send({ version: 2 }));
    res = await as(operator, request(app).get('/api/v1/house-clock/charter'));
    expect(res.body.standing).toBe('paused');
  });

  test('a charter names only this house\'s beings, and never money out', async () => {
    let res = await as(operator, request(app).put('/api/v1/house-clock/charter')
      .send(charter({ seats: [{ laneId: 'someone-elses', dailyCap: 2 }] })));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a being of this house/);
    res = await as(operator, request(app).put('/api/v1/house-clock/charter')
      .send(charter({ allow: ['intents/wallet.send'] })));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/money out/);
  });

  test('a house only ever reads and writes its own charter', async () => {
    await as(operator, request(app).put('/api/v1/house-clock/charter').send(charter()));
    let res = await as(stranger, request(app).get('/api/v1/house-clock/charter'));
    expect(res.body.charter).toBeNull();
    // the stranger owns no lane, so it cannot charter the operator's
    res = await as(stranger, request(app).put('/api/v1/house-clock/charter').send(charter()));
    expect(res.status).toBe(400);
    res = await as(stranger, request(app).post('/api/v1/house-clock/charter/approve').send({ version: 1 }));
    expect(res.status).toBe(404);
    res = await as(operator, request(app).get('/api/v1/house-clock/charter'));
    expect(res.body.standing).toBe('unapproved');
  });
});
