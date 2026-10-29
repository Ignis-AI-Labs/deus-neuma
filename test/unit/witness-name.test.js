// witness-name.test.js — the platform's one witness-addressing module, and
// the canonical-title legend the founding rite shows.
//
// FLAGGED SEAM (RULE 0 justification): localStorage and window/CustomEvent
// are the browser's APIs — Node has neither, so the shims below stand at
// those seams exactly like the drive tests' window.neuma.wallet. What
// these tests prove is OUR logic (namespacing, trim, clear, no-storage
// fallback, and that setWitnessName CALLS dispatchEvent with the right
// shape). Persistence AND event delivery-to-listener are proven in the
// real browser by a rehearsal walk (ACCOUNT sets the name and the
// already-open HOUSE header re-reads live).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getWitnessName, setWitnessName } from '../../frontend/app/RelinkShell/witness-name.js';
import { TITLE_LEGEND } from '../../frontend/app/RelinkShell/founding-titles.js';

const storageShim = () => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
};

beforeEach(() => { globalThis.localStorage = storageShim(); });
afterEach(() => { delete globalThis.localStorage; });

describe('witness-name — how the platform addresses the witness', () => {
  it('remembers the name, wallet-namespaced like the roster cache', () => {
    localStorage.setItem('walletAddress', '0xABCDEF');
    setWitnessName('Founder');
    expect(getWitnessName()).toBe('Founder');
    expect(localStorage.getItem('0xabcdef:witness-name')).toBe('Founder');
    // Another wallet on the same desk has its own name.
    localStorage.setItem('walletAddress', '0x123456');
    expect(getWitnessName()).toBe('');
  });

  it('trims the spoken name; an empty name clears it', () => {
    setWitnessName('  Founder  ');
    expect(getWitnessName()).toBe('Founder');
    setWitnessName('   ');
    expect(getWitnessName()).toBe('');
  });

  it('setWitnessName dispatches a operator:named CustomEvent carrying the trimmed name', () => {
    const events = [];
    globalThis.window = {
      dispatchEvent: (e) => events.push(e),
    };
    globalThis.CustomEvent = class { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } };
    try {
      setWitnessName('  Founder  '); // the dispatched payload is the TRIMMED truth
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('operator:named');
      expect(events[0].detail).toEqual({ name: 'Founder' });
    } finally {
      delete globalThis.window;
      delete globalThis.CustomEvent;
    }
  });

  it('a desk without storage keeps no name but never throws', () => {
    delete globalThis.localStorage;
    expect(getWitnessName()).toBe('');
    expect(() => setWitnessName('Founder')).not.toThrow();
  });
});

describe('founding-titles — the legend', () => {
  it('carries all sixteen canonical roles, each tied to its corporate seat, frozen', () => {
    expect(TITLE_LEGEND).toHaveLength(16);
    expect(TITLE_LEGEND.map((r) => r.title)).toEqual([
      'Rector', 'Optio', 'Faber', 'Quaestor', 'Aedile', 'Praefectus', 'Praetor', 'Legatus', 'Scriba', 'Curator',
      'Mercator', 'Architectus', 'Numerarius', 'Speculator', 'Praeco', 'Logista',
    ]);
    expect(TITLE_LEGEND.map((r) => r.position)).toEqual([
      'CEO', 'COS', 'COO', 'CFO', 'CTO', 'CSO', 'CLO', 'CMO', 'CKO', 'CCRO', 'CRO', 'CPO', 'CDO', 'CINO', 'CCO', 'CAO',
    ]);
    expect(Object.isFrozen(TITLE_LEGEND)).toBe(true);
    TITLE_LEGEND.forEach((r) => {
      expect(r.meaning.length).toBeGreaterThan(0);
      // The seat is spelled out in full — never a bare acronym in the legend.
      expect(r.seat).toMatch(/^CHIEF (.+ OFFICER|OF STAFF)$/);
      expect(['founding', 'growth']).toContain(r.tier);
    });
    // One function, one seat — no corporate anchor may serve two titles.
    expect(new Set(TITLE_LEGEND.map((r) => r.position)).size).toBe(TITLE_LEGEND.length);
    // The founding seats are the ten a house carries from day one —
    // security (Praefectus/CSO) stands among them, no less fundamental
    // than law (ruling, 2026-07-24).
    expect(TITLE_LEGEND.filter((r) => r.tier === 'founding')).toHaveLength(10);
    // The books stand their own growth seat (ruling, 2026-10-29: TREASURY is
    // not ACCOUNTS) — seated when the company first has money moving.
    expect(TITLE_LEGEND.filter((r) => r.tier === 'growth')).toHaveLength(6);
  });
});
