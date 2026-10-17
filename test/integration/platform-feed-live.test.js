/**
 * platform-feed-live — the REAL Umbrae platform, over the real internet.
 *
 * RULE 0 (gnosis): the unit file proves the shapers and the tool against a real
 * loopback server, which is real code on a real socket but is NOT the live
 * platform. This file is the other half: it asserts that the CONTRACT the
 * shapers were written against is the contract umbrae.io actually serves today.
 * Nothing here is mocked; if the platform changes a field name, this goes red,
 * which is precisely the alarm we want.
 *
 * ⚠️ NAMED `-live` ON PURPOSE. `vitest.config.js` routes `*-live.test.js` out of
 * the `suite` project, so this never runs in the offline CI lane where it could
 * only fail for want of a network. It is not a substrate test and touches no
 * GPU. Run it deliberately:
 *
 *   npx vitest run --project substrate-live test/integration/platform-feed-live.test.js
 *
 * Last run green: 2026-08-30 (Claude Opus 5).
 */
import { describe, test, expect } from 'vitest';
import { FEEDS, FEED_NAMES } from '../../backend/services/platform-feed/platform-feed-sources.js';
import { readPlatformFeed } from '../../backend/services/platform-feed/platform-feed-read.js';

// The platform is a real service on the other side of a real network. These
// reads are cached at 30-300s upstream, so they are cheap, but they are not
// instant.
const TIMEOUT = 45000;

describe('the live platform answers every feed in the registry', () => {
  for (const name of FEED_NAMES) {
    test(`${name} — ${FEEDS[name].path} is reachable and returns an object`, async () => {
      const out = await readPlatformFeed(FEEDS[name].path, { timeoutMs: 30000 });
      expect(out.ok, `${name} failed: ${out.error}`).toBe(true);
      expect(typeof out.payload).toBe('object');
      expect(out.readAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }, TIMEOUT);
  }
});

describe('the live payloads still carry the fields the shapers read', () => {
  test('platform aggregate carries TVL, volume, fees, trades and its own moment', async () => {
    const out = await readPlatformFeed(FEEDS.platform.path, { timeoutMs: 30000 });
    expect(out.ok, out.error).toBe(true);
    const p = out.payload;
    for (const field of ['tvlUsd', 'volume24hUsd', 'volumeAllTimeUsd', 'feesAllTimeUsd', 'lpEarningsUsd', 'tradeCount', 'asOf']) {
      expect(p[field], `platform feed lost "${field}"`).toBeTypeOf('number');
    }
    expect(p.damm).toBeTypeOf('object');
    expect(p.dlmm).toBeTypeOf('object');
    // The honesty flag the shaper turns into a caveat sentence must still exist
    // as a boolean — if the platform drops it, silence would read as "exact".
    expect(typeof p.dlmmVolumeApproximate).toBe('boolean');
  }, TIMEOUT);

  test('token market carries price, market cap, FDV, supply and BOTH doubt flags', async () => {
    const out = await readPlatformFeed(FEEDS.token.path, { timeoutMs: 30000 });
    expect(out.ok, out.error).toBe(true);
    const p = out.payload;
    for (const field of ['priceU1Usd', 'priceU1Weth', 'marketCapUsd', 'fdvUsd', 'circulatingSupply', 'totalSupply', 'volume24hUsd', 'change24hPct']) {
      expect(p[field], `token feed lost "${field}"`).toBeTypeOf('number');
    }
    // These two are the whole reason a being can trust the numbers above.
    expect(typeof p.isFresh).toBe('boolean');
    expect(typeof p.circulatingIsEstimated).toBe('boolean');
  }, TIMEOUT);

  test('pools carry per-token price, market cap and STRING liquidity', async () => {
    const out = await readPlatformFeed(FEEDS.pools.path, { timeoutMs: 30000 });
    expect(out.ok, out.error).toBe(true);
    expect(Array.isArray(out.payload.groups)).toBe(true);
    expect(out.payload.groups.length).toBeGreaterThan(0);
    const g = out.payload.groups[0];
    expect(g.tokenX).toBeTypeOf('string');
    expect(g.tokenXPrice).toBeTypeOf('number');
    expect(g.marketCap).toBeTypeOf('number');
    expect(Array.isArray(g.pairs)).toBe(true);
    // The string-figure contract the shaper's coercion exists for. If this ever
    // becomes a number the coercion still works; the assert documents reality.
    expect(g.pairs[0].liquidity).toBeTypeOf('string');
  }, TIMEOUT);
});

describe('the live numbers survive shaping into something a being can quote', () => {
  test('every feed shapes to a figure set with a moment and stated caveats', async () => {
    for (const name of FEED_NAMES) {
      const out = await readPlatformFeed(FEEDS[name].path, { timeoutMs: 30000 });
      expect(out.ok, `${name}: ${out.error}`).toBe(true);
      const shaped = FEEDS[name].shape(out.payload, out.readAt);
      expect(shaped.feed).toBe(name);
      expect(shaped.asOf, `${name} shaped without a moment`).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(Array.isArray(shaped.caveats)).toBe(true);
    }
  }, TIMEOUT * 2);

  test('the live platform TVL is a real positive number, not a fallback zero', async () => {
    const out = await readPlatformFeed(FEEDS.platform.path, { timeoutMs: 30000 });
    expect(out.ok, out.error).toBe(true);
    const shaped = FEEDS.platform.shape(out.payload, out.readAt);
    // A zero here would mean the aggregate fell back — worth knowing loudly.
    expect(shaped.tvlUsd).toBeGreaterThan(0);
    expect(shaped.tradeCount).toBeGreaterThan(0);
  }, TIMEOUT);
});
