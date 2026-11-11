// x-media upload over a real connection: a dropped connection is asked again, X's refusal is final.
//
// 2026-11-10, 21:01: the machine's network blinked for ten seconds and an approved image post
// failed as […], after 64 image posts had gone out on this path.
// A real loopback HTTP server stands in for X (the NEUMA_X_API_ROOT door x-media carries), and
// drops connections the way the network did: the socket is destroyed before any answer.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { Buffer } from 'node:buffer';
import { uploadMedia } from '../../backend/services/social/x-media.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(32)]);
const file = { content: PNG, contentType: 'image/png', filename: 'card.png' };
const credentials = { apiKey: 'k', apiSecret: 's', accessToken: 't', accessSecret: 'ts' };
const FAST = [20, 20, 20];

let server;
let plan = []; // what the stand-in does per request, in order: 'drop' | 503 | 400 | 'ok'
let seen = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const act = plan[seen] ?? 'ok';
    seen += 1;
    req.resume();
    req.on('end', () => {
      if (act === 'drop') { req.socket.destroy(); return; }
      res.setHeader('Content-Type', 'application/json');
      if (act === 'ok') { res.end(JSON.stringify({ data: { id: `m${seen}` } })); return; }
      res.statusCode = act;
      res.end(JSON.stringify({ detail: act === 400 ? 'media type unrecognized' : 'Service Unavailable' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.NEUMA_X_API_ROOT = `http://127.0.0.1:${server.address().port}/2`;
});

afterAll(async () => {
  delete process.env.NEUMA_X_API_ROOT;
  await new Promise((resolve) => server.close(resolve));
});

const run = async (steps) => {
  plan = steps;
  seen = 0;
  const result = await uploadMedia(credentials, file, { retryWaitsMs: FAST });
  return { result, requests: seen };
};

describe('a dropped connection is not an answer', () => {
  test('THE 21:01 CASE: the network drops the first two tries, the third uploads', async () => {
    const { result, requests } = await run(['drop', 'drop', 'ok']);
    expect(result).toEqual({ ok: true, mediaId: 'm3' });
    expect(requests).toBe(3);
  });

  test('a server error (5xx) is asked again too', async () => {
    const { result, requests } = await run([503, 'ok']);
    expect(result).toEqual({ ok: true, mediaId: 'm2' });
    expect(requests).toBe(2);
  });

  test("X's own refusal (4xx) is final: asked once, its words kept", async () => {
    const { result, requests } = await run([400, 'ok']);
    expect(result).toEqual({ ok: false, status: 400, detail: 'media type unrecognized' });
    expect(requests).toBe(1);
  });

  test('a network that never comes back fails with the reason and the count, after every wait', async () => {
    const { result, requests } = await run(['drop', 'drop', 'drop', 'drop']);
    expect(result.ok).toBe(false);
    expect(requests).toBe(4);
    expect(result.detail).toMatch(/fetch failed/);
    expect(result.detail).toMatch(/network did not carry the upload/);
    expect(result.detail).toMatch(/tried 4 times/);
  });

  test('an interruption during a wait stops at once and says so', async () => {
    plan = ['drop', 'ok'];
    seen = 0;
    const controller = new globalThis.AbortController();
    const pending = uploadMedia(credentials, file, { signal: controller.signal, retryWaitsMs: [60_000] });
    await new Promise((resolve) => setTimeout(resolve, 200));
    controller.abort();
    expect(await pending).toEqual({ ok: false, detail: 'interrupted before the image was uploaded' });
    expect(seen).toBe(1);
  });
});
