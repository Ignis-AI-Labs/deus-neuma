/**
 * buildWalletPortfolio — the WHOLE chain, real end to end (#390 tranche 6).
 *
 * All three reads used to be mocked, leaving only the pure `buildPortfolio` to
 * run. So the test proved composition — which `wallet-portfolio.test.js`
 * already proves against the pure function directly — and proved nothing about
 * the orchestration, which is the only thing this module contains.
 *
 * Now every leg is real:
 *   listTokenBalances → real readBaseRpc → real ethers provider
 *                     → REAL JSON-RPC node that decodes the Multicall3 call
 *   fetchEthPrice     → real fetch → REAL price routes (real auth, real cache,
 *   fetchTokenPrices       real single-flight) → REAL upstream feed on loopback
 *   buildPortfolio    → pure, as before
 *
 * `price-routes.js` gained NEUMA_COINGECKO_URL for this. Its upstream was a
 * hardcoded const, so the price lane could not be exercised at all without
 * reaching the live public API — rate-limited, flaky, and outbound network from
 * a suite that should make none. The door is per-call, matching the settings
 * paths, and it also lets an operator aim the feed at a mirror.
 *
 * The one shim is a base-URL resolver for `fetch`: the frontend asks for
 * '/api/v1/prices/eth', and a browser resolves that against its origin while
 * Node cannot. The REAL fetch still does the work against the REAL routes —
 * nothing about a price is decided by the test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'http';
import { startLocalBaseRpc, storageWithRpc, browserWindow } from '../helpers/local-base-rpc.js';
import { BASE_TOKENS } from '../../frontend/app/RelinkShell/base-tokens.js';

const OWNER = '0x' + '11'.repeat(20);
const USDC = BASE_TOKENS.find((t) => t.coingeckoId === 'usd-coin');
const WETH = BASE_TOKENS.find((t) => t.coingeckoId === 'weth');

let node, feed, api, realFetch, previousUpstream;

/** A REAL upstream price feed on loopback, speaking CoinGecko's simple/price shape. */
const startFeed = (prices) => new Promise((resolve) => {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const ids = new URL(req.url, 'http://x').searchParams.get('ids') || '';
    const body = {};
    for (const id of ids.split(',').filter(Boolean)) {
      if (prices[id]) body[id] = { usd: prices[id].usd, usd_24h_change: prices[id].change24h };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1', () => resolve({
    server, hits, url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((d) => server.close(d)),
  }));
});

/** The REAL price routes on a real server, with a real session on every call. */
const startApi = async () => {
  // Imported AFTER vi.resetModules() — auth.js memoizes its token secret per
  // module instance, so a witness minted from a stale import 401s honestly.
  // (The rule is written up in test/README.md; it bit this file first.)
  const { strangerWitness } = await import('../helpers/witness.js');
  const witness = strangerWitness();
  const { default: priceRouter } = await import('../../backend/routes/price-routes.js');
  const app = express();
  app.use('/api/v1/prices', priceRouter);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    header: witness.header,
    close: () => new Promise((d) => server.close(d)),
  };
};

/**
 * Wire the whole chain and hand back the real orchestrator.
 * @param {{balances: object, prices: object}} world
 */
const withWorld = async ({ balances = {}, prices = {} } = {}) => {
  node = await startLocalBaseRpc({ balances });
  feed = await startFeed(prices);

  previousUpstream = process.env.NEUMA_COINGECKO_URL;
  process.env.NEUMA_COINGECKO_URL = feed.url;

  vi.resetModules(); // price routes read auth + env fresh
  api = await startApi();

  const storage = storageWithRpc(node.url, OWNER);
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', browserWindow(storage));

  // A browser resolves a relative URL against its origin; Node does not. The
  // REAL fetch still performs the request against the REAL routes, and the
  // witness session rides it because these routes are genuinely auth-gated.
  realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (url, opts = {}) => realFetch(
    typeof url === 'string' && url.startsWith('/') ? `${api.origin}${url}` : url,
    { ...opts, headers: { ...(opts.headers || {}), ...api.header } },
  ));

  const { buildWalletPortfolio } = await import('../../frontend/app/RelinkShell/wallet-portfolio-load.js');
  return buildWalletPortfolio;
};

beforeEach(() => { node = feed = api = null; });

afterEach(async () => {
  vi.unstubAllGlobals();
  if (previousUpstream === undefined) delete process.env.NEUMA_COINGECKO_URL;
  else process.env.NEUMA_COINGECKO_URL = previousUpstream;
  for (const s of [api, feed, node]) if (s) await s.close();
  node = feed = api = null;
});

describe('buildWalletPortfolio', () => {
  it('assembles ETH first, then non-zero token rows, with the right rolled-up total', async () => {
    const buildWalletPortfolio = await withWorld({
      balances: { [USDC.address]: 100000000n, [WETH.address]: 0n }, // 100 USDC (6dp)
      prices: { ethereum: { usd: 2000, change24h: 10 }, 'usd-coin': { usd: 1, change24h: 10 } },
    });

    const pf = await buildWalletPortfolio(OWNER, '0.1');
    expect(pf.rows.map((r) => r.symbol)).toEqual(['ETH', 'USDC']);
    expect(pf.usdTotal).toBeCloseTo(0.1 * 2000 + 100, 6);
    expect(pf.change24h).toBeCloseTo(10, 6);

    // Every leg really happened: a real eth_call, and a real upstream fetch.
    expect(node.calls.some((c) => c.method === 'eth_call')).toBe(true);
    expect(feed.hits.length).toBeGreaterThan(0);
  });

  it('prices ONLY the ids it actually holds — the upstream request proves it', async () => {
    // Impossible against a stub: with fetchTokenPrices mocked, whether the
    // orchestrator asked for the right coins was never observable.
    const buildWalletPortfolio = await withWorld({
      balances: { [USDC.address]: 5000000n },
      prices: { ethereum: { usd: 2000, change24h: 0 }, 'usd-coin': { usd: 1, change24h: 0 } },
    });
    await buildWalletPortfolio(OWNER, '0.1');

    const tokenCall = feed.hits.find((u) => u.includes('usd-coin'));
    expect(tokenCall).toBeTruthy();
    expect(tokenCall).not.toContain('weth'); // a zero balance is never priced
  });

  it('returns null for a missing address, and issues no reads at all', async () => {
    const buildWalletPortfolio = await withWorld({});
    expect(await buildWalletPortfolio(null, '1')).toBeNull();
    expect(node.calls.filter((c) => c.method === 'eth_call')).toHaveLength(0);
    expect(feed.hits).toHaveLength(0);
  });

  it('omits ETH when the native balance is unknown, keeps tokens', async () => {
    const buildWalletPortfolio = await withWorld({
      balances: { [USDC.address]: 100000000n },
      prices: { ethereum: { usd: 2000, change24h: 0 }, 'usd-coin': { usd: 1, change24h: 0 } },
    });
    const pf = await buildWalletPortfolio(OWNER, null);
    expect(pf.rows.map((r) => r.symbol)).toEqual(['USDC']);
    expect(pf.usdTotal).toBe(100);
  });

  it('an unpriced holding still shows as a row but adds nothing to the total', async () => {
    // The feed genuinely knows neither coin — the real "no price" answer.
    const buildWalletPortfolio = await withWorld({
      balances: { [USDC.address]: 5000000n },
      prices: {},
    });
    const pf = await buildWalletPortfolio(OWNER, '0.1');
    expect(pf.rows.map((r) => r.symbol)).toEqual(['ETH', 'USDC']);
    expect(pf.rows.find((r) => r.symbol === 'USDC').usd).toBeNull();
    expect(pf.rows.find((r) => r.symbol === 'ETH').usd).toBeNull();
    expect(pf.usdTotal).toBeNull(); // nothing priced → no fabricated $0
  });

  it('survives the chain really breaking: RPC down still yields the ETH row', async () => {
    const buildWalletPortfolio = await withWorld({
      prices: { ethereum: { usd: 2000, change24h: 0 } },
    });
    await node.close();
    node = null;

    const pf = await buildWalletPortfolio(OWNER, '0.5');
    expect(pf.rows.map((r) => r.symbol)).toEqual(['ETH']);
    expect(pf.usdTotal).toBeCloseTo(1000, 6);
  });
});
