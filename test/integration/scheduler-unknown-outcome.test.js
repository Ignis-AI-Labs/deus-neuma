/** Real HTTP acceptance plus a transient filesystem fault; no hosted egress. */
import fs from 'node:fs/promises';
import { watch, existsSync, rmdirSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import process from 'node:process';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { useServedHouse, SERVED_WALLET } from '../helpers/served-house.js';

let root, server, watcher, saved, house;
const doors = ['NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_X_API_ROOT',
  'X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
afterEach(async () => {
  house?.restore();
  watcher?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (saved) for (const key of doors) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test('a transient recording failure after acceptance stays sending and reconciles without resending', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-uncertain-send-'));
  saved = Object.fromEntries(doors.map(key => [key, process.env[key]]));
  house = await useServedHouse({ lanes: ['herald'] }); // the tick acts only on a house its backend serves
  const queue = path.join(root, 'queue.json');
  const temporary = `${queue}.${process.pid}.tmp`;
  process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = queue;
  process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = path.join(root, 'credentials.json');
  // The machine's binding record is this test's own, never the operator's.
  process.env.NEUMA_SOCIAL_BINDINGS_PATH = path.join(root, 'bindings.json');
  for (const key of doors.slice(4)) process.env[key] = 'fixture-only';
  const accepted = [];
  let repaired = false;
  server = http.createServer(async (req, res) => {
    const json = body => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/2/users/me') return json({ data: { id: '1000', username: 'fixture' } });
    if (req.url.startsWith('/2/users/1000/tweets')) return json({ data: accepted });
    if (req.url === '/2/tweets' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      accepted.push({ id: '2081973247718162447', text: JSON.parse(body).text, created_at: new Date().toISOString() });
      // Block the actual outcome writer, then restore it only after its lock
      // releases. The old catch can write again and incorrectly marks FAILED.
      await fs.mkdir(temporary);
      watcher = watch(root, (_event, name) => {
        if (name === 'queue.json.lock' && !existsSync(`${queue}.lock`) && existsSync(temporary) && !repaired) {
          rmdirSync(temporary);
          repaired = true;
        }
      });
      return json({ data: accepted[0] });
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.NEUMA_X_API_ROOT = `http://127.0.0.1:${server.address().port}/2`;
  const { schedulerTick } = await import('../../backend/services/social/post-scheduler.js');
  const entry = await postQueue.add({ channelId: 'x', text: 'An accepted post whose receipt write fails.', queuedBy: SERVED_WALLET });
  await postQueue.approve(entry.id, { decidedBy: SERVED_WALLET });
  const outcomes = await schedulerTick();
  await expect.poll(() => repaired).toBe(true);
  expect(accepted).toHaveLength(1);
  expect((await postQueue.load())[0].status).toBe('sending');
  expect(outcomes[0]).toMatchObject({ ok: false, pending: true });
  await schedulerTick(Date.now() + 20 * 60 * 1000);
  const [settled] = await postQueue.load();
  expect(settled.status).toBe('sent');
  expect(settled.postId).toBe(accepted[0].id);
  expect(accepted).toHaveLength(1);
});
