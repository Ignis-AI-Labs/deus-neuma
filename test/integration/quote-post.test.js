/**
 * A QUOTE POST, staged and sent for real (quote-post.js): the queue keeps the quoted post, the
 * scheduler publishes through a real local HTTP server standing where X's API stands, and what X
 * receives is the words ending with the quoted post's link (quote_tweet_id is Enterprise-only, so it
 * is never sent). The social/queue contract refuses a quote that is not an X post. No mocks.
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import process from 'node:process';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { quoteOf } from '../../backend/services/social/quote-post.js';
import { socialQueueIntent } from '../../backend/services/intents/social-queue.js';
import { useServedHouse, SERVED_WALLET } from '../helpers/served-house.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

let root, server, saved, house;
const doors = ['NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_X_API_ROOT',
  'X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
afterEach(async () => {
  house?.restore();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (saved) for (const key of doors) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const QUOTED = 'https://x.com/fameex/status/1988776655443322110';

test('a quote post goes out as X builds one: the words, then the quoted post\'s link', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-quote-post-'));
  saved = Object.fromEntries(doors.map((key) => [key, process.env[key]]));
  house = await useServedHouse({ lanes: ['herald'] });
  await makeInstallOwner(SERVED_WALLET);
  process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(root, 'queue.json');
  process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = path.join(root, 'credentials.json');
  process.env.NEUMA_SOCIAL_BINDINGS_PATH = path.join(root, 'bindings.json');
  for (const key of doors.slice(4)) process.env[key] = 'fixture-only';
  const received = [];
  server = http.createServer(async (req, res) => {
    const json = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/2/users/me') return json({ data: { id: '1000', username: 'fixture' } });
    if (req.url === '/2/tweets' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      received.push(JSON.parse(body));
      return json({ data: { id: '2081973247718162999', text: received.at(-1).text } }, 201);
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.NEUMA_X_API_ROOT = `http://127.0.0.1:${server.address().port}/2`;
  const { schedulerTick } = await import('../../backend/services/social/post-scheduler.js');

  const entry = await postQueue.add({ channelId: 'x', text: 'The Space today was worth an hour.', quote: quoteOf(QUOTED), queuedBy: SERVED_WALLET });
  expect(entry.quote).toEqual({ postId: '1988776655443322110', url: QUOTED });
  await postQueue.approve(entry.id, { decidedBy: SERVED_WALLET });
  await schedulerTick();
  expect(received).toEqual([{ text: `The Space today was worth an hour. ${QUOTED}` }]);
  expect((await postQueue.load()).find((e) => e.id === entry.id).status).toBe('sent');

  // the queue's own door: X only, never a reply, the link counted as 23 characters
  await expect(postQueue.add({ channelId: 'bluesky', text: 'hi', quote: quoteOf(QUOTED), queuedBy: SERVED_WALLET })).rejects.toThrow(/X only/);
  await expect(postQueue.add({ channelId: 'x', text: 'a'.repeat(260), quote: quoteOf(QUOTED), queuedBy: SERVED_WALLET })).rejects.toThrow(/284 characters/);
  await expect(postQueue.add({ channelId: 'x', text: 'a'.repeat(256), quote: quoteOf(QUOTED), queuedBy: SERVED_WALLET })).resolves.toBeTruthy();
}, 60_000);

test('the social/queue contract names quote and refuses one that is not an X post', async () => {
  expect(socialQueueIntent.fieldsForPrompt).toMatch(/quote\?/);
  const refused = await socialQueueIntent.validate({ channel: 'x', text: 'look', quote: 'https://example.com/not-a-post' }, { connection: {} });
  expect(refused).toMatchObject({ ok: false, status: 'invalid' });
  expect(refused.reason).toMatch(/quote must be the X post's link/);
});
