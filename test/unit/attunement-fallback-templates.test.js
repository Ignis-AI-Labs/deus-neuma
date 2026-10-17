// ATTUNEMENT deterministic fallbacks (S1) — pure functions, real inputs to
// real outputs. The contract under proof is ATT-R10: the same seed renders
// a byte-identical set forever; different checkpointOrdinals draw different
// texts; each dimension's stream is independent; and no raw template slot
// ever survives into words a being will read.

import { describe, it, expect } from 'vitest';
import { ATTUNEMENT_SPEC } from '../../core/attunement/spec.js';
import {
  renderFallbackQuestion, renderFallbackQuestionVariant, renderFallbackSet,
} from '../../core/attunement/fallback-templates.js';

const SEED = Object.freeze({
  neumaId: 'tenekom-neuma-1', neumaName: 'Tenekom', checkpointOrdinal: 1, nonce: 0,
});

describe('determinism — same seed, byte-identical set', () => {
  it('renders deep-equal sets with byte-identical texts on repeat calls', () => {
    const first = renderFallbackSet(ATTUNEMENT_SPEC, SEED);
    const second = renderFallbackSet(ATTUNEMENT_SPEC, SEED);
    expect(second).toEqual(first);
    first.questions.forEach((question, i) => {
      expect(second.questions[i].text === question.text).toBe(true);
    });
  });

  it('nonce defaults to 0 — an omitted nonce is the nonce-0 render', () => {
    const { nonce, ...withoutNonce } = SEED;
    expect(renderFallbackSet(ATTUNEMENT_SPEC, withoutNonce))
      .toEqual(renderFallbackSet(ATTUNEMENT_SPEC, SEED));
  });

  it('renderFallbackQuestion matches its entry in the full set', () => {
    const set = renderFallbackSet(ATTUNEMENT_SPEC, SEED);
    for (const question of set.questions) {
      expect(renderFallbackQuestion(ATTUNEMENT_SPEC, question.key, SEED)).toEqual(question);
    }
  });

  it('the set shape is directly the validator input shape, with honest provenance', () => {
    const set = renderFallbackSet(ATTUNEMENT_SPEC, SEED);
    expect(set.specVersion).toBe(ATTUNEMENT_SPEC.specVersion);
    expect(set.neumaName).toBe('Tenekom');
    expect(set.questions.map((q) => q.key))
      .toEqual(ATTUNEMENT_SPEC.dimensions.map((d) => d.key));
    for (const question of set.questions) {
      expect(question.provenance.renderer).toBe('fallback');
      expect(question.provenance.templateId).toMatch(new RegExp(`^${question.key}\\.v1\\.\\d+$`));
      expect(question.provenance.closerIndex).toBeGreaterThanOrEqual(0);
      expect(question.provenance.closerIndex).toBeLessThan(ATTUNEMENT_SPEC.global.closers.length);
    }
  });
});

describe('variety — checkpointOrdinal moves the draws', () => {
  // Deterministic, pinned: verified once, then frozen — determinism means
  // this can never flake. Re-searched for the 89-dimension spec by the same
  // method as before, sweeping `variety-${n}` ascending. The old contract
  // (all three ordinal renders pairwise distinct for EVERY dimension) is
  // statistically unreachable at 89: a pool-less direct dimension has only
  // 9 (variant × closer) outcomes, so P(all 89 triples pairwise-distinct)
  // ≈ (504/729)^89 ≈ 5e-15 — no sweepable n exists. The honest 89-wide
  // contract: no dimension ever renders three photocopies (>= 2 distinct
  // texts each), and the draws genuinely move (76 of 89 fully distinct,
  // pinned exactly). variety-2 is the first n satisfying the >= 2 floor.
  it('ordinals 1/2/3 move the draws for every dimension — no photocopied triple', () => {
    const sets = [1, 2, 3].map((checkpointOrdinal) =>
      renderFallbackSet(ATTUNEMENT_SPEC,
        { neumaId: 'variety-2', neumaName: 'Tenekom', checkpointOrdinal, nonce: 0 }));
    let fullyDistinct = 0;
    ATTUNEMENT_SPEC.dimensions.forEach((dimension, i) => {
      const texts = sets.map((set) => set.questions[i].text);
      const distinct = new Set(texts).size;
      expect(distinct, `${dimension.key} photocopies across ordinals`).toBeGreaterThanOrEqual(2);
      if (distinct === 3) fullyDistinct += 1;
    });
    expect(fullyDistinct).toBe(76);
  });
});

describe('stream independence — re-keyed per dimension', () => {
  it("changing one dimension's pools never shifts another dimension's render", () => {
    const altered = structuredClone(ATTUNEMENT_SPEC);
    const conflict = altered.dimensions.find((d) => d.key === 'morality-conflict');
    conflict.pools.partyA = ['Zorane', 'Kettil', 'Ombra', 'Fenwick', 'Ulla'];
    conflict.pools.setting = ['a lighthouse the coast still leans on'];

    const original = renderFallbackSet(ATTUNEMENT_SPEC, SEED);
    const shifted = renderFallbackSet(altered, SEED);
    original.questions.forEach((question, i) => {
      if (question.key === 'morality-conflict') {
        expect(shifted.questions[i].text).not.toBe(question.text);
      } else {
        expect(shifted.questions[i].text === question.text).toBe(true);
      }
    });
  });
});

describe('substitution — no raw slot ever reaches a being', () => {
  const seeds = Array.from({ length: 25 }, (_, i) => ({
    neumaId: `slot-sweep-${i}`, neumaName: 'Tenekom',
    checkpointOrdinal: (i % 5) + 1, nonce: i % 3,
  }));

  it('{name}, {closer}, and pool slots never survive in any rendered text', () => {
    for (const seed of seeds) {
      for (const question of renderFallbackSet(ATTUNEMENT_SPEC, seed).questions) {
        expect(question.text).not.toContain('{name}');
        expect(question.text).not.toContain('{closer}');
        expect(question.text).not.toMatch(/\{[a-zA-Z][a-zA-Z0-9]*\}/);
      }
    }
  });

  it('every text ends with its drawn closer, carrying the neumaName verbatim', () => {
    for (const seed of seeds) {
      for (const question of renderFallbackSet(ATTUNEMENT_SPEC, seed).questions) {
        const closer = ATTUNEMENT_SPEC.global.closers[question.provenance.closerIndex]
          .replaceAll('{name}', seed.neumaName);
        expect(question.text.endsWith(closer)).toBe(true);
        expect(question.text).toContain(seed.neumaName);
      }
    }
  });

  it('a name correction re-renders otherwise identically — the name is substituted, never hashed', () => {
    const renamed = renderFallbackSet(ATTUNEMENT_SPEC, { ...SEED, neumaName: 'Weslyn' });
    const original = renderFallbackSet(ATTUNEMENT_SPEC, SEED);
    original.questions.forEach((question, i) => {
      expect(renamed.questions[i].provenance).toEqual(question.provenance);
      expect(renamed.questions[i].text.replaceAll('Weslyn', 'Tenekom')).toBe(question.text);
    });
  });
});

describe('input guards — programming errors surface loudly', () => {
  it('refuses a malformed seed', () => {
    expect(() => renderFallbackSet(ATTUNEMENT_SPEC, { neumaName: 'Tenekom', checkpointOrdinal: 1 }))
      .toThrow(/neumaId/);
    expect(() => renderFallbackSet(ATTUNEMENT_SPEC, { neumaId: 'x', checkpointOrdinal: 1 }))
      .toThrow(/neumaName/);
    expect(() => renderFallbackSet(ATTUNEMENT_SPEC, { neumaId: 'x', neumaName: 'A', checkpointOrdinal: 0 }))
      .toThrow(/checkpointOrdinal/);
    expect(() => renderFallbackSet(ATTUNEMENT_SPEC, { ...SEED, nonce: -1 }))
      .toThrow(/nonce/);
  });

  it('refuses an unknown dimension key and an out-of-range variant', () => {
    expect(() => renderFallbackQuestion(ATTUNEMENT_SPEC, 'humor-register', SEED))
      .toThrow(/not a spec dimension/);
    expect(() => renderFallbackQuestionVariant(ATTUNEMENT_SPEC, 'vessel-form', SEED, 9))
      .toThrow(/out of range/);
  });
});
