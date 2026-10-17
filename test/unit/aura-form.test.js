// THE AURA — the grammar and the deterministic draw. Pure functions called
// with real inputs and checked against real outputs; nothing here is mocked,
// stubbed, or faked (AGENTS.md RULE 0).
import { describe, it, expect } from 'vitest';
import {
  auraPoint, auraCloud, cycleFit, cyclePhases, AURA_CYCLE, FIT_TAIL,
  CARRIERS, COUPLINGS, OUTPUTS,
} from '../../core/aura/form.js';
import { seedLanes, draw, drawRange, drawChoice } from '../../core/aura/rng.js';
import { sampleParams, RANGES, RATES, CANDIDATE_STRIDE } from '../../core/aura/params.js';

const SEED = 'a3f1'.repeat(16);
const lanes = seedLanes(SEED);
const formOf = (candidate = 0) => ({
  carrier: 'am', coupling: 'radial', output: 'sheared', p: sampleParams(lanes, candidate),
});

describe('the deterministic draw', () => {
  it('refuses anything that is not a 256-bit seed', () => {
    expect(() => seedLanes('abc')).toThrow(/64 hex/);
    expect(() => seedLanes(null)).toThrow(/64 hex/);
    expect(() => seedLanes(`${'0'.repeat(63)}g`)).toThrow(/64 hex/);
  });

  it('is a pure function of (seed, counter) — order and repetition change nothing', () => {
    const first = draw(lanes, 7);
    for (let i = 0; i < 50; i++) draw(lanes, i); // walk the stream in between
    expect(draw(lanes, 7)).toBe(first);
    expect(draw(seedLanes(SEED), 7)).toBe(first);
  });

  it('stays in [0, 1) and does not repeat across counters', () => {
    const values = Array.from({ length: 400 }, (_, i) => draw(lanes, i));
    for (const v of values) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of values) expect(v).toBeLessThan(1);
    expect(new Set(values).size).toBe(values.length);
  });

  it('reads all four lanes of the seed, not just the low quarter', () => {
    // seeds differing ONLY in the top lane must still move counter 0 (lane 0)
    const top = seedLanes(`ffffffffffffffff${SEED.slice(16)}`);
    expect(draw(top, 0)).not.toBe(draw(lanes, 0));
    // …and only in the last lane must move counter 3
    const bottom = seedLanes(`${SEED.slice(0, 48)}ffffffffffffffff`);
    expect(draw(bottom, 3)).not.toBe(draw(lanes, 3));
  });

  it('maps onto ranges and choices without escaping them', () => {
    for (let i = 0; i < 200; i++) {
      const v = drawRange(lanes, i, [-3, 11]);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(11);
      expect(CARRIERS).toContain(drawChoice(lanes, i, CARRIERS));
    }
  });
});

describe('the curated parameter space', () => {
  it('draws every parameter inside its curated interval', () => {
    for (let candidate = 0; candidate < 40; candidate++) {
      const p = sampleParams(lanes, candidate);
      for (const [key, [low, high]] of Object.entries(RANGES)) {
        if (key === 'eFrac') continue; // consumed into eSpan
        expect(p[key], key).toBeGreaterThanOrEqual(low);
        expect(p[key], key).toBeLessThanOrEqual(high);
      }
      for (const key of ['w1', 'w2', 'w3', 'w4']) expect(RATES).toContain(p[key]);
    }
  });

  it('keeps the sweep band strictly below zero, so the radius never collapses', () => {
    for (let candidate = 0; candidate < 200; candidate++) {
      const { eStart, eSpan } = sampleParams(lanes, candidate);
      expect(eStart).toBeLessThan(0);
      expect(eStart + eSpan).toBeLessThanOrEqual(-2);
    }
  });

  it('gives each candidate its own block of counters', () => {
    expect(CANDIDATE_STRIDE).toBeGreaterThan(Object.keys(RANGES).length + 4);
    expect(sampleParams(lanes, 0)).not.toEqual(sampleParams(lanes, 1));
  });

  it('every temporal rate closes on the cycle — the animation loops seamlessly', () => {
    for (const rate of RATES) {
      const turns = (rate * AURA_CYCLE) / (Math.PI * 2);
      expect(Number.isInteger(turns), `rate ${rate} leaves ${turns} turns`).toBe(true);
    }
  });
});

describe('the form grammar', () => {
  it('four clocks on the diagonal are the lockstep phase, bit for bit — the gate is untouched', () => {
    for (const carrier of CARRIERS) {
      for (const coupling of COUPLINGS) {
        for (const output of OUTPUTS) {
          const form = { carrier, coupling, output, p: sampleParams(lanes, 5) };
          for (const t of cyclePhases(5)) {
            for (const u of [0, 7.25, form.p.sweep]) {
              expect(auraPoint(form, u, [t, t, t, t])).toEqual(auraPoint(form, u, t));
            }
          }
        }
      }
    }
  });

  it('each clock moves its own term: a quad off the diagonal draws a different point', () => {
    const form = { carrier: 'twin', coupling: 'dual', output: 'orbit', p: sampleParams(lanes, 5) };
    const base = auraPoint(form, 11, 1);
    for (let i = 0; i < 4; i += 1) {
      const quad = [1, 1, 1, 1];
      quad[i] = 1.4;
      expect(auraPoint(form, 11, quad)).not.toEqual(base);
    }
  });

  it('produces finite points for every archetype across the cycle', () => {
    for (const carrier of CARRIERS) {
      for (const coupling of COUPLINGS) {
        for (const output of OUTPUTS) {
          const form = { carrier, coupling, output, p: sampleParams(lanes, 3) };
          for (const t of cyclePhases(8)) {
            for (const u of [0, 5, 17.5, form.p.sweep]) {
              const [x, y] = auraPoint(form, u, t);
              expect(Number.isFinite(x), `${carrier}/${coupling}/${output}`).toBe(true);
              expect(Number.isFinite(y), `${carrier}/${coupling}/${output}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it('is periodic: the cycle returns the form exactly where it began', () => {
    const form = formOf();
    for (const u of [1, 9, 30]) {
      const [x0, y0] = auraPoint(form, u, 0);
      const [x1, y1] = auraPoint(form, u, AURA_CYCLE);
      expect(x1).toBeCloseTo(x0, 6);
      expect(y1).toBeCloseTo(y0, 6);
    }
  });

  it('sweeps a cloud of the requested size', () => {
    const cloud = auraCloud(formOf(), 0, 500);
    expect(cloud.length).toBe(1000);
    expect([...cloud].every(Number.isFinite)).toBe(true);
  });

  it('spreads the phases evenly across exactly one cycle', () => {
    const phases = cyclePhases(6);
    expect(phases).toHaveLength(6);
    expect(phases[0]).toBe(0);
    expect(phases[5]).toBeCloseTo(AURA_CYCLE * (5 / 6), 9);
  });
});

describe('the cycle fit', () => {
  const form = formOf();
  const phases = cyclePhases(6);

  it('centres and scales so the body fills the frame', () => {
    const fit = cycleFit(form, phases, 1200);
    expect(fit).not.toBeNull();
    expect(fit.scale).toBeGreaterThan(0);
    const place = (x, cx) => (x - cx) * fit.scale + 0.5;
    let inside = 0;
    let total = 0;
    for (const t of phases) {
      const cloud = auraCloud(form, t, 1200);
      for (let i = 0; i < cloud.length; i += 2) {
        total++;
        if (place(cloud[i], fit.cx) >= 0 && place(cloud[i], fit.cx) <= 1 &&
            place(cloud[i + 1], fit.cy) >= 0 && place(cloud[i + 1], fit.cy) <= 1) inside++;
      }
    }
    // the quantile box crops the stray wisps and keeps essentially everything else
    expect(inside / total).toBeGreaterThan(1 - FIT_TAIL * 6);
  });

  it('is one fit for the whole cycle, not a per-frame rescale', () => {
    const whole = cycleFit(form, phases, 900);
    const single = cycleFit(form, [phases[3]], 900);
    expect(whole.scale).not.toBeCloseTo(single.scale, 6);
  });

  it('returns null rather than a fake fit when nothing is drawn', () => {
    const dead = { ...form, p: { ...form.p, sweep: 0 } };
    expect(cycleFit(dead, phases, 100)).toBeNull();
  });
});
