import express from 'express';
import request from 'supertest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

/**
 * Integration test for the chat-labels API (under the user realm). The route +
 * the label store + the realm are REAL (a temp realm root) with a real witness
 * session (RULE 0, #390 tranche 4); only the realm-settings write is stubbed.
 * Proves the witness can name a chat and read it back, that an empty label
 * clears it, and that a bad id is refused.
 */
const N = '33a55c6177edd1eb7b7106c6f786a7ef';
const S = 'session-1718000000000';
const KEY = `${N}:${S}`;

describe('Chat labels API (user realm)', () => {
  let app, witness;

  beforeEach(async () => {
    vi.resetModules();

    // The REAL settings module, aimed at a real throwaway file (#390 tranche
    // 3). NEUMA_REALM_SETTINGS_PATH is the module's own isolation door — and
    // setting it also lifts the live-file temp-root refusal that exists to
    // stop a scratch path being persisted as the witness's realm, so the
    // guarded persist path is exercised rather than stubbed away.
    process.env.NEUMA_REALM_SETTINGS_PATH = path.join(
      await createTempDir('realm-settings'), 'user-realm.json');

    const realm = await import('../../backend/services/user-realm.js');
    realm.setRealmRoot(await createTempDir(`realm-${Math.random().toString(36).slice(2)}`));

    // Imported AFTER resetModules so the witness mints its token from the
    // same auth.js instance the router will verify against.
    const { strangerWitness } = await import('../helpers/witness.js');
    // The realm is the witness's own ground — a real session that claims no
    // neuma workspace is exactly the right shape.
    witness = strangerWitness();

    const { default: router } = await import('../../backend/routes/user-realm-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/user/realm', router);
  });

  afterEach(() => vi.restoreAllMocks());

  const put = (body) => request(app).put('/api/v1/user/realm/chat-labels').set(witness.header).send(body);

  test('PUT then GET round-trips a custom chat name', async () => {
    const res = await put({ neumaId: N, sessionId: S, label: 'Birth planning' });
    expect(res.status).toBe(200);
    expect(res.body.labels[KEY]).toBe('Birth planning');

    const got = await request(app).get('/api/v1/user/realm/chat-labels').set(witness.header);
    expect(got.status).toBe(200);
    expect(got.body.labels[KEY]).toBe('Birth planning');
  });

  test('an empty label clears the name', async () => {
    await put({ neumaId: N, sessionId: S, label: 'temp' });
    const cleared = await put({ neumaId: N, sessionId: S, label: '' });
    expect(cleared.body.labels[KEY]).toBeUndefined();
  });

  test('an invalid id is refused (400)', async () => {
    const res = await put({ neumaId: '../evil', sessionId: S, label: 'y' });
    expect(res.status).toBe(400);
  });
});
