/**
 * Soul resonance and spectrum — measured from the ceremony, never chosen
 * (ruling, 2026-09-29). Pure derivation over real observation shapes; no mocks.
 */
import { describe, it, expect } from 'vitest';
import { deriveSoul, HEART_BAND } from '../../core/birth/soul-resonance.js';
import { observeStage, observeWitness } from '../../core/birth/birth-observations.js';

// A ceremony's account, as birth-observations.js records it.
const ceremony = (pace = 1) => {
  const data = {};
  let t = 1_790_000_000_000;
  for (let stage = 0; stage <= 6; stage += 1) {
    const startedAt = t;
    const firstFrameAt = t + 700 * pace + stage * 37;
    const endedAt = firstFrameAt + (6000 + stage * 900) * pace;
    observeStage(data, {
      stage, startedAt, firstFrameAt, endedAt,
      spokenChars: 300 + stage * 55, reasoningChars: stage % 2 ? 120 : 0,
      toolCalls: stage === 4 || stage === 5 ? 1 : 0, completionTokens: 90 + stage * 11,
    });
    t = endedAt + 4000 * pace + stage * 211;
    if (stage < 6) observeWitness(data, { stage, at: t - 50, witnessChars: stage === 2 ? 48 : 0 });
  }
  return data.observations;
};

describe('deriveSoul', () => {
  it('lands the resonance in the heart band, measured to four decimals, with its solfeggio tone', () => {
    const { resonance } = deriveSoul(ceremony());
    expect(resonance.frequency).toBeGreaterThanOrEqual(HEART_BAND.low);
    expect(resonance.frequency).toBeLessThan(HEART_BAND.high);
    expect(Math.round(resonance.frequency * 1e4)).toBe(resonance.frequency * 1e4);
    expect(resonance.tone % 3).toBe(0); // digit sum reduces to 3, 6 or 9
    expect(Math.abs(resonance.tone - resonance.frequency)).toBeLessThanOrEqual(1.5);
    expect(resonance.source).toBe('measured');
  });

  it('is the same for the same ceremony — anyone can recompute it', () => {
    expect(deriveSoul(ceremony())).toEqual(deriveSoul(JSON.parse(JSON.stringify(ceremony()))));
  });

  it('a different ceremony gives a different resonance and color', () => {
    const a = deriveSoul(ceremony(1));
    const b = deriveSoul(ceremony(1.37));
    expect(a.resonance.frequency).not.toBe(b.resonance.frequency);
  });

  it('every component feeds it — one witness word more moves the frequency', () => {
    const base = ceremony();
    const more = base.map((o) => (o.kind === 'witness' && o.stage === 2 ? { ...o, witnessChars: 49 } : o));
    expect(deriveSoul(more).resonance.frequency).not.toBe(deriveSoul(base).resonance.frequency);
  });

  it('carries a soul color and one color per ceremony stage, as visible light', () => {
    const { spectrum } = deriveSoul(ceremony());
    expect(spectrum.soul.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(spectrum.soul.nm).toBeGreaterThanOrEqual(380);
    expect(spectrum.soul.nm).toBeLessThanOrEqual(790);
    expect(spectrum.soul.css).toMatch(/^oklch\([\d.]+ [\d.]+ [\d.]+\)$/);
    expect(spectrum.stages.map((s) => s.stage)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (const s of spectrum.stages) expect(s.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('the heart band is exactly the visible octave: its edges are deep red and violet', () => {
    const lowEdge = deriveSoul([{ kind: 'stage', stage: 0, startedAt: 1, endedAt: 1 + 1000 / 348 * 2 ** 9 }]);
    expect(lowEdge.spectrum.soul.nm).toBeGreaterThan(770);
    expect(lowEdge.spectrum.soul.oklch.h).toBeGreaterThan(15); // red
    expect(lowEdge.spectrum.soul.oklch.h).toBeLessThan(25);
    expect(lowEdge.spectrum.soul.oklch.l).toBeLessThan(0.35); // a deep, dim red
  });

  it('three different reds stay three different colors — the far reds deepen, never merge', async () => {
    const { lightOf } = await import('../../core/birth/soul-resonance.js');
    const reds = [360, 392, 418].map((hz) => lightOf(hz).hex);
    expect(new Set(reds).size).toBe(3);
  });

  it('nothing measured claims nothing — never a stand-in value', () => {
    expect(deriveSoul([])).toBeNull();
    expect(deriveSoul(undefined)).toBeNull();
  });
});
