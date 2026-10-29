import express from 'express';
import request from 'supertest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

/**
 * Integration test for the LOOK API (Settings > LOOK). The route + the look
 * store are REAL against a temp settings file (NEUMA_LOOK_SETTINGS_PATH),
 * and auth is REAL too (RULE 0, #390 tranche 4). Proves the witness can read
 * the dress, set and clear a theme, shelve and remove presets, that
 * malformed colors are refused, and that the real gate closes on no session.
 */
const THEME = { ground: '#0A0403', panel: '#160906', ink: '#FFF3E9', trim: '#FF7A45' };

const buildApp = async () => {
  const { default: router } = await import('../../backend/routes/look-routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/look', router);
  return app;
};

describe('Look API (the platform dress)', () => {
  let app;
  let prevPath;
  let witness;

  beforeEach(async () => {
    vi.resetModules();

    prevPath = process.env.NEUMA_LOOK_SETTINGS_PATH;
    process.env.NEUMA_LOOK_SETTINGS_PATH = path.join(
      await createTempDir(`look-${Math.random().toString(36).slice(2)}`),
      'look.json',
    );

    // Imported AFTER resetModules so the witness mints its token from the
    // same auth.js instance the router will verify against. No neuma lane on
    // this route (it's a settings-only surface), so a real session that
    // claims no workspace is exactly the right shape.
    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();
    await makeInstallOwner(witness.address);

    app = await buildApp();
  });

  afterEach(() => {
    if (prevPath === undefined) delete process.env.NEUMA_LOOK_SETTINGS_PATH;
    else process.env.NEUMA_LOOK_SETTINGS_PATH = prevPath;
    vi.restoreAllMocks();
  });

  test('GET / opens on the stock dress — null theme, empty shelf', async () => {
    const res = await request(app).get('/api/v1/look').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ theme: null, presets: [] });
  });

  test('PUT /theme sets the dress and GET reads it back; null restores stock', async () => {
    const put = await request(app).put('/api/v1/look/theme').set(witness.header).send({ theme: THEME });
    expect(put.status).toBe(200);
    expect(put.body.theme).toEqual(THEME);

    const got = await request(app).get('/api/v1/look').set(witness.header);
    expect(got.body.theme).toEqual(THEME);

    const clear = await request(app).put('/api/v1/look/theme').set(witness.header).send({ theme: null });
    expect(clear.status).toBe(200);
    expect(clear.body.theme).toBeNull();
  });

  test('a theme with a HEAD round-trips; a junk head is refused (400)', async () => {
    const put = await request(app).put('/api/v1/look/theme').set(witness.header).send({ theme: { ...THEME, head: '#FFC9A3' } });
    expect(put.status).toBe(200);
    expect(put.body.theme.head).toBe('#FFC9A3');
    const bad = await request(app).put('/api/v1/look/theme').set(witness.header).send({ theme: { ...THEME, head: 'gold' } });
    expect(bad.status).toBe(400);
  });

  test('the registers round-trip through the API; junk is refused (400)', async () => {
    const put = await request(app).put('/api/v1/look/theme').set(witness.header).send({ theme: { ...THEME, alert: '#D42A5B', okay: '#3ECF8E' } });
    expect(put.status).toBe(200);
    expect(put.body.theme.alert).toBe('#D42A5B');
    const bad = await request(app).put('/api/v1/look/theme').set(witness.header).send({ theme: { ...THEME, okay: 'green' } });
    expect(bad.status).toBe(400);
  });

  test('BODY, ITAL, EMPH, LINE round-trip through the API; junk is refused (400)', async () => {
    const put = await request(app).put('/api/v1/look/theme').set(witness.header).send({
      theme: { ...THEME, body: '#E8D5C4', ital: '#C9A27A', emph: '#FFF4E8', line: '#8A7A6A' },
    });
    expect(put.status).toBe(200);
    expect(put.body.theme.body).toBe('#E8D5C4');
    expect(put.body.theme.line).toBe('#8A7A6A');
    const bad = await request(app).put('/api/v1/look/theme').set(witness.header).send({ theme: { ...THEME, ital: 'gold' } });
    expect(bad.status).toBe(400);
  });


  test('a malformed theme is refused (400), and the stored dress stands', async () => {
    await request(app).put('/api/v1/look/theme').set(witness.header).send({ theme: THEME });
    const res = await request(app).put('/api/v1/look/theme').set(witness.header).send({ theme: { ...THEME, trim: 'cyan' } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LOOK_INVALID_THEME');
    expect((await request(app).get('/api/v1/look').set(witness.header)).body.theme).toEqual(THEME);
  });

  test('presets shelve, list, and remove through the API', async () => {
    const add = await request(app).post('/api/v1/look/presets').set(witness.header).send({ name: 'Dusk Study', theme: THEME });
    expect(add.status).toBe(200);
    expect(add.body.presets).toHaveLength(1);
    const { id } = add.body.presets[0];

    const del = await request(app).delete(`/api/v1/look/presets/${id}`).set(witness.header);
    expect(del.status).toBe(200);
    expect(del.body.presets).toEqual([]);
  });

  test('a nameless preset is refused (400); an unknown id is honest (404)', async () => {
    const bad = await request(app).post('/api/v1/look/presets').set(witness.header).send({ name: '   ', theme: THEME });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('LOOK_INVALID_NAME');

    const ghost = await request(app).delete('/api/v1/look/presets/ghost').set(witness.header);
    expect(ghost.status).toBe(404);
    expect(ghost.body.code).toBe('LOOK_UNKNOWN_PRESET');
  });

  test('with no session the door is closed to the unauthenticated (401)', async () => {
    expect((await request(app).get('/api/v1/look')).status).toBe(401);
    expect((await request(app).put('/api/v1/look/theme').send({ theme: THEME })).status).toBe(401);
  });
});
