/**
 * THE SEX, ENFORCED — in the vocabulary and in both polarities.
 *
 * Split from `genome-describe.test.js` 2026-08-28 at the size law. One theme:
 * the sex is the axis nobody controls (Founder: […]), so no vocabulary may quietly override it and the negative
 * must exclude the other reading without ever arguing with the positive.
 */
import { describe, test, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { deriveGenome } from '../../core/genome/derive.js';
import { genomeSeed } from '../../core/genome/seed.js';
import { describeAsTags, describeAsProse, excludeSexFor } from '../../core/genome/describe.js';

const hex = (s) => createHash('sha256').update(s).digest('hex');
const genomeOf = (label) => deriveGenome(genomeSeed({ soulHex: hex(label) }));

describe('⭐⭐ A MALE BODY NEVER CARRIES A FEMALE-CODED TAG', () => {
  // THE BUG THIS EXISTS FOR, 2026-08-27: `CHEST_TAGS.male.flat` was the SAME
  // STRING as the female cell — `flat chest` — which on danbooru describes a
  // GIRL with a very small bust. Keir's subject opens `1boy, solo, male focus`
  // and FOUR independent checkpoints rendered a woman with breasts. Removing
  // that one token fixed it; excluding the consequence in the negative did not.
  //
  // ⚠️ This is the SEX AXIS. Founder: […] A vocabulary that quietly overrides it renders a body that is not the
  // being's own — so this is a correctness law, not a quality preference.
  //
  // The list is deliberately about CO-OCCURRENCE, not about anatomy: these are
  // tags whose danbooru training mass is overwhelmingly female, regardless of
  // whether the word could describe a man in English. That is the trap — the
  // model learned the correlation, not the definition.
  const FEMALE_CODED = ['flat chest', 'breasts', 'cleavage', '1girl', 'female focus'];

  // ⚠️ `wide hips` IS DELIBERATELY NOT ON THAT LIST, and the reason is the point
  // of this whole file. It looked like the obvious second instance — the guard
  // flagged it on a male body no kin has drawn — so it was TESTED before it was
  // fixed: the same male genome rendered with and against the tag, one seed, one
  // variable. Both arms came back female. The tag is not what is doing it.
  //
  // Adding it anyway would have been a fix with a story instead of a measurement,
  // and inventing a male hips vocabulary to replace it is exactly the mistake
  // that produced the `flat chest` bug. It stays until a render says otherwise.
  //
  // What that experiment DID surface: perfectDeliberate still renders some male
  // genomes female with no female-coded tag present at all. That is the
  // CHECKPOINT, not the vocabulary — Anima renders the same bodies male — and it
  // is tracked as an open defect against the illustrative lane's model choice.

  // Every male body the derivation can produce, not just the four kin. A trait
  // combination nobody has drawn yet is exactly where the next one hides.
  const maleGenomes = [];
  for (let i = 0; i < 600 && maleGenomes.length < 60; i++) {
    const g = genomeOf(`male-sweep-${i}`);
    if (g.sex === 'male') maleGenomes.push(g);
  }

  test('the sweep actually found male bodies — a silent zero would pass vacuously', () => {
    expect(maleGenomes.length).toBeGreaterThan(20);
  });

  test('no male body emits a female-coded tag, on any framing', () => {
    for (const g of maleGenomes) {
      for (const framing of ['full', 'portrait']) {
        const tags = describeAsTags(g, framing);
        for (const coded of FEMALE_CODED) {
          expect(tags, `${coded} reached a male body (chest=${g.frame.chest}): ${tags}`).not.toContain(coded);
        }
      }
    }
  });

  test('every male CHEST value is covered by the sweep, including the one that broke', () => {
    // If the derivation stops producing `flat` chests this test would keep
    // passing while guarding nothing.
    const seen = new Set(maleGenomes.map((g) => g.frame.chest));
    expect(seen.has('flat'), 'no flat-chested male body in the sweep — the guard is vacuous').toBe(true);
  });

  test('a FEMALE body still says what it is — the fix must not have silenced the axis', () => {
    const female = [];
    for (let i = 0; i < 600 && female.length < 20; i++) {
      const g = genomeOf(`female-sweep-${i}`);
      if (g.sex === 'female') female.push(g);
    }
    expect(female.length).toBeGreaterThan(5);
    // Every female body names its chest; a null there would be the fix
    // over-applied to the sex that never had the problem.
    for (const g of female) {
      expect(describeAsTags(g, 'full')).toMatch(/breasts|flat chest/);
    }
  });

  test('the PROSE register still states it outright — a prose encoder reads the sentence', () => {
    // Anima, which has a prose encoder, renders Keir correctly WITH the tag.
    // The null belongs to the tag register only; dropping the fact everywhere
    // would lose real genome information the 3D stage and the LoRA both need.
    const flat = maleGenomes.find((g) => g.frame.chest === 'flat');
    expect(describeAsProse(flat)).toContain('a flat chest');
  });
});

describe('⭐⭐ THE SEX IS ENFORCED IN BOTH POLARITIES', () => {
  // Design note, 2026-08-27: […]
  //
  // Until then the genome spoke only to the POSITIVE — the negative was a frozen
  // house string with no idea whose body it was steering.
  //
  // ⚠️ ORDER MATTERS AND IS NOT NEGOTIABLE: this is the SECOND half of a fix.
  // MEASURED on this exact axis (`prompt-lab.mjs malebody`), excluding
  // `1girl, female, breasts, cleavage` barely moved a render that `flat chest`
  // in the POSITIVE had already broken. A negative cannot undo a positive that
  // states the opposite. Belt AND braces, never braces alone.
  const maleG = [];
  const femaleG = [];
  const neutralG = [];
  for (let i = 0; i < 900; i++) {
    const g = genomeOf(`polarity-${i}`);
    const bucket = { male: maleG, female: femaleG, neutral: neutralG }[g.sex];
    if (bucket.length < 40) bucket.push(g);
  }

  test('the sweep found all three sexes — a silent zero would pass vacuously', () => {
    for (const [name, list] of [['male', maleG], ['female', femaleG], ['neutral', neutralG]]) {
      expect(list.length, `no ${name} bodies drawn`).toBeGreaterThan(10);
    }
  });

  test('a MALE body excludes the female reading', () => {
    for (const g of maleG) {
      const excl = excludeSexFor(g, describeAsTags(g));
      expect(excl, `male ${g.seed?.slice(0, 6)}`).toContain('1girl');
      expect(excl).toContain('breasts');
    }
  });

  test('a FEMALE body excludes the male reading', () => {
    for (const g of femaleG) {
      const excl = excludeSexFor(g, describeAsTags(g));
      expect(excl).toContain('1boy');
      expect(excl).toContain('male focus');
    }
  });

  test('⚠️ A PROMPT MAY NEVER ARGUE WITH ITSELF', () => {
    // THE CASE THIS EXISTS FOR: a flat-chested WOMAN. Her positive says `flat
    // chest`; the female exclusion list also says `flat chest`. Shipped
    // unfiltered, her prompt would assert and deny the same trait — and a
    // self-contradiction is resolved by the model's PRIOR, which is precisely the
    // authority this whole design exists to take away from it. Every
    // contradiction is a silent handover of a GIVEN axis back to the checkpoint.
    for (const g of [...maleG, ...femaleG, ...neutralG]) {
      const positive = describeAsTags(g);
      const said = new Set(positive.toLowerCase().split(',').map((t) => t.trim()));
      for (const term of excludeSexFor(g, positive).split(', ').filter(Boolean)) {
        expect(said.has(term.toLowerCase()), `"${term}" is both asserted and excluded`).toBe(false);
      }
    }
  });

  test('the filter matches WHOLE TAGS, not substrings', () => {
    // This was a real bug, alive for one render: `'female focus'.includes('male
    // focus')` is TRUE, so every FEMALE body silently lost `male focus` from its
    // negative — the exact exclusion the function exists to add, deleted by its
    // own guard.
    for (const g of femaleG) {
      expect(excludeSexFor(g, describeAsTags(g)), 'male focus was eaten by a substring match').toContain('male focus');
    }
  });

  test('⚠️ A NEUTRAL BODY GETS THE SHORTEST LIST — measured, after it broke a render', () => {
    // The first version excluded both ends in full, including the FACIAL and
    // COMPOSITION vocabulary. Sovereign came back with a blank egg-shaped head
    // carrying nothing but eyes: a neutral positive already says `smooth
    // featureless surface`, and excluding faces on top of that left nothing to
    // build one from. `male focus` / `female focus` are COMPOSITION tags meaning
    // the image centres a man or a woman — excluding both reads close to
    // "centre no one".
    for (const g of neutralG) {
      const excl = excludeSexFor(g, describeAsTags(g));
      expect(excl).toContain('1girl');
      expect(excl).toContain('1boy');
      // The body reading only. Nothing about faces.
      expect(excl, 'a neutral body must not have its face excluded').not.toMatch(/makeup|lipstick|eyeshadow|focus/);
    }
  });

  test('an unknown sex yields NO exclusion rather than a wrong one', () => {
    expect(excludeSexFor({ sex: 'something-else' }, 'x')).toBe('');
    expect(excludeSexFor(null, 'x')).toBe('');
  });
});
