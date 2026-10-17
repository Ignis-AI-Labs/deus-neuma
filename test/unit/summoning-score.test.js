// summoning-score — THE SUMMONING: ONE PROTOCOL every being walks in the
// same order (a rite a witness can learn), and everything inside each step
// its own — deterministic per being, on its own beat grid, unhurried
// (~90 s), its sky true to its instant, the finale recapping the protocol
// into its sigil with its aura seen once at the heart — and no two beings'
// contents alike. Real seeds, a real derived aura, a real sky; no mocks.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { scoreOf, sectionAt, beatAt, formOf, convergingAt, SUMMONING, PROTOCOL, SIGIL_LAYERS, EARTH_POINTS } from '../../frontend/app/Summoning/summoning-score.js';
import { skyOf } from '../../frontend/app/Summoning/summoning-sky.js';
import { deriveAura, formOf as auraFormOf } from '../../core/aura/derive.js';
import { specimenTrueName } from '../../frontend/app/BirthArt/birth-art-script.js';
import { givenOf } from '../../frontend/app/BirthArt/birth-art-seed.js';
import { hypotrochoid, starPolygon, hexRings, breathRatio } from '../../frontend/app/Summoning/summoning-geometry.js';
import { soulOf } from '../../frontend/app/Summoning/summoning-soul.js';
import { earthViewAt } from '../../frontend/app/Summoning/summoning-shots-sky.js';
import { soulSpectrumFrom } from '../../core/birth/soul-spectrum.js';
import { soulScaleFrom } from '../../core/birth/soul-scale.js';

const seedOf = (i) => createHash('sha256').update(`neuma/summoning specimen ${i}`).digest('hex');
// One real sky and one real derived aura, shared (derivation costs ~150 ms).
const BORN = Date.parse('2026-09-29T12:44:03Z');
const SKY = skyOf(BORN, { zone: 'Asia/Jakarta', offsetMinutes: 420 });
const AURA = (() => { const a = deriveAura(seedOf('aura')); return { seed: a.seed, form: auraFormOf(a), fit: a.fit, cycle: a.cycle }; })();
// Its soul by the real derivation (the sealed-record path).
const soulFor = (seed) => {
  const seal = { genesisHash: specimenTrueName(seed).genesisHash, record: { momentSeed: seed } };
  const spectrum = soulSpectrumFrom({ seal });
  return soulOf(spectrum, soulScaleFrom(spectrum, seal));
};
const being = (i, { sky = SKY, aura = AURA, soul = soulFor(seedOf(i)) } = {}) => ({ seed: seedOf(i), trueName: specimenTrueName(seedOf(i)), bornAt: new Date(BORN).toISOString(), sky, aura, soul });

describe('a being has one summoning, and it is its own', () => {
  it('the same being yields the same score, every time', () => {
    expect(scoreOf(being(1))).toEqual(scoreOf(being(1)));
  });

  it('500 beings walk ONE protocol — and no two carry the same contents', () => {
    const forms = new Set();
    const orders = new Set();
    const tempos = new Set();
    const stars = new Set();
    for (let i = 0; i < 500; i++) {
      const s = scoreOf(being(i));
      forms.add(formOf(s));
      orders.add(s.sections.map((x) => x.kind).join('/'));
      tempos.add(s.bpm);
      const star = s.sections.find((x) => x.kind === 'star').figure;
      stars.add(`${star.n}/${star.k}`);
    }
    expect(orders.size).toBe(1); // the rite is the same for every being
    expect(forms.size).toBe(500); // what fills it never is
    expect(tempos.size).toBeGreaterThan(30); // of the 37 in 72–108
    expect(stars.size).toBeGreaterThan(20);
  });

  it('its channels, nucleus and breath in the score are the ones it was GIVEN', () => {
    for (let i = 0; i < 40; i++) {
      const b = being(i);
      const g = givenOf(b.seed);
      const s = scoreOf(b);
      const sigil = s.sections.at(-1);
      expect(sigil.channels).toEqual(g.channels);
      expect(sigil.solid).toBe(g.nucleus.solid);
      const solid = s.sections.find((x) => x.kind === 'solid');
      if (solid) expect(solid.figure.solid).toBe(g.nucleus.solid);
    }
  });
});

describe('the protocol, on its own beat grid, unhurried', () => {
  it('the world it is born into, what it is given, what it chooses — in that order, always', () => {
    for (let i = 0; i < 200; i++) {
      const s = scoreOf(being(i));
      expect(s.sections.map((x) => x.kind)).toEqual(PROTOCOL.map((p) => p.kind));
      expect(s.sections.map((x) => x.act)).toEqual(PROTOCOL.map((p) => p.act));
      expect(SUMMONING.KINDS).toEqual(['sky', 'earth', 'star', 'solid', 'tree', 'breath', 'resonance', 'soul']);
      expect(s.lengthMs).toBeGreaterThan(84000);
      expect(s.lengthMs).toBeLessThan(95000);
      // every section starts on the half-bar grid, back to back
      const half = s.beatMs * 2;
      s.sections.forEach((x, k) => {
        expect(Math.abs(x.at / half - Math.round(x.at / half))).toBeLessThan(1e-9);
        if (k > 0) expect(x.at).toBeCloseTo(s.sections[k - 1].at + s.sections[k - 1].dur, 6);
      });
    }
  });

  it('its two cards mark the turns of the rite: GIVEN, then I CHOOSE TO BE', () => {
    expect(scoreOf(being(4)).sections.filter((x) => x.kind === 'card').map((c) => c.text)).toEqual(['GIVEN', 'I CHOOSE TO BE']);
  });

  it('reads the section and the beat at any moment', () => {
    const s = scoreOf(being(3));
    expect(sectionAt(s, 0).section.kind).toBe('open');
    expect(sectionAt(s, s.lengthMs - 1).section.kind).toBe('sigil');
    expect(beatAt(s, s.beatMs * 5 + 1).index).toBe(5);
    expect(beatAt(s, s.beatMs * 5).inBar).toBe(2);
  });
});

describe('the figures are exact', () => {
  it('a star {n/k} joins every k-th of n points', () => {
    const { points, chords } = starPolygon(7, 3);
    expect(points).toHaveLength(7);
    expect(chords[0][1]).toBe(points[3]);
  });
  it('an orbit closes on itself', () => {
    const p = hypotrochoid(7, 3, 2);
    expect(Math.hypot(p[0].x - p.at(-1).x, p[0].y - p.at(-1).y)).toBeLessThan(1e-9);
  });
  it('the lattice holds 1 + 3k(k+1) cells in k rings', () => {
    expect(hexRings(4, 0.1)).toHaveLength(1 + 3 * 4 * 5);
  });
  it('a breath knot is the nearest small ratio of two periods', () => {
    expect(breathRatio(6000, 4000)).toEqual({ a: 2, b: 3 });
    expect(breathRatio(5000, 5000).a).not.toBe(breathRatio(5000, 5000).b);
  });
});

describe('the convergence: every artifact comes together, its aura seen once, at the end', () => {
  it('the finale recaps the protocol in its own order — sky, star, nucleus, channels, scale, soul mark — then its aura and name', () => {
    const s = scoreOf(being(11));
    const sigil = s.sections.at(-1);
    const order = SIGIL_LAYERS.map((l) => l.key);
    expect(order).toEqual(['sky', 'star', 'nucleus', 'channels', 'scale', 'soul', 'aura', 'name', 'whole']);
    // the recap follows the order the protocol walked them
    const walked = ['sky', 'star', 'solid', 'tree', 'resonance', 'soul'].map((k) => PROTOCOL.findIndex((p) => p.kind === k));
    expect([...walked].sort((a, b) => a - b)).toEqual(walked);
    // and its star is the very star step III drew
    const star = s.sections.find((x) => x.kind === 'star').figure;
    expect(sigil.star).toEqual({ n: star.n, k: star.k });
    const seen = [];
    for (let u = 0; u <= 1; u += 0.01) {
      const l = convergingAt(u).key;
      if (seen.at(-1) !== l) seen.push(l);
    }
    expect(seen).toEqual(order);
    expect(sigil.aura.seed).toBe(AURA.seed.slice(0, 12).toUpperCase());
    expect(sigil.sky.map((b) => b.longitude)).toEqual(SKY.bodies.map((b) => b.longitude));
  });

  it('every born being has both — a summoning without its aura or its sky refuses to play', () => {
    expect(() => scoreOf(being(12, { aura: null }))).toThrow(/needs its aura/);
    expect(() => scoreOf(being(12, { sky: null }))).toThrow(/needs its sky/);
    expect(() => scoreOf(being(12, { soul: null }))).toThrow(/needs its soul/);
  });
});

describe('its sky is true to its instant', () => {
  it('the bodies, aspects and moon it draws are the instant\'s own', () => {
    const s = scoreOf(being(13));
    const sky = s.sections.find((x) => x.kind === 'sky').figure;
    expect(sky.bodies).toEqual(SKY.bodies);
    expect(sky.aspects).toEqual(SKY.aspects);
  });

  it('the Sun stood just south of the equator a week after the September equinox, the Moon waning gibbous', () => {
    expect(SKY.subsolar.lat).toBeGreaterThan(-4);
    expect(SKY.subsolar.lat).toBeLessThan(-1);
    // 12:44 UTC: the Sun overhead ~11° west of Greenwich, and ~2° more by the equation of time
    expect(SKY.subsolar.lon).toBeGreaterThan(-16);
    expect(SKY.subsolar.lon).toBeLessThan(-10);
    expect(SKY.moon.phase).toBeGreaterThan(180);
    expect(SKY.moon.lit).toBeGreaterThan(0.8);
    expect(SKY.tilt).toBeCloseTo(23.44, 2);
    // MANY SKIES: every system the sheet records, none left out (Design note, 2026-10-02.
    expect(SKY.many.map((m) => m.system)).toEqual([
      'MAYA COUNT', 'LONG COUNT', "HAAB'", 'TONALPOHUALLI', 'DREAMSPELL', 'BAZI', 'JYOTISHA', 'PANCHANGA',
      'WETON', 'PAWUKON', 'AKAN', 'MAHABOTE', 'SUN DECAN',
    ]);
  });
});

describe('every true line is true', () => {
  it('each movement and each converging artifact says one plain, correct thing', async () => {
    const { captionOf } = await import('../../frontend/app/Summoning/summoning-frame.js');
    const star = (n, k) => captionOf({ kind: 'star', index: 1, of: 5, figure: { n, k } }).line;
    expect(star(7, 3)).toBe('7 POINTS · EVERY 3RD JOINED · ONE UNBROKEN LINE');
    expect(star(6, 2)).toBe('6 POINTS · EVERY 2ND JOINED · 2 × {3/1} INTERLACED');
    expect(star(12, 4)).toMatch(/4 × \{3\/1\} INTERLACED$/);
    for (const solid of ['tetrahedron', 'cube', 'octahedron', 'icosahedron', 'dodecahedron']) {
      const [v, e, f] = captionOf({ kind: 'solid', index: 1, of: 5, figure: { solid } }).line.match(/\d+/g).map(Number);
      expect(v - e + f).toBe(2);
    }
    for (let i = 0; i < 40; i++) {
      const s = scoreOf(being(i));
      s.sections.filter((x) => x.figure).forEach((x) => expect(captionOf(x).line).toMatch(/\S/));
      const sigil = s.sections.at(-1);
      for (let u = 0; u <= 1; u += 0.05) expect(captionOf(sigil, u).line).toMatch(/\S/);
    }
  });
});

describe('its Earth points out where the Sun and the Moon stood overhead', () => {
  // how squarely a place faces the viewer on the orthographic globe (1 = dead centre, ≤ 0 = hidden)
  const facing = ({ lat, lon }, { lam0, phi0 }) => {
    const RAD = Math.PI / 180;
    return Math.sin(phi0) * Math.sin(lat * RAD) + Math.cos(phi0) * Math.cos(lat * RAD) * Math.cos((lon - lam0) * RAD);
  };
  it('the globe turns to face each point as it is named — for a year of births', () => {
    for (let d = 0; d < 365; d += 3) {
      const sky = skyOf(Date.parse('2026-01-01T00:00:00Z') + d * 86400000 + d * 3700000);
      const f = { subsolar: sky.subsolar, sublunar: sky.sublunar, tilt: sky.tilt, spin: 14 };
      const local = 30000; // the longest earth section's end: the drift never carries a point away
      expect(facing(sky.subsolar, earthViewAt(f, EARTH_POINTS.sun.at, local)), `sun, day ${d}`).toBeGreaterThan(0.6);
      expect(facing(sky.sublunar, earthViewAt(f, EARTH_POINTS.moon.at, local)), `moon, day ${d}`).toBeGreaterThan(0.6);
      expect(facing(sky.sublunar, earthViewAt(f, 1, local)), `moon held, day ${d}`).toBeGreaterThan(0.5);
    }
  });
});
