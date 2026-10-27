/**
 * A THREAD IS ONE DECISION — PUT /queue/:id/approve-thread over the REAL social
 * router, the REAL post queue on temp disk, and REAL auth (the
 * social-channel-routes.test.js setup). The root and every follow-up draft are
 * approved in one atom; a copy that changed since it was read approves nothing;
 * another house's thread is not this caller's to decide. No mocks (RULE 0).
 */
/* global process */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

const PATH_ENV = ['NEUMA_SOCIAL_CREDENTIALS_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_REPLY_CANDIDATES_PATH', 'WORKSPACES_ROOT'];
const saved = {};
let app; let queue; let caller; let stranger; let realmState;

beforeEach(async () => {
  vi.resetModules();
  for (const k of PATH_ENV) saved[k] = process.env[k];
  const dir = await createTempDir(`social-thread-${Math.random().toString(36).slice(2)}`);
  process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = path.join(dir, 'credentials.json');
  process.env.NEUMA_SOCIAL_BINDINGS_PATH = path.join(dir, 'bindings.json');
  process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(dir, 'queue.json');
  process.env.NEUMA_REPLY_CANDIDATES_PATH = path.join(dir, 'reply-candidates.json');
  process.env.WORKSPACES_ROOT = path.join(dir, 'workspaces');
  const realm = await import('../../backend/services/user-realm.js');
  realmState = { restore: realm.setRealmRoot, root: realm.getRealmRoot() };
  realm.setRealmRoot(path.join(dir, 'realm'));
  const { fullAuth } = await import('../helpers/audit-auth.js');
  const a = await fullAuth();
  const b = await fullAuth();
  caller = { address: a.address, header: { Authorization: `Bearer ${a.token}` } };
  stranger = { address: b.address, header: { Authorization: `Bearer ${b.token}` } };
  const { default: router } = await import('../../backend/routes/social-channel-routes.js');
  ({ postQueue: queue } = await import('../../backend/services/social/post-queue.js'));
  app = express();
  app.use(express.json());
  app.use('/api/v1/social-channels', router);
});

afterEach(() => {
  realmState?.restore(realmState.root);
  for (const k of PATH_ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

// A three-post thread staged by `who`, through the real store.
const stageThread = async (who) => {
  const root = await queue.add({ channelId: 'x', text: 'one: the light', scheduledFor: '2999-01-01T09:00:00Z', queuedBy: who });
  const two = await queue.add({ channelId: 'x', text: 'two: the watch', kind: 'self-reply', thread: { parentId: root.id }, queuedBy: who });
  const three = await queue.add({ channelId: 'x', text: 'three: the harbour', kind: 'self-reply', thread: { parentId: two.id }, queuedBy: who });
  return [root, two, three];
};
const seen = (posts) => Object.fromEntries(posts.map((p) => [p.id, p.text]));
const approveThread = (id, body, who = caller) => request(app)
  .put(`/api/v1/social-channels/queue/${id}/approve-thread`).set(who.header).send(body);

describe('approve a thread as one decision', () => {
  test('pressed on any post of it, every draft from the root down is approved at once', async () => {
    const posts = await stageThread(caller.address);
    const res = await approveThread(posts[2].id, { textsSeen: seen(posts) });
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e) => e.id)).toEqual(posts.map((p) => p.id));
    const after = await queue.load();
    expect(after.map((e) => e.status)).toEqual(['approved', 'approved', 'approved']);
    expect(after.every((e) => e.decidedBy === caller.address.toLowerCase())).toBe(true);
  });

  test('a post whose copy changed since it was read approves nothing', async () => {
    const posts = await stageThread(caller.address);
    const res = await approveThread(posts[0].id, { textsSeen: { ...seen(posts), [posts[1].id]: 'two: an older copy' } });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/post 2 of the thread changed/);
    expect((await queue.load()).map((e) => e.status)).toEqual(['draft', 'draft', 'draft']);
  });

  test('nothing left to decide, or no copy named, is refused plainly', async () => {
    const posts = await stageThread(caller.address);
    expect((await approveThread(posts[0].id, {})).status).toBe(400);
    expect((await approveThread(posts[0].id, { textsSeen: seen(posts) })).status).toBe(200);
    const again = await approveThread(posts[0].id, { textsSeen: seen(posts) });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/nothing in this thread awaits approval/);
  });

  test('another house\'s thread is not this caller\'s to decide', async () => {
    const posts = await stageThread(stranger.address);
    const res = await approveThread(posts[0].id, { textsSeen: seen(posts) });
    expect(res.status).toBe(404);
    expect((await queue.load()).map((e) => e.status)).toEqual(['draft', 'draft', 'draft']);
  });
});
