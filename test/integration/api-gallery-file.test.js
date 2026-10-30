// THE GALLERY's file route, as an image viewer sees it.
//
// Nothing here is mocked — a real Express app, the REAL requireAuth over a REAL
// session token, a real temp folder added through the real grant endpoint, and
// real bytes on disk. That matters especially for the ?token= door: stubbing
// auth would have "proven" the query works while proving nothing about whether
// it is actually verified.
//
// What it holds down: a plain <img src> can load a tile (no header to give),
// the token is genuinely checked, the cache validators are honest in BOTH
// directions (304 when unchanged, fresh bytes when the file is overwritten),
// and none of that widened the route's reach by a single path.

import express from 'express';
import request from 'supertest';
import { promises as fs } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

const WALLET = '0x2222222222222222222222222222222222222222';

// A one-pixel PNG — real bytes with a real mime, so Content-Type is proven
// rather than assumed.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Gallery /file — the viewer contract', () => {
  let app;
  let token;
  let folder;
  let rootId;
  let filePath;

  beforeEach(async () => {
    vi.resetModules();

    folder = await createTempDir(`gallery-src-${Math.random().toString(36).slice(2)}`);
    filePath = path.join(folder, 'render.png');
    await fs.writeFile(filePath, PNG);

    // Isolate the stored root list and the built-in comfy root away from the
    // developer's real ones. Env doors on these two are read per call, not at
    // boot, so setting them here genuinely isolates the test.
    const store = await createTempDir(`gallery-roots-${Math.random().toString(36).slice(2)}`);
    process.env.NEUMA_GALLERY_ROOTS_PATH = path.join(store, 'gallery-roots.json');
    process.env.COMFYUI_DATA_DIR = await createTempDir(`gallery-comfy-${Math.random().toString(36).slice(2)}`);

    const auth = await import('../../backend/services/auth.js');
    token = auth.createSessionToken(WALLET);
    // A fresh install's first owner is seated by the owner claim, never by a first request (owner-claim.js): seated here.
    await makeInstallOwner(WALLET);

    const { default: router } = await import('../../backend/routes/gallery-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/gallery', router);

    // The grant: adding the folder is what puts it in reach.
    const added = await request(app)
      .post('/api/v1/gallery/roots')
      .set('Authorization', `Bearer ${token}`)
      .send({ dir: folder });
    expect(added.status).toBe(200);
    rootId = added.body.roots.find((r) => r.dir === folder).id;
  });

  afterEach(() => {
    delete process.env.NEUMA_GALLERY_ROOTS_PATH;
    delete process.env.COMFYUI_DATA_DIR;
    vi.restoreAllMocks();
  });

  const get = (query = {}) => request(app).get('/api/v1/gallery/file').query({ rootId, rel: 'render.png', ...query });

  test('a bare GET with ?token= serves the bytes — this is what lets <img src> work', async () => {
    // NO Authorization header, exactly like the GET a browser issues for an
    // <img>. This single behaviour is why the gallery no longer hand-fetches
    // every tile into an object URL.
    const res = await get({ token });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(Buffer.from(res.body).equals(PNG)).toBe(true);
  });

  test('without a token or a header it is still 401 — the door did not open', async () => {
    expect((await get()).status).toBe(401);
  });

  test('a forged token is refused — the query is VERIFIED, not merely present', async () => {
    expect((await get({ token: 'not-a-real-token' })).status).toBe(401);
    // A structurally valid base64 token with a wrong signature must fail too.
    const forged = Buffer.from(`${WALLET.toLowerCase()}:${Date.now() + 60000}:${'0'.repeat(64)}`).toString('base64');
    expect((await get({ token: forged })).status).toBe(401);
  });

  test('an Authorization header still works and wins over the query', async () => {
    const res = await request(app)
      .get('/api/v1/gallery/file')
      .query({ rootId, rel: 'render.png', token: 'garbage' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test('the token door is /file only — it does not unlock the rest of the gallery', async () => {
    const res = await request(app).get('/api/v1/gallery/items').query({ token });
    expect(res.status).toBe(401);
  });

  // Audit 2026-10-28 M-02: a root could be any folder, and /file streamed ANY file under it.
  test('only media is served: a text file, a .env, and a .png link to a secret are not found', async () => {
    await fs.writeFile(path.join(folder, 'notes.txt'), 'private notes');
    await fs.writeFile(path.join(folder, '.env'), 'API_KEY=never-served');
    const outside = await createTempDir(`gallery-secret-${Math.random().toString(36).slice(2)}`);
    await fs.writeFile(path.join(outside, 'id_rsa'), 'PRIVATE KEY');
    await fs.symlink(path.join(outside, 'id_rsa'), path.join(folder, 'innocent.png'));
    for (const rel of ['notes.txt', '.env', 'innocent.png']) {
      const res = await request(app).get('/api/v1/gallery/file').set('Authorization', `Bearer ${token}`).query({ rootId, rel });
      expect(res.status, rel).toBe(404);
    }
    const media = await request(app).get('/api/v1/gallery/file').set('Authorization', `Bearer ${token}`).query({ rootId, rel: 'render.png' });
    expect(media.status).toBe(200);
  });

  test('a root can never be the whole disk', async () => {
    const res = await request(app).post('/api/v1/gallery/roots').set('Authorization', `Bearer ${token}`).send({ dir: '/' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toMatch(/whole disk/);
  });

  test('bytes are storable and carry a validator', async () => {
    const res = await get({ token });
    // `no-store` was the bug: it forbade KEEPING the bytes at all, so every
    // scroll back over the grid re-pulled full-size renders. `no-cache` still
    // asks every time — it just gets to answer 304 instead of a megabyte.
    expect(res.headers['cache-control']).not.toContain('no-store');
    expect(res.headers['cache-control']).toContain('no-cache');
    expect(res.headers.etag).toBeTruthy();
    expect(res.headers['last-modified']).toBeTruthy();
  });

  test('an unchanged file answers 304 with no body', async () => {
    const first = await get({ token });
    const second = await get({ token }).set('If-None-Match', first.headers.etag);
    expect(second.status).toBe(304);
    expect(second.body).toEqual({});
  });

  test('an OVERWRITTEN file busts the old validator — caching is not a lie', async () => {
    const first = await get({ token });
    // Same path, different bytes and a later mtime: the operator re-rendered.
    const bigger = Buffer.concat([PNG, Buffer.alloc(64, 7)]);
    await fs.writeFile(filePath, bigger);
    const future = new Date(Date.now() + 2000);
    await fs.utimes(filePath, future, future);

    const second = await get({ token }).set('If-None-Match', first.headers.etag);
    expect(second.status).toBe(200);
    expect(second.headers.etag).not.toBe(first.headers.etag);
    expect(Buffer.from(second.body).length).toBe(bigger.length);
  });

  test('a conditional RANGE still gets bytes — a <video> resuming needs 206, not 304', async () => {
    const first = await get({ token });
    const res = await get({ token })
      .set('If-None-Match', first.headers.etag)
      .set('Range', 'bytes=0-3');
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-3/${PNG.length}`);
  });

  // THE WHOLE BUG, end to end. The two halves each pass on their own: the
  // limiter test proves the exemption against a stub handler, and every test
  // above proves the route against no limiter. Neither would have caught the
  // live failure, which only exists where the two are STACKED the way server.js
  // stacks them.
  test('a spent rate-limit ceiling no longer blackens the grid', async () => {
    // A low ceiling, so the test spends the minute in a handful of requests and
    // does not quietly depend on the live default staying 200. Read at module
    // load, hence set before the import — and rate-limiter is untouched by the
    // beforeEach imports, so this IS its first load in this registry.
    const prev = process.env.NEUMA_RATE_GLOBAL_MAX;
    process.env.NEUMA_RATE_GLOBAL_MAX = '5';
    let apiLimiter;
    try {
      ({ apiLimiter } = await import('../../backend/services/rate-limiter.js'));
    } finally {
      if (prev === undefined) delete process.env.NEUMA_RATE_GLOBAL_MAX;
      else process.env.NEUMA_RATE_GLOBAL_MAX = prev;
    }
    const { default: router } = await import('../../backend/routes/gallery-routes.js');

    const stacked = express();
    stacked.use(express.json());
    // ONE wallet for the whole run — the limiter keys on it, so a fresh address
    // per request would hand every call its own untouched bucket and the
    // ceiling would never be reached (this test caught exactly that mistake in
    // its own first draft).
    const wallet = `0xgrid-${Math.random().toString(36).slice(2)}`;
    stacked.use((req, res, next) => { req.walletAddress = wallet; next(); });
    stacked.use('/api', apiLimiter);
    stacked.use('/api/v1/gallery', router);

    const authed = (p) => request(stacked).get(p).set('Authorization', `Bearer ${token}`);

    // Spend the operator's minute — a busy desk, or simply a big folder.
    let refused = false;
    for (let i = 0; i < 12 && !refused; i++) {
      // eslint-disable-next-line no-await-in-loop -- a sliding window is sequential
      refused = (await authed('/api/v1/gallery/items')).status === 429;
    }
    expect(refused).toBe(true);

    // Before the fix this was the red "Too many requests" and a black tile.
    const tile = await request(stacked)
      .get('/api/v1/gallery/file')
      .query({ rootId, rel: 'render.png', token });
    expect(tile.status).toBe(200);
    expect(Buffer.from(tile.body).equals(PNG)).toBe(true);
  });

  test('the token buys no extra reach: traversal and unknown roots still 404', async () => {
    const escape = await request(app)
      .get('/api/v1/gallery/file')
      .query({ rootId, rel: '../../../etc/passwd', token });
    expect(escape.status).toBe(404);

    const unknown = await request(app)
      .get('/api/v1/gallery/file')
      .query({ rootId: 'no-such-root', rel: 'render.png', token });
    expect(unknown.status).toBe(404);
  });
});
