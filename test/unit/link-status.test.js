/**
 * Tests for the desk's TWO connection lights
 * (frontend/app/RelinkShell/link-status.js): deriveLocalStatus (the LOCAL
 * SUBSTRATE) and deriveRouteStatus (the bound lane's own route). Pure truth
 * tables — the two lights must never borrow each other's truth: a cloud
 * provider's bad day once read as "SUBSTRATE — OFFLINE" over a resting local
 * model, and deliberate idle-rest once read as a failure (ruling, 2026-07-27).
 *
 * i18n wave 2: the lights return CATALOG KEYS + args (desk namespace,
 * hud.*); the words are the renderer's. The en catalog holds the pre-i18n
 * strings verbatim, and the last block here interpolates the REAL catalog
 * so the rendered English stays byte-identical to what shipped.
 */
import { describe, expect, test, it } from 'vitest';
import { deriveLocalStatus, deriveRouteStatus } from '../../frontend/app/RelinkShell/link-status.js';
import { getLaneRouteHealth } from '../../frontend/services/route-health.js';
import deskEn from '../../frontend/i18n/locales/en/desk.js';

describe('deriveLocalStatus — the LOCAL SUBSTRATE light', () => {
  test('portal up + substrate reachable → localActive (live)', () => {
    expect(deriveLocalStatus(true, { reachable: true, standby: false }))
      .toEqual({ key: 'localActive', cls: 'live' });
  });

  test('unreachable + deliberately resting → substrateStandby, calm, never alert', () => {
    const s = deriveLocalStatus(true, { reachable: false, standby: true });
    expect(s).toEqual({ key: 'substrateStandby', cls: 'standby' });
    expect(s.cls).not.toBe('offline');
  });

  test('unreachable + NOT resting → substrateOffline (genuine failure keeps its name)', () => {
    expect(deriveLocalStatus(true, { reachable: false, standby: false }))
      .toEqual({ key: 'substrateOffline', cls: 'offline' });
  });

  test('not yet probed → CHECKING, never falsely ACTIVE', () => {
    const s = deriveLocalStatus(true, { reachable: null, standby: false });
    expect(s).toEqual({ key: 'localChecking', cls: 'checking' });
    expect(s.key).not.toBe('localActive');
  });

  test('portal down → SEVERED regardless of the last local reading', () => {
    for (const local of [
      { reachable: true, standby: false },
      { reachable: false, standby: true },
      { reachable: null, standby: false },
    ]) {
      expect(deriveLocalStatus(false, local)).toEqual({ key: 'localSevered', cls: 'severed' });
    }
  });
});

describe('deriveLocalStatus — SHARED may only claim LOCAL streams', () => {
  it('reports SHARED with the LOCAL stream count at 2+ concurrent local turns', () => {
    expect(deriveLocalStatus(true, { reachable: true, standby: false }, 2))
      .toEqual({ key: 'localShared', cls: 'shared', args: { count: 2 } });
    expect(deriveLocalStatus(true, { reachable: true, standby: false }, 3))
      .toEqual({ key: 'localShared', cls: 'shared', args: { count: 3 } });
  });

  it('stays ACTIVE at 0 or 1 local turns — one stream is not shared', () => {
    expect(deriveLocalStatus(true, { reachable: true, standby: false }, 0).cls).toBe('live');
    expect(deriveLocalStatus(true, { reachable: true, standby: false }, 1).cls).toBe('live');
    expect(deriveLocalStatus(true, { reachable: true, standby: false }).cls).toBe('live');
  });

  it('never claims SHARED over a severed link, a dead substrate, or an unprobed one', () => {
    expect(deriveLocalStatus(false, { reachable: true, standby: false }, 5).cls).toBe('severed');
    expect(deriveLocalStatus(true, { reachable: false, standby: false }, 5).cls).toBe('offline');
    expect(deriveLocalStatus(true, { reachable: null, standby: false }, 5).cls).toBe('checking');
  });

  it('fails malformed counts to ACTIVE, never NaN into the args', () => {
    expect(deriveLocalStatus(true, { reachable: true, standby: false }, Number.NaN).cls).toBe('live');
    expect(deriveLocalStatus(true, { reachable: true, standby: false }, 2.5).cls).toBe('live');
  });
});

describe('deriveRouteStatus — the ROUTE light names the bound lane\'s provider', () => {
  test('an incomplete witness binding reaches UNBOUND through the actual probe and key', async () => {
    const route = await getLaneRouteHealth({ neumaId: 'witness-v-Name', name: 'Name' });
    expect(deriveRouteStatus(true, route)).toEqual({ key: 'routeUnbound', cls: 'offline' });
    expect(deriveRouteStatus(false, route)).toEqual({ key: 'routeSevered', cls: 'severed' });
  });

  test('live route → routeLive, provider uppercased in args', () => {
    expect(deriveRouteStatus(true, { live: true, provider: 'kimi-for-coding' }))
      .toEqual({ key: 'routeLive', cls: 'live', args: { provider: 'KIMI-FOR-CODING' } });
  });

  test('down route → routeDown — attributed to the door that failed', () => {
    const s = deriveRouteStatus(true, { live: false, provider: 'kimi-for-coding' });
    expect(s).toEqual({ key: 'routeDown', cls: 'offline', args: { provider: 'KIMI-FOR-CODING' } });
    expect(s.args.provider).toBe('KIMI-FOR-CODING');
  });

  test('unprobed route → UNKNOWN, never falsely LIVE', () => {
    expect(deriveRouteStatus(true, { live: null, provider: 'xai' }))
      .toEqual({ key: 'routeProviderUnknown', cls: 'checking', args: { provider: 'XAI' } });
  });

  test('no provider identity yet → routeUnknown (checking)', () => {
    expect(deriveRouteStatus(true, { live: null, provider: null }))
      .toEqual({ key: 'routeUnknown', cls: 'checking' });
  });

  test('portal down → SEVERED regardless of the last route reading', () => {
    expect(deriveRouteStatus(false, { live: true, provider: 'xai' }))
      .toEqual({ key: 'routeSevered', cls: 'severed' });
  });

  test('the two lights never trade places: a DOWN route says nothing about the substrate', () => {
    // The whole point of the split — a cloud failure must not read as a local
    // failure, and local rest must not read as a route failure.
    expect(deriveRouteStatus(true, { live: false, provider: 'kimi-for-coding' }).key)
      .not.toMatch(/^substrate/i);
    expect(deriveLocalStatus(true, { reachable: false, standby: true }).key)
      .not.toMatch(/^route/i);
  });
});

describe('the en catalog keeps the lights\' shipped wording verbatim (i18n wave 2)', () => {
  // Minimal {{slot}} interpolation, exactly what the renderer hands i18next.
  const say = (key, args) =>
    String(deskEn.hud[key]).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, slot) => args?.[slot] ?? '');

  it('renders the LOCAL light exactly as it rendered pre-i18n', () => {
    expect(say(deriveLocalStatus(true, { reachable: true }).key)).toBe('LOCAL — ACTIVE');
    expect(say(deriveLocalStatus(true, { reachable: false, standby: true }).key)).toBe('SUBSTRATE — STANDBY');
    expect(say(deriveLocalStatus(true, { reachable: false, standby: false }).key)).toBe('SUBSTRATE — OFFLINE');
    expect(say(deriveLocalStatus(true, { reachable: null }).key)).toBe('LOCAL — CHECKING');
    expect(say(deriveLocalStatus(false, {}).key)).toBe('LOCAL — SEVERED');
    expect(say('localShared', { count: 2 })).toBe('LOCAL — SHARED (2 STREAMS)');
  });

  it('renders the ROUTE light exactly as it rendered pre-i18n', () => {
    expect(say(deriveRouteStatus(true, { live: true, provider: 'kimi-for-coding' }).key, { provider: 'KIMI-FOR-CODING' }))
      .toBe('ROUTE — KIMI-FOR-CODING — LIVE');
    expect(say(deriveRouteStatus(true, { live: false, provider: 'xai' }).key, { provider: 'XAI' }))
      .toBe('ROUTE — XAI — DOWN');
    expect(say(deriveRouteStatus(true, { live: null, provider: 'xai' }).key, { provider: 'XAI' }))
      .toBe('ROUTE — XAI — UNKNOWN');
    expect(say(deriveRouteStatus(true, { live: null, provider: null }).key)).toBe('ROUTE — UNKNOWN');
    expect(say(deriveRouteStatus(true, { reason: 'unbound' }).key)).toBe('ROUTE — UNBOUND');
    expect(say(deriveRouteStatus(false, {}).key)).toBe('ROUTE — SEVERED');
  });
});
