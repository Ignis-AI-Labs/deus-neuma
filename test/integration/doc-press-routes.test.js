import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

/**
 * Doc-press routes — THE PRESS's witness surface, end to end: a REAL brand
 * kit on real temp disk pressed through the REAL Chromium print pipeline to
 * real PDF bytes over HTTP, under REAL auth (RULE 0, #390 tranche 4). No
 * mock stands in for the caller's session — a real wallet with a real HMAC
 * token proves every request, and a genuine 401 comes from sending none.
 */

const TINY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>';

const binaryBody = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Doc-press routes (/api/v1/doc-press)', () => {
  let app;
  let tempDir;
  let witness;
  const savedEnv = {};
  const ENV = ['NEUMA_BRAND_KITS_DIR', 'NEUMA_CHROMIUM_PATH'];

  const buildApp = async () => {
    const { default: router } = await import('../../backend/routes/doc-press-routes.js');
    const a = express();
    a.use('/api/v1/doc-press', router);
    return a;
  };

  beforeEach(async () => {
    vi.resetModules();

    for (const k of ENV) { savedEnv[k] = process.env[k]; delete process.env[k]; }
    tempDir = await createTempDir(`doc-press-routes-${Math.random().toString(36).slice(2)}`);
    process.env.NEUMA_BRAND_KITS_DIR = path.join(tempDir, 'kits');
    const kitDir = path.join(tempDir, 'kits', 'acme');
    await fs.mkdir(kitDir, { recursive: true });
    await fs.writeFile(path.join(kitDir, 'kit.json'), JSON.stringify({
      name: 'Acme Kit', companyName: 'Acme Corp', logos: { primary: 'logo.svg' },
    }));
    await fs.writeFile(path.join(kitDir, 'logo.svg'), TINY_SVG);

    // Imported AFTER resetModules so the helper mints its token from the same
    // auth.js instance the router will verify against — the token secret is
    // memoized per module instance, so a stale import would 401 honestly.
    const { strangerWitness } = await import('../helpers/witness.js');
    // No neuma lane on this router — the caller wallet is just the
    // attributing actor for the press log.
    witness = strangerWitness();

    app = await buildApp();
  });

  afterEach(() => {
    for (const k of ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    vi.restoreAllMocks();
  });

  test('GET / lists the real kits and reports Chromium readiness', async () => {
    const res = await request(app).get('/api/v1/doc-press').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.kits).toEqual([{ id: 'acme', name: 'Acme Kit', companyName: 'Acme Corp' }]);
    expect(res.body.chromium.available).toBe(true); // this box has Chromium
  });

  test('POST /press refuses a body without markdown', async () => {
    const res = await request(app).post('/api/v1/doc-press/press').set(witness.header).send({ title: 'no source' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/markdown/);
  });

  test('POST /press with an unknown kit answers 400 with the real choices', async () => {
    const res = await request(app).post('/api/v1/doc-press/press').set(witness.header)
      .send({ markdown: '# X', kitId: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.kits).toEqual(['acme']);
  });

  test('POST /press presses real markdown through real Chromium to real PDF bytes', async () => {
    const res = await request(app).post('/api/v1/doc-press/press').set(witness.header)
      .send({ markdown: '# Pressed over HTTP\n\nWith a [link](https://kenorie.ai).', title: 'Route Proof', kitId: 'acme' })
      .buffer(true).parse(binaryBody);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="route-proof.pdf"');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.body.length).toBeGreaterThan(5_000);
  }, 60_000);

  test('without a Bearer token the real auth answers 401 on every route', async () => {
    // No mock stands between `app` and the real requireAuth now — sending no
    // Authorization header IS the real refusal.
    for (const probe of [
      request(app).get('/api/v1/doc-press'),
      request(app).post('/api/v1/doc-press/press').send({ markdown: '# X' }),
    ]) {
      const res = await probe;
      expect(res.status).toBe(401);
    }
  });
});
