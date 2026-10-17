/**
 * The account on the card (integration, RULE 0) — which door a post goes out
 * (Design note, 2026-07-28: […]).
 *
 * Real loopback X (/2/users/me), real channel credential store, real queue
 * store on real temp disk: the board answers WHO the channel speaks as, and
 * a successful send stamps that account onto the entry permanently.
 */
import express from 'express';
import request from 'supertest';
import http from 'http';
import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { useServedHouse, SERVED_WALLET } from '../helpers/served-house.js';

const ENV = [
  'NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH',
  'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_X_API_ROOT',
  'X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET',
];

let savedEnv;
let xServer;
let meMode; // 'ok' | 'down'
let queuePath;
let witness;

const ME = { data: { id: '1000', username: 'Umbrae_Ignis', name: 'Umbrae' } };

beforeAll(async () => {
  savedEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
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
    if (url.pathname === '/2/users/me') {
      return meMode === 'down' ? json(401, { detail: 'bad token' }) : json(200, ME);
    }
    if (url.pathname === '/2/tweets' && req.method === 'POST') {
      return json(201, { data: { id: '4242', text: 'out' } });
    }
    return json(404, { detail: 'not found' });
  });
  await new Promise((resolve) => xServer.listen(0, '127.0.0.1', resolve));
  process.env.NEUMA_X_API_ROOT = `http://127.0.0.1:${xServer.address().port}/2`;
}, 30000);

afterAll(async () => {
  for (const k of ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  xServer?.close();
});

beforeEach(async () => {
  vi.resetModules();
  // Imported AFTER resetModules — the token must be minted from the same
  // auth.js instance the router will verify against (memoized HMAC secret
  // per module instance; a stale import 401s honestly).
  // No neuma lane on this router; a real session that claims no workspace
  // is exactly the right shape for the operator-only channel board.
  const { strangerWitness } = await import('../helpers/witness.js');
  witness = strangerWitness();
  const dir = await createTempDir('account-id');
  queuePath = `${dir}/queue.json`;
  process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = queuePath;
  process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = `${dir}/creds.json`;
  process.env.NEUMA_SOCIAL_BINDINGS_PATH = `${dir}/bindings.json`;
  meMode = 'ok';
});

describe('the channel board names the account it speaks as', () => {
  test('a configured X channel carries {id, username} — probed live, cached', async () => {
    const { default: router } = await import('../../backend/routes/social-channel-routes.js');
    const app = express();
    app.use(express.json());
    app.use('/api/v1/social-channels', router);
    const res = await request(app).get('/api/v1/social-channels').set(witness.header);
    expect(res.status).toBe(200);
    const x = res.body.channels.find((c) => c.id === 'x');
    expect(x.configured).toBe(true); // env creds are set
    expect(x.account).toEqual({ id: '1000', username: 'Umbrae_Ignis' });
  });

  test('an unanswered me-read yields null — the account is never invented', async () => {
    meMode = 'down';
    const { default: router } = await import('../../backend/routes/social-channel-routes.js');
    const app = express();
    app.use(express.json());
    app.use('/api/v1/social-channels', router);
    const res = await request(app).get('/api/v1/social-channels').set(witness.header);
    const x = res.body.channels.find((c) => c.id === 'x');
    expect(x.account ?? null).toBeNull();
  });
});

describe('postedAs — the account locked in for THIS post, permanently', () => {
  test('recordOutcome stamps postedAs on a successful send', async () => {
    const { postQueue } = await import('../../backend/services/social/post-queue.js');
    const e = await postQueue.add({ channelId: 'x', text: 'who am I posting as', queuedBy: 'test' });
    await postQueue.approve(e.id, { decidedBy: '0xW' });
    await postQueue.claimForSend(e.id);
    await postQueue.recordOutcome(e.id, {
      ok: true, id: '4242', postedAs: { id: '1000', username: 'Umbrae_Ignis' },
    });
    const [after] = await postQueue.load();
    expect(after.status).toBe('sent');
    expect(after.postedAs).toEqual({ id: '1000', username: 'Umbrae_Ignis' });
  });

  test('a scheduler publish through the REAL path lands postedAs from the live me-read', async () => {
    // The binding the send-time re-check law requires: this channel HAS a
    // holder, and the entry is authored by them.
    // …and the house it belongs to, served by this backend: the tick acts on nothing else.
    const house = await useServedHouse({ lanes: ['test-holder'] });
    const fs = await import('fs/promises');
    await fs.writeFile(process.env.NEUMA_SOCIAL_BINDINGS_PATH, JSON.stringify({
      x: { neumaId: 'test-holder', boundBy: SERVED_WALLET, boundAt: new Date().toISOString() },
    }));
    const { postQueue } = await import('../../backend/services/social/post-queue.js');
    const { schedulerTick } = await import('../../backend/services/social/post-scheduler.js');
    const e = await postQueue.add({
      channelId: 'x', text: 'scheduled with identity',
      scheduledFor: new Date(Date.now() - 60000).toISOString(),
      queuedBy: 'test-holder', authorNeumaId: 'test-holder',
    });
    await postQueue.approve(e.id, { decidedBy: SERVED_WALLET });
    await schedulerTick(Date.now()).finally(house.restore);
    const [after] = await postQueue.load();
    expect(after.status).toBe('sent');
    expect(after.postId).toBe('4242');
    expect(after.postedAs).toEqual({ id: '1000', username: 'Umbrae_Ignis' });
  });
});
