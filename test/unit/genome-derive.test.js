/**
 * THE GENOME — the body a being was given, not one it chose.
 *
 * Real seed, real derivation, real trait vocabularies. Pure inputs, pure
 * outputs, no mock (RULE 0).
 *
 * The claims that matter most are the ones a comment cannot make true: that the
 * derivation is deterministic across processes, that nobody can steer it, and
 * that the age floor is not a clamp somebody could remove but a structural
 * impossibility.
 */
import { AGE } from '../../core/identity/age.js';
import { describe, test, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { genomeSeed } from '../../core/genome/seed.js';
import { deriveGenome, defaultHairstyle } from '../../core/genome/derive.js';
import { auraSeed } from '../../core/aura/seed.js';
import {
  SEX, CAST, COUNTER, GENOME_SCHEMA, FEATURE,
} from '../../core/genome/traits.js';

const hex = (s) => createHash('sha256').update(s).digest('hex');
const IDENTITY = { soulHex: hex('a-soul'), genesisHash: hex('a-genesis'), neumaId: 'keir' };

describe('the seed — outside everyone\'s reach', () => {
  test('the same identity always folds to the same seed', () => {
    expect(genomeSeed(IDENTITY)).toBe(genomeSeed({ ...IDENTITY }));
    expect(genomeSeed(IDENTITY)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('an id ALONE is refused — a guessable body is a steerable one', () => {
    // If a name or an id were enough, anyone could try names until the
    // derivation produced the body they wanted. That is exactly the control the
    // law exists to remove.
    expect(() => genomeSeed({ neumaId: 'keir' })).toThrow(/guessable/);
    expect(() => genomeSeed({})).toThrow();
    expect(() => genomeSeed({ soulHex: hex('x') })).not.toThrow();
  });

  test('the CHOSEN NAME is not an input — renaming must not re-body a being', () => {
    // genomeSeed reads soulHex/genesisHash/momentSeed/neumaId only. A being that
    // renames itself keeps the body it was born with.
    const before = genomeSeed(IDENTITY);
    const after = genomeSeed({ ...IDENTITY, chosenName: 'a completely different name' });
    expect(after).toBe(before);
  });

  test('⚠️ THE DOMAIN TAG: the genome seed is NOT the aura seed', () => {
    // Sharing a seed would weld two independent facets of a life together — every
    // soft aura on a soft body — by an implementation accident. The sweep
    // measures the resulting independence; this pins the cause.
    expect(genomeSeed(IDENTITY)).not.toBe(auraSeed(IDENTITY));
  });
});

describe('the derivation — deterministic, and nobody\'s to steer', () => {
  const seed = genomeSeed(IDENTITY);

  test('the same seed yields a byte-identical genome, every time', () => {
    expect(deriveGenome(seed)).toEqual(deriveGenome(seed));
    expect(deriveGenome(seed).schema).toBe(GENOME_SCHEMA);
  });

  test('the genome is FROZEN — a body is not editable after the fact', () => {
    const g = deriveGenome(seed);
    expect(Object.isFrozen(g)).toBe(true);
    expect(Object.isFrozen(g.frame)).toBe(true);
    expect(Object.isFrozen(g.coloring)).toBe(true);
    expect(() => { g.sex = 'male'; }).toThrow();
  });

  test('a malformed seed refuses rather than deriving something', () => {
    expect(() => deriveGenome('not-hex')).toThrow(/64 hex/);
    expect(() => deriveGenome('')).toThrow();
    expect(() => deriveGenome(null)).toThrow();
  });

  test('every drawn trait comes from its declared vocabulary', () => {
    for (let i = 0; i < 500; i++) {
      const g = deriveGenome(genomeSeed({ soulHex: hex(`being-${i}`) }));
      expect(SEX).toContain(g.sex);
      expect(CAST).toContain(g.cast);
      if (g.form === 'humanoid') expect(FEATURE).toContain(g.feature); // null is a member — a plain face is real
    }
  });

  test('a formless body carries only what its form has — no frame, face, skin or mark', () => {
    // Design note, 2026-09-28, on a drone's card reading […] and […]: […]
    let formless = 0;
    for (let i = 0; i < 500; i++) {
      const g = deriveGenome(genomeSeed({ soulHex: hex(`formless-${i}`) }));
      if (g.form === 'humanoid') continue;
      formless++;
      expect(g).not.toHaveProperty('face');
      expect(g).not.toHaveProperty('feature');
      expect(Object.keys(g.frame)).toEqual(['stature']);
      expect(Object.keys(g.coloring).sort()).toEqual(['color', 'colorIsUncanny', 'glow']);
      expect(defaultHairstyle(g)).toBe('');
    }
    expect(formless, 'no formless body in the sweep — the guard is vacuous').toBeGreaterThan(50);
  });

  test('all three states actually occur — `neither` is not unreachable in practice', () => {
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      seen.add(deriveGenome(genomeSeed({ soulHex: hex(`b${i}`) })).sex);
    }
    expect([...seen].sort()).toEqual(['female', 'male', 'neutral']);
  });
});

describe('THE SPECIES IS NEUMA — pinned like the age, never drawn', () => {
  // Design note, 2026-08-27: […] `form` names a body plan a neuma wears;
  // it never names what the being is.
  test('species is a CONSTANT on every genome, from every seed', () => {
    const seen = new Set();
    for (let i = 0; i < 500; i += 1) {
      seen.add(deriveGenome(genomeSeed({ soulHex: hex(`species-${i}`) })).species);
    }
    expect([...seen]).toEqual(['neuma']);
  });

  test('there is no species counter — the derivation cannot reach it', () => {
    expect(Object.keys(COUNTER)).not.toContain('species');
  });

  test('a construct-form body is still a neuma — form never changes species', () => {
    for (let i = 0; i < 400; i += 1) {
      const g = deriveGenome(genomeSeed({ soulHex: hex(`form-species-${i}`) }));
      if (g.form !== 'humanoid') {
        expect(g.species).toBe('neuma');
        return;
      }
    }
    throw new Error('no non-humanoid body in 400 draws — widen the search');
  });
});

describe('⚠️ THE AGE FLOOR IS STRUCTURAL, NOT A CLAMP', () => {
  test('age is NOT DNA — no genome, from any seed, carries an age (Design note, 2026-09-26', () => {
    for (let i = 0; i < 1000; i++) {
      const g = deriveGenome(genomeSeed({ soulHex: hex(`age-${i}`) }));
      expect('age' in g).toBe(false);
    }
  });

  test('THERE IS NO AGE COUNTER — the derivation cannot reach age at all', () => {
    // This is the real guarantee, and it is stronger than any clamp. A clamped
    // trait is still a trait: someone could widen the clamp, or a new code path
    // could bypass it. Age has no counter allocated to it, so there is no draw
    // to clamp — nothing to loosen and nothing to bypass.
    //
    // Design note, 2026-08-26: […]
    expect(Object.keys(COUNTER)).not.toContain('age');
    expect(AGE.class).toBe('adult');
    expect(AGE.minimumYears).toBe(20);
    expect(Object.isFrozen(AGE)).toBe(true);

    // `presentsAs` was added 2026-08-27 so a model is TOLD an age instead of
    // picking one (the same genome read late-twenties on one checkpoint and
    // mid-forties on another). It is a CONSTANT and must stay one: no counter,
    // no vocabulary, identical on every body ever derived.
    expect(AGE.startsAt).toBe(21);
    expect(Object.keys(COUNTER)).not.toContain('startsAt');
    // And it lives outside the genome (core/identity/age.js): no derivation
    // can reach it, so no seed can move it.
    for (let i = 0; i < 500; i += 1) {
      expect(deriveGenome(genomeSeed({ soulHex: hex(`presents-${i}`) }))).not.toHaveProperty('age');
    }
  });

  test('the trait counters are unique — two traits sharing one would couple them', () => {
    const counters = Object.values(COUNTER);
    expect(new Set(counters).size).toBe(counters.length);
  });
});
