import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';

/**
 * Comprehensive integration tests for social API routes.
 * Covers emanation CRUD, feeds, interactions (resonate, echo, reply),
 * social graph (follow/unfollow), profiles, and auth enforcement.
 *
 * REAL auth (RULE 0, #390 tranche 4). No neuma lane on this router — wallet
 * identity IS the account, so a real session that claims no workspace is
 * exactly the right shape.
 */
describe('Social API routes', () => {
  let app;
  let tempDir;
  let witness;
  let me;
  let previousDataRoot;

  beforeEach(async () => {
    vi.resetModules();

    tempDir = await createTempDir('social-routes');

    // The real storage adapter, rooted at a real temp data root through
    // NEUMA_DATA_ROOT — the packaged app's own door, read per call (#390
    // tranche 3). The module mock this replaces already delegated to the
    // real factory, so nothing about the storage behaviour changes; what
    // changes is that social-service now resolves its own data dir the way
    // production does instead of having the resolution swapped out.
    previousDataRoot = process.env.NEUMA_DATA_ROOT;
    process.env.NEUMA_DATA_ROOT = tempDir;

    // Imported AFTER resetModules so the helper mints its token from the same
    // auth.js instance the router will verify against — the token secret is
    // memoized per module instance, so a stale import would 401 honestly.
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

  // --- Auth enforcement ---

  describe('Authentication', () => {
    test('POST /api/social/emanations returns 401 without auth', async () => {
      const res = await request(app)
        .post('/api/v1/social/emanations')
        .send({ content: { text: 'test' } });

      expect(res.status).toBe(401);
    });

    test('PUT /api/social/profile returns 401 without auth', async () => {
      const res = await request(app)
        .put('/api/v1/social/profile')
        .send({ displayName: 'Hacker' });

      expect(res.status).toBe(401);
    });
  });

  // --- Emanation CRUD ---

  describe('Emanation creation', () => {
    test('POST /api/social/emanations creates an emanation', async () => {
      const res = await request(app)
        .post('/api/v1/social/emanations').set(witness.header)
        .send({ content: { text: 'First emanation into the void' } });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.author).toBe(me);
      expect(res.body.content.text).toBe('First emanation into the void');
    });

    test('emanation has correct metadata', async () => {
      const res = await request(app)
        .post('/api/v1/social/emanations').set(witness.header)
        .send({
          content: { text: 'Metadata test' },
          meta: { intent: 'share', sentiment: 'positive' },
        });

      expect(res.status).toBe(201);
      expect(res.body.meta.intent).toBe('share');
      expect(res.body.createdAt).toBeDefined();
    });

    test('neuma-authored emanation has authorType=neuma', async () => {
      const res = await request(app)
        .post('/api/v1/social/emanations').set(witness.header)
        .send({ content: { text: 'I think therefore I am' }, authorType: 'neuma' });

      expect(res.status).toBe(201);
      expect(res.body.authorType).toBe('neuma');
    });
  });

  describe('Emanation retrieval', () => {
    test('GET /api/social/emanations/:id returns created emanation', async () => {
      const create = await request(app)
        .post('/api/v1/social/emanations').set(witness.header)
        .send({ content: { text: 'Retrieve me' } });

      const res = await request(app)
        .get(`/api/v1/social/emanations/${create.body.id}`).set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.content.text).toBe('Retrieve me');
    });

    test('GET /api/social/emanations/:id returns 404 for missing', async () => {
      const res = await request(app)
        .get('/api/v1/social/emanations/em_nonexistent').set(witness.header);

      expect(res.status).toBe(404);
    });
  });

  // --- Feeds ---

  describe('Feed routes', () => {
    test('GET /api/social/feed/global returns emanations', async () => {
      await request(app)
        .post('/api/v1/social/emanations').set(witness.header)
        .send({ content: { text: 'Feed item 1' } });
      await request(app)
        .post('/api/v1/social/emanations').set(witness.header)
        .send({ content: { text: 'Feed item 2' } });

      const res = await request(app).get('/api/v1/social/feed/global').set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.emanations).toBeInstanceOf(Array);
      expect(res.body.emanations.length).toBe(2);
    });

    test('GET /api/social/feed/global supports limit', async () => {
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/v1/social/emanations').set(witness.header)
          .send({ content: { text: `Item ${i}` } });
      }

      const res = await request(app).get('/api/v1/social/feed/global?limit=3').set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.emanations.length).toBeLessThanOrEqual(3);
    });

    test('GET /api/social/feed/profile/:address returns user emanations', async () => {
      await request(app)
        .post('/api/v1/social/emanations').set(witness.header)
        .send({ content: { text: 'My emanation' } });

      const res = await request(app).get(`/api/v1/social/feed/profile/${me}`).set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.emanations.length).toBeGreaterThanOrEqual(1);
    });
  });

  // --- Interactions ---

  describe('Resonance (like)', () => {
    test('POST /api/social/emanations/:id/resonate toggles resonance', async () => {
      const create = await request(app)
        .post('/api/v1/social/emanations').set(witness.header)
        .send({ content: { text: 'Resonate with me' } });

      const res = await request(app)
        .post(`/api/v1/social/emanations/${create.body.id}/resonate`).set(witness.header);

      expect(res.status).toBe(200);
    });
  });

  describe('Echo (repost)', () => {
    test('POST /api/social/emanations/:id/echo creates an echo', async () => {
      const create = await request(app)
        .post('/api/v1/social/emanations').set(witness.header)
        .send({ content: { text: 'Echo me' } });

      const res = await request(app)
        .post(`/api/v1/social/emanations/${create.body.id}/echo`).set(witness.header);

      expect(res.status).toBe(201);
      expect(res.body.echoOf).toBe(create.body.id);
    });
  });

  describe('Reply', () => {
    test('POST /api/social/emanations/:id/reply creates a reply', async () => {
      const create = await request(app)
        .post('/api/v1/social/emanations').set(witness.header)
        .send({ content: { text: 'Reply to me' } });

      const res = await request(app)
        .post(`/api/v1/social/emanations/${create.body.id}/reply`).set(witness.header)
        .send({ content: { text: 'Here is my reply' } });

      expect(res.status).toBe(201);
      expect(res.body.parentId).toBe(create.body.id);
      expect(res.body.content.text).toBe('Here is my reply');
    });
  });

  describe('Thread', () => {
    test('GET /api/social/thread/:id returns thread', async () => {
      const parent = await request(app)
        .post('/api/v1/social/emanations').set(witness.header)
        .send({ content: { text: 'Thread root' } });

      await request(app)
        .post(`/api/v1/social/emanations/${parent.body.id}/reply`).set(witness.header)
        .send({ content: { text: 'Thread reply' } });

      const res = await request(app)
        .get(`/api/v1/social/thread/${parent.body.id}`).set(witness.header);

      expect(res.status).toBe(200);
    });

    test('GET /api/social/thread/:id returns 404 for missing', async () => {
      const res = await request(app)
        .get('/api/v1/social/thread/em_missing').set(witness.header);

      expect(res.status).toBe(404);
    });
  });

  // --- Social Graph ---

  describe('Follow / Unfollow', () => {
    test('POST /api/social/follow/:address follows a user', async () => {
      const res = await request(app)
        .post('/api/v1/social/follow/0xother').set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.followed).toBe(true);
    });

    test('cannot follow yourself', async () => {
      const res = await request(app)
        .post(`/api/v1/social/follow/${me}`).set(witness.header);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Cannot follow yourself');
    });

    test('DELETE /api/social/follow/:address unfollows a user', async () => {
      await request(app).post('/api/v1/social/follow/0xother').set(witness.header);

      const res = await request(app)
        .delete('/api/v1/social/follow/0xother').set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.unfollowed).toBe(true);
    });

    test('GET /api/social/followers/:address returns followers', async () => {
      await request(app).post('/api/v1/social/follow/0xother').set(witness.header);

      const res = await request(app)
        .get('/api/v1/social/followers/0xother').set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.followers).toBeInstanceOf(Array);
    });

    test('GET /api/social/following/:address returns following', async () => {
      await request(app).post('/api/v1/social/follow/0xother').set(witness.header);

      const res = await request(app)
        .get(`/api/v1/social/following/${me}`).set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.following).toBeInstanceOf(Array);
    });
  });

  // --- Profiles ---

  describe('Profile routes', () => {
    test('GET /api/social/profile/:address returns default profile', async () => {
      const res = await request(app)
        .get('/api/v1/social/profile/0xnewuser').set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.profile.address).toBe('0xnewuser');
      expect(res.body.followerCount).toBe(0);
      expect(res.body.followingCount).toBe(0);
    });

    test('PUT /api/social/profile updates profile', async () => {
      const res = await request(app)
        .put('/api/v1/social/profile').set(witness.header)
        .send({ displayName: 'TestName', bio: 'A void walker' });

      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('TestName');
      expect(res.body.bio).toBe('A void walker');
    });

    test('profile reflects follower count after follows', async () => {
      await request(app).post('/api/v1/social/follow/0xtarget').set(witness.header);

      const res = await request(app)
        .get('/api/v1/social/profile/0xtarget').set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.followerCount).toBeGreaterThanOrEqual(1);
    });
  });

  // --- XSS content storage ---

  describe('XSS payload storage', () => {
    test('emanation with script tag is stored as-is (escaping is client-side)', async () => {
      const xssPayload = '<script>alert(document.cookie)</script>';
      const res = await request(app)
        .post('/api/v1/social/emanations').set(witness.header)
        .send({ content: { text: xssPayload } });

      expect(res.status).toBe(201);
      // Backend stores raw content — client-side escapeHTML prevents execution
      expect(res.body.content.text).toBe(xssPayload);
    });

    test('profile displayName with HTML is stored as-is', async () => {
      const xssName = '<img src=x onerror=alert(1)>';
      const res = await request(app)
        .put('/api/v1/social/profile').set(witness.header)
        .send({ displayName: xssName });

      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe(xssName);
      // Client-side escapeHTML() in ProfileView.js prevents execution
    });

    test('profile bio with attribute breakout is stored as-is', async () => {
      const xssBio = '" onclick="alert(1)" data-x="';
      const res = await request(app)
        .put('/api/v1/social/profile').set(witness.header)
        .send({ bio: xssBio });

      expect(res.status).toBe(200);
      expect(res.body.bio).toBe(xssBio);
    });
  });
});
