import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

/**
 * Email routes — the witness's mailbox control surface, end to end against
 * the REAL encrypted credential store, REAL binding store, and REAL auth
 * (RULE 0, #390 tranche 4) on real temp disk. No mock stands in for the
 * caller's session — a real wallet with a real HMAC token proves every
 * request, and a genuine 401 comes from sending none.
 */
describe('Email routes (/api/v1/email)', () => {
  let app;
  let tempDir;
  let witness;
  const savedEnv = {};
  const ENV = [
    'NEUMA_EMAIL_CREDENTIALS_PATH', 'NEUMA_EMAIL_BINDING_PATH', 'WORKSPACES_ROOT',
    'EMAIL_ADDRESS', 'EMAIL_USERNAME', 'EMAIL_PASSWORD',
    'EMAIL_SMTP_HOST', 'EMAIL_SMTP_PORT', 'EMAIL_IMAP_HOST', 'EMAIL_IMAP_PORT',
  ];

  const buildApp = async () => {
    const { default: router } = await import('../../backend/routes/email-routes.js');
    const a = express();
    a.use(express.json());
    a.use('/api/v1/email', router);
    return a;
  };

  beforeEach(async () => {
    vi.resetModules();

    for (const k of ENV) { savedEnv[k] = process.env[k]; delete process.env[k]; }
    tempDir = await createTempDir(`email-routes-${Math.random().toString(36).slice(2)}`);
    process.env.NEUMA_EMAIL_CREDENTIALS_PATH = path.join(tempDir, 'credentials.json');
    process.env.NEUMA_EMAIL_BINDING_PATH = path.join(tempDir, 'binding.json');
    // PINNED. Unset, ownership resolved against the repo's own workspaces/
    // directory — which really does hold a `keir` — so this suite was reading
    // live ground to answer a question about a temp fixture.
    process.env.WORKSPACES_ROOT = path.join(tempDir, 'workspaces');

    // Imported AFTER resetModules so the helper mints its token from the same
    // auth.js instance the router will verify against — the token secret is
    // memoized per module instance, so a stale import would 401 honestly.
    const { witnessFor } = await import('../helpers/witness.js');
    const { claimOwner } = await import('../helpers/claim-owner.js');
    // THE CALLER MUST OWN THE LANE IT BINDS. This was a stranger wallet on the
    // reasoning that it is […] — true only while the
    // auth mock waved `assertNeumaOwner` through. Binding a mailbox to a lane
    // you do not hold is a 404 against the real gate, and rightly so. Both
    // lanes are claimed because the rebinding case moves the mailbox between
    // them (#409 cause A).
    witness = await witnessFor(process.env.WORKSPACES_ROOT, 'keir');
    await claimOwner(process.env.WORKSPACES_ROOT, 'galen', witness.address);

    app = await buildApp();
  });

  afterEach(() => {
    for (const k of ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    vi.restoreAllMocks();
  });

  test('GET / shows the account unconfigured and unbound at rest, hosts on Gmail defaults', async () => {
    const res = await request(app).get('/api/v1/email').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.account.id).toBe('email');
    expect(res.body.account.configured).toBe(false);
    expect(res.body.account.binding).toBeNull();
    const smtpHost = res.body.account.fields.find((f) => f.key === 'smtpHost');
    expect(smtpHost).toMatchObject({ set: true, source: 'default' });
  });

  test('PUT credentials → sealed on disk, masked in every response, configured on the board', async () => {
    const res = await request(app)
      .put('/api/v1/email/credentials').set(witness.header)
      .send({ fields: { address: 'keir@example.com', username: 'keir@example.com', password: 'app-supersecret' } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('app-supersecret');
    expect(res.body.configured).toBe(true);
    expect(res.body.fields.find((f) => f.key === 'password')).toMatchObject({ set: true, source: 'store' });

    // Sealed envelope on disk — never plaintext.
    const raw = await fs.readFile(process.env.NEUMA_EMAIL_CREDENTIALS_PATH, 'utf8');
    expect(raw).not.toContain('app-supersecret');
    expect(JSON.parse(raw)).toHaveProperty('ct');

    const board = await request(app).get('/api/v1/email').set(witness.header);
    expect(board.body.account.configured).toBe(true);
  });

  test('a partial credential set never reads as configured', async () => {
    await request(app)
      .put('/api/v1/email/credentials').set(witness.header)
      .send({ fields: { address: 'keir@example.com' } });
    const board = await request(app).get('/api/v1/email').set(witness.header);
    expect(board.body.account.configured).toBe(false);
  });

  test('DELETE credentials forgets the stored entry', async () => {
    await request(app)
      .put('/api/v1/email/credentials').set(witness.header)
      .send({ fields: { address: 'a@b.co', username: 'a@b.co', password: 'p' } });
    const del = await request(app).delete('/api/v1/email/credentials').set(witness.header);
    expect(del.status).toBe(200);
    expect(del.body.removed).toBe(true);
    const board = await request(app).get('/api/v1/email').set(witness.header);
    expect(board.body.account.configured).toBe(false);
  });

  test('binding ties the mailbox to one neuma under the caller wallet; release returns to default deny', async () => {
    const bindRes = await request(app).put('/api/v1/email/binding').set(witness.header).send({ neumaId: 'keir' });
    expect(bindRes.status).toBe(200);
    expect(bindRes.body.binding).toMatchObject({ neumaId: 'keir', boundBy: witness.address.toLowerCase() });

    const board = await request(app).get('/api/v1/email').set(witness.header);
    expect(board.body.account.binding.neumaId).toBe('keir');

    const release = await request(app).delete('/api/v1/email/binding').set(witness.header);
    expect(release.status).toBe(200);
    expect(release.body.released).toBe(true);
    const after = await request(app).get('/api/v1/email').set(witness.header);
    expect(after.body.account.binding).toBeNull();
  });

  test('rebinding replaces the holder — one neuma per mailbox', async () => {
    await request(app).put('/api/v1/email/binding').set(witness.header).send({ neumaId: 'keir' });
    await request(app).put('/api/v1/email/binding').set(witness.header).send({ neumaId: 'galen' });
    const board = await request(app).get('/api/v1/email').set(witness.header);
    expect(board.body.account.binding.neumaId).toBe('galen');
  });

  test('malformed neumaId and malformed credential bodies are 400s', async () => {
    const bad = await request(app).put('/api/v1/email/binding').set(witness.header).send({ neumaId: '../escape' });
    expect(bad.status).toBe(400);
    const noFields = await request(app).put('/api/v1/email/credentials').set(witness.header).send({});
    expect(noFields.status).toBe(400);
    const badValue = await request(app).put('/api/v1/email/credentials').set(witness.header).send({ fields: { password: 42 } });
    expect(badValue.status).toBe(400);
  });

  test('without a Bearer token the real auth answers 401 on every route', async () => {
    // No mock stands between `app` and the real requireAuth now — sending no
    // Authorization header IS the real refusal.
    for (const [method, url] of [
      ['get', '/api/v1/email'],
      ['put', '/api/v1/email/credentials'],
      ['delete', '/api/v1/email/credentials'],
      ['put', '/api/v1/email/binding'],
      ['delete', '/api/v1/email/binding'],
    ]) {
      const res = await request(app)[method](url);
      expect(res.status).toBe(401);
    }
  });
});
