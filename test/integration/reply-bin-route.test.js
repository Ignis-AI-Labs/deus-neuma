/**
 * THE BIN, FROM THE DESK (Design note, 2026-10-13: […]). PUT
 * /replies/:postId/bin and /restore on the REAL route, the REAL candidate store on temp disk and
 * REAL auth. The same record the being's reply_dismiss_to_x writes: never deleted, who and why
 * kept, and reversible.
 */
import express from 'express';
import request from 'supertest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

describe('the reply bin — the operator puts a reply aside and takes it back', () => {
  let app, witness, realmState;
  const ENV = ['NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_REPLY_CANDIDATES_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'WORKSPACES_ROOT'];
  const saved = {};

  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV) saved[k] = process.env[k];
    const dir = await createTempDir(`reply-bin-${Math.random().toString(36).slice(2)}`);
    process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(dir, 'queue.json');
    process.env.NEUMA_REPLY_CANDIDATES_PATH = path.join(dir, 'reply-candidates.json');
    process.env.NEUMA_SOCIAL_BINDINGS_PATH = path.join(dir, 'bindings.json');
    process.env.WORKSPACES_ROOT = path.join(dir, 'workspaces');
    const realm = await import('../../backend/services/user-realm.js');
    realmState = { restore: realm.setRealmRoot, root: realm.getRealmRoot() };
    realm.setRealmRoot(path.join(dir, 'realm'));
    const { fullAuth } = await import('../helpers/audit-auth.js');
    const auth = await fullAuth();
    witness = { address: auth.address, header: { Authorization: `Bearer ${auth.token}` } };
    const { default: router } = await import('../../backend/routes/social-channel-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/social-channels', router);
  });

  afterEach(() => {
    realmState?.restore(realmState.root);
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('PUT /replies/:postId/bin and /restore — the operator\'s bin, recorded and reversible', async () => {
    const { replyCandidatesOf } = await import('../../backend/services/social/reply-candidates.js');
    await replyCandidatesOf(witness.address).add({
      postId: '3001', conversationId: '950', authorId: '77', username: 'baiter',
      verified: false, text: 'scammers, all of you', postCreatedAt: '2026-10-12T10:00:00Z',
    });
    const read = async () => (await request(app).get('/api/v1/social-channels/replies').set(witness.header))
      .body.replies.find((r) => r.postId === '3001');

    const binned = await request(app).put('/api/v1/social-channels/replies/3001/bin')
      .set(witness.header).send({ reason: 'bait' });
    expect(binned.status).toBe(200);
    expect(await read()).toMatchObject({ disposition: 'dismissed', dismissed: true, reason: 'bait', dismissedBy: witness.address });

    const restored = await request(app).put('/api/v1/social-channels/replies/3001/restore').set(witness.header);
    expect(restored.status).toBe(200);
    const back = await read();
    expect(back).toMatchObject({ disposition: 'none', dismissed: false, restoredBy: witness.address });
    // What the set-aside was stays on the record.
    expect(back.reason).toBe('bait');

    expect((await request(app).put('/api/v1/social-channels/replies/0000/bin').set(witness.header)).status).toBe(404);
    expect((await request(app).put('/api/v1/social-channels/replies/3001/delete').set(witness.header)).status).toBe(404);
  });

  test('two houses: a reply landed for one is never listed for, nor binned by, the other', async () => {
    const { fullAuth } = await import('../helpers/audit-auth.js');
    const other = await fullAuth();
    const otherHeader = { Authorization: `Bearer ${other.token}` };
    expect(other.address.toLowerCase()).not.toBe(witness.address.toLowerCase());
    // The record as it stood machine-wide, landed through this house's X binding.
    const fs = await import('fs/promises');
    await fs.writeFile(process.env.NEUMA_SOCIAL_BINDINGS_PATH, JSON.stringify({
      x: { neumaId: 'herald', boundBy: witness.address.toLowerCase(), boundAt: '2026-10-01T00:00:00Z' },
    }));
    const { createReplyCandidates } = await import('../../backend/services/social/reply-candidates.js');
    await createReplyCandidates({ path: process.env.NEUMA_REPLY_CANDIDATES_PATH }).add({
      postId: '3101', conversationId: '951', authorId: '78', username: 'neighbour',
      verified: false, text: 'a reply to this house', postCreatedAt: '2026-10-12T10:00:00Z',
    });
    const listed = async (header) => (await request(app).get('/api/v1/social-channels/replies').set(header))
      .body.replies.map((r) => r.postId);

    expect(await listed(otherHeader)).not.toContain('3101');
    expect((await request(app).put('/api/v1/social-channels/replies/3101/bin').set(otherHeader)).status).toBe(404);
    expect(await listed(witness.header)).toContain('3101');
    expect((await request(app).put('/api/v1/social-channels/replies/3101/bin').set(witness.header)).status).toBe(200);
    expect(await listed(otherHeader)).not.toContain('3101');
  });

  test('without a Bearer token the bin is a real 401', async () => {
    expect((await request(app).put('/api/v1/social-channels/replies/3001/bin')).status).toBe(401);
  });
});
