import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

/**
 * Social channel routes — the witness's outward-speech board, end to end
 * against the REAL encrypted credential store, REAL binding store, and REAL
 * auth (RULE 0, #390 tranche 4) on real temp disk. No mock stands in for the
 * caller's session — a real wallet with a real HMAC token proves every
 * request, and a genuine 401 comes from sending none.
 */
describe('Social channel routes (/api/v1/social-channels)', () => {
  let app;
  let tempDir;
  let witness;
  let realmState;
  const savedEnv = {};
  // Platform credential fallbacks — must read as unset for the […] assertions to measure this test's isolation, not this machine's
  // real .env.
  const SECRET_ENV = [
    'X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET',
    'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'DISCORD_BOT_TOKEN', 'DISCORD_CHANNEL_ID',
    'MASTODON_INSTANCE_URL', 'MASTODON_ACCESS_TOKEN',
    'BLUESKY_SERVICE', 'BLUESKY_IDENTIFIER', 'BLUESKY_APP_PASSWORD',
    'FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_ACCESS_TOKEN',
    'LINKEDIN_PERSON_URN', 'LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_TOKEN_EXPIRES_AT',
  ];
  // Store paths this test points at temp disk — must NOT be scrubbed after
  // import (unlike SECRET_ENV above), or every store falls back to its real
  // default location.
  const PATH_ENV = [
    'NEUMA_SOCIAL_CREDENTIALS_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SOCIAL_POST_QUEUE_PATH',
    'NEUMA_REPLY_CANDIDATES_PATH', 'WORKSPACES_ROOT', 'NEUMA_CMO_PATH', 'NEUMA_WEEKLY_PLAN_PATH',
  ];
  const ENV = [...PATH_ENV, ...SECRET_ENV];

  const buildApp = async () => {
    const { default: router } = await import('../../backend/routes/social-channel-routes.js');
    const a = express();
    a.use(express.json());
    a.use('/api/v1/social-channels', router);
    return a;
  };

  beforeEach(async () => {
    vi.resetModules();

    for (const k of ENV) { savedEnv[k] = process.env[k]; delete process.env[k]; }
    tempDir = await createTempDir(`social-channel-routes-${Math.random().toString(36).slice(2)}`);
    process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = path.join(tempDir, 'credentials.json');
    process.env.NEUMA_SOCIAL_BINDINGS_PATH = path.join(tempDir, 'bindings.json');
    process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(tempDir, 'queue.json');
    process.env.NEUMA_REPLY_CANDIDATES_PATH = path.join(tempDir, 'reply-candidates.json');
    process.env.NEUMA_CMO_PATH = path.join(tempDir, 'cmo.json');
    process.env.NEUMA_WEEKLY_PLAN_PATH = path.join(tempDir, 'weekly-plan.json');
    // PINNED. Unset, ownership resolved against the repo's own workspaces/
    // directory — which really does hold a `keir` — so this suite was reading
    // live ground to answer a question about a temp fixture.
    process.env.WORKSPACES_ROOT = path.join(tempDir, 'workspaces');

    // Imported AFTER resetModules so the helper mints its token from the same
    // auth.js instance the router will verify against — the token secret is
    // memoized per module instance, so a stale import would 401 honestly.
    const realm = await import('../../backend/services/user-realm.js');
    realmState = { restore: realm.setRealmRoot, root: realm.getRealmRoot() };
    realm.setRealmRoot(path.join(tempDir, 'realm'));
    const { fullAuth } = await import('../helpers/audit-auth.js');
    const { claimOwner } = await import('../helpers/claim-owner.js');
    // THE CALLER MUST OWN THE LANE IT BINDS. This was a stranger wallet on the
    // reasoning that it is […] — true only while the
    // auth mock waved `assertNeumaOwner` through. Binding a channel to a lane
    // you do not hold is a 404 against the real gate, and rightly so. Both
    // lanes are claimed because the rebinding case moves the channel between
    // them (#409 cause A).
    const auth = await fullAuth();
    witness = { address: auth.address, header: { Authorization: `Bearer ${auth.token}` } };
    await claimOwner(process.env.WORKSPACES_ROOT, 'keir', witness.address);
    await claimOwner(process.env.WORKSPACES_ROOT, 'galen', witness.address);

    app = await buildApp();

    // The real auth.js chain (unlike the mock it replaces) pulls in
    // core/index.js's barrel, which eagerly loads `natural`, whose
    // Postgres.js storage backend calls dotenv.config() at import time —
    // repopulating the SECRET_ENV keys this file just cleared from the real
    // .env on disk. Scrub again post-import (paths are left alone — they are
    // this test's own temp-disk routing, not leaked secrets) so the
    // "unconfigured at rest" assertions measure this test's isolation, not
    // this machine's secrets.
    for (const k of SECRET_ENV) delete process.env[k];
  });

  afterEach(() => {
    realmState?.restore(realmState.root);
    for (const k of ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    vi.restoreAllMocks();
  });

  test('GET / lists every catalog channel, unconfigured and unbound at rest', async () => {
    const res = await request(app).get('/api/v1/social-channels').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.channels.map((c) => c.id).sort())
      .toEqual(['bluesky', 'discord', 'facebook', 'linkedin', 'mastodon', 'telegram', 'x']);
    for (const c of res.body.channels) {
      expect(c.configured).toBe(false);
      expect(c.binding).toBeNull();
    }
  });

  test('PUT credentials → sealed on disk, masked in every response, configured on the board', async () => {
    const res = await request(app)
      .put('/api/v1/social-channels/telegram/credentials').set(witness.header)
      .send({ fields: { botToken: 'bot-supersecret', chatId: '@herald_channel' } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('bot-supersecret');
    expect(res.body.configured).toBe(true);
    expect(res.body.fields.find((f) => f.key === 'botToken')).toMatchObject({ set: true, source: 'store' });

    // Sealed envelope on disk — never plaintext.
    const raw = await fs.readFile(process.env.NEUMA_SOCIAL_CREDENTIALS_PATH, 'utf8');
    expect(raw).not.toContain('bot-supersecret');
    expect(JSON.parse(raw)).toHaveProperty('ct');

    const board = await request(app).get('/api/v1/social-channels').set(witness.header);
    expect(board.body.channels.find((c) => c.id === 'telegram').configured).toBe(true);
  });

  test('a partial credential set never reads as configured', async () => {
    await request(app)
      .put('/api/v1/social-channels/telegram/credentials').set(witness.header)
      .send({ fields: { botToken: 'bot-only' } });
    const board = await request(app).get('/api/v1/social-channels').set(witness.header);
    expect(board.body.channels.find((c) => c.id === 'telegram').configured).toBe(false);
  });

  test('DELETE credentials forgets the stored entry', async () => {
    await request(app)
      .put('/api/v1/social-channels/discord/credentials').set(witness.header)
      .send({ fields: { botToken: 'bot-tok', channelId: '42' } });
    const del = await request(app).delete('/api/v1/social-channels/discord/credentials').set(witness.header);
    expect(del.status).toBe(200);
    expect(del.body.removed).toBe(true);
    const board = await request(app).get('/api/v1/social-channels').set(witness.header);
    expect(board.body.channels.find((c) => c.id === 'discord').configured).toBe(false);
  });

  test('binding ties the channel to one neuma under the caller wallet; release returns to default deny', async () => {
    const bindRes = await request(app)
      .put('/api/v1/social-channels/x/binding').set(witness.header)
      .send({ neumaId: 'keir' });
    expect(bindRes.status).toBe(200);
    expect(bindRes.body.binding).toMatchObject({ neumaId: 'keir', boundBy: witness.address.toLowerCase() });

    const board = await request(app).get('/api/v1/social-channels').set(witness.header);
    expect(board.body.channels.find((c) => c.id === 'x').binding.neumaId).toBe('keir');

    const release = await request(app).delete('/api/v1/social-channels/x/binding').set(witness.header);
    expect(release.status).toBe(200);
    expect(release.body.released).toBe(true);
    const after = await request(app).get('/api/v1/social-channels').set(witness.header);
    expect(after.body.channels.find((c) => c.id === 'x').binding).toBeNull();
  });

  test('rebinding replaces the holder — one neuma per channel', async () => {
    await request(app).put('/api/v1/social-channels/x/binding').set(witness.header).send({ neumaId: 'keir' });
    await request(app).put('/api/v1/social-channels/x/binding').set(witness.header).send({ neumaId: 'galen' });
    const board = await request(app).get('/api/v1/social-channels').set(witness.header);
    expect(board.body.channels.find((c) => c.id === 'x').binding.neumaId).toBe('galen');
  });

  test('malformed neumaId is a 400; unknown channel is a 404; malformed body is a 400', async () => {
    const bad = await request(app).put('/api/v1/social-channels/x/binding').set(witness.header).send({ neumaId: '../escape' });
    expect(bad.status).toBe(400);
    const missing = await request(app).get('/api/v1/social-channels').set(witness.header).then(() =>
      request(app).put('/api/v1/social-channels/myspace/binding').set(witness.header).send({ neumaId: 'keir' }));
    expect(missing.status).toBe(404);
    const noFields = await request(app).put('/api/v1/social-channels/x/credentials').set(witness.header).send({});
    expect(noFields.status).toBe(400);
  });

  test('campaign lane: stage → approve → decide rules hold over REST', async () => {
    const staged = await request(app)
      .post('/api/v1/social-channels/queue').set(witness.header)
      .send({ channelId: 'x', text: 'first light', scheduledFor: '2999-01-01T00:00:00Z' });
    expect(staged.status).toBe(201);
    expect(staged.body.entry).toMatchObject({ status: 'draft', queuedBy: witness.address.toLowerCase(), channelId: 'x' });

    const listed = await request(app).get('/api/v1/social-channels/queue').set(witness.header);
    expect(listed.body.queue).toHaveLength(1);

    const approved = await request(app)
      .put(`/api/v1/social-channels/queue/${staged.body.entry.id}/approve`).set(witness.header)
      .send({});
    expect(approved.status).toBe(200);
    expect(approved.body.entry).toMatchObject({ status: 'approved', decidedBy: witness.address.toLowerCase() });

    // THE SCHEDULE LOCK (Design note, 2026-07-28: […]) — the approve answer carries the receipt: lock id, slot,
    // lock timestamp, and whose clock fires it (named honestly — there is no
    // X-side scheduler on this account).
    expect(approved.body.schedule).toEqual({
      id: staged.body.entry.id,
      firesAt: '2999-01-01T00:00:00Z',
      lockedAt: approved.body.entry.decidedAt,
      status: 'approved',
      scheduler: 'neuma-backend',
    });

    // A decision is a decision — no second approve, no reject after approve.
    expect((await request(app).put(`/api/v1/social-channels/queue/${staged.body.entry.id}/approve`).set(witness.header).send({})).status).toBe(409);
    expect((await request(app).put(`/api/v1/social-channels/queue/${staged.body.entry.id}/reject`).set(witness.header).send({})).status).toBe(409);
    // An approved entry cannot be removed.
    expect((await request(app).delete(`/api/v1/social-channels/queue/${staged.body.entry.id}`).set(witness.header)).status).toBe(409);

    // Bad drafts are refused at the door.
    expect((await request(app).post('/api/v1/social-channels/queue').set(witness.header).send({ channelId: 'myspace', text: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/v1/social-channels/queue').set(witness.header).send({ channelId: 'x', text: '' })).status).toBe(400);
  });

  test('PUT /queue/:id edits in place, wallet-attributed, under the approval law (#208)', async () => {
    const staged = await request(app)
      .post('/api/v1/social-channels/queue').set(witness.header)
      .send({ channelId: 'x', text: 'the staged line', scheduledFor: '2999-01-01T00:00:00Z' });
    const id = staged.body.entry.id;

    // A draft edit keeps the draft and records the actor + what the copy WAS.
    const edited = await request(app)
      .put(`/api/v1/social-channels/queue/${id}`).set(witness.header)
      .send({ text: 'the better line' });
    expect(edited.status).toBe(200);
    expect(edited.body.entry).toMatchObject({
      id, text: 'the better line', status: 'draft', updatedBy: witness.address.toLowerCase(),
    });
    expect(edited.body.entry.revisions).toHaveLength(1);
    expect(edited.body.entry.revisions[0]).toMatchObject({
      by: witness.address.toLowerCase(), changed: { text: 'the staged line' },
    });

    // Approve, then a schedule-only edit: the approval PRESERVES.
    await request(app).put(`/api/v1/social-channels/queue/${id}/approve`).set(witness.header).send({});
    const retimed = await request(app)
      .put(`/api/v1/social-channels/queue/${id}`).set(witness.header)
      .send({ scheduledFor: '2999-02-02T00:00:00Z' });
    expect(retimed.status).toBe(200);
    expect(retimed.body.entry).toMatchObject({ status: 'approved', decidedBy: witness.address.toLowerCase() });

    // New words on the approved post: the decision RENEWS — back to draft.
    const reworded = await request(app)
      .put(`/api/v1/social-channels/queue/${id}`).set(witness.header)
      .send({ text: 'different words entirely' });
    expect(reworded.status).toBe(200);
    expect(reworded.body.entry.status).toBe('draft');
    expect(reworded.body.entry.decidedBy).toBeUndefined();

    // Honest refusals: settled history, unknown ids, invalid patches.
    await request(app).put(`/api/v1/social-channels/queue/${id}/approve`).set(witness.header).send({});
    const invalid = await request(app)
      .put(`/api/v1/social-channels/queue/${id}`).set(witness.header)
      .send({ scheduledFor: 'whenever' });
    expect(invalid.status).toBe(409);
    expect(invalid.body.error).toContain('ISO-8601');
    expect((await request(app).put('/api/v1/social-channels/queue/nosuchid00000000').set(witness.header).send({ text: 'x' })).status).toBe(409);
  });

  test('POST /queue/bulk-update decides each entry independently and names every verdict', async () => {
    const a = await request(app).post('/api/v1/social-channels/queue').set(witness.header).send({ channelId: 'x', text: 'post a' });
    const b = await request(app).post('/api/v1/social-channels/queue').set(witness.header).send({ channelId: 'x', text: 'post b' });
    const c = await request(app).post('/api/v1/social-channels/queue').set(witness.header).send({ channelId: 'x', text: 'post c' });

    const res = await request(app)
      .post('/api/v1/social-channels/queue/bulk-update').set(witness.header)
      .send({
        updates: [
          { id: a.body.entry.id, text: 'post a, retitled' },
          { id: b.body.entry.id, scheduledFor: 'not-a-time' },
          { id: 'nosuchid00000000', text: 'ghost' },
          { id: c.body.entry.id, scheduledFor: '2999-03-03T00:00:00Z' },
          { text: 'no id at all' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { id: a.body.entry.id, ok: true },
      { id: b.body.entry.id, ok: false, error: 'scheduledFor must be an ISO-8601 time' },
      { id: 'nosuchid00000000', ok: false, error: 'no such queued post' },
      { id: c.body.entry.id, ok: true },
      { id: '', ok: false, error: 'each update needs an id' },
    ]);

    // The valid ones landed on the REAL queue; the refused ones are untouched.
    const listed = await request(app).get('/api/v1/social-channels/queue').set(witness.header);
    const byId = Object.fromEntries(listed.body.queue.map((e) => [e.id, e]));
    expect(byId[a.body.entry.id].text).toBe('post a, retitled');
    expect(byId[a.body.entry.id].updatedBy).toBe(witness.address.toLowerCase());
    expect(byId[b.body.entry.id].text).toBe('post b');
    expect(byId[b.body.entry.id].revisions).toBeUndefined();
    expect(byId[c.body.entry.id].scheduledFor).toBe('2999-03-03T00:00:00Z');

    // A malformed body is a 400, never a silent no-op.
    expect((await request(app).post('/api/v1/social-channels/queue/bulk-update').set(witness.header).send({})).status).toBe(400);
    expect((await request(app).post('/api/v1/social-channels/queue/bulk-update').set(witness.header).send({ updates: [] })).status).toBe(400);
  });

  test('PUT /queue/:id/withdraw — the operator pulls staged copy back; the store refusal reaches them verbatim', async () => {
    // Until 2026-08-06 withdraw had no REST door — only beings (queue_cancel)
    // and the system could pull an entry; the operator's own board could not.
    const staged = await request(app).post('/api/v1/social-channels/queue').set(witness.header)
      .send({ channelId: 'x', text: 'copy that will be superseded' });
    const id = staged.body.entry.id;

    const withdrawn = await request(app).put(`/api/v1/social-channels/queue/${id}/withdraw`).set(witness.header)
      .send({ reason: 'superseded by the launch thread' });
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.entry).toMatchObject({
      status: 'withdrawn', withdrawnBy: witness.address.toLowerCase(), withdrawnReason: 'superseded by the launch thread',
    });

    // A settled entry refuses through the transition guard, verbatim — a
    // withdrawal is never rewritten and never repeated.
    const again = await request(app).put(`/api/v1/social-channels/queue/${id}/withdraw`).set(witness.header).send({});
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('cannot act on a withdrawn post');
  });

  test('PUT /queue/:id/approve on a REPLY sends NOW — textSeen guards the copy, the outcome is honest (2026-08-06)', async () => {
    const { createPostQueue } = await import('../../backend/services/social/post-queue.js');
    const queue = createPostQueue({ path: process.env.NEUMA_SOCIAL_POST_QUEUE_PATH });
    const e = await queue.add({
      channelId: 'x', text: 'the answer as read', kind: 'reply',
      reply: { toPostId: '9001', toUserId: '42', toUsername: 'bluefriend', conversationId: '900' },
      queuedBy: witness.address.toLowerCase(),
    });

    // No textSeen, or different copy than the operator read: refused (TOCTOU
    // — the operator approves WORDS, not an id).
    const blind = await request(app).put(`/api/v1/social-channels/queue/${e.id}/approve`).set(witness.header).send({});
    expect(blind.status).toBe(409);
    expect(blind.body.error).toContain('the copy moved');
    const moved = await request(app).put(`/api/v1/social-channels/queue/${e.id}/approve`).set(witness.header)
      .send({ textSeen: 'not what was read' });
    expect(moved.status).toBe(409);
    expect(moved.body.error).toContain('the copy moved');
    expect((await queue.load()).find((x) => x.id === e.id).status).toBe('draft');

    // With the copy as read, the approval claims and publishes IMMEDIATELY —
    // through the real publish path. No credentials are configured in this
    // harness, so the send answers with its NAMED refusal, and the entry
    // lands `failed`: honest, never stranded in `sending`, never resting at
    // `approved`, and no schedule-lock receipt pretending a scheduler will
    // come for it.
    const decided = await request(app).put(`/api/v1/social-channels/queue/${e.id}/approve`).set(witness.header)
      .send({ textSeen: 'the answer as read' });
    expect(decided.status).toBe(200);
    expect(decided.headers['cache-control']).toBe('private, no-store');
    expect(decided.body.schedule).toBeUndefined();
    expect(decided.body.outcome).toEqual({ ok: false, detail: expect.stringContaining('credentials are not configured') });
    expect(decided.body.entry).toMatchObject({ status: 'failed', decidedBy: witness.address.toLowerCase(), kind: 'reply' });
  });

  test('GET /replies — the inbound half: candidates with their reads, disposition, and the parent post joined', async () => {
    // Seed the lane through the REAL stores on REAL temp disk: a sent house
    // post (draft → approve → claim → outcome, the scheduler's own path) and
    // two landed candidates — one answering that post, one a drive-by whose
    // parent the house never published through this lane.
    const { createPostQueue } = await import('../../backend/services/social/post-queue.js');
    const { createReplyCandidates } = await import('../../backend/services/social/reply-candidates.js');
    const queue = createPostQueue({ path: process.env.NEUMA_SOCIAL_POST_QUEUE_PATH });
    const candidates = createReplyCandidates({ path: process.env.NEUMA_REPLY_CANDIDATES_PATH });

    const sent = await queue.add({ channelId: 'x', text: 'the house said something real', queuedBy: witness.address.toLowerCase() });
    await queue.approve(sent.id, { decidedBy: witness.address.toLowerCase() });
    await queue.claimForSend(sent.id);
    await queue.recordOutcome(sent.id, { ok: true, id: '900', postedAs: { id: '1000', username: 'neuma_house' } });

    await candidates.add({
      postId: '2001', conversationId: '900', authorId: '42', username: 'bluefriend',
      verified: true, verifiedType: 'blue',
      text: 'how does the auto-rebalancing handle impermanent loss over time?',
      postCreatedAt: '2026-07-28T00:01:00Z', inReplyToPostId: '900',
    });
    await candidates.add({
      postId: '2002', conversationId: '901', authorId: '43', username: 'driveby',
      verified: false, verifiedType: 'none',
      text: '@neuma_house Nice!', postCreatedAt: '2026-07-28T00:02:00Z',
      inReplyToPostId: '999',
    });

    // A staged answer against 2001 — the disposition must read it live.
    await queue.add({
      channelId: 'x', text: 'a real answer, staged', queuedBy: witness.address.toLowerCase(),
      kind: 'reply', reply: { toPostId: '2001', toUserId: '42', conversationId: '900' },
    });

    const res = await request(app).get('/api/v1/social-channels/replies').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.replies).toHaveLength(2);
    const byId = Object.fromEntries(res.body.replies.map((r) => [r.postId, r]));

    // The substantive one: its reads, its parent — the house post's OWN
    // words — and its live disposition.
    expect(byId['2001'].substance).toBe('substantive');
    expect(byId['2001'].inReplyToPostId).toBe('900');
    expect(byId['2001'].answersPost).toMatchObject({ postId: '900', text: 'the house said something real' });
    expect(byId['2001'].answersPost.sentAt).toBeTruthy();
    expect(byId['2001'].disposition).toBe('staged');
    expect(byId['2001'].text).toBe('how does the auto-rebalancing handle impermanent loss over time?');

    // The drive-by: marked low-effort, unanswered, and its parent is null —
    // the join never invents a post the lane did not publish.
    expect(byId['2002'].substance).toBe('low-effort');
    expect(byId['2002'].disposition).toBe('none');
    expect(byId['2002'].answersPost).toBeNull();
    // The house's own answer rides the row, in its words (the inbox reads it).
    expect(byId['2001'].answers).toEqual([expect.objectContaining({ status: 'draft', text: 'a real answer, staged' })]);
    expect(byId['2002'].answers).toEqual([]);
    expect(byId['2001'].category).toBe('ordinary');
  });


  test('GET /queue/:id/media/:index — the staged bytes stream authenticated; wrong index, unknown id, and gutted media are 404', async () => {
    // A REAL image on real temp disk, staged through the REAL queue store
    // exactly as production stages it — the resolved real path + alt text.
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const imgPath = path.join(tempDir, 'render.png');
    await fs.writeFile(imgPath, PNG);
    const { createPostQueue } = await import('../../backend/services/social/post-queue.js');
    const queue = createPostQueue({ path: process.env.NEUMA_SOCIAL_POST_QUEUE_PATH });
    const entry = await queue.add({
      channelId: 'x', text: 'a staged answer', kind: 'reply',
      reply: { toPostId: '2001', toUserId: '42' },
      media: [{ path: await fs.realpath(imgPath), alt: 'a dark chamfered panel' }],
      queuedBy: witness.address.toLowerCase(),
    });

    const binary = (r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    };
    const res = await request(app)
      .get(`/api/v1/social-channels/queue/${entry.id}/media/0`).set(witness.header)
      .buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.equals(PNG)).toBe(true);

    // Nothing invented: a bad index and an unknown id are honest 404s.
    expect((await request(app).get(`/api/v1/social-channels/queue/${entry.id}/media/1`).set(witness.header)).status).toBe(404);
    expect((await request(app).get('/api/v1/social-channels/queue/nosuchid00000000/media/0').set(witness.header)).status).toBe(404);

    // The send-time re-check doctrine holds for previews too: media gutted
    // since staging is a 404, never a stream of whatever stands there now.
    await fs.rm(imgPath);
    expect((await request(app).get(`/api/v1/social-channels/queue/${entry.id}/media/0`).set(witness.header)).status).toBe(404);
  });

  test('without a Bearer token the real auth answers 401 on every route', async () => {
    // No mock stands between `app` and the real requireAuth now — sending no
    // Authorization header IS the real refusal.
    for (const [method, url] of [
      ['get', '/api/v1/social-channels'],
      ['get', '/api/v1/social-channels/replies'],
      ['put', '/api/v1/social-channels/x/credentials'],
      ['put', '/api/v1/social-channels/x/binding'],
      ['delete', '/api/v1/social-channels/x/binding'],
      ['put', '/api/v1/social-channels/queue/someid0000000000'],
      ['post', '/api/v1/social-channels/queue/bulk-update'],
      ['get', '/api/v1/social-channels/queue/someid0000000000/media/0'],
    ]) {
      const res = await request(app)[method](url);
      expect(res.status).toBe(401);
    }
  });
});
