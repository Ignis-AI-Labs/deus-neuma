/**
 * THE THREAD LANE (integration, RULE 0) — a self-reply chained to its
 * parent, proven end to end: a REAL loopback X-shaped server (the wire
 * carries the parent's id into the child's reply linkage), the REAL queue
 * store on REAL tmp disk, the REAL schedulerTick.
 *
 * The laws proven here are Kagipem's (2026-07-29): the parent publishes
 * FIRST, the follow-up answers its live post id IN THE SAME PASS, and a
 * parent that never publishes takes the thread with it — quietly, never
 * independently.
 */
import http from 'http';
import path from 'path';
import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { useServedHouse, SERVED_WALLET } from '../helpers/served-house.js';

const X_ENV = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
const ENV_DOORS = ['NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_X_API_ROOT', ...X_ENV];

let queuePath;
let savedEnv;
let xServer;
let scheduler;
let nextPostId;
let posted; // every POST /2/tweets body, in order
let failTexts; // texts the wire refuses (a parent that cannot publish)
let gonePosts; // live ids the post-lookup disowns
let house;

beforeAll(async () => {
  // The house these threads belong to — the tick acts only on a house its backend serves.
  house = await useServedHouse({ lanes: ['herald'] });
  savedEnv = Object.fromEntries(ENV_DOORS.map((k) => [k, process.env[k]]));
  // The machine's binding record is this suite's own, never the operator's.
  process.env.NEUMA_SOCIAL_BINDINGS_PATH = path.join(path.dirname(house.root), 'social-channel-bindings.json');
  for (const k of X_ENV) process.env[k] = `dummy-${k}`;

  xServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://loopback');
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/2/users/me') return json(200, { data: { id: '1000', username: 'neuma_house' } });
    if (url.pathname === '/2/tweets' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (failTexts.has(body.text)) return json(500, { detail: 'upstream is unwell' });
      const id = String(nextPostId++);
      posted.push({ id, text: body.text, reply: body.reply || null });
      return json(201, { data: { id, text: body.text } });
    }
    if (url.pathname.startsWith('/2/tweets/') && req.method === 'GET') {
      const id = url.pathname.slice('/2/tweets/'.length);
      if (gonePosts.has(id)) return json(404, { detail: 'Not Found' });
      return json(200, { data: { id, author_id: '1000' } });
    }
    return json(404, { detail: 'not found' });
  });
  await new Promise((resolve) => xServer.listen(0, '127.0.0.1', resolve));
  process.env.NEUMA_X_API_ROOT = `http://127.0.0.1:${xServer.address().port}/2`;
  vi.resetModules();
  scheduler = await import('../../backend/services/social/post-scheduler.js');
}, 30000);

afterAll(async () => {
  house.restore();
  for (const k of ENV_DOORS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  xServer?.close();
});

beforeEach(async () => {
  queuePath = `${await createTempDir('thread-queue')}/queue.json`;
  process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = queuePath;
  nextPostId = 5000;
  posted = [];
  failTexts = new Set();
  gonePosts = new Set();
});

const stagePair = async ({ parentText = 'the parent says the thing', childText = 'and the follow-up lands the CTA' } = {}) => {
  const parent = await postQueue.add({
    channelId: 'x', text: parentText, scheduledFor: '2001-01-01T00:00:00Z', queuedBy: SERVED_WALLET,
  });
  await postQueue.approve(parent.id, { decidedBy: SERVED_WALLET });
  const child = await postQueue.add({
    channelId: 'x', text: childText, kind: 'self-reply', thread: { parentId: parent.id }, queuedBy: SERVED_WALLET,
  });
  await postQueue.approve(child.id, { decidedBy: SERVED_WALLET });
  return { parent, child };
};

describe('the thread lane (real loopback X + real queue + real tick, gnosis)', () => {
  test('THE CHAIN — the parent publishes FIRST, the follow-up answers its live id IN THE SAME PASS', async () => {
    const { parent, child } = await stagePair();
    const outcomes = await scheduler.schedulerTick(Date.parse('2026-07-29T14:00:00Z'));

    // Both went out, parent first, in ONE pass.
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(posted).toHaveLength(2);
    const [parentPost, childPost] = posted;
    expect(parentPost.text).toBe('the parent says the thing');
    expect(parentPost.reply).toBeNull();
    // The child answers the parent's LIVE id on the wire.
    expect(childPost.text).toBe('and the follow-up lands the CTA');
    expect(childPost.reply).toEqual({ in_reply_to_tweet_id: parentPost.id });

    // The record preserves both and their relationship (Kagipem's law 9).
    const entries = await postQueue.load();
    const parentNow = entries.find((e) => e.id === parent.id);
    const childNow = entries.find((e) => e.id === child.id);
    expect(parentNow.status).toBe('sent');
    expect(parentNow.postId).toBe(parentPost.id);
    expect(childNow.status).toBe('sent');
    expect(childNow.postId).toBe(childPost.id);
    expect(childNow.thread).toEqual({ parentId: parent.id });
  }, 30000);

  test('Kagipem\'s law 7 — a parent that FAILS takes the thread with it, quietly: the child never touches the wire', async () => {
    failTexts.add('the parent says the thing');
    const { child } = await stagePair();
    const outcomes = await scheduler.schedulerTick(Date.parse('2026-07-29T14:00:00Z'));

    // The parent failed on the wire; the child was system-withdrawn, and
    // only the parent's (failed) attempt ever touched the wire.
    expect(posted).toHaveLength(0);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].ok).toBe(false);
    const entries = await postQueue.load();
    expect(entries.find((e) => e.id === child.id)).toMatchObject({
      status: 'withdrawn', withdrawnBy: 'system',
    });
  }, 30000);

  test('a WITHDRAWN parent orphans the same way — never a send, never a failure', async () => {
    const { parent, child } = await stagePair();
    await postQueue.withdraw(parent.id, { withdrawnBy: 'test', reason: 'superseded' });
    const outcomes = await scheduler.schedulerTick(Date.parse('2026-07-29T14:00:00Z'));
    expect(posted).toHaveLength(0);
    expect(outcomes).toHaveLength(0);
    const entries = await postQueue.load();
    expect(entries.find((e) => e.id === child.id)).toMatchObject({
      status: 'withdrawn', withdrawnBy: 'system',
    });
  }, 30000);

  test('a parent whose live post VANISHED holds the follow-up honestly — no fallback post', async () => {
    const { parent, child } = await stagePair();
    // The parent publishes fine in pass one…
    await scheduler.schedulerTick(Date.parse('2026-07-29T14:00:00Z'));
    // …but this child was still a DRAFT then (separate approval, law 2) —
    // approve it now, with the parent's post already gone from the field.
    const ghost = await postQueue.add({
      channelId: 'x', text: 'a late follow-up', kind: 'self-reply', thread: { parentId: parent.id }, queuedBy: SERVED_WALLET,
    });
    const parentNow = (await postQueue.load()).find((e) => e.id === parent.id);
    gonePosts.add(parentNow.postId);
    await postQueue.approve(ghost.id, { decidedBy: SERVED_WALLET });
    const outcomes = await scheduler.schedulerTick(Date.parse('2026-07-29T14:05:00Z'));

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].ok).toBe(false);
    expect(outcomes[0].detail).toMatch(/no longer stands/);
    // The wire saw the first chain (parent + its follow-up) — the late
    // follow-up never posted.
    expect(posted).toHaveLength(2);
    expect((await postQueue.load()).find((e) => e.id === ghost.id).status).toBe('failed');
    expect(child).toBeTruthy(); // (the first chain's record is untouched)
  }, 30000);

  test('a schedule on a self-reply is refused at the door — it inherits the parent\'s moment', async () => {
    const parent = await postQueue.add({ channelId: 'x', text: 'parent', queuedBy: SERVED_WALLET });
    await expect(postQueue.add({
      channelId: 'x', text: 'child', kind: 'self-reply',
      thread: { parentId: parent.id }, scheduledFor: '2030-01-01T00:00:00Z', queuedBy: SERVED_WALLET,
    })).rejects.toThrow(/inherits its parent/);
  });
});
