import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

/**
 * Integration test for project channels at the wire (user-projects routes).
 * REAL: express app, routes, project store on a temp realm, real folder
 * stat checks. Stubbed per repo convention: auth passthrough (auth is not
 * the claimed behavior) and saveFileSettings (its write targets the
 * operator's live data/settings/user-files.json — protecting live settings,
 * the same door api-chat-labels uses for realm settings; the roots side
 * effect is not the claimed path here).
 */

const NEUMA = 'lifovan-2';

describe('Project channels API', () => {
  let app, ground, witness;

  const post = (body) => request(app).post('/api/v1/user/projects').set(witness.header).send(body);

  beforeEach(async () => {
    vi.resetModules();

    // Imported AFTER resetModules — the token must be minted from the same
    // auth.js instance the router will verify against (memoized HMAC secret
    // per module instance; a stale import 401s honestly).
    // No neuma lane on this router; a real session that claims no workspace
    // is exactly the right shape for the witness's own project list.
    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();
    // The REAL settings module, aimed at a real throwaway file (#390 tranche
    // 3). NEUMA_FILES_SETTINGS_PATH is the module's own isolation door and is
    // read per call, so the persist path runs for real and the operator's
    // live data/settings/user-files.json is never touched.
    process.env.NEUMA_FILES_SETTINGS_PATH = path.join(
      await createTempDir('files-settings'), 'user-files.json');

    ground = await createTempDir(`proj-ground-${Math.random().toString(36).slice(2)}`);
    const realm = await import('../../backend/services/user-realm.js');
    realm.setRealmRoot(await createTempDir(`realm-${Math.random().toString(36).slice(2)}`));

    const { default: router } = await import('../../backend/routes/user-projects-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/user/projects', router);
  });

  afterEach(() => vi.restoreAllMocks());

  test('a neuma project is created with its being, and GET returns the channel fields', async () => {
    const res = await post({ name: 'Lifovan Ground', folder: ground, channel: 'neuma', neumaId: NEUMA });
    expect(res.status).toBe(200);
    expect(res.body.project).toMatchObject({ channel: 'neuma', neumaId: NEUMA });

    const got = await request(app).get('/api/v1/user/projects').set(witness.header);
    expect(got.body.projects[0]).toMatchObject({ channel: 'neuma', neumaId: NEUMA });
  });

  test('a neuma project without its being is refused (400)', async () => {
    const res = await post({ name: 'Orphan', folder: ground, channel: 'neuma' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requires the being/);
  });

  test('an invalid channel or neumaId is refused (400)', async () => {
    expect((await post({ name: 'X', folder: ground, channel: 'void' })).status).toBe(400);
    expect((await post({ name: 'X', folder: ground, channel: 'neuma', neumaId: '../evil' })).status).toBe(400);
  });

  test('a house project is created without a being', async () => {
    const res = await post({ name: 'House Ground', folder: ground, channel: 'house' });
    expect(res.status).toBe(200);
    expect(res.body.project).toMatchObject({ channel: 'house', neumaId: null });
  });

  test('a legacy channelless project on disk reads as HOUSE', async () => {
    const realm = await import('../../backend/services/user-realm.js');
    const file = path.join(realm.walletDir(witness.address), 'projects.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({
      activeProjectId: null,
      projects: [{ id: 'p1', name: 'Legacy', folder: ground, createdAt: '2026-01-01T00:00:00Z', pinnedChats: [], sharedFiles: [] }],
    }));

    const got = await request(app).get('/api/v1/user/projects').set(witness.header);
    expect(got.body.projects[0]).toMatchObject({ id: 'p1', channel: 'house', neumaId: null });
  });
});
