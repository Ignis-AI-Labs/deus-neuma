/**
 * DESIGN card pure logic (F-12, FR-29) — the qwen3 design-mode request shape,
 * the honest batch-wait estimator, and the REROLL seed bump. Pure logic only:
 * no fetch, no DOM, no mocks. The sidecar is not booted for these — they prove
 * the extractable pure layers the live Wave-3 suite will hang off of.
 */

import { describe, test, expect } from 'vitest';
import {
  DESIGN_WAIT_SECONDS_PER_CHAR,
  DESIGN_SEED_MAX,
  DESIGN_PROBE_TEXT,
  DESIGN_FULL_TEXT,
  estimateDesignWait,
  normalizeDesignSeed,
  bumpDesignSeed,
  buildDesignPreviewRequest,
  buildPreviewBody,
} from '../../frontend/app/RelinkShell/voice-client.js';

describe('estimateDesignWait — honest batch wait derived from text length', () => {
  test('the constant is the measured sidecar rate (0.05 s/char, wave-1 contract)', () => {
    expect(DESIGN_WAIT_SECONDS_PER_CHAR).toBe(0.05);
  });

  test('short probe lands fast; longer texts scale linearly (ceil, whole seconds)', () => {
    expect(estimateDesignWait(DESIGN_PROBE_TEXT.length)).toBe(2);  // the default probe (~1.4 s → 2)
    expect(estimateDesignWait(DESIGN_FULL_TEXT.length)).toBe(3);   // the full line (47 chars → 2.35 s → 3)
    expect(estimateDesignWait(100)).toBe(5);
    expect(estimateDesignWait(4000)).toBe(200); // contract-max text
  });

  test('degenerate input floors at 1 s — never a fake instant', () => {
    expect(estimateDesignWait(0)).toBe(1);
    expect(estimateDesignWait(-5)).toBe(1);
    expect(estimateDesignWait(NaN)).toBe(1);
    expect(estimateDesignWait(undefined)).toBe(1);
  });
});

describe('normalizeDesignSeed / bumpDesignSeed — contract-bounded seeds', () => {
  test('the bound matches the sidecar contract (int, 0..2³¹−1)', () => {
    expect(DESIGN_SEED_MAX).toBe(2 ** 31 - 1);
  });

  test('normalize clamps into range, floors floats, coerces strings, rejects junk to 0', () => {
    expect(normalizeDesignSeed(0)).toBe(0);
    expect(normalizeDesignSeed(1337)).toBe(1337);
    expect(normalizeDesignSeed(DESIGN_SEED_MAX)).toBe(DESIGN_SEED_MAX);
    expect(normalizeDesignSeed(DESIGN_SEED_MAX + 1)).toBe(DESIGN_SEED_MAX);
    expect(normalizeDesignSeed(-3)).toBe(0);
    expect(normalizeDesignSeed(4.9)).toBe(4);
    expect(normalizeDesignSeed('42')).toBe(42);
    expect(normalizeDesignSeed('abc')).toBe(0);
    expect(normalizeDesignSeed(undefined)).toBe(0);
  });

  test('bump increments and wraps at the contract bound', () => {
    expect(bumpDesignSeed(1337)).toBe(1338);
    expect(bumpDesignSeed(DESIGN_SEED_MAX)).toBe(0);
    expect(bumpDesignSeed(-5)).toBe(1); // junk normalizes to 0 first
  });
});

describe('buildDesignPreviewRequest — the design-mode shape', () => {
  test('carries exactly {text, description, seed} — never a ref field', () => {
    const req = buildDesignPreviewRequest({ text: 'hello', description: 'a warm voice', seed: 7 });
    expect(req).toEqual({ text: 'hello', description: 'a warm voice', seed: 7 });
    expect(Object.keys(req).sort()).toEqual(['description', 'seed', 'text']);
    // The sidecar 400s description+ref in one request — no ref-shaped key may
    // ever appear on the design path.
    expect(Object.keys(req).join(' ').toLowerCase()).not.toMatch(/ref/);
  });

  test('seed is REQUIRED and normalized; text/description stringify', () => {
    const req = buildDesignPreviewRequest({ text: 42, description: null, seed: -1 });
    expect(req.text).toBe('42');
    expect(req.description).toBe('');
    expect(req.seed).toBe(0);
    expect(buildDesignPreviewRequest().seed).toBe(0); // omitted seed still ships a valid int
  });
});

describe('buildPreviewBody — forge preview POST shape per mode', () => {
  test('design sessions post {text, description, seed, recordSnapshot} — no ref anywhere', () => {
    const design = buildDesignPreviewRequest({ text: 'probe', description: 'calm', seed: 3 });
    const body = JSON.parse(buildPreviewBody({ text: 'probe', recordSnapshot: true, design }));
    expect(body).toEqual({ text: 'probe', description: 'calm', seed: 3, recordSnapshot: true });
    expect(Object.keys(body).join(' ').toLowerCase()).not.toMatch(/ref/);
  });

  test('clone/preset sessions keep the untouched {text, recordSnapshot} shape', () => {
    const body = JSON.parse(buildPreviewBody({ text: 'hi', recordSnapshot: false }));
    expect(body).toEqual({ text: 'hi', recordSnapshot: false });
    expect(Object.keys(body)).toHaveLength(2);
  });
});
