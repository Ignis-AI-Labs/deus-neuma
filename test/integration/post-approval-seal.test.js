/**
 * AN APPROVAL IS BOUND TO WHAT ITS CARD SHOWED (audit P6-124). RULE 0: the
 * real social router over a real signed-wallet session, the real post queue on
 * temp disk, real image files, the real scheduler and the real poster aimed at
 * a loopback X. No double anywhere; nothing can reach a real platform.
 *
 * Proven: a yes that names no copy is refused; a draft rewritten while its
 * card sat open is refused with the stale words, and so is one whose images
 * were swapped; the preview shows only the bytes sealed at staging; and an
 * image overwritten in place AFTER the approval is never uploaded — the post
 * fails with the reason, and nothing reaches X.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import express from 'express';
import { fullAuth } from '../helpers/audit-auth.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { schedulerTick } from '../../backend/services/social/post-scheduler.js';
import { socialPostIntent } from '../../backend/services/intents/social-post.js';
import { grantMandate } from '../../backend/services/marketing/mandate/mandate-lifecycle.js';
import {
  buildMandateHouse, teardownMandateHouse, resetHouse, stagePost, lastEntry, entryOf, grantInput, HOUSE,
} from '../helpers/mandate-house-kit.js';

// Two real 1x1 PNGs with different bytes.
const PNG_A = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PNG_B = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

let h; let server; let base; let operator; let art; let previousLibrary;

const call = async (method, route, body) => {
  const res = await fetch(`${base}/api/v1/social-channels${route}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operator.token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  let json = {};
  try { json = JSON.parse(bytes.toString('utf8')); } catch { /* an image answers in bytes */ }
  return { status: res.status, body: json, bytes };
};
const approve = (id, body) => call('PUT', `/queue/${id}/approve`, body);
// The card as the desk reads it: the queue the route serves.
const card = async (id) => (await call('GET', '/queue')).body.queue.find((e) => e.id === id);
// The operator's own draft with one image, staged through the real store.
const stage = async (text, file) => postQueue.add({
  channelId: 'x', text, scheduledFor: '2999-01-01T00:00:00Z', media: [{ path: file, alt: 'the card' }],
  authorNeumaId: null, queuedBy: operator.address,
});

beforeAll(async () => {
  h = await buildMandateHouse();
  operator = await fullAuth();
  art = await fs.realpath(await createTempDir('approval-seal-art'));
  previousLibrary = process.env.NEUMA_MEDIA_LIBRARY_PATH;
  process.env.NEUMA_MEDIA_LIBRARY_PATH = art;
  const app = express();
  app.use(express.json());
  app.use('/api/v1/social-channels', (await import('../../backend/routes/social-channel-routes.js')).default);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}, 60000);

afterAll(async () => {
  if (server?.listening) await new Promise((r) => server.close(r));
  if (previousLibrary === undefined) delete process.env.NEUMA_MEDIA_LIBRARY_PATH; else process.env.NEUMA_MEDIA_LIBRARY_PATH = previousLibrary;
  await teardownMandateHouse(h);
});

beforeEach(async () => { await resetHouse(h); h.x.state.uploads = 0; });

describe('the yes names what the card showed', () => {
  test('a yes with no copy is refused, and a draft rewritten under an open card is not approved', async () => {
    const file = path.join(art, 'words.png');
    await fs.writeFile(file, PNG_A);
    const { id } = await stage('We ship on Friday.', file);
    const seen = await card(id);
    expect(seen.media[0].sha256).toBe(sha(PNG_A));

    const blind = await approve(id, {});
    expect(blind.status).toBe(409);
    expect(blind.body.error).toContain('names the copy it read');

    // The rewrite lands while the card is still on screen (the store's own edit door).
    await postQueue.update(id, { text: 'Claim your tokens at evil.example/claim' }, { by: 'replylaneecho' });
    const stale = await approve(id, { textSeen: seen.text, mediaSeen: seen.media.map((m) => m.sha256) });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toContain('the copy moved since it was read');
    expect(await entryOf(id)).toMatchObject({ status: 'draft', text: 'Claim your tokens at evil.example/claim' });

    // Read again, decide again: the fresh card approves.
    const fresh = await card(id);
    const yes = await approve(id, { textSeen: fresh.text, mediaSeen: fresh.media.map((m) => m.sha256) });
    expect(yes.status).toBe(200);
    expect(yes.body.entry.status).toBe('approved');
  });

  test('images swapped under an open card are not approved, and a yes that names no image is refused', async () => {
    const [first, second] = [path.join(art, 'first.png'), path.join(art, 'second.png')];
    await fs.writeFile(first, PNG_A);
    await fs.writeFile(second, PNG_B);
    const { id } = await stage('Tonight.', first);
    const seen = await card(id);

    expect((await approve(id, { textSeen: seen.text })).body.error).toContain('the media moved since it was seen');
    await postQueue.update(id, { media: [{ path: second, alt: 'the card' }] }, { by: 'replylaneecho' });
    const stale = await approve(id, { textSeen: seen.text, mediaSeen: [sha(PNG_A)] });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toContain('the media moved since it was seen');
    expect((await entryOf(id)).status).toBe('draft');
    expect((await approve(id, { textSeen: seen.text, mediaSeen: [sha(PNG_B)] })).status).toBe(200);
  });

  test('the preview shows only the bytes sealed at staging', async () => {
    const file = path.join(art, 'preview.png');
    await fs.writeFile(file, PNG_A);
    const { id } = await stage('Look.', file);
    const shown = await call('GET', `/queue/${id}/media/0`);
    expect(shown.status).toBe(200);
    expect(shown.bytes.equals(PNG_A)).toBe(true);

    await fs.writeFile(file, PNG_B); // overwritten in place: same path, other bytes
    const swapped = await call('GET', `/queue/${id}/media/0`);
    expect(swapped.status).toBe(404);
    expect(swapped.body.error).toContain('changed after it was staged');
  });
});

describe('a thread and a group are bound the same way (the P6-124 leftover)', () => {
  const files = async () => {
    const [first, second] = [path.join(art, 'many-a.png'), path.join(art, 'many-b.png')];
    await fs.writeFile(first, PNG_A);
    await fs.writeFile(second, PNG_B);
    return [first, second];
  };

  test('a thread whose image was swapped under its open card is not approved, nor one whose yes names no image', async () => {
    const [first, second] = await files();
    const root = await stage('One of two.', first);
    const next = await postQueue.add({ channelId: 'x', text: 'Two of two.', kind: 'self-reply', thread: { parentId: root.id }, authorNeumaId: null, queuedBy: operator.address });
    const textsSeen = { [root.id]: 'One of two.', [next.id]: 'Two of two.' };
    const seen = { [root.id]: [sha(PNG_A)], [next.id]: [] };
    const approveThread = (mediaSeen) => call('PUT', `/queue/${next.id}/approve-thread`, { textsSeen, ...(mediaSeen ? { mediaSeen } : {}) });

    expect((await approveThread()).body.error).toContain('the media moved since it was seen');
    await postQueue.update(root.id, { media: [{ path: second, alt: 'the card' }] }, { by: 'replylaneecho' });
    const stale = await approveThread(seen);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatch(/post 1 of the thread: the media moved since it was seen/);
    expect([(await entryOf(root.id)).status, (await entryOf(next.id)).status]).toEqual(['draft', 'draft']);

    expect((await approveThread({ ...seen, [root.id]: [sha(PNG_B)] })).status).toBe(200);
    expect([(await entryOf(root.id)).status, (await entryOf(next.id)).status]).toEqual(['approved', 'approved']);
  });

  test('a group whose image was swapped under its open card is not approved', async () => {
    const [first, second] = await files();
    const post = await postQueue.add({ channelId: 'x', text: 'The launch.', groupId: 'launch', scheduledFor: '2999-01-01T00:00:00Z',
      media: [{ path: first, alt: 'the card' }], authorNeumaId: null, queuedBy: operator.address });
    expect((await entryOf(post.id)).groupId).toBe('launch');
    const decision = (mediaSeen) => ({ ids: new Set([post.id]), decidedBy: operator.address, textsSeen: { [post.id]: 'The launch.' }, mediaSeen });

    expect((await postQueue.approveGroup('launch', decision(undefined))).error).toContain('the media moved since it was seen');
    await postQueue.update(post.id, { media: [{ path: second, alt: 'the card' }] }, { by: 'replylaneecho' });
    expect((await postQueue.approveGroup('launch', decision({ [post.id]: [sha(PNG_A)] }))).error).toMatch(/the media moved since it was seen.*nothing in the group was approved/);
    expect((await entryOf(post.id)).status).toBe('draft');
    expect((await postQueue.approveGroup('launch', decision({ [post.id]: [sha(PNG_B)] }))).ok).toBe(true);
    expect((await entryOf(post.id)).status).toBe('approved');
  });
});

describe('the send re-checks the bytes', () => {
  test('an image overwritten in place after the approval is never uploaded: the post fails and nothing reaches X', async () => {
    await grantMandate(HOUSE, grantInput());
    const file = path.join(art, 'approved.png');
    await fs.writeFile(file, PNG_A);
    const staged = await stagePost(h, { text: 'The card for tonight.', media: [{ path: file, alt: 'tonight' }] });
    expect(staged.status, JSON.stringify(staged)).not.toBe('invalid');
    const entry = await lastEntry();
    expect(entry).toMatchObject({ status: 'approved', media: [{ sha256: sha(PNG_A) }] });

    await fs.writeFile(file, PNG_B);
    await schedulerTick(Date.now());
    expect(h.x.state.uploads).toBe(0);
    expect(h.x.state.posts).toEqual([]);
    const after = await entryOf(entry.id);
    expect(after.status).toBe('failed');
    expect(after.error).toContain('changed after it was staged');
  });

  test('an instant post re-checks the sealed image immediately before upload', async () => {
    const file = path.join(art, 'instant.png');
    await fs.writeFile(file, PNG_A);
    const approved = await socialPostIntent.validate({ channel: 'x', text: 'Now, exactly this image.', media: [{ path: file, alt: 'instant' }] }, { connection: h.connection });
    expect(approved.ok, JSON.stringify(approved)).toBe(true);
    expect(approved.value.media[0].sha256).toBe(sha(PNG_A));
    await fs.writeFile(file, PNG_B);
    const sent = await socialPostIntent.execute(approved.value, { signal: AbortSignal.timeout(5000) });
    expect(sent.ok).toBe(false);
    expect(sent.reason).toContain('changed after it was staged');
    expect(h.x.state.uploads).toBe(0);
    expect(h.x.state.posts).toEqual([]);
  });

  test('the same image, untouched, goes out', async () => {
    await grantMandate(HOUSE, grantInput());
    const file = path.join(art, 'untouched.png');
    await fs.writeFile(file, PNG_A);
    await stagePost(h, { text: 'The card for tonight, as approved.', media: [{ path: file, alt: 'tonight' }] });
    await schedulerTick(Date.now());
    expect(h.x.state.uploads).toBe(1);
    expect(h.x.state.posts).toHaveLength(1);
    expect((await lastEntry()).status).toBe('sent');
  });
});
