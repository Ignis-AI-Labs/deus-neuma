import { describe, test, expect } from 'vitest';
import { shouldUnload } from '../../backend/services/substrate-idle.js';

// The live monitor→unload→reload loop is proven by integration against a real
// smoke llama-server (RULE 0); these cover the pure unload decision.

const base = { serving: true, owned: true, busy: false, lastActivityAt: 0, now: 60000, idleMs: 30000 };

describe('shouldUnload', () => {
  test('unloads a serving, owned, idle, quiet substrate past the window', () => {
    expect(shouldUnload(base)).toBe(true);
  });
  test('never unloads mid-generation (busy)', () => {
    expect(shouldUnload({ ...base, busy: true })).toBe(false);
  });
  test('never unloads a substrate NEUMA does not own', () => {
    expect(shouldUnload({ ...base, owned: false })).toBe(false);
  });
  test('never unloads what is not serving', () => {
    expect(shouldUnload({ ...base, serving: false })).toBe(false);
  });
  test('waits until the idle window has fully elapsed', () => {
    expect(shouldUnload({ ...base, now: 20000 })).toBe(false); // 20s < 30s window
    expect(shouldUnload({ ...base, now: 30000 })).toBe(true);  // exactly at the window
  });
  test('idleMs 0 disables unload entirely', () => {
    expect(shouldUnload({ ...base, idleMs: 0 })).toBe(false);
  });
});
