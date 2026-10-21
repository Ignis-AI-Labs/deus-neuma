// genesis-signatures.js — each Platonic solid's own hand, so it is known
// at a glance even nested inside the others. Pure.
//
// Three channels, all inside the palette (monochrome at rest, the one
// signal accent): where its line sits between ink (0) and signal (1), how
// its edges are drawn (solid, or broken into dashes along each edge), and
// the mark standing on each of its vertices. No two solids share a hand,
// and a solid keeps its hand through every beat — the eye learns it once.
// The two tetrahedra of the stella are one solid, one hand.

/** The vertex marks the stage can draw; a mark's index is its shader shape. */
export const MARKS = Object.freeze(['dot', 'ring', 'square', 'diamond', 'triangle']);

export const SIGNATURES = Object.freeze({
  tetrahedron: Object.freeze({ mix: 0.5, dashes: 0, mark: 'triangle' }),
  cube: Object.freeze({ mix: 0, dashes: 0, mark: 'square' }),
  octahedron: Object.freeze({ mix: 0.25, dashes: 6, mark: 'diamond' }),
  icosahedron: Object.freeze({ mix: 1, dashes: 0, mark: 'ring' }),
  dodecahedron: Object.freeze({ mix: 0.75, dashes: 11, mark: 'dot' }),
});

/** pure — the signature a construct figure draws with (the stella is a tetrahedron). */
export const signatureOf = (key) => SIGNATURES[key === 'stella' ? 'tetrahedron' : key];
