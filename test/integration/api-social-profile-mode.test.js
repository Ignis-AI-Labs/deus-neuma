import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';

/**
 * Integration tests for account setup flow — mode field in social profile.
 * Verifies that PUT /api/social/profile accepts and validates the `mode` field,
 * and GET /api/social/profile/:address returns it.
 *
 * REAL auth (RULE 0, #390 tranche 4) — no neuma lane on this router, so a
 * real session that claims no workspace is exactly the right shape.
 */
describe('Social profile — mode field (account setup flow)', () => {
  let app;
  let tempDir;
  let witness;
  let me;
  let previousDataRoot;

  beforeEach(async () => {
    vi.resetModules();

    tempDir = await createTempDir('social-mode');

    // The real storage adapter, rooted at a real temp data root through
    // NEUMA_DATA_ROOT — the packaged app's own door, read per call (#390
    // tranche 3). The module mock this replaces already delegated to the
    // real factory, so nothing about the storage behaviour changes; what
    // changes is that social-service now resolves its own data dir the way
    // production does instead of having the resolution swapped out.
    previousDataRoot = process.env.NEUMA_DATA_ROOT;
    process.env.NEUMA_DATA_ROOT = tempDir;

    // Imported AFTER resetModules — see api-social-routes.test.js for why:
    // the token secret is memoized per auth.js module instance.
    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();
    me = witness.address.toLowerCase(); // requireAuth hands back the lowercased address

    const { default: socialRouter } = await import('../../backend/routes/social-routes.js');

    app = express();
    app.use(express.json());
    app.use('/api/v1/social', socialRouter);
  });

  afterEach(() => {
    if (previousDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = previousDataRoot;
    vi.restoreAllMocks();
  });

  test('PUT /api/social/profile accepts mode=social', async () => {
    const res = await request(app)
      .put('/api/v1/social/profile').set(witness.header)
      .send({ displayName: 'TestUser', mode: 'social' });

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('social');
    expect(res.body.displayName).toBe('TestUser');
  });

  test('PUT /api/social/profile accepts mode=marketplace', async () => {
    const res = await request(app)
      .put('/api/v1/social/profile').set(witness.header)
      .send({ displayName: 'MarketUser', mode: 'marketplace' });

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('marketplace');
  });

  test('PUT /api/social/profile ignores invalid mode values', async () => {
    const res = await request(app)
      .put('/api/v1/social/profile').set(witness.header)
      .send({ displayName: 'Hacker', mode: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('Hacker');
    expect(res.body.mode).toBeUndefined();
  });

  test('PUT /api/social/profile ignores mode when not a string', async () => {
    const res = await request(app)
      .put('/api/v1/social/profile').set(witness.header)
      .send({ displayName: 'Test', mode: { inject: true } });

    expect(res.status).toBe(200);
    expect(res.body.mode).toBeUndefined();
  });

  test('PUT /api/social/profile works without mode field', async () => {
    const res = await request(app)
      .put('/api/v1/social/profile').set(witness.header)
      .send({ displayName: 'NoMode' });

    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('NoMode');
  });

  test('GET /api/social/profile/:address returns stored mode', async () => {
    // Set mode
    await request(app)
      .put('/api/v1/social/profile').set(witness.header)
      .send({ displayName: 'Persisted', mode: 'marketplace' });

    // Retrieve it
    const res = await request(app)
      .get(`/api/v1/social/profile/${me}`).set(witness.header);

    expect(res.status).toBe(200);
    expect(res.body.profile.mode).toBe('marketplace');
    expect(res.body.profile.displayName).toBe('Persisted');
  });

  test('mode persists across updates without being overwritten', async () => {
    // Set mode first
    await request(app)
      .put('/api/v1/social/profile').set(witness.header)
      .send({ mode: 'social' });

    // Update bio without mode
    await request(app)
      .put('/api/v1/social/profile').set(witness.header)
      .send({ bio: 'I am a neuma' });

    // Mode should still be there
    const res = await request(app)
      .get(`/api/v1/social/profile/${me}`).set(witness.header);

    expect(res.body.profile.mode).toBe('social');
    expect(res.body.profile.bio).toBe('I am a neuma');
  });

  test('mode can be changed from social to marketplace', async () => {
    await request(app)
      .put('/api/v1/social/profile').set(witness.header)
      .send({ mode: 'social' });

    await request(app)
      .put('/api/v1/social/profile').set(witness.header)
      .send({ mode: 'marketplace' });

    const res = await request(app)
      .get(`/api/v1/social/profile/${me}`).set(witness.header);

    expect(res.body.profile.mode).toBe('marketplace');
  });
});
