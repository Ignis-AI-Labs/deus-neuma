/**
 * The house clock's vision routes (/api/v1/house-clock/queue, /ledger, /asks)
 * — RULE 0: a real wallet with a real session token, the real router, the
 * real charter store, the real queue moving real wakes on a real temp realm.
 * A real recorder function stands where the wake turn sits (the routes wire
 * the real turn at load; it is replaced before anything is queued, so no
 * model is ever asked). Under proof: the operator sees what waits and why it
 * is held, every wake that ran, page by page, and every ask a wake filed —
 * and only ever their own house's.
 */
import express from 'express';
import request from 'supertest';
import path from 'path';
import { describe, test, expect, beforeEach } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

describe('the house clock\'s vision, through its routes', () => {
  let app, operator, stranger, queue, ledger, store;
  const ENV = ['WORKSPACES_ROOT', 'NEUMA_REALM_ROOT', 'NEUMA_DATA_ROOT'];
  const saved = {};

  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV) saved[k] = process.env[k];
    const root = await createTempDir('house-clock-routes');
    process.env.WORKSPACES_ROOT = path.join(root, 'workspaces');
    process.env.NEUMA_REALM_ROOT = path.join(root, 'realm');
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    const { setRealmRoot } = await import('../../backend/services/user-realm.js');
    setRealmRoot(process.env.NEUMA_REALM_ROOT);
    const { witnessFor, strangerWitness } = await import('../helpers/witness.js');
    operator = await witnessFor(process.env.WORKSPACES_ROOT, 'clock-seat');
    stranger = strangerWitness();
    const { default: router } = await import('../../backend/routes/house-clock-routes.js');
    queue = await import('../../backend/services/house-clock/wake-queue.js');
    ledger = await import('../../backend/services/house-clock/wake-ledger.js');
    store = await import('../../backend/services/house-clock/charter-store.js');
    queue.setWakeRunner(null); // nothing runs until a test says what does
    queue.configureWakeQueue({ settleMs: 0 });
    app = express();
    app.use(express.json());
    app.use('/api/v1/house-clock', router);
    const c = await store.writeCharter(operator.address, {
      goal: 'Prove the operator sees every wake.',
      seats: [{ laneId: 'clock-seat', dailyCap: 3 }],
    }, { by: operator.address, ownedLanes: ['clock-seat'] });
    await store.approveCharter(operator.address, { version: c.version, by: operator.address });
    return () => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
  });

  const as = (who, req) => req.set('Authorization', `Bearer ${who.token}`);

  test('no token, no vision', async () => {
    for (const p of ['queue', 'ledger', 'asks']) expect((await request(app).get(`/api/v1/house-clock/${p}`)).status).toBe(401);
  });

  test('the queue shows what waits and why it is held; the ledger shows every wake, newest first, page by page', async () => {
    await queue.enqueueWake(operator.address, { seat: 'clock-seat', reason: 'post', ref: 'p-1', detail: { from: 'optio' } });
    let res = await as(operator, request(app).get('/api/v1/house-clock/queue'));
    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => [i.seat, i.reason, i.ref])).toEqual([['clock-seat', 'post', 'p-1']]);
    expect(res.body.held).toEqual([]);
    await store.setCharterPaused(operator.address, true);
    res = await as(operator, request(app).get('/api/v1/house-clock/queue'));
    expect(res.body.held).toEqual([{ seat: 'clock-seat', why: 'the charter is paused' }]);
    await store.setCharterPaused(operator.address, false);

    const ran = [];
    queue.setWakeRunner(async (wake) => { ran.push(wake.items[0].ref); return { outcome: 'done', sessionId: `s-${wake.items[0].ref}` }; });
    await queue.pumpHouse(operator.address);
    await queue.whenHouseIdle(operator.address);
    await queue.enqueueWake(operator.address, { seat: 'clock-seat', reason: 'dispatch', ref: 'c-1' });
    await queue.pumpHouse(operator.address);
    await queue.whenHouseIdle(operator.address);
    expect(ran).toEqual(['p-1', 'c-1']);

    res = await as(operator, request(app).get('/api/v1/house-clock/ledger'));
    expect(res.body.total).toBe(2);
    expect(res.body.rows.map((r) => [r.ref, r.outcome, r.sessionId])).toEqual([['c-1', 'done', 's-c-1'], ['p-1', 'done', 's-p-1']]);
    res = await as(operator, request(app).get('/api/v1/house-clock/ledger?offset=1&limit=1'));
    expect(res.body.rows.map((r) => r.ref)).toEqual(['p-1']);
    res = await as(operator, request(app).get('/api/v1/house-clock/queue'));
    expect(res.body).toMatchObject({ items: [], running: {}, today: { 'clock-seat': 2 } });

    // the filters run before the page: total counts what matches
    res = await as(operator, request(app).get('/api/v1/house-clock/ledger?outcome=done&seat=clock-seat&limit=1'));
    expect(res.body).toMatchObject({ total: 2, rows: [{ ref: 'c-1' }] });
    res = await as(operator, request(app).get('/api/v1/house-clock/ledger?outcome=failed'));
    expect(res.body).toEqual({ rows: [], total: 0 });
    res = await as(operator, request(app).get('/api/v1/house-clock/ledger?seat=another-seat'));
    expect(res.body.total).toBe(0);
  });

  test('a running wake shows its sitting on the queue while it runs, so the operator can open it live', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    queue.setWakeRunner(async (wake) => {
      await wake.onSitting('s-live-1');
      await gate;
      return { outcome: 'done', sessionId: 's-live-1' };
    });
    await queue.enqueueWake(operator.address, { seat: 'clock-seat', reason: 'post', ref: 'p-live' });
    await queue.pumpHouse(operator.address);
    let running;
    for (let i = 0; i < 200 && !running?.sessionId; i += 1) {
      running = (await as(operator, request(app).get('/api/v1/house-clock/queue'))).body.running['clock-seat'];
      if (!running?.sessionId) await new Promise((r) => setTimeout(r, 10));
    }
    expect(running).toMatchObject({ sessionId: 's-live-1' });
    expect(running.startedAt).toBeTruthy();
    release();
    await queue.whenHouseIdle(operator.address);
    const res = await as(operator, request(app).get('/api/v1/house-clock/ledger'));
    expect(res.body.rows[0]).toMatchObject({ ref: 'p-live', sessionId: 's-live-1', outcome: 'done' });
  });

  test('every ask a wake filed is on view — and only to its own house', async () => {
    await ledger.fileAsk(operator.address, { wakeId: 'w-1', seat: 'clock-seat', kind: 'act', tool: 'intents/wallet.send', why: 'money out is always the operator\'s to approve', sessionId: 's-1' });
    let res = await as(operator, request(app).get('/api/v1/house-clock/asks'));
    expect(res.body.asks.map((a) => [a.kind, a.tool, a.status])).toEqual([['act', 'intents/wallet.send', 'open']]);
    res = await as(stranger, request(app).get('/api/v1/house-clock/asks'));
    expect(res.body.asks).toEqual([]);
    res = await as(stranger, request(app).get('/api/v1/house-clock/ledger'));
    expect(res.body).toEqual({ rows: [], total: 0 });
  });

  test('the operator closes an ask: it reads closed, with their note; nothing else is written; a stranger cannot close it', async () => {
    const filed = await ledger.fileAsk(operator.address, { wakeId: 'w-2', seat: 'clock-seat', kind: 'act', tool: 'web/web_search', why: 'it needs the operator\'s approval', sessionId: 's-2' });
    const close = (who, id, body = {}) => as(who, request(app).post(`/api/v1/house-clock/asks/${id}/close`)).send(body);

    expect((await close(stranger, filed.id)).status).toBe(404);
    expect((await close(operator, 'not-an-id')).status).toBe(400);
    expect((await close(operator, filed.id, { note: 'x'.repeat(281) })).status).toBe(400);

    let res = await close(operator, filed.id, { note: 'I told the seat to search next sitting.' });
    expect(res.status).toBe(200);
    expect(res.body.ask).toMatchObject({ id: filed.id, status: 'closed', closedBy: operator.address.toLowerCase(), closeNote: 'I told the seat to search next sitting.' });
    // a second close changes nothing: the first stands
    res = await close(operator, filed.id, { note: 'again' });
    expect(res.body.ask.closeNote).toBe('I told the seat to search next sitting.');

    res = await as(operator, request(app).get('/api/v1/house-clock/asks'));
    expect(res.body.asks.map((a) => [a.id, a.status])).toEqual([[filed.id, 'closed']]);
    // closing is not approving: no wake was queued, no wake ran
    expect((await as(operator, request(app).get('/api/v1/house-clock/queue'))).body.items).toEqual([]);
    expect((await as(operator, request(app).get('/api/v1/house-clock/ledger'))).body.total).toBe(0);
  });
});
