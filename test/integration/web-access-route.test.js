import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Integration tests for /api/v1/web/web-access — the operator's switch route.
 * Nothing is mocked. Auth is a real HMAC session token through the real
 * requireAuth; the settings module is the real shared instance, pointed at a
 * tmp file through its own NEUMA_WEB_ACCESS_PATH door (#390 tranche 3 — the
 * door used to be boot-only, which is why this file previously had to
 * doMock the module to repoint the singleton). Every read and write below
 * is real disk, and the operator's real web-access.json is never touched.
 */
describe('web-access routes', () => {
  let app;
  let dir;
  let witness;
  let envLock;

  beforeEach(async () => {
    vi.resetModules();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-route-'));

    // The real shared instance, aimed at the rig's tmp file through the
    // module's own isolation door. The kill-switch variable is cleared for
    // the duration so a rig that launched air-gapped cannot silently turn
    // the […] assertions into false reds.
    process.env.NEUMA_WEB_ACCESS_PATH = path.join(dir, 'web-access.json');
    envLock = process.env.NEUMA_WEB_ACCESS;
    delete process.env.NEUMA_WEB_ACCESS;

    // Imported AFTER resetModules so the helper mints its token from the same
    // auth.js instance the router will verify against. No neuma lane here —
    // this is a pure settings route, so a stranger's real session is the
    // right shape (nothing to own).
    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();

    const { default: router } = await import('../../backend/routes/web-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/web', router);
  });

  afterEach(() => {
    delete process.env.NEUMA_WEB_ACCESS_PATH;
    if (envLock === undefined) delete process.env.NEUMA_WEB_ACCESS;
    else process.env.NEUMA_WEB_ACCESS = envLock;
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('GET reports the fresh-install default: on, unlocked, with search indexes named', async () => {
    const res = await request(app).get('/api/v1/web/web-access').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.envLocked).toBe(false);
    expect(res.body.searchBackend).toBe('duckduckgo');
    expect(res.body.pageReader).toBe('direct');
  });

  test('PUT persists explicit OFF and ON choices on real disk', async () => {
    const off = await request(app).put('/api/v1/web/web-access').set(witness.header).send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.enabled).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'web-access.json'), 'utf8')).enabled).toBe(false);
    const on = await request(app).put('/api/v1/web/web-access').set(witness.header).send({ enabled: true });
    expect(on.body.enabled).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'web-access.json'), 'utf8')).enabled).toBe(true);
  });

  test('PUT with a non-boolean is a 400, and the fresh default never moved', async () => {
    const res = await request(app).put('/api/v1/web/web-access').set(witness.header).send({ enabled: 'yes' });
    expect(res.status).toBe(400);
    const after = await request(app).get('/api/v1/web/web-access').set(witness.header);
    expect(after.body.enabled).toBe(true);
  });
});

describe('web-access routes — real auth', () => {
  test('unauthenticated is 401', async () => {
    const { default: router } = await import('../../backend/routes/web-routes.js');
    const realApp = express();
    realApp.use(express.json());
    realApp.use('/api/v1/web', router);
    const res = await request(realApp).get('/api/v1/web/web-access');
    expect(res.status).toBe(401);
  });
});
