/**
 * TRY AGAIN through the real route (slice SDT-2, finding 29): the real social
 * router over a real signed-wallet session (challenge → sign → session), the
 * real post queue on tmp disk, two houses. No double (RULE 0); no keys at all,
 * no scheduler running — nothing here can reach a platform.
 *
 * Proven: a post the platform stumbled on returns to DRAFT, the same entry,
 * its failure kept — nothing sent; it goes out again only through the
 * ordinary APPROVE; a refusal of the keys is refused here and left as it was;
 * another house's post is not this house's to retry (404); no session, no
 * retry (401); and a second press on a draft does nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import process from 'node:process';
import express from 'express';
import { fullAuth } from '../helpers/audit-auth.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { postQueue } from '../../backend/services/social/post-queue.js';

let tmp; let server; let base; let a; let b; const saved = {};

const failed = (id, house, over) => ({
  id, channelId: 'x', accountId: 'x-1', text: `${id}: only the harness changed.`, scheduledFor: null, campaignId: null, pillar: '', media: [],
  authorNeumaId: null, queuedBy: house, status: 'failed', createdAt: '2026-10-24T09:00:00.000Z', decidedBy: house,
  decidedAt: '2026-10-24T09:10:00.000Z', sendingAt: '2026-10-24T09:50:00.000Z', failedAt: '2026-10-24T09:52:00.000Z', ...over,
});

const put = async (who, id, act) => {
  const res = await fetch(`${base}/api/v1/social-channels/queue/${id}/${act}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${who.token}` } : {}) }, body: '{}',
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const entry = async (id) => (await postQueue.load()).find((e) => e.id === id);

beforeAll(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'queue-retry-')));
  saved.realm = getRealmRoot();
  saved.lanes = getWorkspacesRoot();
  saved.queue = process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
  setRealmRoot(path.join(tmp, 'realm'));
  setWorkspacesRoot(path.join(tmp, 'lanes'));
  process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(tmp, 'queue.json');
  [a, b] = [await fullAuth(), await fullAuth()];
  await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, `${JSON.stringify([
    failed('stumbled', a.address, { error: 'X answered HTTP 503', errorStatus: 503, decidedUnder: 'md_old' }),
    failed('refused', a.address, { error: 'Unauthorized', errorStatus: 401 }),
    failed('theirs', b.address, { error: 'X answered HTTP 503', errorStatus: 503 }),
  ], null, 2)}\n`);
  const app = express();
  app.use(express.json());
  app.use('/api/v1/social-channels', (await import('../../backend/routes/social-channel-routes.js')).default);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}, 60000);

afterAll(async () => {
  if (server?.listening) await new Promise((r) => server.close(r));
  setRealmRoot(saved.realm);
  setWorkspacesRoot(saved.lanes);
  if (saved.queue === undefined) delete process.env.NEUMA_SOCIAL_POST_QUEUE_PATH; else process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = saved.queue;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('PUT /queue/:id/retry — TRY AGAIN, the operator\'s own press', () => {
  it('no session, no retry', async () => {
    expect((await put(null, 'stumbled', 'retry')).status).toBe(401);
    expect((await entry('stumbled')).status).toBe('failed');
  });

  it('another house\'s post is not this house\'s to retry — and stays as it was', async () => {
    expect((await put(a, 'theirs', 'retry')).status).toBe(404);
    expect((await entry('theirs')).status).toBe('failed');
  });

  it('a refusal of the keys is refused, the entry untouched — its door is the keys row', async () => {
    const before = await entry('refused');
    const res = await put(a, 'refused', 'retry');
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('did not fail on a passing platform error');
    expect(await entry('refused')).toEqual(before);
  });

  it('a stumble returns to DRAFT — same id, failure kept, the old decision (and its mandate) gone; nothing sent', async () => {
    const res = await put(a, 'stumbled', 'retry');
    expect(res.status).toBe(200);
    const now = await entry('stumbled');
    expect(now).toMatchObject({ id: 'stumbled', status: 'draft', restagedBy: a.address, text: 'stumbled: only the harness changed.' });
    expect(now.attempts).toEqual([{ failedAt: '2026-10-24T09:52:00.000Z', error: 'X answered HTTP 503', errorStatus: 503 }]);
    for (const k of ['error', 'errorStatus', 'failedAt', 'decidedBy', 'decidedAt', 'decidedUnder', 'sendingAt', 'sentAt', 'postId']) expect(now[k]).toBeUndefined();
    // A second press on a draft does nothing.
    expect((await put(a, 'stumbled', 'retry')).status).toBe(409);
    expect((await entry('stumbled')).attempts).toHaveLength(1);
  });

  it('a failed send keeps the platform\'s own status, so its cause is read from the answer, not only its words', async () => {
    const staged = await postQueue.add({ channelId: 'x', accountId: 'x-1', text: 'status kept', queuedBy: a.address });
    expect((await postQueue.approve(staged.id, { decidedBy: a.address })).ok).toBe(true);
    expect((await postQueue.claimForSend(staged.id)).ok).toBe(true);
    expect((await postQueue.recordOutcome(staged.id, { ok: false, status: 503, detail: 'Service Unavailable' })).ok).toBe(true);
    expect(await entry(staged.id)).toMatchObject({ status: 'failed', error: 'Service Unavailable', errorStatus: 503 });
    expect((await put(a, staged.id, 'retry')).body.entry).toMatchObject({ status: 'draft', attempts: [{ error: 'Service Unavailable', errorStatus: 503 }] });
  });

  it('it goes out again only through the ordinary APPROVE — the operator\'s fresh decision', async () => {
    const res = await put(a, 'stumbled', 'approve');
    expect(res.status).toBe(200);
    expect(await entry('stumbled')).toMatchObject({ status: 'approved', decidedBy: a.address });
    expect((await entry('stumbled')).decidedUnder).toBeUndefined();
  });
});
