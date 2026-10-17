import express from 'express';
import request from 'supertest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

/**
 * Lead routes — the ledger's REST window, end to end against the REAL store
 * and REAL auth (RULE 0, #390 tranche 4) on real temp disk. No mock stands
 * in for the caller's session — a real wallet with a real HMAC token proves
 * every request, and a genuine 401 comes from sending none.
 */
describe('Lead routes (/api/v1/leads)', () => {
  let app;
  let tempDir;
  let witness;
  let savedPath;
  let savedRealm;

  const buildApp = async () => {
    const { default: router } = await import('../../backend/routes/lead-routes.js');
    const a = express();
    a.use(express.json());
    a.use('/api/v1/leads', router);
    return a;
  };

  beforeEach(async () => {
    vi.resetModules();

    savedPath = process.env.NEUMA_LEAD_LEDGER_PATH;
    tempDir = await createTempDir(`lead-routes-${Math.random().toString(36).slice(2)}`);
    process.env.NEUMA_LEAD_LEDGER_PATH = path.join(tempDir, 'leads.json');
    // Every house lands in tmp: read at import by the freshly reset user-realm.
    savedRealm = process.env.NEUMA_REALM_ROOT;
    process.env.NEUMA_REALM_ROOT = path.join(tempDir, 'realm');

    // Imported AFTER resetModules so the helper mints its token from the same
    // auth.js instance the router will verify against — the token secret is
    // memoized per module instance, so a stale import would 401 honestly.
    const { strangerWitness } = await import('../helpers/witness.js');
    // No neuma lane on this router — the caller wallet is just the
    // attributing actor for captures/touches.
    witness = strangerWitness();

    app = await buildApp();
  });

  afterEach(() => {
    if (savedPath === undefined) delete process.env.NEUMA_LEAD_LEDGER_PATH;
    else process.env.NEUMA_LEAD_LEDGER_PATH = savedPath;
    if (savedRealm === undefined) delete process.env.NEUMA_REALM_ROOT;
    else process.env.NEUMA_REALM_ROOT = savedRealm;
    vi.restoreAllMocks();
  });

  test('capture → board → touch → remove: the whole walk under the caller wallet', async () => {
    const captured = await request(app).post('/api/v1/leads').set(witness.header).send({
      name: 'Ada Artisan', contact: '@ada', channelId: 'x', source: 'replied to the porch thread',
    });
    expect(captured.status).toBe(201);
    expect(captured.body.lead).toMatchObject({
      name: 'Ada Artisan', channelId: 'x', status: 'cold',
    });
    expect(captured.body.lead.touches[0].by).toBe(witness.address.toLowerCase());

    const board = await request(app).get('/api/v1/leads').set(witness.header);
    expect(board.status).toBe(200);
    expect(board.body.leads).toHaveLength(1);
    expect(board.body.board.cold).toHaveLength(1);
    expect(board.body.board.won).toEqual([]); // honest zeros
    expect(board.body.statuses).toContain('qualified');

    const touched = await request(app).put(`/api/v1/leads/${captured.body.lead.id}`).set(witness.header).send({
      status: 'contacted', note: 'first DM sent', ownerNeumaId: 'keir',
    });
    expect(touched.status).toBe(200);
    expect(touched.body.lead.status).toBe('contacted');
    expect(touched.body.lead.ownerNeumaId).toBe('keir');
    expect(touched.body.lead.touches).toHaveLength(2);
    expect(touched.body.lead.touches[1]).toMatchObject({ by: witness.address.toLowerCase(), note: 'first DM sent' });

    const removed = await request(app).delete(`/api/v1/leads/${captured.body.lead.id}`).set(witness.header);
    expect(removed.status).toBe(200);
    expect((await request(app).get('/api/v1/leads').set(witness.header)).body.leads).toEqual([]);
  });

  test('bad captures and bad touches are refused at the door', async () => {
    expect((await request(app).post('/api/v1/leads').set(witness.header).send({})).status).toBe(400);
    expect((await request(app).post('/api/v1/leads').set(witness.header).send({ name: 'A', channelId: 'myspace' })).status).toBe(400);

    const ok = await request(app).post('/api/v1/leads').set(witness.header).send({ name: 'Ada' });
    const badStatus = await request(app).put(`/api/v1/leads/${ok.body.lead.id}`).set(witness.header).send({ status: 'maybe' });
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toContain('Unknown status');

    expect((await request(app).put('/api/v1/leads/ghost').set(witness.header).send({ note: 'x' })).status).toBe(404);
    expect((await request(app).delete('/api/v1/leads/ghost').set(witness.header)).status).toBe(404);
  });

  test('a corrupt store is our fault, not the caller\'s — capture answers 500, never 400', async () => {
    const { default: fs } = await import('fs/promises');
    const ledger = path.join(process.env.NEUMA_REALM_ROOT, witness.address.toLowerCase(), 'offices', 'marketing', 'lead-ledger.json');
    await fs.mkdir(path.dirname(ledger), { recursive: true });
    await fs.writeFile(ledger, '{"not":"an array"}');
    const res = await request(app).post('/api/v1/leads').set(witness.header).send({ name: 'Ada' });
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Failed to capture');
  });

  test('without a Bearer token the real auth answers 401 on every route', async () => {
    // No mock stands between `app` and the real requireAuth now — sending no
    // Authorization header IS the real refusal.
    for (const [method, url] of [
      ['get', '/api/v1/leads'],
      ['post', '/api/v1/leads'],
      ['put', '/api/v1/leads/some-id'],
      ['delete', '/api/v1/leads/some-id'],
    ]) {
      const res = await request(app)[method](url);
      expect(res.status).toBe(401);
    }
  });
});
