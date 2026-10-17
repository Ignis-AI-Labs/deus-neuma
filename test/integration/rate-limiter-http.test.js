// Real HTTP admission, signed wallet identity and native process environment.
import express from 'express';
import http from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { clearInterval } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { test, expect } from 'vitest';
import { createRateLimiter, neumaAuthLimiter, apiLimiter, STATUS_PROBE_MAX } from '../../backend/services/rate-limiter.js';
import { requireAuth } from '../../backend/services/auth.js';
import { fullAuth } from '../helpers/audit-auth.js';

const execute = promisify(execFile);
const envHost = fileURLToPath(new URL('../helpers/rate-limiter-process.js', import.meta.url));

// A real HTTP endpoint after the middleware: its 204 means admission, not a
// substitute for any production gallery/unlock/status endpoint response.
const withServer = async (middleware, run, { auth = false } = {}) => {
  const app = express();
  app.use(express.json());
  if (auth) app.use(requireAuth);
  app.use('/api', middleware);
  app.use((_req, res) => res.sendStatus(204));
  const server = http.createServer(app);
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    await run(server.address().port);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    if (middleware._cleanup) clearInterval(middleware._cleanup);
  }
};

const send = (port, { route = '/api/check', token, body, localAddress, method = 'GET' } = {}) =>
  new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: route, localAddress, method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
    }, (response) => {
      let text = '';
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end(body ? JSON.stringify(body) : undefined);
  });

const exhaust = async (port, options, allowed) => {
  for (let i = 0; i < allowed; i++) expect((await send(port, options)).status).toBe(204);
  const refused = await send(port, options);
  expect(refused.status).toBe(429);
  const body = JSON.parse(refused.text);
  expect(body.error).toBe('Too many requests');
  expect(body.retryAfterMs).toBeGreaterThan(0);
};

test('the default IP bucket admits then refuses; distinct real source addresses remain independent', async () => {
  await withServer(createRateLimiter({ windowMs: 60_000, max: 2 }), async (port) => {
    await exhaust(port, { localAddress: '127.0.0.1' }, 2);
    expect((await send(port, { localAddress: '127.0.0.2' })).status).toBe(204);
  });
});

test('custom wallet key follows the verified signer across IPs and separates signers', async () => {
  const first = await fullAuth(); const second = await fullAuth();
  await withServer(createRateLimiter({ windowMs: 60_000, max: 1, keyFn: (req) => req.walletAddress }), async (port) => {
    expect((await send(port)).status).toBe(401);
    expect((await send(port, { token: first.token, localAddress: '127.0.0.1' })).status).toBe(204);
    expect((await send(port, { token: first.token, localAddress: '127.0.0.2' })).status).toBe(429);
    expect((await send(port, { token: second.token })).status).toBe(204);
  }, { auth: true });
});

test('the real elapsed window restores admission', async () => {
  await withServer(createRateLimiter({ windowMs: 1000, max: 1 }), async (port) => {
    await exhaust(port, {}, 1);
    await delay(1100);
    expect((await send(port)).status).toBe(204);
  });
});

test('per-keypair buckets allow nine distinct targets and retain the ten-attempt bound', async () => {
  const { token } = await fullAuth();
  await withServer(neumaAuthLimiter, async (port) => {
    for (let i = 0; i < 9; i++) {
      expect((await send(port, { token, method: 'POST', body: { neumaId: `rate-fixture-${i}` } })).status).toBe(204);
    }
    await exhaust(port, { token, method: 'POST', body: { neumaId: 'repeated-rate-fixture' } }, 10);
    await exhaust(port, { token, method: 'POST', route: '/api/challenge', body: { address: 'address-bucket' } }, 10);
    await exhaust(port, { token, method: 'POST', route: '/api/challenge', body: {} }, 10);
    expect((await send(port, { token, method: 'POST', route: '/api/other-challenge', body: {} })).status).toBe(204);
  }, { auth: true });
});

test('API two-tier: session reads get 600/min, writes stay 200 — separate windows, exemptions and the status budget hold', async () => {
  const first = await fullAuth(); const second = await fullAuth();
  await withServer(apiLimiter, async (port) => {
    // The read tier: 600 tokened GETs pass, the 601st refuses — truthfully.
    await exhaust(port, { token: first.token, route: '/api/v1/gallery/items' }, 600);
    // The exemptions hold with the read tier spent.
    for (const route of ['/v1/gallery/file', '/v1/user/files/list', '/v1/user/files/events', '/v1/user/files/roots']) {
      expect((await send(port, { token: first.token, route: `/api${route}` })).status).toBe(204);
    }
    expect((await send(port, { token: first.token, route: '/api/v1/voice/transcribe', method: 'POST' })).status).toBe(204);
    // Metered read paths refuse; a WRITE still lands — polling never spends
    // the witness's acts (TOO MANY REQUESTS on uploads, live 2026-09-25).
    for (const route of ['/v1/health/detailed', '/v1/gallery/files', '/v1/user/files/roots/x']) {
      expect((await send(port, { token: first.token, route: `/api${route}` })).status).toBe(429);
    }
    expect((await send(port, { token: first.token, route: '/api/v1/llm/provider', method: 'PUT' })).status).toBe(204);
    // The essential status lights keep their own finite budget.
    for (const route of ['/v1/health', '/v1/llm/provider', '/v1/neuma/fenna/route/health', '/v1/witnesses/xai/Grok/health']) {
      expect((await send(port, { token: first.token, route: `/api${route}` })).status).toBe(204);
    }
    await exhaust(port, { token: first.token, route: '/api/v1/health' }, STATUS_PROBE_MAX - 4);

    // The write tier under a FRESH key: 200 POSTs pass, the 201st refuses.
    await exhaust(port, { token: second.token, route: '/api/v1/gallery/items', method: 'POST', body: {} }, 200);
    // Separate windows: spent writes leave the full 600 reads standing.
    await exhaust(port, { token: second.token, route: '/api/v1/gallery/items' }, 600);
  }, { auth: true });
});

test('production order (metered BEFORE auth, one local IP): spent reads never refuse a write', async () => {
  const { token } = await fullAuth();
  await withServer(apiLimiter, async (port) => {
    await exhaust(port, { token, route: '/api/v1/user/files/git-status' }, 600);
    expect((await send(port, { token, route: '/api/v1/attachments', method: 'POST', body: {} })).status).toBe(204);
    expect((await send(port, { route: '/api/v1/auth/challenge' })).status).toBe(204);
  });
});

for (const [ceiling, readRefusal, writeRefusal] of [
  [undefined, 601, 201], ['250', 251, 251], ['abc', 601, 201], ['0', 601, 201],
  ['-5', 601, 201], ['', 601, 201], ['99999', null, null],
]) {
  test(`fresh-process ceiling ${JSON.stringify(ceiling)} preserves exact API tiers and authentication limits`, async () => {
    const env = { ...process.env, NODE_OPTIONS: '' };
    delete env.NEUMA_RATE_GLOBAL_MAX;
    if (ceiling !== undefined) env.NEUMA_RATE_GLOBAL_MAX = ceiling;
    const { stdout } = await execute(
      process.execPath, [envHost, String(readRefusal || 12), String(writeRefusal || 12)], { env, timeout: 15_000 },
    );
    const result = JSON.parse(stdout.trim().split('\n').at(-1));
    expect(result).toEqual({ general: readRefusal, writes: writeRefusal, authentication: 11 });
  }, 20_000);
}
