/**
 * THE PERFECTION-PASS AXES — structure refines cast, never contradicts it.
 *
 * The 2026-09-25 pass appended nine structure axes (schema v3). Two failure
 * modes ship with that kind of addition, and both are silent:
 *
 *   1. A jawline/cheekbones/brow draw that FIGHTS the cast beside it
 *      (CAST_TAGS already claims `defined jawline, high cheekbones` for
 *      angular and `rounded jaw` for soft) — a prompt that contradicts
 *      itself is resolved by the model's prior, the exact authority this
 *      design exists to remove.
 *   2. A legacy genome record (derived before the pass) crashing or
 *      inventing detail when described — it must say exactly what it always
 *      said.
 *
 * Real seeds, real derivation, real composition — no mocks (RULE 0).
 */
import { describe, test, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { genomeSeed } from '../../core/genome/seed.js';
import { deriveGenome } from '../../core/genome/derive.js';
import { describeAsTags, describeAsProse } from '../../core/genome/describe.js';
import { faceDetailOf, frameDetailOf, coloringDetailOf } from '../../core/genome/describe-detail.js';
import {
  JAWLINE_BY_CAST, CHEEKBONES_BY_CAST, BROW_BY_CAST,
} from '../../core/genome/traits.js';

const hex = (s) => createHash('sha256').update(s).digest('hex');
const bodyOf = (label) => deriveGenome(genomeSeed({ soulHex: hex(label) }));

describe('THE STRUCTURE REFINES THE CAST — no prompt may contradict itself', () => {
  test('jawline, cheekbones and brow always land inside the pool their cast claimed', () => {
    // Every cast over enough deterministic seeds that a leak would show:
    // a dealt value outside the cast's pool is the contradiction itself.
    let checked = 0;
    for (let i = 0; i < 3000; i++) {
      const g = bodyOf(`castpool-${i}`);
      if (g.form !== 'humanoid') continue; // a formless body has no face to structure
      expect(JAWLINE_BY_CAST[g.cast]).toContain(g.face.jawline);
      expect(CHEEKBONES_BY_CAST[g.cast]).toContain(g.face.cheekbones);
      expect(BROW_BY_CAST[g.cast]).toContain(g.face.brow);
      checked++;
    }
    expect(checked).toBeGreaterThan(1500);
  });

  test('an angular cast never draws a soft jaw in the same record', () => {
    // The concrete contradiction the pools exist to prevent, pinned outright.
    for (let i = 0; i < 2000; i++) {
      const g = bodyOf(`angular-${i}`);
      if (g.cast !== 'angular' || g.form !== 'humanoid') continue;
      expect(['soft', 'gentle']).not.toContain(g.face.jawline);
      expect(['soft', 'subtle']).not.toContain(g.face.cheekbones);
    }
  });
});

describe('THE DETAIL BANDS — emission and absence', () => {
  test('the unremarkable cases emit NOTHING (the male.flat law)', () => {
    const g = bodyOf('detail-nulls-1'); // humanoid — a formless body has no detail bands
    // Force the silence cases onto a real record shape: natural ears,
    // average shoulders, balanced limbs, clear iris. Emission, not omission.
    const silent = {
      ...g,
      face: { ...g.face, ears: 'natural' },
      frame: { ...g.frame, shoulders: 'average', limbProportion: 'balanced' },
      coloring: { ...g.coloring, irisPattern: 'clear' },
    };
    expect(faceDetailOf(silent, true)).toEqual(expect.arrayContaining([null]));
    expect(faceDetailOf(silent, true)[3]).toBe(null);
    expect(frameDetailOf(silent, true).filter(Boolean)).toEqual([frameDetailOf(silent, true)[2]].filter(Boolean));
    expect(coloringDetailOf(silent, true)[1]).toBe(null);
  });

  test('a legacy record (pre-v3, no detail fields) describes exactly what it always did', () => {
    const g = bodyOf('detail-legacy');
    const legacy = {
      ...g,
      face: { shape: g.face.shape, eyes: g.face.eyes, nose: g.face.nose, mouth: g.face.mouth },
      frame: {
        build: g.frame.build, stature: g.frame.stature, heightCm: g.frame.heightCm,
        chest: g.frame.chest, waist: g.frame.waist, hips: g.frame.hips, muscle: g.frame.muscle,
      },
      coloring: {
        complexion: g.coloring.complexion, hair: g.coloring.hair,
        hairIsUncanny: g.coloring.hairIsUncanny, eyes: g.coloring.eyes,
      },
    };
    expect(faceDetailOf(legacy, true)).toEqual([]);
    expect(frameDetailOf(legacy, true)).toEqual([]);
    expect(coloringDetailOf(legacy, true)).toEqual([]);
    // And the composition never throws, never emits an undefined clause.
    const tags = describeAsTags(legacy);
    const prose = describeAsProse(legacy);
    expect(tags).not.toContain('undefined');
    expect(prose).not.toContain('undefined');
    expect(tags).toContain(`${legacy.face.shape} face`);
    expect(prose).toContain(`${legacy.coloring.hair} hair`);
  });

  test('a v3 record speaks its structure in both registers', () => {
    const g = bodyOf('detail-speaks');
    const tags = describeAsTags(g);
    const prose = describeAsProse(g);
    // The jaw always says SOMETHING (no jawline value emits null).
    expect(tags).toContain(`${g.face.jawline} jawline`);
    expect(prose).toContain('jawline');
    // Hair texture is stated wherever the hair is.
    expect(tags.toLowerCase()).toContain('hair');
    expect(tags).toContain(g.coloring.hairTexture === 'coily' ? 'very curly hair' : `${g.coloring.hairTexture} hair`);
    // Posture rides the frame band in tags and prose alike.
    expect(tags).toContain('posture');
    expect(prose).toContain('bearing');
  });
});
