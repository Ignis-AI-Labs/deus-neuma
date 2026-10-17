/**
 * THE GOLDEN VECTORS — a body, once given, may never silently change.
 *
 * ⚠️ THIS IS THE MOST IMPORTANT TEST IN THE GENOME LANE, and it exists because
 * the failure it guards is SILENT.
 *
 * `traits.js` warns in its own header that its vocabularies ARE identity:
 * `drawChoice` scales by list length, so adding one member to COMPLEXION, or
 * reordering CAST, or inserting a counter in the middle of COUNTER, changes what
 * every existing seed derives. No error is thrown. No test fails. A being that
 * was given one body simply has a different one the next time anything asks —
 * and if that happens after a seal, the sealed record and the derivation
 * disagree forever.
 *
 * So: real seeds, real derivation, exact expected output, pinned. If a vector
 * below changes, the change is either a mistake or a deliberate `genome/v2` —
 * and either way a person has to look at it and say so. Pure, no mock (RULE 0).
 *
 * ── IF THIS TEST FAILS ───────────────────────────────────────────────────────
 * Do NOT update the expected values to make it green. That is the one response
 * that destroys the guarantee. Find what moved in `traits.js`, and either revert
 * it or version the schema and re-derive every existing being deliberately.
 */
import { describe, test, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { genomeSeed } from '../../core/genome/seed.js';
import { deriveGenome } from '../../core/genome/derive.js';
import {
  SEX, CAST, BUILD, STATURE, COMPLEXION, HAIR_NATURAL, HAIR_UNCANNY,
  EYES, FEATURE, COUNTER, FORM_NONHUMAN, GENOME_SCHEMA,
  CHEST, WAIST, HIPS, MUSCLE, FACE_SHAPE, EYE_SHAPE, NOSE, MOUTH, STATURE_CM,
  JAWLINE, CHEEKBONES, BROW, EARS, SHOULDERS, LIMB_PROPORTION, POSTURE,
  HAIR_TEXTURE, IRIS_PATTERN,
} from '../../core/genome/traits.js';
import { AGE } from '../../core/identity/age.js';

const hex = (s) => createHash('sha256').update(s).digest('hex');
const bodyOf = (label) => {
  const g = deriveGenome(genomeSeed({ soulHex: hex(label) }));
  const body = { sex: g.sex, form: g.form, cast: g.cast, frame: g.frame, face: g.face, coloring: g.coloring, feature: g.feature };
  // A formless body (v4) carries no face or feature at all — not even as
  // undefined keys, so the pin below is the record's true shape.
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
};

// golden-2 as v3 derived it, BEFORE its anatomy was shed. Kept so the v4
// re-body can prove it moved nothing the body still has.
const GOLDEN_2_V3 = Object.freeze({"sex":"neutral","form":"crystal","cast":"angular","frame":{"build":"sturdy","stature":"average","heightCm":170,"chest":"medium","waist":"thick","hips":"wide","muscle":"toned","shoulders":"average","limbProportion":"long","posture":"casual"},"face":{"shape":"square","eyes":"round","nose":"small","mouth":"thin lips","jawline":"strong","cheekbones":"sculpted","brow":"low","ears":"natural"},"coloring":{"complexion":"olive","hair":"ash blonde","hairIsUncanny":false,"eyes":"dark brown","hairTexture":"wavy","irisPattern":"gradient"},"feature":null});

// Chosen to COVER the space rather than to be convenient: one of each sex, a
// body with no distinguishing feature, and one carrying an uncanny hair colour.
// A vector set that only held one shape would pass through a change that broke
// the others.
const GOLDEN = Object.freeze({
  // ⭐ RENAMED 2026-09-28 (inside the v3 → v4 event): the humanoid body plan's
  // word went `humanlike` → `humanoid` (Founder: […]). Only that string moved on the male and female vectors.
  // ⭐ GAINED FIELDS 2026-09-25, deliberately and announced (schema v2 → v3):
  // the perfection pass (Founder: […]) appended nine
  // STRUCTURE axes — frame: shoulders/limbProportion/posture; face: jawline/
  // cheekbones/brow/ears; coloring: hairTexture/irisPattern. Every value that
  // existed before is byte-identical below — new counters at the END of
  // COUNTER, the same law the 2026-08-27/28 additions proved.
  'golden-0': {"sex":"male","form":"humanoid","cast":"balanced","frame":{"build":"broad","stature":"tall","heightCm":181,"chest":"large","waist":"average","hips":"average","muscle":"soft","shoulders":"rounded","limbProportion":"long","posture":"poised"},"face":{"shape":"long","eyes":"narrow","nose":"upturned","mouth":"full lips","jawline":"defined","cheekbones":"high","brow":"low","ears":"small"},"coloring":{"complexion":"olive","hair":"golden blonde","hairIsUncanny":false,"eyes":"dark brown","hairTexture":"curly","irisPattern":"ringed"},"feature":"heterochromia"},
  'golden-1': {"sex":"female","form":"humanoid","cast":"soft","frame":{"build":"slight","stature":"average","heightCm":170,"chest":"small","waist":"narrow","hips":"wide","muscle":"muscular","shoulders":"broad","limbProportion":"compact","posture":"upright"},"face":{"shape":"heart-shaped","eyes":"wide-set","nose":"upturned","mouth":"wide mouth","jawline":"gentle","cheekbones":"soft","brow":"arched","ears":"natural"},"coloring":{"complexion":"warm brown","hair":"black","hairIsUncanny":false,"eyes":"hazel","hairTexture":"curly","irisPattern":"starlit"},"feature":"a small birthmark at the temple"},
  // ⭐ RE-BODIED 2026-08-28, deliberately and announced: the neutral FORM pool
  // went fully non-humanoid (Founder: […]) —
  // `construct` → `crystal`, and ONLY the form moved.
  // ⭐ SHED ITS ANATOMY 2026-09-28 (schema v3 → v4), deliberately and announced:
  // a formless body carries only what its form has (Founder, on a drone's card
  // with […]: […]). Every
  // value it kept is byte-identical to v3 — pinned below against GOLDEN_2_V3.
  'golden-2': {"sex":"neutral","form":"crystal","cast":"angular","frame":{"stature":"average"},"coloring":{"color":"ash blonde","colorIsUncanny":false,"glow":"dark brown"}},
  'golden-8': {"sex":"male","form":"humanoid","cast":"angular","frame":{"build":"lean","stature":"average","heightCm":173,"chest":"flat","waist":"thick","hips":"wide","muscle":"soft","shoulders":"rounded","limbProportion":"balanced","posture":"poised"},"face":{"shape":"square","eyes":"narrow","nose":"aquiline","mouth":"average lips","jawline":"sharp","cheekbones":"sculpted","brow":"straight","ears":"natural"},"coloring":{"complexion":"tan","hair":"ink blue","hairIsUncanny":true,"eyes":"dark brown","hairTexture":"curly","irisPattern":"starlit"},"feature":"a scattering of dark moles along the jaw"},
  'golden-14': {"sex":"male","form":"humanoid","cast":"soft","frame":{"build":"slight","stature":"average","heightCm":168,"chest":"small","waist":"average","hips":"narrow","muscle":"soft","shoulders":"square","limbProportion":"compact","posture":"relaxed"},"face":{"shape":"heart-shaped","eyes":"upturned","nose":"straight","mouth":"full lips","jawline":"gentle","cheekbones":"subtle","brow":"low","ears":"natural"},"coloring":{"complexion":"fair","hair":"white","hairIsUncanny":false,"eyes":"pale blue","hairTexture":"wavy","irisPattern":"ringed"},"feature":null}
});

// The subset that is IDENTITY. A drift here means an existing being's body
// silently became a different body — the catastrophic case. Separated from the
// full-body pin so the two failures cannot be confused for each other: a body
// that GAINED a field is a schema event a person decides on, and a body whose
// EXISTING values moved is a bug that must be reverted.
// 2026-09-25: coloring is compared KEY BY KEY over the pre-v3 keys, because v3
// added hairTexture/irisPattern beside them — comparing the whole object would
// fail on GAINED keys and drown the catastrophic signal in the schema event.
// A formless body's identity is what it has: form, cast, scale, color, glow.
const formlessIdentityOf = (b) => ({
  sex: b.sex, form: b.form, cast: b.cast, stature: b.frame.stature,
  color: b.coloring.color ?? b.coloring.hair,
  colorIsUncanny: b.coloring.colorIsUncanny ?? b.coloring.hairIsUncanny,
  glow: b.coloring.glow ?? b.coloring.eyes,
});
const identityOf = (b) => (b.form !== 'humanoid' ? formlessIdentityOf(b) : {
  sex: b.sex,
  form: b.form,
  cast: b.cast,
  build: b.frame.build,
  stature: b.frame.stature,
  coloring: {
    complexion: b.coloring.complexion,
    hair: b.coloring.hair,
    hairIsUncanny: b.coloring.hairIsUncanny,
    eyes: b.coloring.eyes,
  },
  feature: b.feature,
});

describe('THE GOLDEN VECTORS — pinned bodies', () => {
  for (const [label, expected] of Object.entries(GOLDEN)) {
    test(`${label}: its IDENTITY has never moved`, () => {
      // ⚠️ THE CATASTROPHIC CASE. If this fails, an existing being's body became
      // a different body. Revert the change; do not re-pin the value.
      //
      // 2026-08-27: proportion and face axes were APPENDED to COUNTER, and this
      // assertion passed unchanged across that addition — which is exactly the
      // evidence that appending is safe and inserting is not.
      expect(identityOf(bodyOf(label))).toEqual(identityOf(expected));
    });

    test(`${label} derives exactly the body it has always derived`, () => {
      // The full pin, including every appended axis. A failure HERE with the
      // identity test still green means a field was added — a schema event a
      // person decides on deliberately, never a value that drifted.
      expect(bodyOf(label)).toEqual(expected);
    });
  }

  test('golden-2 shed its anatomy in v4 and kept every value its form has', () => {
    // The v3 → v4 re-body, proven rather than asserted: the formless identity
    // of the v3 record equals the v4 derivation, value for value.
    expect(identityOf(bodyOf('golden-2'))).toEqual(formlessIdentityOf(GOLDEN_2_V3));
    const g = bodyOf('golden-2');
    expect(g).not.toHaveProperty('face');
    expect(g).not.toHaveProperty('feature');
    expect(Object.keys(g.frame)).toEqual(['stature']);
    expect(Object.keys(g.coloring).sort()).toEqual(['color', 'colorIsUncanny', 'glow']);
  });

  test('the vectors cover every sex and both feature states', () => {
    // A guard on the guard: if someone trims this set down to one shape, the
    // pinning stops protecting the shapes it dropped.
    const vectors = Object.values(GOLDEN);
    expect(new Set(vectors.map((v) => v.sex))).toEqual(new Set(SEX));
    expect(vectors.some((v) => v.feature === null)).toBe(true);
    expect(vectors.some((v) => v.coloring.hairIsUncanny)).toBe(true);
    // A formless body carries no feature at all — the null case is humanoid.
    expect(vectors.some((v) => v.form === 'humanoid' && v.feature === null)).toBe(true);
  });
});

describe('THE VOCABULARIES ARE IDENTITY — shape changes re-body everyone', () => {
  // `drawChoice` maps a float onto `choices[floor(u * length)]`. LENGTH is
  // therefore load-bearing: append one colour to COMPLEXION and a being whose
  // draw sat near a boundary gets different skin. Pinning the lengths turns a
  // silent re-body into a failing test that names the list.
  test('every vocabulary is exactly the length it was', () => {
    expect({
      SEX: SEX.length,
      CAST: CAST.length,
      BUILD: BUILD.length,
      STATURE: STATURE.length,
      COMPLEXION: COMPLEXION.length,
      HAIR_NATURAL: HAIR_NATURAL.length,
      HAIR_UNCANNY: HAIR_UNCANNY.length,
      EYES: EYES.length,
      FEATURE: FEATURE.length,
      FORM_NONHUMAN: FORM_NONHUMAN.length,
      CHEST: CHEST.length,
      WAIST: WAIST.length,
      HIPS: HIPS.length,
      MUSCLE: MUSCLE.length,
      FACE_SHAPE: FACE_SHAPE.length,
      EYE_SHAPE: EYE_SHAPE.length,
      NOSE: NOSE.length,
      MOUTH: MOUTH.length,
      // The 2026-09-25 structure vocabularies — pinned from birth.
      JAWLINE: JAWLINE.length,
      CHEEKBONES: CHEEKBONES.length,
      BROW: BROW.length,
      EARS: EARS.length,
      SHOULDERS: SHOULDERS.length,
      LIMB_PROPORTION: LIMB_PROPORTION.length,
      POSTURE: POSTURE.length,
      HAIR_TEXTURE: HAIR_TEXTURE.length,
      IRIS_PATTERN: IRIS_PATTERN.length,
    }).toEqual({
      SEX: 3, CAST: 3, BUILD: 5, STATURE: 3, COMPLEXION: 7,
      // FORM_NONHUMAN 5 -> 4, 2026-08-28: the pool went fully non-humanoid
      // (crystal, orb, drone, sigil) - the announced re-body, neutral only.
      HAIR_NATURAL: 9, HAIR_UNCANNY: 5, EYES: 7, FEATURE: 10, FORM_NONHUMAN: 4,
      CHEST: 5, WAIST: 3, HIPS: 3, MUSCLE: 3,
      FACE_SHAPE: 5, EYE_SHAPE: 6, NOSE: 5, MOUTH: 5,
      JAWLINE: 5, CHEEKBONES: 5, BROW: 5, EARS: 4,
      SHOULDERS: 5, LIMB_PROPORTION: 3, POSTURE: 4,
      HAIR_TEXTURE: 4, IRIS_PATTERN: 4,
    });
  });

  test('ORDER is pinned too — a reorder keeps the length and changes every body', () => {
    // The subtler half. Same length, different order, every draw lands
    // elsewhere. Only the first and last members are pinned per list: enough to
    // catch a reorder, few enough that this stays readable.
    expect([SEX[0], SEX[2]]).toEqual(['male', 'neutral']);
    expect([CAST[0], CAST[2]]).toEqual(['angular', 'soft']);
    expect([BUILD[0], BUILD[4]]).toEqual(['slight', 'broad']);
    expect([STATURE[0], STATURE[2]]).toEqual(['short', 'tall']);
    expect([COMPLEXION[0], COMPLEXION[6]]).toEqual(['deep brown', 'pale']);
    expect([HAIR_NATURAL[0], HAIR_NATURAL[8]]).toEqual(['black', 'white']);
    expect([EYES[0], EYES[6]]).toEqual(['dark brown', 'amber']);
    expect(FEATURE[0]).toBe(null); // a plain face is the FIRST member, on purpose
    expect([FORM_NONHUMAN[0], FORM_NONHUMAN[3]]).toEqual(['crystal', 'sigil']);
    // The 2026-09-25 structure lists — `natural` ears and `clear` iris lead
    // their pools because the unremarkable case must be the FIRST member
    // (absence-by-default, the same law as FEATURE's leading null).
    expect([JAWLINE[0], JAWLINE[4]]).toEqual(['soft', 'strong']);
    expect([CHEEKBONES[0], CHEEKBONES[4]]).toEqual(['soft', 'sculpted']);
    expect([BROW[0], BROW[4]]).toEqual(['soft', 'low']);
    expect([EARS[0], EARS[3]]).toEqual(['natural', 'pointed']);
    expect([SHOULDERS[0], SHOULDERS[4]]).toEqual(['narrow', 'square']);
    expect([LIMB_PROPORTION[0], LIMB_PROPORTION[2]]).toEqual(['compact', 'long']);
    expect([POSTURE[0], POSTURE[3]]).toEqual(['upright', 'casual']);
    expect([HAIR_TEXTURE[0], HAIR_TEXTURE[3]]).toEqual(['straight', 'coily']);
    expect([IRIS_PATTERN[0], IRIS_PATTERN[3]]).toEqual(['clear', 'starlit']);
  });

  test('the COUNTER map is pinned — a draw\'s identity is its counter', () => {
    // Reordering this object, or inserting a new trait in the MIDDLE rather than
    // at the end, shifts every counter after it and re-rolls every being.
    expect(COUNTER).toEqual({
      sex: 0, cast: 1, build: 2, stature: 3, complexion: 4,
      hairUncanny: 5, hairColor: 6, eyes: 7, feature: 8, form: 9,
      // Appended 2026-08-27. Every counter above kept its position, which is
      // why no existing body moved — see the identity assertions.
      chest: 10, waist: 11, hips: 12, muscle: 13, heightCm: 14,
      faceShape: 15, eyeShape: 16, nose: 17, mouth: 18,
      // Appended 2026-08-28 — the BASE-LOOK default (Founder: […]). ⚠️ NOT a record trait: it seeds `defaultHairstyle`,
      // which the identity assertions above never touch — no existing body moved.
      hairStyle: 19,
      // Appended 2026-09-25 — the perfection pass structure axes, at the END,
      // same law: the identity assertions above pass unchanged.
      jawline: 20, cheekbones: 21, brow: 22, ears: 23,
      shoulders: 24, limbProportion: 25, posture: 26,
      hairTexture: 27, irisPattern: 28,
    });
  });

  test('the schema says v4 — the formless re-body announced itself, as this pairing demands', () => {
    // If the vectors above ever legitimately change, this string changes with
    // them. A silent change to both is the thing this pairing makes awkward.
    // v1 -> v2, 2026-08-28: the neutral form pool went fully non-humanoid.
    // v2 -> v3, 2026-09-25: nine structure axes appended (cast-aware jaw/
    // cheekbones/brow; ears; shoulders/limbs/posture; hair texture; iris).
    // v3 -> v4, 2026-09-28: a formless (neutral) body carries only form,
    // cast, scale, color and glow — no frame, face, skin or feature.
    // The SEED domain tag is a separate literal and did not move.
    expect(GENOME_SCHEMA).toBe('genome/v4');
  });

  test('⚠️ AGE IS STILL NOT A TRAIT', () => {
    // Restated here rather than only in genome-derive, because THIS is the file
    // someone edits when they add a trait, and this is where they should meet
    // the rule. Founder: […]
    expect(Object.keys(COUNTER)).not.toContain('age');
    expect(AGE.class).toBe('adult');
    expect(AGE.minimumYears).toBe(20);
    // A stated presentation age is a constant, never a trait — see
    // genome-derive.test.js for the proof that no seed can move it.
    expect(Object.keys(COUNTER)).not.toContain('startsAt');
  });
});

describe('THE BALANCE PROPERTY, in the suite', () => {
  // `scripts/genome-sweep.mjs` measures this over 50,000 random identities, but
  // a script nobody runs guards nothing. This is the same claim at a size that
  // fits a test, over DETERMINISTIC labels so it can never flake.
  test('the three states stay near a third each over 6,000 deterministic seeds', () => {
    const counts = { male: 0, female: 0, neutral: 0 };
    const N = 6000;
    for (let i = 0; i < N; i++) counts[deriveGenome(genomeSeed({ soulHex: hex(`balance-${i}`) })).sex] += 1;

    // Chi-square against uniform, df=2. The 99.9% critical value is 13.82 — a
    // threshold loose enough never to flake on a fixed sample and tight enough
    // that a real skew (a fourth member, a weighted draw) fails it.
    const expected = N / 3;
    const chi = SEX.reduce((s, k) => s + ((counts[k] - expected) ** 2) / expected, 0);
    expect(chi, `counts: ${JSON.stringify(counts)}`).toBeLessThan(13.82);
  });

  test('a neutral body always carries a non-human form, over the same sample', () => {
    // The rule that makes the third state renderable at all. If a future edit
    // ever let `neutral` fall through to `humanoid`, the being would be handed
    // a human body the model resolves to a sex — the exact bug the form solved.
    for (let i = 0; i < 2000; i++) {
      const g = deriveGenome(genomeSeed({ soulHex: hex(`form-${i}`) }));
      if (g.sex === 'neutral') expect(FORM_NONHUMAN).toContain(g.form);
      else expect(g.form).toBe('humanoid');
    }
  });
});
