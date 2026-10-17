// The probe's models-path derivation, proven over a REAL HTTP server — no mock
// anywhere in the path: a real listener on loopback records what liveModels
// actually sends, for the real registry entries.
//
// The bug this guards (found 2026-07-27): kimi-for-coding's catalog entry keeps
// its versioned base (https://api.kimi.com/coding/v1) with chatPath /messages,
// and the anthropic fallback '/v1/models' double-appended → /coding/v1/v1/models
// → 404 → probe.live always false → CONNECT refused → the desk could never lock
// kimi-for-coding, so no Kimi witness could be summoned. Verified against the
// live endpoint: the doubled path 404s, the derived /coding/v1/models answers
// 401 (auth-gated, real).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { liveModels } from '../../backend/services/provider-probe.js';
import { getProvider } from '../../backend/services/provider-registry.js';

let server;
let base;
let lastRequest;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    lastRequest = { url: req.url, headers: req.headers };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'm1' }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => server.close());

describe('liveModels — the models path each dialect really probes', () => {
  it('derives /models from /messages for an anthropic-dialect entry on a versioned base (kimi-for-coding)', async () => {
    const entry = getProvider('kimi-for-coding');
    expect(entry.chatPath).toBe('/messages'); // the catalog shape that broke
    const models = await liveModels(entry, `${base}/coding/v1`, 'test-key');
    expect(lastRequest.url).toBe('/coding/v1/models'); // not /coding/v1/v1/models
    expect(lastRequest.headers['x-api-key']).toBe('test-key');
    expect(lastRequest.headers['anthropic-version']).toBeTruthy();
    expect(models.some((m) => m._live)).toBe(true);
  });

  it('keeps anthropic proper on /v1/models — same path the old fallback produced', async () => {
    const entry = getProvider('anthropic');
    expect(entry.chatPath).toBe('/v1/messages');
    await liveModels(entry, base, 'test-key');
    expect(lastRequest.url).toBe('/v1/models');
  });

  it('still derives /models from /chat/completions for the openai dialect', async () => {
    const entry = getProvider('groq');
    expect(entry.chatPath).toBe('/v1/chat/completions');
    await liveModels(entry, `${base}/openai`, 'test-key');
    expect(lastRequest.url).toBe('/openai/v1/models');
    expect(lastRequest.headers.authorization).toBe('Bearer test-key');
  });
});
