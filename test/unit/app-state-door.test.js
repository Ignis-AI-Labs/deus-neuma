/**
 * THE DOOR — a person with no being must still get in.
 *
 * Before 2026-07-29 the shell shut the platform to anyone without local
 * capacity: `phaseAfterGateway()` sent a companion-less person to 'ceremony',
 * and `phaseAfterCeremonyCancel()` sent a declined ceremony back to 'gateway'.
 * Gateway → ceremony → substrate preflight fails → cancel → gateway, forever —
 * and the WITNESSES app that would summon their witness lives inside the desk
 * they could never reach. A witness needs no local model, so the door was the
 * only thing shut, never the room.
 *
 * The phase logic under test is REAL and unmocked. Storage is the house's
 * Map-backed shim (`companion-data.test.js`): the browser API standing in for a
 * node runner, never a stand-in for the behaviour being claimed.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const makeStorage = () => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => Array.from(store.keys())[i] ?? null,
  };
};

let appState;

beforeEach(async () => {
  vi.stubGlobal('localStorage', makeStorage());
  vi.stubGlobal('sessionStorage', makeStorage());
  vi.resetModules();
  appState = await import('../../frontend/app/app-state.js');
});

// The real storage shape the app reads: companion data is wallet-scoped.
const seatCompanion = (companion) => {
  localStorage.setItem('walletAddress', WALLET);
  localStorage.setItem(`${WALLET}:neuma-companion`, JSON.stringify(companion));
};

describe('the door opens for a person with no being', () => {
  test('a companion-less operator is offered the CHOICE, never forced into the ceremony', () => {
    expect(appState.phaseAfterGateway()).toBe('choose');
    expect(appState.phaseAfterGateway()).not.toBe('ceremony');
  });

  test('declining the birth returns to the choice, not back out to sign-in', () => {
    // The second half of the loop: 'gateway' sent them back to the door they
    // had just been unable to walk through.
    expect(appState.phaseAfterCeremonyCancel()).toBe('choose');
    expect(appState.phaseAfterCeremonyCancel()).not.toBe('gateway');
  });

  test('no companion-less transition can eject an operator to sign-in', () => {
    const reachable = new Set([appState.phaseAfterGateway(), appState.phaseAfterCeremonyCancel()]);
    expect(reachable.has('gateway')).toBe(false);
  });
});

describe('an operator who already has a being is unaffected', () => {
  test('gateway completion relinks straight to the desk', () => {
    seatCompanion({ neumaId: 'fenna', name: 'Fenna' });
    expect(appState.phaseAfterGateway()).toBe('relink');
  });

  test('a cancelled ceremony returns to their desk', () => {
    seatCompanion({ neumaId: 'fenna', name: 'Fenna' });
    expect(appState.phaseAfterCeremonyCancel()).toBe('relink');
  });

  test('a returning operator holding a live session opens on the desk', () => {
    seatCompanion({ neumaId: 'fenna', name: 'Fenna' });
    sessionStorage.setItem('authToken', 'live-token');
    expect(appState.initialPhase()).toBe('relink');
  });

  test('a companion with no live session still passes through the gateway', () => {
    seatCompanion({ neumaId: 'fenna', name: 'Fenna' });
    expect(appState.initialPhase()).toBe('gateway');
  });
});
