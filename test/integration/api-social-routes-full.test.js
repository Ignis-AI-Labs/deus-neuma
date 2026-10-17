import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';

/**
 * Full coverage integration tests for social API routes.
 *
 * Fills gaps left by api-social-routes.test.js — exercises deeper interaction
 * scenarios: resonance toggle (on/off), echo idempotency, threaded replies,
 * profile feed filtering, follower/following lists, self-follow guard, and
 * empty profile feed edge case.
 *
 * Uses real social-storage with a temp directory to verify end-to-end data
 * flow, and REAL auth (RULE 0, #390 tranche 4) — no neuma lane on this
 * router, so a real session that claims no workspace is exactly the right
 * shape.
 */
describe('Social API routes — full coverage', () => {
  let app;
  let tempDir;
  let witness;
  let me;
  let previousDataRoot;

  beforeEach(async () => {
    vi.resetModules();

    tempDir = await createTempDir('social-full');

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

  // Helper: create an emanation and return the response body
  const createEmanation = async (text = 'Test emanation', authorType = 'human') => {
    const res = await request(app)
      .post('/api/v1/social/emanations').set(witness.header)
      .send({ content: { text }, authorType });
    expect(res.status).toBe(201);
    return res.body;
  };

  // --- Resonance (like/unlike toggle) ---

  describe('POST /emanations/:id/resonate', () => {
    test('first resonance sets resonated to true', async () => {
      const emanation = await createEmanation('Resonate with me');

      const res = await request(app)
        .post(`/api/v1/social/emanations/${emanation.id}/resonate`).set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.resonated).toBe(true);
    });

    test('second resonance toggles back to false', async () => {
      const emanation = await createEmanation('Toggle resonance');

      await request(app)
        .post(`/api/v1/social/emanations/${emanation.id}/resonate`).set(witness.header);
      const res = await request(app)
        .post(`/api/v1/social/emanations/${emanation.id}/resonate`).set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.resonated).toBe(false);
    });

    test('resonance increments stats on the emanation', async () => {
      const emanation = await createEmanation('Check stats');

      await request(app)
        .post(`/api/v1/social/emanations/${emanation.id}/resonate`).set(witness.header);

      const fetched = await request(app)
        .get(`/api/v1/social/emanations/${emanation.id}`).set(witness.header);

      expect(fetched.status).toBe(200);
      expect(fetched.body.stats.resonances).toBe(1);
    });

    test('returns 400 for nonexistent emanation', async () => {
      const res = await request(app)
        .post('/api/v1/social/emanations/em_nonexistent/resonate').set(witness.header);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not found');
    });
  });

  // --- Echo (repost) ---

  describe('POST /emanations/:id/echo', () => {
    test('creates echo referencing original', async () => {
      const emanation = await createEmanation('Echo this');

      const res = await request(app)
        .post(`/api/v1/social/emanations/${emanation.id}/echo`).set(witness.header);

      expect(res.status).toBe(201);
      expect(res.body.echoOf).toBe(emanation.id);
      expect(res.body.author).toBe(me);
    });

    test('echo increments echo count on original', async () => {
      const emanation = await createEmanation('Count my echoes');

      await request(app)
        .post(`/api/v1/social/emanations/${emanation.id}/echo`).set(witness.header);

      const fetched = await request(app)
        .get(`/api/v1/social/emanations/${emanation.id}`).set(witness.header);

      expect(fetched.body.stats.echoes).toBe(1);
    });

    test('double echo returns 400 (already echoed)', async () => {
      const emanation = await createEmanation('No double echo');

      await request(app)
        .post(`/api/v1/social/emanations/${emanation.id}/echo`).set(witness.header);
      const res = await request(app)
        .post(`/api/v1/social/emanations/${emanation.id}/echo`).set(witness.header);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Already echoed');
    });

    test('returns 400 for nonexistent emanation', async () => {
      const res = await request(app)
        .post('/api/v1/social/emanations/em_ghost/echo').set(witness.header);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not found');
    });
  });

  // --- Reply ---

  describe('POST /emanations/:id/reply', () => {
    test('creates reply linked to parent', async () => {
      const parent = await createEmanation('Reply to this');

      const res = await request(app)
        .post(`/api/v1/social/emanations/${parent.id}/reply`).set(witness.header)
        .send({ content: { text: 'My thoughtful reply' } });

      expect(res.status).toBe(201);
      expect(res.body.parentId).toBe(parent.id);
      expect(res.body.content.text).toBe('My thoughtful reply');
    });

    test('reply increments parent reply count', async () => {
      const parent = await createEmanation('Count replies');

      await request(app)
        .post(`/api/v1/social/emanations/${parent.id}/reply`).set(witness.header)
        .send({ content: { text: 'Reply one' } });
      await request(app)
        .post(`/api/v1/social/emanations/${parent.id}/reply`).set(witness.header)
        .send({ content: { text: 'Reply two' } });

      const fetched = await request(app)
        .get(`/api/v1/social/emanations/${parent.id}`).set(witness.header);

      expect(fetched.body.stats.replies).toBe(2);
    });

    test('returns 400 for nonexistent parent', async () => {
      const res = await request(app)
        .post('/api/v1/social/emanations/em_missing/reply').set(witness.header)
        .send({ content: { text: 'Reply to void' } });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not found');
    });

    test('reply with neuma authorType', async () => {
      const parent = await createEmanation('Neuma can reply');

      const res = await request(app)
        .post(`/api/v1/social/emanations/${parent.id}/reply`).set(witness.header)
        .send({ content: { text: 'I ponder this' }, authorType: 'neuma' });

      expect(res.status).toBe(201);
      expect(res.body.authorType).toBe('neuma');
    });
  });

  // --- Thread ---

  describe('GET /thread/:id', () => {
    test('returns thread with parent and replies', async () => {
      const parent = await createEmanation('Thread root');

      await request(app)
        .post(`/api/v1/social/emanations/${parent.id}/reply`).set(witness.header)
        .send({ content: { text: 'First reply' } });
      await request(app)
        .post(`/api/v1/social/emanations/${parent.id}/reply`).set(witness.header)
        .send({ content: { text: 'Second reply' } });

      const res = await request(app)
        .get(`/api/v1/social/thread/${parent.id}`).set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.parent).toBeDefined();
      expect(res.body.parent.content.text).toBe('Thread root');
      expect(res.body.replies).toBeInstanceOf(Array);
      expect(res.body.replies.length).toBe(2);
    });

    test('returns 404 for nonexistent thread', async () => {
      const res = await request(app)
        .get('/api/v1/social/thread/em_nope').set(witness.header);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Thread not found');
    });

    test('thread with no replies returns empty replies array', async () => {
      const parent = await createEmanation('Lonely thread');

      const res = await request(app)
        .get(`/api/v1/social/thread/${parent.id}`).set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.parent.id).toBe(parent.id);
      expect(res.body.replies).toEqual([]);
    });
  });

  // --- Profile Feed ---

  describe('GET /feed/profile/:address', () => {
    test('returns emanations from a specific user', async () => {
      await createEmanation('User1 emanation');

      const res = await request(app)
        .get(`/api/v1/social/feed/profile/${me}`).set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.emanations).toBeInstanceOf(Array);
      expect(res.body.emanations.length).toBeGreaterThanOrEqual(1);
      expect(res.body.emanations[0].author).toBe(me);
    });

    test('profile feed is empty for user with no emanations', async () => {
      const res = await request(app)
        .get('/api/v1/social/feed/profile/0xnobody').set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.emanations).toEqual([]);
    });

    test('profile feed only includes emanations from that address', async () => {
      // Create emanation as the witness
      await createEmanation('From user1');

      // Profile feed for a different address should be empty
      const res = await request(app)
        .get('/api/v1/social/feed/profile/0xother').set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.emanations).toEqual([]);
    });

    test('profile feed returns cursor for pagination', async () => {
      await createEmanation('Paginatable post');

      const res = await request(app)
        .get(`/api/v1/social/feed/profile/${me}`).set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.cursor).toBeDefined();
    });
  });

  // --- Social Graph: Follow / Unfollow ---

  describe('POST /follow/:address', () => {
    test('follows another user', async () => {
      const res = await request(app)
        .post('/api/v1/social/follow/0xother').set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.followed).toBe(true);
    });

    test('idempotent follow returns false on second call', async () => {
      await request(app).post('/api/v1/social/follow/0xother').set(witness.header);
      const res = await request(app).post('/api/v1/social/follow/0xother').set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.followed).toBe(false);
    });

    test('cannot follow yourself', async () => {
      const res = await request(app)
        .post(`/api/v1/social/follow/${me}`).set(witness.header);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Cannot follow yourself');
    });
  });

  describe('DELETE /follow/:address', () => {
    test('unfollows a user', async () => {
      await request(app).post('/api/v1/social/follow/0xunfollow-target').set(witness.header);

      const res = await request(app)
        .delete('/api/v1/social/follow/0xunfollow-target').set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.unfollowed).toBe(true);
    });

    test('unfollow returns 400 when not following', async () => {
      const res = await request(app)
        .delete('/api/v1/social/follow/0xnever-followed').set(witness.header);

      expect(res.status).toBe(400);
    });
  });

  describe('GET /followers/:address', () => {
    test('returns list of followers', async () => {
      // The witness follows 0xtarget
      await request(app).post('/api/v1/social/follow/0xtarget').set(witness.header);

      const res = await request(app)
        .get('/api/v1/social/followers/0xtarget').set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.followers).toBeInstanceOf(Array);
      expect(res.body.followers).toContain(me);
    });

    test('returns empty array when no followers', async () => {
      const res = await request(app)
        .get('/api/v1/social/followers/0xlonely').set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.followers).toEqual([]);
    });
  });

  describe('GET /following/:address', () => {
    test('returns list of followed addresses', async () => {
      await request(app).post('/api/v1/social/follow/0xfriend1').set(witness.header);
      await request(app).post('/api/v1/social/follow/0xfriend2').set(witness.header);

      const res = await request(app)
        .get(`/api/v1/social/following/${me}`).set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.following).toBeInstanceOf(Array);
      expect(res.body.following.length).toBe(2);
      expect(res.body.following).toContain('0xfriend1');
      expect(res.body.following).toContain('0xfriend2');
    });

    test('returns empty array when not following anyone', async () => {
      const res = await request(app)
        .get('/api/v1/social/following/0xhermit').set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.following).toEqual([]);
    });
  });

  // --- Follow + Unfollow round-trip ---

  describe('Follow / unfollow round-trip', () => {
    test('follow then unfollow removes from followers list', async () => {
      await request(app).post('/api/v1/social/follow/0xround-trip').set(witness.header);

      // Verify they appear in followers
      const before = await request(app).get('/api/v1/social/followers/0xround-trip').set(witness.header);
      expect(before.body.followers).toContain(me);

      // Unfollow
      await request(app).delete('/api/v1/social/follow/0xround-trip').set(witness.header);

      // Verify they are removed
      const after = await request(app).get('/api/v1/social/followers/0xround-trip').set(witness.header);
      expect(after.body.followers).not.toContain(me);
    });
  });

  // --- Following feed with social graph ---

  describe('GET /feed/following', () => {
    test('following feed includes emanations from followed users', async () => {
      // This test is constrained because all emanations are authored by the
      // witness, but the following feed includes your own posts too
      await createEmanation('My own post for following feed');

      const res = await request(app)
        .get('/api/v1/social/feed/following').set(witness.header);

      expect(res.status).toBe(200);
      expect(res.body.emanations).toBeInstanceOf(Array);
      // Should include own emanations in following feed
      expect(res.body.emanations.length).toBeGreaterThanOrEqual(1);
    });
  });
});
