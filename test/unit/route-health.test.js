/**
 * route-health — the lane→endpoint addressing doctrine and the tri-state
 * probe contract (#269 seam 2: zero coverage while #232's ROUTE corrections
 * sit directly on this module).
 *
 * The pure half is table-tested with real companion shapes. The impure half's
 * load-bearing clause — […] — is proven by REAL failures: no address, and a fetch that genuinely
 * throws (a relative path has no origin under node — the same catch that
 * absorbs a dead network). No mock anywhere (RULE 0); the success-mapping leg
 * (`data.live === true`) needs a browser origin and is covered by the desk
 * e2e, not simulated here.
 */
import { describe, it, expect } from 'vitest';
import { routeHealthPathFor, getLaneRouteHealth } from '../../frontend/services/route-health.js';

describe('routeHealthPathFor — which door speaks for this lane', () => {
  it('addresses a neuma lane by id', () => {
    expect(routeHealthPathFor({ neumaId: 'fenna' }))
      .toBe('/api/v1/neuma/fenna/route/health');
  });

  it('addresses a witness lane through its vendor + chosen name, never the lane string', () => {
    expect(routeHealthPathFor({
      neumaId: 'witness-kimi-code-Basunor',
      participantKind: 'witness',
      vendorSlug: 'kimi-code',
      witness: { chosenName: 'Basunor' },
    })).toBe('/api/v1/witnesses/kimi-code/Basunor/health');
  });

  it('recognizes a witness lane by ANY of its three markers', () => {
    const expected = '/api/v1/witnesses/xai/Grok/health';
    expect(routeHealthPathFor({ neumaId: 'x', participantKind: 'witness', vendorSlug: 'xai', name: 'Grok' })).toBe(expected);
    expect(routeHealthPathFor({ neumaId: 'x', witness: { vendorSlug: 'xai', chosenName: 'Grok' } })).toBe(expected);
    expect(routeHealthPathFor({ neumaId: 'witness-xai-Grok', vendorSlug: 'xai', name: 'Grok' })).toBe(expected);
  });

  it('URL-encodes what it interpolates', () => {
    expect(routeHealthPathFor({ neumaId: 'a b/c' })).toBe('/api/v1/neuma/a%20b%2Fc/route/health');
    expect(routeHealthPathFor({
      neumaId: 'witness-v-N', vendorSlug: 'v/x', name: 'N N',
    })).toBe('/api/v1/witnesses/v%2Fx/N%20N/health');
  });

  it('returns null when the lane cannot be addressed — nothing to poll', () => {
    expect(routeHealthPathFor(null)).toBeNull();
    expect(routeHealthPathFor({})).toBeNull();
    // A witness lane missing vendor or name is unaddressable, not guessable.
    expect(routeHealthPathFor({ neumaId: 'witness-x-Y', participantKind: 'witness' })).toBeNull();
    expect(routeHealthPathFor({ neumaId: 'witness-x-Y', participantKind: 'witness', vendorSlug: 'x' })).toBeNull();
  });
});

describe('getLaneRouteHealth — silence about the route is not evidence it failed', () => {
  it('an unaddressable lane reports UNBOUND without claiming the provider is down', async () => {
    for (const lane of [null, {}, { neumaId: 'witness-v-Name', name: 'Name' }]) {
      expect(await getLaneRouteHealth(lane))
        .toEqual({ live: null, provider: null, reason: 'unbound' });
    }
  });

  it('a probe that cannot even be sent reads UNKNOWN, never DOWN', async () => {
    // Real failure, no mock: under node a relative path has no origin, so the
    // fetch inside the module genuinely throws — the exact catch a dead
    // network or refused socket lands in. live must be null (UNKNOWN), and
    // must NEVER be false (DOWN): the probe failed, not the route.
    const verdict = await getLaneRouteHealth({ neumaId: 'fenna' });
    expect(verdict).toEqual({ live: null, provider: null });
    expect(verdict.live).not.toBe(false);
  });
});
