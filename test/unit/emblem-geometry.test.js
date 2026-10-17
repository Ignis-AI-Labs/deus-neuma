// emblem-geometry is pure — verification is real inputs → real outputs, no
// mock anywhere in the path (RULE 0). The claims proven here are the
// SHINKEI claims the seal makes on screen: the counts are true, the seed is
// a true seed of life, the vesica's centers truly touch each other's
// circumference, and the chamfer cuts land exactly where the ratified
// look-dev specimen put them.
import { describe, it, expect } from 'vitest';
import {
  EMBLEM,
  SEAL,
  GATEWAY_SEAL,
  chamferedSquarePoints,
  ringGraduations,
  seedOfLife,
  vesica,
  polar,
} from '../../frontend/utils/emblem-geometry.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

describe('emblem-geometry — the brand mark tells the truth', () => {
  it('the chamfered square cuts TR+BL exactly as the ratified specimen does', () => {
    // lookdev/index.html study 04 boot seal frame (viewBox 132, cut 12, 1px inset)
    expect(chamferedSquarePoints(1, 1, 130, 12)).toBe(
      '1,1 119,1 131,13 131,131 13,131 1,119'
    );
  });

  it('the ring carries exactly 60 graduations, 4 of them cardinal', () => {
    const ticks = ringGraduations(66, 66, 46, 4, 8);
    expect(ticks).toHaveLength(EMBLEM.TICK_COUNT);
    expect(EMBLEM.TICK_COUNT).toBe(60); // the caption's claim, proven here
    const cardinals = ticks.filter((t) => t.cardinal);
    expect(cardinals).toHaveLength(EMBLEM.CARDINAL_COUNT);
  });

  it('every graduation sits on the ring and reaches its true length', () => {
    const c = { x: 66, y: 66 };
    for (const t of ringGraduations(66, 66, 46, 4, 8)) {
      expect(dist({ x: t.x1, y: t.y1 }, c)).toBeCloseTo(46, 6);
      const expected = 46 + (t.cardinal ? 8 : 4);
      expect(dist({ x: t.x2, y: t.y2 }, c)).toBeCloseTo(expected, 6);
    }
  });

  it('inward graduations end ON the ring and never reach past it', () => {
    const c = { x: 200, y: 200 };
    const r = GATEWAY_SEAL.RING_RADIUS;
    for (const t of ringGraduations(c.x, c.y, r, GATEWAY_SEAL.TICK_LENGTH, GATEWAY_SEAL.CARDINAL_LENGTH, -1)) {
      expect(dist({ x: t.x1, y: t.y1 }, c)).toBeCloseTo(r, 6);
      const expected = r - (t.cardinal ? GATEWAY_SEAL.CARDINAL_LENGTH : GATEWAY_SEAL.TICK_LENGTH);
      expect(dist({ x: t.x2, y: t.y2 }, c)).toBeCloseTo(expected, 6);
      // Never pierce the inscribed frame: no endpoint exceeds the ring.
      expect(dist({ x: t.x2, y: t.y2 }, c)).toBeLessThanOrEqual(r);
    }
  });

  it('cardinals stand at the compass points — 12, 3, 6, 9 o clock', () => {
    const c = { x: 66, y: 66 };
    const cardinalAngles = ringGraduations(66, 66, 46, 4, 8)
      .map((t, i) => ({ t, deg: i * 6 }))
      .filter(({ t }) => t.cardinal)
      .map(({ deg }) => deg);
    expect(cardinalAngles).toEqual([0, 90, 180, 270]);
  });

  it('the seed is a TRUE seed of life — seven circles, one radius, petal centers one radius out', () => {
    const c = { x: 66, y: 66 };
    const seed = seedOfLife(c.x, c.y, SEAL.SEED_RADIUS);
    expect(seed).toHaveLength(EMBLEM.SEED_PETALS + 1);
    for (const circle of seed) expect(circle.r).toBe(SEAL.SEED_RADIUS);
    // Each petal center lies exactly on the center circle's circumference.
    for (const petal of seed.slice(1)) {
      expect(dist(petal, c)).toBeCloseTo(SEAL.SEED_RADIUS, 6);
    }
    // And the whole seed fills the core ring precisely: extent 2r = CORE_RADIUS.
    expect(SEAL.SEED_RADIUS * 2).toBe(SEAL.CORE_RADIUS);
  });

  it('petals stand 60° apart', () => {
    const petals = seedOfLife(66, 66, 13.5).slice(1);
    for (let i = 0; i < petals.length; i++) {
      const next = petals[(i + 1) % petals.length];
      const a = Math.atan2(petals[i].y - 66, petals[i].x - 66);
      const b = Math.atan2(next.y - 66, next.x - 66);
      const delta = ((b - a) * 180) / Math.PI;
      const stepped = ((delta % 360) + 360) % 360;
      expect(stepped).toBeCloseTo(60, 6);
    }
  });

  it('the vesica: each center truly lies on the other circle', () => {
    const [a, b] = vesica(200, 200, 24);
    expect(dist(a, b)).toBeCloseTo(24, 6); // centers one radius apart
    expect(a.r).toBe(24);
    expect(b.r).toBe(24);
  });

  it('polar puts 0° at 12 o clock and runs clockwise', () => {
    expect(polar(0, 0, 10, 0)).toEqual({ x: 0, y: -10 });
    const east = polar(0, 0, 10, 90);
    expect(east.x).toBeCloseTo(10, 6);
    expect(east.y).toBeCloseTo(0, 6);
  });

  it('the spec is frozen — the mark cannot drift at runtime', () => {
    expect(Object.isFrozen(EMBLEM)).toBe(true);
    expect(Object.isFrozen(SEAL)).toBe(true);
    expect(Object.isFrozen(SEAL.FRAME)).toBe(true);
  });

  it('the gateway seal is truly inscribed — the ring touches its frame', () => {
    expect(Object.isFrozen(GATEWAY_SEAL)).toBe(true);
    expect(Object.isFrozen(GATEWAY_SEAL.FRAME)).toBe(true);
    // A circle inscribed in a square: diameter equals the side.
    expect(GATEWAY_SEAL.FRAME.SIZE).toBe(GATEWAY_SEAL.RING_RADIUS * 2);
    // The frame is centered on the ring.
    const c = GATEWAY_SEAL.CENTER;
    expect(GATEWAY_SEAL.FRAME.X + GATEWAY_SEAL.FRAME.SIZE / 2).toBe(c);
    expect(GATEWAY_SEAL.FRAME.Y + GATEWAY_SEAL.FRAME.SIZE / 2).toBe(c);
    // The bands stay distinct: middle ring < inscription < dashed ring < ticks.
    expect(GATEWAY_SEAL.INSCRIPTION_RADIUS).toBeLessThan(160);
    expect(GATEWAY_SEAL.INSCRIPTION_RADIUS).toBeGreaterThan(140);
    expect(GATEWAY_SEAL.RING_RADIUS - GATEWAY_SEAL.CARDINAL_LENGTH).toBeGreaterThan(160);
  });
});
