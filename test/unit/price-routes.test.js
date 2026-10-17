// Backend tests for the wallet price proxy. Real Express + a minted session token
// (no auth mock — Rule: don't fake the data path); the UPSTREAM feed is stubbed via
// global fetch so we can count calls and force failure shapes. Each test re-imports
// the router under vi.resetModules() so the module-level cache starts clean.
//
// Guards the exact bug the round-2 review caught: a 200 body shaped
// { ethereum: { usd: null } } must resolve to { usd: null } and must NOT be cached
// — never a coerced, fabricated $0.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const realFetch = globalThis.fetch.bind(globalThis);
let server = null;
let port = 0;
let token = '';
let calls = 0;

const start = async () => {
  vi.resetModules(); // fresh module-level ethCache/ethInFlight per test
  const [{ default: express }, { default: priceRouter }, { createSessionToken }] = await Promise.all([
    import('express'),
    import('../../backend/routes/price-routes.js'),
    import('../../backend/services/auth.js'),
  ]);
  token = createSessionToken('0x1111111111111111111111111111111111111111');
  const app = express();
  app.use('/api/v1/prices', priceRouter);
  await new Promise((res) => { server = app.listen(0, res); });
  port = server.address().port;
};

// The route's internal fetch (→ CoinGecko) is the global; test→server hops use realFetch.
const stubUpstream = (body, { ok = true, status = 200, delay = 0 } = {}) => {
  globalThis.fetch = async () => {
    calls++;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return { ok, status, json: async () => body };
  };
};

const get = (auth = true) =>
  realFetch(`http://localhost:${port}/api/v1/prices/eth`, auth ? { headers: { Authorization: `Bearer ${token}` } } : undefined);

const ETH_OK = { ethereum: { usd: 1752.21, usd_24h_change: 1.37 } };

beforeEach(async () => { calls = 0; await start(); });
afterEach(async () => {
  globalThis.fetch = realFetch;
  if (server) await new Promise((res) => server.close(res));
  server = null;
});

describe('GET /api/v1/prices/eth', () => {
  it('rejects an unauthenticated request (401)', async () => {
    stubUpstream(ETH_OK);
    const res = await get(false);
    expect(res.status).toBe(401);
    expect(calls).toBe(0); // never reached the upstream fetch
  });

  it('returns a real price and caches it (one upstream call)', async () => {
    stubUpstream(ETH_OK);
    const a = await (await get()).json();
    expect(a).toMatchObject({ usd: 1752.21, change24h: 1.37 });
    expect(typeof a.asOf).toBe('string');
    const b = await (await get()).json();
    expect(b).toEqual(a);
    expect(calls).toBe(1); // second request served from cache
  });

  it('a 200 body with usd:null → {usd:null}, NOT coerced to 0, NOT cached', async () => {
    stubUpstream({ ethereum: { usd: null, usd_24h_change: null } });
    const a = await (await get()).json();
    expect(a).toEqual({ usd: null }); // the round-2 regression: no fabricated $0
    const b = await (await get()).json();
    expect(b).toEqual({ usd: null });
    expect(calls).toBe(2); // failure was not cached — each request retried upstream
  });

  it('a non-OK upstream → {usd:null}', async () => {
    stubUpstream({}, { ok: false, status: 500 });
    expect(await (await get()).json()).toEqual({ usd: null });
  });

  it('single-flight: concurrent cold-cache requests make ONE upstream call', async () => {
    stubUpstream(ETH_OK, { delay: 50 });
    const results = await Promise.all(Array.from({ length: 5 }, () => get().then((r) => r.json())));
    expect(results.every((j) => j.usd === 1752.21)).toBe(true);
    expect(calls).toBe(1);
  });
});
