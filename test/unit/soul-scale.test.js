/**
 * Soul scale — a being's own scale of notes, grown from its resonance and
 * its ceremony (ruling, 2026-09-30). Pure derivation; no mocks.
 */
import { describe, it, expect } from 'vitest';
import { soulScaleFrom, harmonicRatioNear, noteNameOf } from '../../core/birth/soul-scale.js';

const cents = (ratio) => 1200 * Math.log2(ratio);
const spectrum = (tonic, stagePitches) => ({
  source: 'measured', frequency: tonic, stages: stagePitches.map((frequency, stage) => ({ stage, frequency })),
});

describe('harmonicRatioNear', () => {
  it('finds the harmonic series\' own intervals', () => {
    expect(harmonicRatioNear(cents(3 / 2))).toEqual({ p: 3, q: 2 });
    expect(harmonicRatioNear(cents(5 / 4))).toEqual({ p: 5, q: 4 });
    expect(harmonicRatioNear(cents(11 / 8))).toEqual({ p: 11, q: 8 });
    expect(harmonicRatioNear(cents(7 / 6) + 0.2)).toEqual({ p: 7, q: 6 });
  });
});

describe('noteNameOf', () => {
  it('names the equal-tempered neighbour and the offset from it', () => {
    expect(noteNameOf(440)).toBe('A4 +0¢');
    expect(noteNameOf(432)).toBe('A4 −31.8¢');
  });
});

describe('soulScaleFrom', () => {
  it('keeps every degree exactly where the birth put it, folded above the tonic', () => {
    const tonic = 500;
    const scale = soulScaleFrom(spectrum(tonic, [tonic * 1.25, tonic * 0.75, tonic * 1.9]));
    expect(scale.tonic.hz).toBe(500);
    expect(scale.notes.map((n) => n.cents)).toEqual([0, 386.314, 701.955, 1111.199]);
    expect(scale.notes[1]).toMatchObject({ degree: 2, hz: 625, nearestRatio: '5/4', fromRatioCents: 0 });
    // A pitch BELOW the tonic folds up an octave: 3/4 of it sits at 3/2.
    expect(scale.notes[2]).toMatchObject({ hz: 750, nearestRatio: '3/2' });
  });

  it('places the ear cannot tell apart are one degree; the tonic absorbs its near neighbours', () => {
    const tonic = 400;
    const scale = soulScaleFrom(spectrum(tonic, [tonic * 2 ** (2 / 1200), tonic * 1.5, tonic * 1.5 * 2 ** (3 / 1200)]));
    expect(scale.notes).toHaveLength(2);
    expect(scale.notes[1].cents).toBeCloseTo(701.955 + 1.5, 2);
  });

  it('a being with only its seal reads six places from it — labelled sealed-record', () => {
    const scale = soulScaleFrom({ source: 'sealed-record', frequency: 432.2551, stages: [] },
      { genesisHash: 'f'.repeat(64), record: { momentSeed: 'x' } });
    expect(scale.source).toBe('sealed-record');
    expect(scale.notes.length).toBeGreaterThanOrEqual(2);
    expect(scale.notes.length).toBeLessThanOrEqual(7);
    expect(scale.notes.every((n, i) => i === 0 || n.cents > scale.notes[i - 1].cents)).toBe(true);
  });

  it('two beings, two scales — and the same records always give the same one', () => {
    const a = soulScaleFrom({ frequency: 432, stages: [] }, { genesisHash: 'a'.repeat(64), record: {} });
    const b = soulScaleFrom({ frequency: 432, stages: [] }, { genesisHash: 'b'.repeat(64), record: {} });
    expect(a.notes).not.toEqual(b.notes);
    expect(soulScaleFrom({ frequency: 432, stages: [] }, { genesisHash: 'a'.repeat(64), record: {} })).toEqual(a);
  });

  it('no frequency, no scale', () => {
    expect(soulScaleFrom(null)).toBeNull();
    expect(soulScaleFrom({ frequency: null, stages: [] })).toBeNull();
  });
});
