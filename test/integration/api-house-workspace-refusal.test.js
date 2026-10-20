import express from 'express';
import request from 'supertest';
import path from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { createTempDir } from '../helpers/temp-fs.js';

/**
 * PUT /user/realm/house-workspace — a refused ground answers with its OWN
 * words and a 400, never a generic 500. The route, the ground service, the
 * realm and auth are all real (a temp realm, a real session token); a second
 * house on the same install is recorded through the real setter.
 */

describe('House workspace API — a refusal says why', () => {
  let app;
  let witness;
  let world;
  let setHouseWorkspace;

  beforeEach(async () => {
    vi.resetModules();
    process.env.NEUMA_REALM_SETTINGS_PATH = path.join(await createTempDir('realm-settings'), 'user-realm.json');
    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();
    world = await createTempDir('house-ws-refusal');
    const realm = await import('../../backend/services/user-realm.js');
    realm.setRealmRoot(path.join(world, 'realm'));
    ({ setHouseWorkspace } = await import('../../backend/services/house-workspace.js'));
    const { default: router } = await import('../../backend/routes/user-realm-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/user/realm', router);
  });

  const put = (root) => request(app).put('/api/v1/user/realm/house-workspace').set(witness.header).send({ root });

  test('a being\'s lane is refused with a 400 naming the lane law', async () => {
    const lane = path.join(world, 'some-lane');
    mkdirSync(lane, { recursive: true });
    writeFileSync(path.join(lane, 'owner.json'), JSON.stringify({ wallet: witness.address }));
    const res = await put(lane);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('can never overwrite a lane');
  });

  test('another house\'s ground on this install is refused with a 400 saying so', async () => {
    const other = await setHouseWorkspace('0x' + 'c3'.repeat(20), path.join(world, 'other-house'));
    const res = await put(path.join(other.root, 'repos'));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('another house');
  });

  test('a clear root still sets', async () => {
    const res = await put(path.join(world, 'my-house'));
    expect(res.status).toBe(200);
    expect(res.body.root).toBe(path.join(world, 'my-house'));
  });
});
