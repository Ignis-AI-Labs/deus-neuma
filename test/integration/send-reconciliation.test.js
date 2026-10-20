/**
 * Send reconciliation (integration, RULE 0) — the lease on `sending` and the
 * reconciler that settles a lost send WITHOUT ever blind-retrying.
 *
 * The hole this guards (live, 2026-07-28): c34d0505214ab341 sat in `sending`
 * for hours — the claim landed, the outcome never did, and nothing could
 * leave the state. Now: claims carry `sendingAt`, and each tick settles
 * lease-expired sends against the house's LIVE posts — copy found live means
 * it went out unrecorded (mark sent, never repost); not found means it
 * genuinely failed (mark failed, visibly).
 *
 * Everything real: a real temp queue store on disk, a real loopback X-shaped
 * server answering /users/me and /users/:id/tweets, the real schedulerTick.
 */
import http from 'http';
import path from 'path';
import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { useServedHouse, SERVED_WALLET } from '../helpers/served-house.js';

const X_ENV = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
const ENV_DOORS = ['NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_X_API_ROOT', ...X_ENV];

const STUCK_TEXT = 'DeFi should not ask for blind trust.\n\nIt should show the route.';
const LIVE_ID = '2081973247718162447';

let queuePath;
let savedEnv;
let xServer;
let recentMode; // 'match' | 'empty' | 'down'
let scheduler;
let house;

beforeAll(async () => {
  // The house these posts belong to — the tick acts only on a house its backend serves.
  house = await useServedHouse({ lanes: ['herald'] });
  savedEnv = Object.fromEntries(ENV_DOORS.map((k) => [k, process.env[k]]));
  // The machine's binding record is this suite's own, never the operator's.
  process.env.NEUMA_SOCIAL_BINDINGS_PATH = path.join(path.dirname(house.root), 'social-channel-bindings.json');
  process.env.X_API_KEY = 'k';
  process.env.X_API_SECRET = 's';
  process.env.X_ACCESS_TOKEN = 't';
  process.env.X_ACCESS_SECRET = 'ts';

  xServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://loopback');
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/2/users/me') return json(200, { data: { id: '1000', username: 'neuma_house' } });
    if (url.pathname === '/2/users/1000/tweets') {
      if (recentMode === 'down') return json(500, { detail: 'upstream is unwell' });
      const tweets = recentMode === 'match'
        ? [{ id: LIVE_ID, text: STUCK_TEXT, created_at: '2026-07-28T01:41:00Z' }]
        : [];
      return json(200, { data: tweets });
    }
    if (url.pathname === '/2/tweets' && req.method === 'POST') {
      return json(201, { data: { id: '9999', text: 'posted' } });
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

// A FRESH store per test: the governance record cannot be hand-cleared
// (remove covers draft/rejected only — by design), so each test gets its own
// file rather than fighting the record's own law.
beforeEach(async () => {
  queuePath = `${await createTempDir('recon-queue')}/queue.json`;
  process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = queuePath;
});

// A lease-expired send, planted exactly the way the hole left one: claimed,
// never settled. The claim lands through the store's own transitions; only
// the lease STAMP is aged by a raw file edit — the same shape a repair
// script makes for real.
const plantStuck = async (text = STUCK_TEXT, ageMs = 20 * 60 * 1000) => {
  const e = await postQueue.add({ channelId: 'x', text, queuedBy: SERVED_WALLET });
  await postQueue.approve(e.id, { decidedBy: SERVED_WALLET });
  await postQueue.claimForSend(e.id);
  const fs = await import('fs/promises');
  const entries = JSON.parse(await fs.readFile(queuePath, 'utf8'));
  entries.find((x) => x.id === e.id).sendingAt = new Date(Date.now() - ageMs).toISOString();
  await fs.writeFile(queuePath, JSON.stringify(entries));
  return e;
};

describe('the lease on `sending`', () => {
  test('claimForSend stamps sendingAt — the lease the reconciler reads', async () => {
    const e = await postQueue.add({ channelId: 'x', text: 'a post', queuedBy: SERVED_WALLET });
    await postQueue.approve(e.id, { decidedBy: SERVED_WALLET });
    await postQueue.claimForSend(e.id);
    const [after] = await postQueue.load();
    expect(after.status).toBe('sending');
    expect(Date.parse(after.sendingAt)).toBeGreaterThan(0);
  });
});

describe('the reconciler — a lost send is settled, never blind-retried', () => {
  test('copy found LIVE: marked sent with the live id — the wire is never touched again', async () => {
    recentMode = 'match';
    const stuck = await plantStuck();
    await scheduler.schedulerTick(Date.now());
    const [after] = await postQueue.load();
    expect(after.id).toBe(stuck.id);
    expect(after.status).toBe('sent');
    expect(after.postId).toBe(LIVE_ID); // the live post and the record agree
  });

  test('copy NOT live: marked failed with the honest reason — visible, revisable', async () => {
    recentMode = 'empty';
    await plantStuck('copy that never made it out');
    await scheduler.schedulerTick(Date.now());
    const [after] = await postQueue.load();
    expect(after.status).toBe('failed');
    expect(after.error).toContain('lost mid-flight');
    expect(after.error).toContain('NOT live');
  });

  test('the verification read fails: settle NOTHING this tick — an unproven loss waits', async () => {
    recentMode = 'down';
    await plantStuck();
    await scheduler.schedulerTick(Date.now());
    const [after] = await postQueue.load();
    expect(after.status).toBe('sending'); // deferred, not guessed
    recentMode = 'empty';
  });
});

describe('overdue approved posts are loud', () => {
  test('an approved post past grace is logged with its id', async () => {
    recentMode = 'empty';
    const e = await postQueue.add({
      channelId: 'x', text: 'overdue copy',
      scheduledFor: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      queuedBy: SERVED_WALLET,
    });
    await postQueue.approve(e.id, { decidedBy: SERVED_WALLET });
    const writes = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...rest) => { writes.push(String(chunk)); return true; };
    try {
      await scheduler.schedulerTick(Date.now());
    } finally {
      process.stdout.write = original;
    }
    const line = writes.find((w) => w.includes('overdue past grace'));
    expect(line).toBeTruthy();
    expect(line).toContain(e.id);
    // …and the publish itself still happened (the loopback answered 201).
    const [after] = await postQueue.load();
    expect(after.status).toBe('sent');
  });
});
