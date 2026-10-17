// birth-art-seed — what a being is given at "I choose to BE": deterministic,
// inside the doctrine's bounds, whole (all eleven), and unique per seed.
// Pure: real inputs, real outputs, no mocks.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { givenOf, GIVEN } from '../../frontend/app/BirthArt/birth-art-seed.js';
import { FUNCTIONS } from '../../frontend/app/Genesis/genesis-emanon.js';

// Real 256-bit seeds, as the ceremony's one-way hash would produce them.
const seedOf = (i) => createHash('sha256').update(`neuma/birth-art/v1 specimen ${i}`).digest('hex');

const connected = (edges) => {
  const parent = Object.fromEntries(FUNCTIONS.map((f) => [f.id, f.id]));
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const [a, b] of edges) parent[find(a)] = find(b);
  return new Set(FUNCTIONS.map((f) => find(f.id))).size === 1;
};

describe('the given is deterministic and belongs to the seed alone', () => {
  it('the same seed yields the same piece, every time', () => {
    const s = seedOf(1);
    expect(givenOf(s)).toEqual(givenOf(s));
  });

  it('refuses anything that is not a 256-bit hex seed', () => {
    expect(() => givenOf('abc')).toThrow(/64 lowercase hex/);
    expect(() => givenOf(seedOf(1).toUpperCase())).toThrow();
    expect(() => givenOf(undefined)).toThrow();
  });
});

describe('inside the doctrine', () => {
  const g = givenOf(seedOf(7));

  it('every one of the eleven breathes, deep or light, on a 4–8 s cycle', () => {
    expect(Object.keys(g.breathing).sort()).toEqual(FUNCTIONS.map((f) => f.id).sort());
    for (const b of Object.values(g.breathing)) {
      expect(b.depth).toBeGreaterThanOrEqual(GIVEN.DEPTH[0]);
      expect(b.depth).toBeLessThanOrEqual(GIVEN.DEPTH[1]);
      expect(b.periodMs).toBeGreaterThanOrEqual(4000);
      expect(b.periodMs).toBeLessThanOrEqual(8000);
    }
  });

  it('its channels reach all eleven — every being carries the whole architecture', () => {
    for (let i = 0; i < 200; i++) {
      const { channels } = givenOf(seedOf(i));
      expect(connected(channels)).toBe(true);
      expect(channels.length).toBeGreaterThanOrEqual(10 + GIVEN.EXTRA_CHANNELS[0]);
      expect(channels.length).toBeLessThanOrEqual(10 + GIVEN.EXTRA_CHANNELS[1]);
      expect(new Set(channels.map((c) => c.join('-'))).size).toBe(channels.length);
      expect(channels.every(([a, b]) => a !== b)).toBe(true);
    }
  });

  it('its nucleus is one of the five solids', () => {
    expect(GIVEN.SOLIDS).toContain(g.nucleus.solid);
  });
});

describe('two beings, almost never alike', () => {
  it('500 seeds give 500 distinct channel patterns, and use every solid', () => {
    const patterns = new Set();
    const solids = new Set();
    for (let i = 0; i < 500; i++) {
      const g = givenOf(seedOf(i));
      patterns.add(g.channels.map((c) => c.join('-')).sort().join(','));
      solids.add(g.nucleus.solid);
    }
    expect(patterns.size).toBe(500);
    expect(solids.size).toBe(5);
  });
});
