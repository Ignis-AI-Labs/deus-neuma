/**
 * Tests for the companion-data utility — localStorage helpers that
 * namespace neuma state by wallet address so a single browser can
 * safely hold state for multiple witness wallets.
 *
 * Phase 1.4 of the frontend redesign roadmap.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

// Minimal localStorage shim for Node test environment.
const makeStorage = () => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => Array.from(store.keys())[i] ?? null,
    _raw: store,
  };
};

let localStorageShim;
let companionData;

beforeEach(async () => {
  localStorageShim = makeStorage();
  vi.stubGlobal('localStorage', localStorageShim);
  vi.resetModules();
  companionData = await import('../../frontend/utils/companion-data.js');
});

describe('companion-data — wallet namespacing', () => {

  test('scoped key falls back to unscoped when no wallet is set', async () => {
    const { scopedKey } = companionData.__test;
    expect(scopedKey('neuma-companion')).toBe('neuma-companion');
  });

  test('scoped key uses wallet prefix when wallet is set', async () => {
    localStorageShim.setItem('walletAddress', '0xABC123');
    const { scopedKey } = companionData.__test;
    expect(scopedKey('neuma-companion')).toBe('0xabc123:neuma-companion');
  });

  test('wallet address is lowercased for consistency', async () => {
    localStorageShim.setItem('walletAddress', '0xMixedCase');
    const { getWalletAddress } = companionData.__test;
    expect(getWalletAddress()).toBe('0xmixedcase');
  });

  test('active companion roundtrips under a wallet', async () => {
    localStorageShim.setItem('walletAddress', '0xAlice');
    companionData.setActiveCompanion({ name: 'Aster', neumaId: 'aster-123' });
    const companion = companionData.getActiveCompanion();
    expect(companion.name).toBe('Aster');
    expect(companion.neumaId).toBe('aster-123');
  });

  test('two wallets do not see each other\'s active companion', async () => {
    localStorageShim.setItem('walletAddress', '0xAlice');
    companionData.setActiveCompanion({ name: 'Aster', neumaId: 'a1' });

    localStorageShim.setItem('walletAddress', '0xBob');
    expect(companionData.getActiveCompanion()).toBeNull();
    companionData.setActiveCompanion({ name: 'Bodhi', neumaId: 'b1' });
    expect(companionData.getActiveCompanion()?.name).toBe('Bodhi');

    localStorageShim.setItem('walletAddress', '0xAlice');
    expect(companionData.getActiveCompanion()?.name).toBe('Aster');
    expect(companionData.getActiveCompanion()?.neumaId).toBe('a1');
  });

  test('roster is per-wallet and setRoster persists scoped', async () => {
    localStorageShim.setItem('walletAddress', '0xAlice');
    companionData.setRoster([{ name: 'A' }, { name: 'B' }]);
    expect(companionData.getRoster()).toEqual([{ name: 'A' }, { name: 'B' }]);

    localStorageShim.setItem('walletAddress', '0xBob');
    expect(companionData.getRoster()).toEqual([]);
  });

  test('birth time is per-wallet', async () => {
    localStorageShim.setItem('walletAddress', '0xAlice');
    companionData.setBirthTime('2026-04-15T12:00:00Z');

    localStorageShim.setItem('walletAddress', '0xBob');
    expect(companionData.getBirthTime()).toBeNull();

    localStorageShim.setItem('walletAddress', '0xAlice');
    expect(companionData.getBirthTime()).toBe('2026-04-15T12:00:00Z');
  });

  test('clearActiveCompanion only clears the current wallet', async () => {
    localStorageShim.setItem('walletAddress', '0xAlice');
    companionData.setActiveCompanion({ name: 'Aster' });
    localStorageShim.setItem('walletAddress', '0xBob');
    companionData.setActiveCompanion({ name: 'Bodhi' });

    localStorageShim.setItem('walletAddress', '0xAlice');
    companionData.clearActiveCompanion();
    expect(companionData.getActiveCompanion()).toBeNull();

    localStorageShim.setItem('walletAddress', '0xBob');
    expect(companionData.getActiveCompanion()?.name).toBe('Bodhi');
  });
});

describe('companion-data — legacy migration', () => {
  test('legacy unkeyed companion is migrated into current wallet namespace', async () => {
    // Simulate a pre-Phase-1.4 state: unscoped companion + roster in localStorage
    localStorageShim.setItem('neuma-companion', JSON.stringify({ name: 'LegacyNeuma', neumaId: 'legacy-1' }));
    localStorageShim.setItem('neuma-roster', JSON.stringify([{ name: 'LegacyNeuma' }]));
    localStorageShim.setItem('neuma-birth-time', '2026-01-01T00:00:00Z');

    // Now the witness connects a wallet for the first time
    localStorageShim.setItem('walletAddress', '0xAlice');

    expect(companionData.getActiveCompanion()?.name).toBe('LegacyNeuma');
    expect(companionData.getRoster()).toEqual([{ name: 'LegacyNeuma' }]);
    expect(companionData.getBirthTime()).toBe('2026-01-01T00:00:00Z');

    // The wallet-scoped copies should now exist
    expect(localStorageShim.getItem('0xalice:neuma-companion')).toContain('LegacyNeuma');
    expect(localStorageShim.getItem('0xalice:neuma-roster')).toContain('LegacyNeuma');
    expect(localStorageShim.getItem('0xalice:neuma-birth-time')).toBe('2026-01-01T00:00:00Z');
  });

  test('migration is idempotent — second read does not overwrite existing scoped data', async () => {
    localStorageShim.setItem('walletAddress', '0xAlice');
    localStorageShim.setItem('0xalice:neuma-companion', JSON.stringify({ name: 'ScopedNeuma' }));
    // Legacy data also present but should NOT overwrite
    localStorageShim.setItem('neuma-companion', JSON.stringify({ name: 'LegacyNeuma' }));

    expect(companionData.getActiveCompanion()?.name).toBe('ScopedNeuma');
  });

  test('migration does nothing when no wallet is connected', async () => {
    // No wallet set — helper falls back to unscoped reads directly
    localStorageShim.setItem('neuma-companion', JSON.stringify({ name: 'LegacyNeuma' }));
    expect(companionData.getActiveCompanion()?.name).toBe('LegacyNeuma');
    // And no scoped keys were created
    const keys = Array.from(localStorageShim._raw.keys());
    expect(keys.every(k => !k.includes(':'))).toBe(true);
  });
});

describe('companion-data — parseCompanionData backward compat', () => {
  test('parses plain string as { name }', () => {
    expect(companionData.parseCompanionData('Aster')).toEqual({ name: 'Aster' });
  });

  test('parses JSON object', () => {
    expect(companionData.parseCompanionData('{"name":"Aster","neumaId":"abc"}'))
      .toEqual({ name: 'Aster', neumaId: 'abc' });
  });

  test('returns null for null/empty', () => {
    expect(companionData.parseCompanionData(null)).toBeNull();
    expect(companionData.parseCompanionData('')).toBeNull();
  });
});
