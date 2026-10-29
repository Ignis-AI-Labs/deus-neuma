/**
 * THE MANDATE's doors for the operator — ON FROM THE DESK, OFF FROM ANYWHERE
 * (ruling, 2026-10-24). The REST routes behind real wallet auth (a signed
 * session) and the REAL access guard (a loopback desk vs a real paired phone
 * through the tailnet), the house social check against a loopback X, and the
 * CLI at the machine as a real child process (RULE 0, no mock anywhere).
 *
 * Proven: a grant (and resume, renew, clearing a hold) is refused unless it
 * comes from this computer's own desk, in plain words; the grant protocol's
 * rows are enforced by the route itself, not the screen; a grant always has
 * an end; WITHDRAW answers from the desk, the phone, every surface's own call,
 * and the CLI with the desk closed.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readMandate } from '../../backend/services/marketing/mandate/mandate-store.js';
import { DESK_ONLY } from '../../backend/routes/mandate-routes.js';
import { buildDeskHouse, teardownDeskHouse, atDesk, fromPhone } from '../helpers/mandate-desk-kit.js';

const run = promisify(execFile);
const CLEAR = { accounts: [{ id: 'x-1', pace: 2 }], timeZone: 'UTC' };
const RED = { accounts: [{ id: 'x-2', pace: 2 }], timeZone: 'UTC' };

let k;
beforeAll(async () => { k = await buildDeskHouse(); }, 60000);
afterAll(async () => { await teardownDeskHouse(k); });

const desk = (who, method, url, body = {}) => atDesk(k, who, request(k.base)[method](url)).send(body);
const phone = (who, method, url, body = {}) => fromPhone(k, who, request(k.base)[method](url)).send(body);
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

describe('the grant protocol, run by the server', () => {
  test('no session reaches nothing', async () => {
    expect((await request(k.base).get('/api/v1/mandate').set('Host', `localhost:${k.port}`)).status).toBe(401);
    expect((await request(k.base).post('/api/v1/mandate/grant').set('Host', `localhost:${k.port}`).send(CLEAR)).status).toBe(401);
  });

  test('pre-flight at the desk: x-1 passes every row; x-2 (keys answer as another account) fails its row with a door', async () => {
    const ok = await desk(k.operator, 'post', '/api/v1/mandate/preflight', CLEAR);
    expect(ok.status).toBe(200);
    expect(ok.body.atDesk).toBe(true);
    expect(ok.body.rows.map((r) => [r.id, r.ok])).toEqual([['seat', true], ['accounts', true], ['security', true], ['legal', true], ['settled', true]]);
    expect(ok.body.clear).toBe(true);
    const red = await desk(k.operator, 'post', '/api/v1/mandate/preflight', RED);
    expect(byId(red.body.rows).accounts).toMatchObject({ ok: false, door: { kind: 'marketing', tab: 'accounts', accountId: 'x-2' } });
    expect(byId(red.body.rows).accounts.words).toContain('x-2: the right account');
    expect(red.body.clear).toBe(false);
  }, 30000);

  test('the same read from the phone says it is not the desk', async () => {
    const res = await phone(k.operator, 'post', '/api/v1/mandate/preflight', CLEAR);
    expect(res.status).toBe(200);
    expect(res.body.atDesk).toBe(false);
  }, 30000);

  test('a grant from the phone is refused in plain words — nothing stands', async () => {
    const res = await phone(k.operator, 'post', '/api/v1/mandate/grant', CLEAR);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: DESK_ONLY, code: 'MANDATE_DESK_ONLY' });
    expect(DESK_ONLY).toContain('only at this computer\'s own desk');
    expect(await readMandate(k.operator.address)).toBeNull();
  });

  test('a header claiming the desk is not the desk: a forwarded loopback Host is refused before the route', async () => {
    const res = await request(k.base).post('/api/v1/mandate/grant').set('Authorization', `Bearer ${k.operator.token}`)
      .set('Host', `localhost:${k.port}`).set('X-Forwarded-For', '100.100.7.9').send(CLEAR);
    expect(res.status).toBe(403);
    expect(await readMandate(k.operator.address)).toBeNull();
  });

  test('the route enforces the rows itself: a grant on an account that is not clear is refused, with the rows', async () => {
    const res = await desk(k.operator, 'post', '/api/v1/mandate/grant', RED);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MANDATE_PREFLIGHT');
    expect(res.body.error).toMatch(/^Not granted — Every account is clear on the social check: x-2/);
    expect(byId(res.body.rows).accounts.ok).toBe(false);
    expect(await readMandate(k.operator.address)).toBeNull();
  }, 30000);

  test('a grant always ends: "until withdrawn" is refused; the default turns itself off in 7 days', async () => {
    const open = await desk(k.operator, 'post', '/api/v1/mandate/grant', { ...CLEAR, untilWithdrawn: true });
    expect(open.status).toBe(409);
    expect(open.body.error).toContain('always turns itself off');
    const res = await desk(k.operator, 'post', '/api/v1/mandate/grant', CLEAR);
    expect(res.status).toBe(200);
    expect(res.body.view.standing).toBe('active');
    expect(res.body.mandate.days).toBe(7);
    expect(Date.parse(res.body.mandate.expiresAt) - Date.parse(res.body.mandate.grantedAt)).toBe(7 * 24 * 60 * 60 * 1000);
  }, 30000);

  test('while it stands the protocol says so: nothing unresolved fails, and a second grant is refused', async () => {
    const rows = (await desk(k.operator, 'post', '/api/v1/mandate/preflight', CLEAR)).body.rows;
    expect(byId(rows).settled).toMatchObject({ ok: false, words: 'A mandate already stands (active) — withdraw it first.' });
    expect((await desk(k.operator, 'post', '/api/v1/mandate/grant', CLEAR)).status).toBe(409);
  }, 30000);
});

describe('on only from the desk, off from anywhere', () => {
  test('renew and clearing a hold are refused from the phone; renew answers at the desk', async () => {
    expect((await phone(k.operator, 'post', '/api/v1/mandate/renew')).body.code).toBe('MANDATE_DESK_ONLY');
    expect((await phone(k.operator, 'post', '/api/v1/mandate/holds/mh_000000000000/clear')).body.code).toBe('MANDATE_DESK_ONLY');
    expect((await desk(k.operator, 'post', '/api/v1/mandate/holds/mh_000000000000/clear')).status).toBe(404);
    expect((await desk(k.operator, 'post', '/api/v1/mandate/renew')).status).toBe(200);
  });

  test('a stranger can neither grant nor withdraw this house\'s mandate, even at the desk', async () => {
    expect((await desk(k.stranger, 'post', '/api/v1/mandate/grant', CLEAR)).status).toBe(409);
    expect((await desk(k.stranger, 'post', '/api/v1/mandate/withdraw')).status).toBe(409);
    expect((await readMandate(k.operator.address)).status).toBe('active');
    expect((await desk(k.stranger, 'get', '/api/v1/mandate')).body).toMatchObject({ standing: 'none', seat: null, feed: [] });
  }, 30000);

  test('WITHDRAW from the phone ends it at once', async () => {
    const out = await phone(k.operator, 'post', '/api/v1/mandate/withdraw', { reason: 'from the phone' });
    expect(out.status).toBe(200);
    expect(out.body.view.standing).toBe('none');
    expect(await readMandate(k.operator.address)).toBeNull();
  });

  test('resume is refused from the phone; at the desk it needs a paused mandate', async () => {
    expect((await phone(k.operator, 'post', '/api/v1/mandate/resume')).body.code).toBe('MANDATE_DESK_ONLY');
    expect((await desk(k.operator, 'post', '/api/v1/mandate/resume')).status).toBe(409);
  });

  // Each surface's own WITHDRAW sends its own reason down the same route
  // (mandate-client.js withdrawMandate): the tray, MARKETING, the House Clock.
  test.each([
    ['the tray', 'withdrawn from the tray'],
    ['the MARKETING window', 'withdrawn from the MARKETING window'],
    ['the House Clock and the tray section', 'withdrawn from the desk'],
  ])('WITHDRAW from %s answers', async (_where, reason) => {
    expect((await desk(k.operator, 'post', '/api/v1/mandate/grant', CLEAR)).status).toBe(200);
    const out = await desk(k.operator, 'post', '/api/v1/mandate/withdraw', { reason });
    expect(out.status).toBe(200);
    expect(out.body.mandate.withdrawReason).toBe(reason);
    expect(await readMandate(k.operator.address)).toBeNull();
  }, 30000);
});

describe('the CLI at the machine', () => {
  test('withdraws with the desk closed — a real child process on the same files; it cannot turn one on', async () => {
    expect((await desk(k.operator, 'post', '/api/v1/mandate/grant', CLEAR)).status).toBe(200);
    const env = {
      ...process.env,
      NEUMA_REALM_ROOT: k.houses.realm,
      WORKSPACES_ROOT: k.houses.rootA,
      NEUMA_DATA_ROOT: path.join(k.houses.tmp, 'data'),
    };
    const script = path.resolve('scripts/mandate.mjs');
    const status = await run(process.execPath, [script, 'status', '--house', k.operator.address], { env });
    expect(status.stdout).toMatch(/^ACTIVE\n.*may post on x-1/);
    const out = await run(process.execPath, [script, 'withdraw', '--house', k.operator.address, '--reason', 'at the machine'], { env });
    expect(out.stdout).toMatch(/^WITHDRAWN md_[0-9a-f]+ — 0 queued post\(s\) cancelled, 0 already leaving\.$/m);
    expect(await readMandate(k.operator.address)).toBeNull();
    await expect(run(process.execPath, [script, 'withdraw', '--house', k.operator.address], { env })).rejects.toMatchObject({ code: 1 });
    const resume = run(process.execPath, [script, 'resume', '--house', k.operator.address], { env });
    await expect(resume).rejects.toMatchObject({ code: 2 });
    await expect(resume).rejects.toMatchObject({ stderr: expect.stringContaining('only at the desk') });
  }, 60000);
});
