import express from 'express';
import request from 'supertest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

/**
 * Integration test for the operator-name API (under the user realm) — the
 * synced name every portal turn reads so beings address the operator by name.
 * The route + the name store + the realm are REAL (a temp realm root), and
 * auth is REAL (RULE 0): a stranger witness mints a real session token the
 * router verifies. Proves unset reads empty, set→get round-trips the cleaned
 * name, an empty name clears, a non-string is refused, and no token is no
 * door.
 */

describe('Operator name API (user realm)', () => {
  let app;
  let witness;

  beforeEach(async () => {
    vi.resetModules();

    // The REAL settings module aimed at a throwaway file — the module's own
    // isolation door (api-preset.test.js precedent).
    process.env.NEUMA_REALM_SETTINGS_PATH = path.join(
      await createTempDir('realm-settings'), 'user-realm.json');

    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();

    const realm = await import('../../backend/services/user-realm.js');
    realm.setRealmRoot(await createTempDir(`realm-${Math.random().toString(36).slice(2)}`));

    const { default: router } = await import('../../backend/routes/user-realm-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/user/realm', router);
  });

  test('GET with no stored name answers empty, never 404', async () => {
    const res = await request(app).get('/api/v1/user/realm/operator-name').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('');
  });

  test('PUT then GET round-trips the cleaned name', async () => {
    const put = await request(app).put('/api/v1/user/realm/operator-name').set(witness.header).send({ name: '  Founder ' });
    expect(put.status).toBe(200);
    expect(put.body.name).toBe('Founder');
    const got = await request(app).get('/api/v1/user/realm/operator-name').set(witness.header);
    expect(got.body.name).toBe('Founder');
  });

  test('an empty name clears the record', async () => {
    await request(app).put('/api/v1/user/realm/operator-name').set(witness.header).send({ name: 'Founder' });
    const cleared = await request(app).put('/api/v1/user/realm/operator-name').set(witness.header).send({ name: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.name).toBe('');
    const got = await request(app).get('/api/v1/user/realm/operator-name').set(witness.header);
    expect(got.body.name).toBe('');
  });

  test('a non-string name is refused with a 400', async () => {
    const res = await request(app).put('/api/v1/user/realm/operator-name').set(witness.header).send({ name: 42 });
    expect(res.status).toBe(400);
  });

  test('no token, no door', async () => {
    const res = await request(app).get('/api/v1/user/realm/operator-name');
    expect(res.status).toBe(401);
  });
});
