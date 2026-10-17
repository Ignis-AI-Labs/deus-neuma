import express from 'express';
import request from 'supertest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

/**
 * Integration test for the inference-preset API (under the user realm). The route
 * + the preset store + the realm are REAL (a temp realm root), and auth is REAL
 * too (RULE 0, #390 tranche 4) — only the realm-settings write is stubbed.
 * Proves the witness can read the modes, save a default, read it back, get the
 * default when unset, and that a bad name is refused.
 */

describe('Preset API (user realm)', () => {
  let app;
  let witness;

  beforeEach(async () => {
    vi.resetModules();

    // Still mocked (out of scope for #390 tranche 4) — a later tranche's target.
    // The REAL settings module, aimed at a real throwaway file (#390 tranche
    // 3). NEUMA_REALM_SETTINGS_PATH is the module's own isolation door — and
    // setting it also lifts the live-file temp-root refusal that exists to
    // stop a scratch path being persisted as the witness's realm, so the
    // guarded persist path is exercised rather than stubbed away.
    process.env.NEUMA_REALM_SETTINGS_PATH = path.join(
      await createTempDir('realm-settings'), 'user-realm.json');

    // Imported AFTER resetModules so the witness mints its token from the
    // same auth.js instance the router will verify against. No neuma lane on
    // this route (it's the witness's own realm), so a real session that
    // claims no workspace is exactly the right shape.
    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();

    const realm = await import('../../backend/services/user-realm.js');
    realm.setRealmRoot(await createTempDir(`realm-${Math.random().toString(36).slice(2)}`));

    const { default: router } = await import('../../backend/routes/user-realm-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/user/realm', router);
  });

  afterEach(() => vi.restoreAllMocks());

  test('GET /presets lists the modes with no raw numbers', async () => {
    const res = await request(app).get('/api/v1/user/realm/presets').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.presets.map((p) => p.name)).toEqual(['grounded', 'balanced', 'expansive']);
    expect(res.body.default).toBe('balanced');
    expect(res.body.presets[0]).not.toHaveProperty('temperature');
  });

  test('PUT then GET round-trips the default preset', async () => {
    const put = await request(app).put('/api/v1/user/realm/preset').set(witness.header).send({ preset: 'grounded' });
    expect(put.status).toBe(200);
    expect(put.body.preset).toBe('grounded');

    const got = await request(app).get('/api/v1/user/realm/preset').set(witness.header);
    expect(got.status).toBe(200);
    expect(got.body.preset).toBe('grounded');
  });

  test('no saved preset returns the default', async () => {
    const got = await request(app).get('/api/v1/user/realm/preset').set(witness.header);
    expect(got.body.preset).toBe('balanced');
  });

  test('an unknown preset is refused (400)', async () => {
    const res = await request(app).put('/api/v1/user/realm/preset').set(witness.header).send({ preset: 'wild' });
    expect(res.status).toBe(400);
  });
});
