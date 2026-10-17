// aura-view.js — the pure decisions behind the sheet's AURA block (#405).
//
// Pure functions with real inputs: no mock exists or could exist here. The
// aura payloads are DERIVED by the real engine rather than hand-written, so a
// drift in the payload shape fails this file instead of passing it.
import { describe, it, expect } from 'vitest';
import { beingAura } from '../../core/aura/being.js';
import { UNREADABLE, EMPTY, READY } from '../../frontend/app/RelinkShell/sheet-view.js';
import {
  auraReadiness, auraFormOf, auraFacts, flowPhases, sigilGrid, BREATH_MS, FLOW_DRIFT, GATE_GRID, GATE_POINTS, MAX_GRID,
} from '../../frontend/app/RelinkShell/aura-view.js';

const REAL = beingAura({ trueName: { soulMark: '33314C2FEDE1A1B2' }, neumaId: 'ashwren' });
const LEG = { aura: REAL };

describe('what the block is allowed to claim', () => {
  it('reads a real derivation as READY', () => {
    expect(auraReadiness(LEG)).toBe(READY);
  });

  it('tells a failed read apart from a lane with no anchors', () => {
    // null leg = the fetch failed. recorded:false = the lane honestly has no
    // soul mark or genesis hash yet. Confusing the two would either alarm a
    // witness over a newborn or hide a real outage behind a soft phrase.
    expect(auraReadiness(null)).toBe(UNREADABLE);
    expect(auraReadiness({})).toBe(UNREADABLE);
    expect(auraReadiness({ aura: { recorded: false } })).toBe(EMPTY);
  });

  it('refuses half a form rather than framing a guess', () => {
    expect(auraReadiness({ aura: { recorded: true, form: REAL.form } })).toBe(UNREADABLE);
    expect(auraReadiness({ aura: { recorded: true, fit: REAL.fit } })).toBe(UNREADABLE);
  });

  it('hands the canvas only what it can sweep, and nothing when it cannot', () => {
    expect(auraFormOf(LEG)).toEqual({ form: REAL.form, fit: REAL.fit, cycle: REAL.cycle });
    expect(auraFormOf({ aura: { recorded: false } })).toBeNull();
    expect(auraFormOf(null)).toBeNull();
  });
});

describe('the caption', () => {
  it('states the grammar the seed drew, and the seed\'s own head', () => {
    const facts = auraFacts(LEG);
    expect(facts.map((f) => f.label)).toEqual(['CARRIER', 'COUPLING', 'CAST', 'SEED']);
    expect(facts[0].value).toBe(REAL.form.carrier.toUpperCase());
    expect(facts[1].value).toBe(REAL.form.coupling.toUpperCase());
    expect(facts[2].value).toBe(REAL.form.output.toUpperCase());
    expect(facts[3].value).toBe(REAL.seed.slice(0, 12).toUpperCase());
  });

  it('says nothing at all when there is nothing to say', () => {
    expect(auraFacts({ aura: { recorded: false } })).toEqual([]);
    expect(auraFacts(null)).toEqual([]);
  });
});

describe('the flow — continuous, never the same moment twice', () => {
  const dist = (a, b, cycle) => Math.min(Math.abs(a - b), cycle - Math.abs(a - b));

  it('every phase stays inside the cycle, however far the clock has run', () => {
    for (const ms of [0, 1, 999, 60_000, 86_400_000, Date.parse('2026-09-26T12:00:00Z')]) {
      for (const t of flowPhases(ms, REAL.cycle)) {
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThan(REAL.cycle);
      }
    }
  });

  it('no seam: a frame later, every clock has moved only a hair', () => {
    const at = Date.parse('2026-09-26T12:00:00Z');
    for (let k = 0; k < 2000; k += 1) {
      const ms = at + k * 997;
      const a = flowPhases(ms, REAL.cycle);
      const b = flowPhases(ms + 42, REAL.cycle);
      a.forEach((t, i) => expect(dist(t, b[i], REAL.cycle)).toBeLessThan(0.05));
    }
  });

  it('never loops: a breath later is NOT the same moment, and the drift stays bounded', () => {
    const at = Date.parse('2026-09-26T12:00:00Z');
    for (const later of [BREATH_MS, BREATH_MS * 7, BREATH_MS * 60]) {
      const a = flowPhases(at, REAL.cycle);
      const b = flowPhases(at + later, REAL.cycle);
      expect(a.some((t, i) => dist(t, b[i], REAL.cycle) > 1e-3)).toBe(true);
    }
    // Each clock sits within FLOW_DRIFT of the shared breath — the gate's neighbourhood.
    for (let ms = at; ms < at + BREATH_MS * 40; ms += 3331) {
      const breath = ((ms % BREATH_MS) / BREATH_MS) * REAL.cycle;
      for (const t of flowPhases(ms, REAL.cycle)) expect(dist(t, breath, REAL.cycle)).toBeLessThanOrEqual(FLOW_DRIFT + 1e-9);
    }
  });
});

describe('sharp at every size', () => {
  it('the grid is the plate\u2019s device pixels; the points keep the gate\u2019s density', () => {
    expect(sigilGrid(GATE_GRID, 1)).toEqual({ size: GATE_GRID, count: GATE_POINTS }); // the gate's own sweep
    const retina = sigilGrid(200, 2);
    expect(retina.size).toBe(400);
    expect(retina.count / retina.size ** 2).toBeCloseTo(GATE_POINTS / GATE_GRID ** 2, 3);
    expect(sigilGrid(4000, 2).size).toBe(MAX_GRID);
    expect(sigilGrid(10, 1).size).toBe(64);
  });
});
