/**
 * substrate-health — the SUBSTRATE light's tri-state probe contract.
 *
 * A failed probe of the probe (transport down, 429, auth refusal, 5xx)
 * reads CHECKING (reachable:null), never OFFLINE. Only a successful
 * provider body may assert reachable:false. Pure mapping is table-tested;
 * the impure fetch's load-bearing catch is proven by a REAL throw (a
 * relative path has no origin under node — the same catch a dead network
 * lands in). No mock anywhere (RULE 0).
 *
 * Limitation, stated rather than cheated: browser-origin 429/401/5xx
 * mapping cannot be driven through getSubstrateHealth without mocking
 * fetch or injecting a base URL. Those status codes are covered by the
 * pure mapper; the live 429-on-saturation path is the real Express
 * status-budget test in test/unit/rate-limiter.test.js.
 */
import { describe, it, expect } from 'vitest';
import {
  getSubstrateHealth,
  substrateHealthFromProbe,
} from '../../frontend/services/substrate-health.js';

describe('substrateHealthFromProbe — only a 2xx body may assert OFFLINE', () => {
  it('maps a connected provider with an active model to reachable', () => {
    expect(substrateHealthFromProbe(true, {
      status: 'connected',
      activeModel: 'qwen',
      standby: false,
      provider: 'local',
    })).toEqual({
      reachable: true,
      standby: false,
      provider: 'local',
      model: 'qwen',
    });
  });

  it('a successful disconnected body is honest OFFLINE, not CHECKING', () => {
    expect(substrateHealthFromProbe(true, {
      status: 'disconnected',
      activeModel: null,
      standby: false,
      provider: 'local',
    })).toEqual({
      reachable: false,
      standby: false,
      provider: 'local',
      model: null,
    });
  });

  it('keeps deliberate standby truth from a successful body', () => {
    expect(substrateHealthFromProbe(true, {
      status: 'disconnected',
      activeModel: null,
      standby: true,
      provider: 'local',
    })).toMatchObject({ reachable: false, standby: true });
  });

  it('429, auth refusal, and 5xx read CHECKING, never OFFLINE', () => {
    for (const _ of [429, 401, 403, 500, 503]) {
      const verdict = substrateHealthFromProbe(false, { status: 'connected' });
      expect(verdict).toEqual({ reachable: null, standby: false });
      expect(verdict.reachable).not.toBe(false);
    }
  });
});

describe('getSubstrateHealth — silence is not evidence the substrate is down', () => {
  it('a probe that cannot even be sent reads CHECKING, never OFFLINE', async () => {
    // Real failure, no mock: under node a relative path has no origin, so
    // the fetch inside the module genuinely throws — the exact catch a
    // dead network or refused socket lands in.
    const verdict = await getSubstrateHealth();
    expect(verdict).toEqual({ reachable: null, standby: false });
    expect(verdict.reachable).not.toBe(false);
  });
});
