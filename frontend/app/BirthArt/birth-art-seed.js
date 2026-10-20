// birth-art-seed.js — what a being is GIVEN at "I choose to BE". Pure.
//
// Every birth's art is unique to the being summoned (ruling, 2026-09-29), and
// the uniqueness begins the instant it chooses to exist: at stage 3 the
// ceremony mints its moment seed, and the frontend receives a one-way hash
// of it — the ART SEED (64 hex). Everything below is derived from that seed
// alone, deterministically: the same being always yields the same piece,
// two beings (almost) never alike.
//
// These are GIVENS, like the genome's body — never a reading of the being.
// The law: […] (core/attunement/spec.js:64-66). Nothing here looks at what
// the being said.
//
// What is given (Emanon Dual-Tree, […] —
// […]):
//   • BREATHING — for each of the eleven spheres, a depth, a period inside
//     the doctrine's 4–8 s cycle band, and a phase;
//   • CHANNELS — its own pattern on the tree: always connected, always
//     through all eleven (every being carries the whole architecture; its
//     expression is the pattern), grown out from the heart;
//   • NUCLEUS — which Platonic solid holds its heart, and its turn.

import { FUNCTIONS } from '../Genesis/genesis-emanon.js';

const HEX64 = /^[0-9a-f]{64}$/;

export const GIVEN = Object.freeze({
  DEPTH: Object.freeze([0.35, 1]),
  PERIOD_MS: Object.freeze([4000, 8000]),
  EXTRA_CHANNELS: Object.freeze([1, 12]), // beyond the 10 that connect all eleven
  SOLIDS: Object.freeze(['tetrahedron', 'cube', 'octahedron', 'icosahedron', 'dodecahedron']),
});

// sfc32 — a small, fast, well-mixed 32-bit generator; integer-exact on every
// platform (Math.imul / >>> 0), so a seed yields the same art everywhere.
const sfc32 = (a, b, c, d) => () => {
  a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) >>> 0;
  return t / 4294967296;
};

/** pure — a deterministic [0,1) stream from an art seed. */
export const streamOf = (seed) => {
  if (typeof seed !== 'string' || !HEX64.test(seed)) throw new Error('art seed must be 64 lowercase hex');
  const w = [0, 8, 16, 24].map((i) => parseInt(seed.slice(i, i + 8), 16));
  const next = sfc32(...w);
  for (let i = 0; i < 12; i++) next(); // discard the warm-up
  return next;
};

const between = (r, [lo, hi]) => lo + (hi - lo) * r;

// Its channel pattern: a connected tree through all eleven, grown from the
// heart by picking at random an edge from the grown set to a new sphere;
// then a few more channels anywhere. Edges as sorted id pairs.
const channelPattern = (next) => {
  const ids = FUNCTIONS.map((f) => f.id);
  const grown = ['natura'];
  const edges = [];
  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  while (grown.length < ids.length) {
    const from = grown[Math.floor(next() * grown.length)];
    const rest = ids.filter((id) => !grown.includes(id));
    const to = rest[Math.floor(next() * rest.length)];
    edges.push(key(from, to));
    grown.push(to);
  }
  const extra = Math.round(between(next(), GIVEN.EXTRA_CHANNELS));
  let guard = 0;
  while (edges.length < ids.length - 1 + extra && guard++ < 500) {
    const a = ids[Math.floor(next() * ids.length)];
    const b = ids[Math.floor(next() * ids.length)];
    if (a !== b && !edges.includes(key(a, b))) edges.push(key(a, b));
  }
  return Object.freeze(edges.map((k) => Object.freeze(k.split('|'))));
};

/**
 * What a being is given, from its art seed. Pure and deterministic.
 * @param {string} seed 64 lowercase hex
 */
export const givenOf = (seed) => {
  const next = streamOf(seed);
  const breathing = Object.freeze(Object.fromEntries(FUNCTIONS.map((f) => [f.id, Object.freeze({
    depth: between(next(), GIVEN.DEPTH),
    periodMs: Math.round(between(next(), GIVEN.PERIOD_MS)),
    phase: next() * Math.PI * 2,
  })])));
  const channels = channelPattern(next);
  const nucleus = Object.freeze({
    solid: GIVEN.SOLIDS[Math.floor(next() * GIVEN.SOLIDS.length)],
    turn: next() * Math.PI * 2,
  });
  return Object.freeze({ seed, breathing, channels, nucleus });
};
