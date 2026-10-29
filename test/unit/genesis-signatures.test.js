// genesis-signatures — each Platonic solid is known at a glance, and the
// light goes where the caption points. Pure: the real signatures, the real
// construct state, the real clock.
import { describe, it, expect } from 'vitest';
import { SIGNATURES, MARKS, signatureOf } from '../../frontend/app/Genesis/genesis-signatures.js';
import { constructAt, FOCUS_MS } from '../../frontend/app/Genesis/genesis-state-construct.js';
import { partStart, BEATS } from '../../frontend/app/Genesis/genesis-timeline.js';
import { NO_FLASH } from '../../frontend/utils/no-flash.js';

const AT = Object.fromEntries(BEATS.map((b) => [b.id, b.at]));
const SOLIDS = ['tetrahedron', 'cube', 'octahedron', 'icosahedron', 'dodecahedron'];
const KEYS = ['tetrahedron', 'stella', 'cube', 'octahedron', 'icosahedron', 'dodecahedron'];
const STEP = 25;

describe('every solid has its own hand', () => {
  it('five solids, five signatures, each unique in every channel it is told apart by', () => {
    expect(Object.keys(SIGNATURES).sort()).toEqual([...SOLIDS].sort());
    const hands = SOLIDS.map((k) => JSON.stringify(SIGNATURES[k]));
    expect(new Set(hands).size).toBe(5);
    expect(new Set(SOLIDS.map((k) => SIGNATURES[k].mark)).size).toBe(5);
    expect(new Set(SOLIDS.map((k) => SIGNATURES[k].mix)).size).toBe(5);
  });

  it('inside the palette: a mix between ink (0) and signal (1), a drawable mark, whole or dashed edges', () => {
    for (const k of SOLIDS) {
      const s = SIGNATURES[k];
      expect(s.mix).toBeGreaterThanOrEqual(0);
      expect(s.mix).toBeLessThanOrEqual(1);
      expect(MARKS).toContain(s.mark);
      expect(Number.isInteger(s.dashes) && s.dashes >= 0).toBe(true);
    }
  });

  it('stable: frozen, and the stella\'s second tetrahedron draws in the tetrahedron\'s hand', () => {
    expect(Object.isFrozen(SIGNATURES)).toBe(true);
    SOLIDS.forEach((k) => expect(Object.isFrozen(SIGNATURES[k])).toBe(true));
    expect(signatureOf('stella')).toBe(SIGNATURES.tetrahedron);
    SOLIDS.forEach((k) => expect(signatureOf(k)).toBe(SIGNATURES[k]));
  });
});

describe('the named solid takes the light', () => {
  // [beat, from, to, the solids its caption names]
  const NAMED = [
    ['TETRAHEDRON', AT.simplex, AT.solids, ['tetrahedron']],
    ['STELLA', partStart('solids', 'stella'), partStart('solids', 'cube'), ['tetrahedron', 'stella']],
    ['CUBE', partStart('solids', 'cube'), partStart('solids', 'octahedron'), ['cube']],
    ['OCTAHEDRON', partStart('solids', 'octahedron'), partStart('solids', 'icosahedron'), ['octahedron']],
    ['ICOSAHEDRON', partStart('solids', 'icosahedron'), partStart('solids', 'dodecahedron'), ['icosahedron']],
    ['DODECAHEDRON', partStart('solids', 'dodecahedron'), AT.cosmos, ['dodecahedron']],
  ];
  for (const [name, from, to, named] of NAMED) {
    it(`${name}: brighter than every other solid, from the hand-off on`, () => {
      for (let t = from + FOCUS_MS; t < to; t += STEP) {
        const c = constructAt(t);
        const lit = Math.min(...named.map((k) => c[k].opacity));
        for (const k of KEYS.filter((x) => !named.includes(x))) expect(lit, `${k} at ${t}`).toBeGreaterThan(c[k].opacity);
      }
    });
  }

  it('THE COSMOS: all five lit at once, none stepped back', () => {
    const c = constructAt(AT.cosmos + FOCUS_MS + 100);
    const top = Math.max(...KEYS.map((k) => c[k].opacity));
    for (const k of KEYS) expect(c[k].opacity).toBeGreaterThan(0.5 * top);
  });

  it('the light moves by fades: no solid rises faster than the no-flash law', () => {
    const fastest = 1 / NO_FLASH.RISE_MS; // a full rise in the law's floor
    for (let t = AT.simplex; t < AT.tree; t += 16) {
      const a = constructAt(t);
      const b = constructAt(t + 16);
      for (const k of KEYS) expect(b[k].opacity - a[k].opacity).toBeLessThanOrEqual(fastest * 16);
    }
  });
});
