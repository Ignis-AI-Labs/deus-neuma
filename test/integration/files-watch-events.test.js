/**
 * Integration proof for the Explorer live-watch lane: the REAL router, REAL
 * auth (an HMAC session token minted by the real auth service and verified by
 * the real requireAuth), a REAL HTTP server, a REAL SSE stream, real fs.watch
 * under a real temp root, and a real write landing as a `files:changed` frame
 * on the wire. No mock anywhere on the claimed path (RULE 0).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createSessionToken } from '../../backend/services/auth.js';
import { setRoots } from '../../backend/services/user-files.js';
import { stopFilesWatchers } from '../../backend/services/files-watcher.js';
import router from '../../backend/routes/user-files-routes.js';

const WALLET = '0x2222222222222222222222222222222222222222';

let server;
let base;
let root;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-sse-'));
  setRoots([root]);
  const app = express();
  app.use('/api/v1/user/files', router);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve); // ephemeral — the port law
  });
  base = `http://127.0.0.1:${server.address().port}/api/v1/user/files`;
});

afterAll(async () => {
  stopFilesWatchers();
  setRoots([]);
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
});

test('no token → the lane refuses (requireAuth, for real)', async () => {
  const res = await fetch(`${base}/events`);
  expect(res.status).toBe(401);
});

test('a real write reaches a live SSE subscriber as a files:changed frame', async () => {
  const token = createSessionToken(WALLET);
  const abort = new AbortController();
  // The token rides the QUERY — the exact path an EventSource must use.
  const res = await fetch(`${base}/events?token=${encodeURIComponent(token)}`, {
    signal: abort.signal,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let wire = '';
  const readUntil = async (pred, ms = 5000) => {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > ms) throw new Error(`frame never arrived; wire so far: ${wire}`);
      const { value, done } = await reader.read();
      if (done) throw new Error('stream closed early');
      wire += decoder.decode(value, { stream: true });
    }
  };

  // The preamble opens the stream; the watcher is live from the first
  // subscriber — write AFTER the stream stands.
  await readUntil(() => wire.includes(': live'));
  const born = path.join(root, 'seen-from-outside.txt');
  await fs.writeFile(born, 'the terminal wrote this');
  await readUntil(() => wire.includes('seen-from-outside.txt'));

  const frame = JSON.parse(wire.split('data: ').pop().split('\n')[0]);
  expect(frame.paths).toContain(born);
  abort.abort();
});
