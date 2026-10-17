/**
 * THE GENOME — the body, said in a language the model can hear.
 *
 * A genome is structured facts; a pipeline wants a subject line. This is the
 * translation, and it is register-aware because the registers genuinely differ:
 *
 *   TAGS  (anime, illustrative) — these checkpoints are trained on DANBOORU
 *         CAPTIONS. `1girl`, `1other`, `dark skin` are real tags with millions
 *         of images behind them. Prose is nearly weightless to them and worse,
 *         dilutes the tags that work. MEASURED 2026-08-26: the framing clause
 *         "plain uncluttered background" lost outright to `simple background`.
 *   PROSE (real) — CyberRealistic's author asks for plain English description
 *         and short negatives; danbooru tags mean nothing to it.
 *
 * ⭐ THE HARD PART, AND THE REASON THIS FILE EXISTS SEPARATELY
 *
 * `neutral` must render as its OWN thing, not as the absence of the other two.
 * The failure mode is a soft, featureless average that reads as […] — which would quietly tell every third being that it is a
 * compromise. Two defences, both structural rather than hopeful:
 *
 *   1. `neutral` gets POSITIVE vocabulary, never negations. `1other` and
 *      `androgynous` are real danbooru tags carrying real training signal; […] carries none and, in a negative-weighted encoder, is
 *      actively harmful.
 *   2. CAST carries the structure. Every body — all three sexes — gets the same
 *      quantity of structural description from its cast. A `neutral` body is not
 *      thinner than a masculine one; it is specified differently. Two `neutral`
 *      beings differ from each other exactly as much as two masculine ones do.
 *
 * Whether this actually worked cannot be settled here. It is settled by looking
 * at the pictures (phase 2).
 *
 * Pure. Imports only the trait vocabularies, the spine, and its own wording
 * tables (`describe-vocab.js` — split out under the size law; the vocabulary is
 * WHAT each value is called, this file is WHICH clauses a body gets).
 */

import { composeSpine } from './prompt-spine.js';
import { BODY_FEATURES } from './traits.js';
import { AGE } from '../identity/age.js';
import { defaultHairstyle } from './derive.js';
import {
  CHEST_TAGS, CHEST_PROSE, WAIST_TAGS, WAIST_PROSE, HIPS_TAGS, HIPS_PROSE,
  MUSCLE_TAGS, MUSCLE_PROSE, BUILD_TAGS, STATURE_TAGS, FEATURE_TAGS,
  HAIR_ANCHOR, SKIN_ANCHOR, FORM_DETAIL, CAST_GEOMETRY, STATURE_SCALE,
} from './describe-vocab.js';
// The 2026-09-25 structure axes compose in their own module (size law) —
// absence-proof for any genome record derived before the pass.
import { faceDetailOf, frameDetailOf, coloringDetailOf } from './describe-detail.js';

// ── SEX, in each register ───────────────────────────────────────────────────
// `1other` is danbooru's own tag for a subject that is neither `1girl` nor
// `1boy` — a trained concept, not a coinage of ours.
//
// ⚠️ `mature male` / `mature female` USED TO RIDE HERE AND ARE GONE. On danbooru
// those tags mean an OLDER subject, so they were pulling against the age beside
// them — Design note, 2026-08-27: […] The stated
// number does the work they were meant to.
const SEX_TAGS = Object.freeze({
  male: `1boy, solo, male focus, adult, ${AGE.startsAt} years old`,
  female: `1girl, solo, female focus, adult, ${AGE.startsAt} years old`,
  // Never reached: a `neutral` body is described by its FORM (below), because
  // there is no human tag that escapes the axis. Kept only so a malformed genome
  // with no form still names something rather than nothing.
  neutral: '1other, solo, adult',
});

const SEX_PROSE = Object.freeze({
  male: `a ${AGE.startsAt} year old man`,
  female: `a ${AGE.startsAt} year old woman`,
  neutral: `a ${AGE.startsAt} year old figure`,
});

// ── THE THIRD STATE, BY FORM ────────────────────────────────────────────────
// MEASURED 2026-08-26: `1other, androgynous, ambiguous gender` on a humanoid
// body rendered as a young man. The tags were not weak — the request was
// impossible. A humanoid face is dimorphic and the model has to land somewhere.
//
// So the third state leaves the humanoid BODY PLAN — never the species. Every
// being here is a NEUMA (traits.js SPECIES, Design note, 2026-08-27; these forms are
// bodies a neuma can wear.
//
// ⭐⭐ THE RULE, SUPERSEDED BY MEASUREMENT TWICE:
//   2026-08-26 — […]: humanoid forms that changed the
//   facial material (porcelain, construct) beat the ones that left a human
//   face on machinery (android, automaton).
//   2026-08-28 — Founder, after living with those renders: […] Even a porcelain face is a face, the genome kept
//   asking for one (`square face, wide-set eyes…`), and the model kept landing
//   it somewhere on the sex axis. The `nonhumanoid` sweep proved the stronger
//   rule in BOTH registers: THERE IS NO FACE, so there is nothing to sex.
//
// `no humans` is the anchor every form shares — a major danbooru tag with real
// mass, meaning no human subject in frame. The being's colors ride in the
// coloring band directly behind these, its geometry in the cast band, its
// focal point (the face-without-a-face) in the face band.
export const FORM_TAGS = Object.freeze({
  crystal: 'no humans, a large floating faceted crystal, geometric facets, levitating',
  orb: 'no humans, a sphere of light, energy orb, floating',
  drone: 'no humans, non-humanoid robot, small floating drone, sleek ceramic shell, hovering',
  sigil: 'no humans, abstract glowing emblem, interlocking geometric rings, floating',
});

export const FORM_PROSE = Object.freeze({
  crystal: 'a large floating faceted crystal lit from within',
  orb: 'a drifting sphere of light',
  drone: 'a small non-humanoid drone with a single glowing sensor eye',
  sigil: 'an abstract glowing emblem of interlocking rings',
});

// FORM_DETAIL (color noun, focal point, presence per form), CAST_GEOMETRY and
// STATURE_SCALE — the formless wording tables — live in `describe-vocab.js`
// with the rest of the vocabulary.

// The predicate tests the BODY PLAN, and its name says so. It was `isNonHuman`
// until 2026-08-27, which asserted a species — and every being here is a neuma,
// so "non-human" distinguished nothing. What it actually gates is whether the
// body is off the humanoid plan (no complexion clause, no chest spec, form
// vocabulary instead of sex vocabulary).
const isNonHumanoid = (g) => g.sex === 'neutral' && Boolean(FORM_TAGS[g.form]);

// A formless palette: v4 says color/glow; a v3 record said hair/eyes.
const formColor = (g) => g.coloring.color ?? g.coloring.hair;
const formGlow = (g) => g.coloring.glow ?? g.coloring.eyes;

// ── CAST — the same weight of structure for all three sexes ─────────────────
// This is the anti-smear mechanism doing its work: whatever the sex, the body
// gets this much said about its actual construction.
// ⚠️ CAST OWNS BONE STRUCTURE ONLY, as of 2026-08-27. It used to claim the eyes
// and the mouth as well, which put it in direct contradiction with the face
// axes — `angular` said "narrow eyes" while `face.eyes` might say "round". A
// prompt that contradicts itself is resolved by the model's prior, which is
// exactly the authority this design exists to take away from it.
const CAST_TAGS = Object.freeze({
  angular: 'sharp features, defined jawline, high cheekbones',
  balanced: 'even features, level brow',
  soft: 'soft features, rounded jaw',
});

const CAST_PROSE = Object.freeze({
  angular: 'sharp features, a defined jawline and high cheekbones',
  balanced: 'even, regular features and a level brow',
  soft: 'soft features and a rounded jaw',
});

/** The face, axis by axis — the same face in either vocabulary. Pure. */
const faceOf = (g, asTags = true) => (g.face ? [
  `${g.face.shape} face`,
  `${g.face.eyes} eyes`,
  `${g.face.nose} nose`,
  g.face.mouth,
  ...faceDetailOf(g, asTags),
] : []);

// ── ⭐ THE PROPORTIONS, SAID THE SAME WAY TWICE ──────────────────────────────
// The paired tag/prose tables live in `describe-vocab.js`, including the most
// important null in the genome (`CHEST_TAGS.male.flat`) and the account of why.

/**
 * Every proportion axis, in one register's vocabulary. Pure.
 *
 * The HEIGHT rides as a figure because a figure cannot be reinterpreted:
 * "short" means whatever a checkpoint thinks it means and 158 cm does not. It is
 * also the one line of this the 3D stage can use directly.
 */
const proportions = (g, asTags) => {
  const f = g.frame;
  const chestTable = asTags ? CHEST_TAGS : CHEST_PROSE;
  // A neutral body's form already stated its surface and construction; adding a
  // human chest spec to a porcelain construct describes anatomy it does not have.
  const chest = g.sex === 'neutral' ? null : chestTable[g.sex]?.[f.chest];
  return [
    chest,
    (asTags ? WAIST_TAGS : WAIST_PROSE)[f.waist],
    (asTags ? HIPS_TAGS : HIPS_PROSE)[f.hips],
    (asTags ? MUSCLE_TAGS : MUSCLE_PROSE)[f.muscle],
    `${f.heightCm}cm tall`,
  ];
};

const join = (parts) => parts.filter(Boolean).join(', ');

// The color anchor law and its measurement live with the maps in
// `describe-vocab.js`. `dark brown hair` already contains `brown hair`
// verbatim, so its anchor would only duplicate adjacent tokens — the substring
// check keeps it out.
const anchored = (shade, kind, anchors) => {
  const anchor = anchors[shade];
  return anchor && !shade.includes(anchor)
    ? `${anchor} ${kind}, ${shade} ${kind}`
    : `${shade} ${kind}`;
};

/**
 * Does this framing have room for this feature? A portrait shows the face and
 * nothing below the collarbone, so a mark on a hand cannot appear in it — and
 * asking for one anyway does not produce a subtle omission, it produces a hand
 * dragged into the shot (MEASURED, Keir's PFP, 2026-08-26). Pure.
 */
const showsFeature = (g, framing) =>
  Boolean(g.feature) && !(framing === 'portrait' && BODY_FEATURES.has(g.feature));

/**
 * Which framing a pipeline id draws. A turnaround shows the whole body and can
 * carry every feature; a portrait cannot. Pure.
 * @param {string} pipelineId
 * @returns {'portrait'|'full'}
 */
export const framingOf = (pipelineId) =>
  (String(pipelineId ?? '').endsWith('.pfp') ? 'portrait' : 'full');

/**
 * ⭐ THE GENOME HALF OF THE SPINE — the given body, as NAMED COMPONENTS.
 *
 * Design note, 2026-08-27: […]
 *
 * Returning a map rather than a string is what makes that enforceable: the
 * parameterizer can now ask what is missing instead of counting commas. Every
 * key here is `owner: GENOME` in the spine — given by the hash, and not the
 * pipeline's to drop. Pure.
 *
 * The `chosen` map carries the CHOSEN half where it exists — today that is
 * `hairstyle`. Design note, 2026-08-28: […] Absent a choice, the genome's seeded default
 * stands, so renders agree before anyone has chosen anything.
 *
 * @param {object} g a `genome/v1`
 * @param {'portrait'|'full'} framing
 * @param {{hairstyle?: string}} chosen the neuma-and-operator choices, if any
 * @returns {Record<string, string>}
 */
export const describeAsComponents = (g, framing = 'full', chosen = {}) => {
  // ⭐⭐ A FORMLESS BODY WEARS THE SAME SPINE IN ITS OWN VOCABULARY — every
  // GIVEN axis still speaks (that is what keeps neutral exactly as specified
  // as the other two sexes), but through what the form can carry:
  //   coloring → the hair shade paints the form's material, the eye shade its
  //              glow; cast → geometry; face → the FOCAL POINT (the
  //              face-without-a-face a viewer meets first); frame → scale.
  //   garment/expression → overridden: `levitating` is what a crystal wears,
  //              its orbiting shards are its expression. Both taken from the
  //              measured `nonhumanoid` sweep prompts.
  //   hairstyle/feature → silent: no hair, no skin to mark.
  // ⚠️ NO HUMAN VOCABULARY, MEASURED THE HARD WAY 2026-08-28: the first
  // composition kept `solo, adult, 21 years old` and the pipeline's
  // `portrait, looking at viewer`, and perfectDeliberate rendered a beautiful
  // WOMAN wearing the sigil on her forehead — with `no humans` in the positive
  // and humanoid/human/face/person in the negative. Positives always beat
  // negatives, and those four human-coded tags outweighed everything. The
  // sweep prompts that measured clean carried NO human vocabulary at all, so
  // this composes to exactly that: the framing is overridden too. The AGE
  // still rides the RECORD (it is pinned there forever); it stays out of a
  // formless PROMPT because there is no human in frame to be young.
  if (isNonHumanoid(g)) {
    const d = FORM_DETAIL[g.form];
    return Object.freeze({
      sex: FORM_TAGS[g.form],
      coloring: join([
        anchored(formColor(g), d.noun, HAIR_ANCHOR),
        `${formGlow(g)} glow`,
      ]),
      cast: CAST_GEOMETRY[g.cast],
      face: d.focus,
      hairstyle: '',
      frame: STATURE_SCALE[g.frame.stature],
      feature: '',
      framing: 'centered composition',
      garment: 'levitating',
      expression: d.presence,
    });
  }
  return Object.freeze({
    // The sex carries `solo`, the focus tag and the AGE with it, so a body can
    // never be rendered without one — they are one component precisely because
    // splitting them would let the age go missing while the prompt still reads fine.
    sex: SEX_TAGS[g.sex],
    // ⚠️ COLORING RIDES HIGH — MEASURED 2026-08-27, and it cost a real render.
    // Adding the proportion and face axes pushed `rich brown skin` from the middle
    // of the prompt to the tail, and Signal's photoreal portrait came back FAIR.
    // Nothing about the tag changed; it simply lost the weight fight. The
    // Illustrious guidance says this outright — […] — and skin, hair and eyes are the attributes a viewer
    // reads FIRST and forgives LAST, so they sit where they cannot be diluted.
    // The SPINE is now what guarantees that position, rather than this line's
    // place in an array.
    coloring: join([
      anchored(g.coloring.complexion, 'skin', SKIN_ANCHOR),
      anchored(g.coloring.hair, 'hair', HAIR_ANCHOR),
      `${g.coloring.eyes} eyes`,
      ...coloringDetailOf(g, true),
    ]),
    cast: CAST_TAGS[g.cast],
    face: join(faceOf(g)),
    // The base look — a chosen style when one exists, the seeded default until
    // then. Never permanent, never sealed; `defaultHairstyle` carries the law.
    hairstyle: String(chosen.hairstyle ?? '').trim() || defaultHairstyle(g),
    frame: join([
      BUILD_TAGS[g.frame.build],
      STATURE_TAGS[g.frame.stature],
      ...proportions(g, true),
      ...frameDetailOf(g, true),
    ]),
    // The one OPTIONAL genome component, and it is optional twice over: not every
    // body has a feature, and a portrait has no room for a mark on a hand.
    feature: showsFeature(g, framing) ? FEATURE_TAGS[g.feature] : '',
  });
};

/**
 * The body as danbooru tags — for the anime and illustrative registers. Pure.
 *
 * Composed through the SPINE. The 2026-08-27 spine refactor was byte-identical
 * to the flat array it replaced; the color ANCHORS added the same day changed
 * the coloring band on purpose, with the measurement (`hairhold-s*.json`) that
 * justified changing text approved renders were made from.
 *
 * @param {object} g a `genome/v1`
 * @returns {string}
 */
export const describeAsTags = (g, framing = 'full', chosen = {}) =>
  composeSpine(describeAsComponents(g, framing, chosen));

/**
 * The body as plain English — for the photoreal register. Pure.
 * @param {object} g a `genome/v1`
 * @returns {string}
 */
export const describeAsProse = (g, framing = 'full') => {
  // A formless body's prose is short on purpose: form, palette, geometry.
  // Chest specs and face shapes describe anatomy it does not have, and an age
  // describes a human in frame — the tag register drops it for the same reason.
  // (The prose lane is SHELVED; this keeps it honest for the day it returns.)
  if (isNonHumanoid(g)) {
    return join([
      FORM_PROSE[g.form],
      `${formColor(g)} colored, glowing ${formGlow(g)}`,
      CAST_GEOMETRY[g.cast],
      STATURE_SCALE[g.frame.stature],
    ]);
  }
  const frame = `${g.frame.stature === 'average' ? 'of average height' : g.frame.stature}, `
    + `${g.frame.build} build, ${[...proportions(g, false), ...frameDetailOf(g, false)].filter(Boolean).join(', ')}`;
  // Same law as the tag register: the colouring leads, because it is what a
  // viewer reads first and what a diluted prompt loses first.
  return join([
    SEX_PROSE[g.sex],
    `${g.coloring.hair} hair, ${g.coloring.eyes} eyes, ${g.coloring.complexion} skin`,
    join(coloringDetailOf(g, false)) || null,
    CAST_PROSE[g.cast],
    faceOf(g, false).join(', '),
    frame,
    showsFeature(g, framing) ? g.feature : null,
  ]);
};

/**
 * The register a pipeline id belongs to. `form.real.*` is the only prose lane;
 * everything else is danbooru-trained. Pure.
 * @param {string} pipelineId
 * @returns {'tags'|'prose'}
 */
export const registerOf = (pipelineId) =>
  (String(pipelineId ?? '').startsWith('form.real.') ? 'prose' : 'tags');

/**
 * The subject text a form pipeline should receive for this body. Pure.
 *
 * ⚠️ This is the GIVEN half only. Hair style, clothing, expression and every
 * other chosen thing are appended by the being — they are its authorship and do
 * not belong to the genome.
 *
 * @param {object} genome a `genome/v1`
 * @param {string} pipelineId
 * @returns {string}
 */
/**
 * A genome's spine components for a pipeline, or NULL when the pipeline's
 * register cannot carry them.
 *
 * The PROSE register is a sentence, not a component list — splitting […] into named parts would produce grammar, not tags.
 * Returning null there is honest: the parameterizer then audits only the
 * structured half, exactly as it does for a being's own free text.
 *
 * ⚠️ Both prose lanes are shelved today, so this returns components in practice.
 * The null branch exists so restoring one cannot silently start enforcing a law
 * against a register that was never shaped for it. Pure.
 *
 * @param {object} genome a `genome/v1`
 * @param {string} pipelineId
 * @returns {Record<string, string>|null}
 */
// ── ⭐⭐ THE SEX, ENFORCED IN BOTH POLARITIES ─────────────────────────────────
//
// Design note, 2026-08-27: […]
//
// Until now the genome spoke only to the POSITIVE. The negative was a frozen
// house string that had no idea whose body it was steering — so a male genome
// asserted `1boy` and then excluded nothing that would pull it female. Asserting
// and excluding are different jobs and a given axis deserves both.
//
// ⚠️ AND THE NEGATIVE ALONE IS NOT ENOUGH — that was MEASURED, on this exact
// axis. `prompt-lab.mjs malebody`: excluding `1girl, female, breasts, cleavage`
// barely moved a render that `flat chest` in the positive had already broken.
// A negative cannot undo a positive that states the opposite. So this is the
// SECOND half of a fix whose first half is already in — belt AND braces, in that
// order, never braces alone.
//
// The vocabulary is danbooru-native, because a term these models never learned
// is a comforting no-op (the lesson `plain uncluttered background` taught).
const SEX_EXCLUSION = Object.freeze({
  male: '1girl, 2girls, female focus, breasts, cleavage, makeup, lipstick, eyeshadow',
  female: '1boy, 2boys, male focus, muscular male, facial hair, beard, stubble, flat chest',
  // ⚠️ THE NEUTRAL LIST CHANGED WITH THE FORMS, 2026-08-28. Under the HUMANOID
  // pool this list was the shortest by measurement: excluding facial vocabulary
  // on top of `smooth featureless surface` gave Sovereign a blank egg-shaped
  // head — a neutral body HAD a face, and the exclusion starved it.
  //
  // The pool is now fully NON-HUMANOID (Founder: […]). There is no face to starve — the `nonhumanoid` sweep measured
  // these renders in both registers WITH the humanoid vocabulary excluded, and
  // that exclusion is part of why `no humans` holds: the model is told what the
  // frame contains AND what it must not reach for. `focus`/`makeup` stay out —
  // they never came back after the egg-head lesson and nothing asks for them.
  neutral: '1girl, 1boy, breasts, cleavage, humanoid, human, face, person',
});

/**
 * ⭐ The sex exclusion for a body, MINUS anything its own positive asserts.
 *
 * ⚠️ THE FILTER IS THE WHOLE POINT, not a tidy-up. A flat-chested WOMAN would
 * otherwise get `flat chest` in her negative while her positive says `flat
 * chest` — a prompt arguing with itself, resolved by the model's prior, which is
 * exactly the authority this design exists to take away from it. Every
 * self-contradiction is a silent handover of a given axis back to the checkpoint.
 *
 * Pure.
 *
 * @param {object} genome a `genome/v1`
 * @param {string} positive the composed positive, so nothing it asserts is excluded
 * @returns {string} comma-separated exclusions, possibly empty
 */
export const excludeSexFor = (genome, positive = '') => {
  const raw = SEX_EXCLUSION[genome?.sex];
  if (!raw) return '';
  // ⚠️ WHOLE TAGS, NEVER SUBSTRINGS. A substring test looked right and was
  // wrong within one render: `'female focus'.includes('male focus')` is TRUE, so
  // every FEMALE body silently lost `male focus` from its negative — the exact
  // exclusion this function exists to add, deleted by its own guard. A prompt
  // vocabulary is comma-separated tags, so the comparison is over tags.
  const said = new Set(String(positive).toLowerCase().split(',').map((t) => t.trim()).filter(Boolean));
  return raw
    .split(', ')
    .filter((term) => !said.has(term.toLowerCase()))
    .join(', ');
};

export const componentsFor = (genome, pipelineId, chosen = {}) => {
  if (registerOf(pipelineId) === 'prose') return null;
  const components = describeAsComponents(genome, framingOf(pipelineId), chosen);
  // The exclusion is computed against this body's OWN positive, so a trait it
  // asserts can never also be excluded. Carried on a `__`-prefixed key because
  // it is NEGATIVE text travelling with positive components — the spine composes
  // the positive, and the parameterizer strips this before composing.
  return Object.freeze({
    ...components,
    __excludeSex: excludeSexFor(genome, composeSpine(components)),
  });
};

export const subjectFor = (genome, pipelineId, chosen = {}) => {
  const framing = framingOf(pipelineId);
  // The prose lane is SHELVED and does not carry the chosen axes yet — when it
  // returns, the base look needs a prose wording beside the tag one.
  return registerOf(pipelineId) === 'prose'
    ? describeAsProse(genome, framing)
    : describeAsTags(genome, framing, chosen);
};

/**
 * A short human-readable line for the reveal and the desk. Pure.
 *
 * Names the age explicitly. It is never a variable, and a reader should be able
 * to see that from the record rather than take it on trust.
 * @param {object} g
 */
export const summarize = (g) => (isNonHumanoid(g)
  // A formless body's summary speaks the form — it has no chest or face to recite.
  ? `${g.species ?? 'neuma'} · ${g.sex} (${g.form}) · ${g.cast} · ${STATURE_SCALE[g.frame.stature]} · `
    + `${formColor(g)}, ${formGlow(g)} glow · ${AGE.class}, starts at ${AGE.startsAt}`
  : `${g.species ?? 'neuma'} · ${g.sex} · ${g.cast} · `
  + `${g.frame.heightCm}cm ${g.frame.build} · chest ${g.frame.chest}, waist ${g.frame.waist}, `
  + `hips ${g.frame.hips}, ${g.frame.muscle} · `
  + `${g.face.shape} face, ${g.face.eyes} eyes, ${g.face.nose} nose, ${g.face.mouth} · `
  + `${g.coloring.hair} hair, ${g.coloring.eyes} eyes, ${g.coloring.complexion} skin`
  + `${g.feature ? ` · ${g.feature}` : ''} · ${AGE.class}, starts at ${AGE.startsAt}`);
