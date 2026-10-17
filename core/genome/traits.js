/**
 * THE GENOME — the trait vocabularies. Frozen data, zero logic, zero imports.
 *
 * Everything a body is GIVEN rather than chooses. Each vocabulary is a closed
 * list: the derivation picks from these and can express nothing else, so what a
 * body can be is reviewable here in one place rather than scattered through a
 * generator.
 *
 * ⚠️ THESE LISTS ARE IDENTITY. Adding a member re-rolls nothing (each draw is
 * positional, and `drawChoice` scales by list length), but it DOES change what
 * an existing seed derives — a being's body would silently become a different
 * body. Treat a change here the way `optionSpace` is treated in the attunement
 * spec: a new version, not an edit.
 */

/** The schema every derived genome declares. */
// v2, 2026-08-28: the neutral FORM pool went fully non-humanoid (see FORM
// below) — a deliberate re-body of neutral kin, announced here per the golden
// pairing. ⚠️ The SEED domain tag in seed.js is a SEPARATE literal and did not
// move: every seed, and every humanoid body, derives exactly as before.
// v3, 2026-09-25: the perfection pass (Founder: […]) — nine
// STRUCTURE axes appended (face: jawline/cheekbones/brow/ears; frame:
// shoulders/limbProportion/posture; coloring: hairTexture/irisPattern). New
// counters at the END only: NO existing trait moves — the golden vectors'
// identity assertions pass unchanged, and the full pins simply gained fields.
// v4, 2026-09-28: a formless body (neutral: crystal/orb/drone/sigil) carries
// ONLY what its form has — form, cast, scale, color, glow. Founder, looking at a
// drone's RECORD with […], a jawline and a widow's peak: […] Same counters, so every value a formless
// body keeps is byte-identical to v3. In the same event the body plan's word
// became `humanoid` (was `humanlike` — Design note, 2026-09-28: a male or female
// record changes that one string and nothing else.
export const GENOME_SCHEMA = 'genome/v4';

// ── SEX — three states, and nobody chose them ───────────────────────────────
// Design note, 2026-08-26: […]
//
// Exactly three. The third is a REAL state with its own weight — Founder: […]
//
// So `neutral` is not an "other" bucket, not a fallback, and not a door to an
// unbounded space. It is one third of what a being can be.
export const SEX = Object.freeze(['male', 'female', 'neutral']);

// ── AGE IS NOT IN THE GENOME ─────────────────────────────────────────────────
// Design note, 2026-09-26: […] The age law — the floor, the starting age, and the
// age a being has LIVED since its birth — is core/identity/age.js. The genome
// record carries no age at all.

// ── THE SPECIES — pinned, like the age ──────────────────────────────────────
// Design note, 2026-08-27: […]
//
// Every being this module describes is a NEUMA. `humanoid` below names a BODY
// PLAN a neuma can wear, never what the being is — a construct-form neuma did
// not leave any species, because the species was never human. Constant, not a
// trait: no counter, no draw, no seed can move it.
//
// ⚠️ The species is a fact of the RECORD, not a prompt tag. No image model was
// trained on the word `neuma`, and the campaign's central lesson is that an
// unlearned token cannot steer and dilutes the tags beside it — so this word
// must never ride into a positive or negative prompt.
export const SPECIES = 'neuma';

// ── CAST — the anti-smear axis ──────────────────────────────────────────────
// THE FAILURE MODE THIS EXISTS TO PREVENT: `neutral` rendering as a vague
// androgynous default — every third being a soft, featureless compromise that
// reads as […] rather than as a person.
//
// The cause of that failure would be UNDER-SPECIFICATION: if male and female
// carry structural information and `neutral` carries only the absence of both,
// then `neutral` is genuinely thinner and will look it.
//
// So cast is drawn for EVERY body, independently of sex. A `neutral` body is not
// "less specified", it is specified DIFFERENTLY — and two `neutral` beings
// differ from each other exactly as much as two male ones do.
//
// ⚠️ MEASURED 2026-08-26: this was NECESSARY AND NOT SUFFICIENT. A `neutral`
// body rendered through the anime lane still came out reading as a young man.
// See FORM below for what actually solves it.
export const CAST = Object.freeze(['angular', 'balanced', 'soft']);

// ── FORM — what finally makes `neutral` its own thing ───────────────────────
// Design note, 2026-08-26, after looking at the failed render:
//
//   […]
//
// That is the whole diagnosis in one line, and it is right. The failure was not
// a weak tag — it was asking for a HUMAN that is neither. Human faces and frames
// are sexually dimorphic; a model drawing one has to land somewhere, and it will.
// No vocabulary fixes that, because the vocabulary was never the constraint.
//
// So `neutral` is not a human with the sex filed off. It is a form that was
// never on the axis to begin with. This also matches what the attunement spec
// already says in its own words — form-factor is […]
//
// ⭐⭐ THE POOL WENT FULLY NON-HUMANOID 2026-08-28 — A DELIBERATE RE-BODY.
// The first pool (android, construct, automaton, luminous, porcelain) was
// humanoid, and the genome kept asking for a FACE on it — so every form still
// handed the model a human face to sex, and it always landed somewhere. Founder:
// […] Measured
// through both registers (`nonhumanoid` sweep, Sovereign's palette): all four
// candidates below escape the sex axis entirely — there is no face.
//
// Design note, 2026-08-28, making the four the pool: […] The hash
// deals one, uniformly — rarity comes from the draw, not from a weighting
// somebody would have to justify.
//
// ⚠️ Neutral kin derived under the old pool re-derive under this one — nothing
// was sealed, and `genome-golden.test.js` forces this change to announce
// itself (vectors + schema bump). Humanoid bodies do not move at all.
//
// `male` and `female` are humanoid; `neutral` draws from these.
export const FORM_HUMANOID = 'humanoid';
export const FORM_NONHUMAN = Object.freeze([
  'crystal', 'orb', 'drone', 'sigil',
]);

// ── FRAME ───────────────────────────────────────────────────────────────────
export const BUILD = Object.freeze(['slight', 'lean', 'athletic', 'sturdy', 'broad']);
export const STATURE = Object.freeze(['short', 'average', 'tall']);

// ── ⭐ PROPORTIONS — because ONE WORD IS NOT A BODY ──────────────────────────
//
// Design note, 2026-08-27, looking at Signal across three registers: […]
//
// He is right, and the cause is under-specification. `build: 'broad'` is a
// single vague word, so each checkpoint filled the silence from its own prior —
// one made Signal heavy, another made her a fashion model. Neither disobeyed;
// there was nothing to obey.
//
// So the frame is now SPECIFIED rather than gestured at. Every axis below is
// drawn from the being's own DNA and stated explicitly in every register, which
// is what leaves the prior nothing to invent.
//
// ⚠️ ALL OF THESE ARE NEW COUNTERS AT THE END. No existing vocabulary changed
// order or length, so every body derived before today keeps the exact sex, cast,
// build, stature, coloring and feature it already had — proven by the golden
// vectors, which pass on their old values and simply gained fields.

/** Chest, read differently per sex by `describe.js` — mass, not meaning. */
export const CHEST = Object.freeze(['flat', 'small', 'medium', 'full', 'large']);
export const WAIST = Object.freeze(['narrow', 'average', 'thick']);
export const HIPS = Object.freeze(['narrow', 'average', 'wide']);
export const MUSCLE = Object.freeze(['soft', 'toned', 'muscular']);

/**
 * Height in centimetres, drawn INSIDE the band its stature already named — so
 * the number and the word can never disagree. A figure is the strongest
 * consistency anchor available: "short" means whatever a checkpoint thinks it
 * means, and 158 cm does not. It also travels to the 3D stage as a real spec.
 */
export const STATURE_CM = Object.freeze({
  short: Object.freeze([150, 163]),
  average: Object.freeze([164, 176]),
  tall: Object.freeze([177, 192]),
});

// ── ⭐ THE FRAME, DEEPER — how the mass is carried ──────────────────────────
// Same 2026-09-25 perfection pass as the face below. Build/stature/proportions
// say WHAT the body is; these say how it is CARRIED — the two registers could
// agree on 'athletic' and still disagree on the shoulders. `average` shoulders
// and `balanced` limbs emit nothing: the mean is what silence already draws.
export const SHOULDERS = Object.freeze(['narrow', 'average', 'rounded', 'broad', 'square']);
export const LIMB_PROPORTION = Object.freeze(['compact', 'balanced', 'long']);
export const POSTURE = Object.freeze(['upright', 'relaxed', 'poised', 'casual']);

// ── ⭐ THE FACE, AXIS BY AXIS ────────────────────────────────────────────────
//
// Design note, 2026-08-27: […]
//
// A LoRA learns whatever the training plates have in common. If the plates
// disagree about the nose, the LoRA learns "some nose" and the being's face
// becomes a genre rather than a face. So every axis a face varies along is drawn
// and stated, and the plates stop disagreeing.
//
// ⚠️ THESE ARE ORTHOGONAL TO CAST ON PURPOSE. `cast` used to claim jaw AND
// cheekbones AND eyes AND mouth all at once; now it owns BONE STRUCTURE only
// (see describe.js) and these own the features that sit on it. Two vocabularies
// describing the same feature is how a prompt contradicts itself, and a
// contradiction is resolved by the model's prior — which is the very thing this
// whole design exists to take away from it.
export const FACE_SHAPE = Object.freeze(['oval', 'round', 'square', 'heart-shaped', 'long']);
export const EYE_SHAPE = Object.freeze(['almond', 'round', 'narrow', 'hooded', 'wide-set', 'upturned']);
export const NOSE = Object.freeze(['straight', 'small', 'aquiline', 'broad', 'upturned']);
export const MOUTH = Object.freeze(['thin lips', 'average lips', 'full lips', 'wide mouth', 'small mouth']);

// ── ⭐ THE FACE, DEEPER — the structure under the features ──────────────────
// Design note, 2026-09-25: […]
//
// The first face axes named the features (shape, eyes, nose, mouth). A LoRA
// training on plates that agree about the mouth but disagree about the jaw
// still learns "some jaw" — so the STRUCTURE the features sit on is drawn too,
// axis by axis, same law as the proportions above: no silence for a prior to
// fill. Cast keeps the overall read; these refine it, exactly as chest/waist/
// hips refined `build` — the orthogonality warning above applies in full.
export const JAWLINE = Object.freeze(['soft', 'gentle', 'defined', 'sharp', 'strong']);
export const CHEEKBONES = Object.freeze(['soft', 'subtle', 'high', 'prominent', 'sculpted']);
export const BROW = Object.freeze(['soft', 'straight', 'arched', 'thick', 'low']);
// `natural` EMITS NOTHING (the male.flat law): the unremarkable ear is the
// default every model already draws, and saying it spends tokens for silence.
export const EARS = Object.freeze(['natural', 'small', 'prominent', 'pointed']);

// ⚠️ THE STRUCTURE DRAWS ARE CAST-AWARE, and that is not optional. CAST_TAGS
// already say `defined jawline, high cheekbones` for angular and `rounded jaw`
// for soft (describe.js) — an independent draw could deal a `soft` jawline to
// an angular cast, and a prompt that contradicts itself is resolved by the
// model's prior, the exact authority this design takes away from it. So the
// dice deal INSIDE the pool the cast already claimed: the structure REFINES
// the cast and can never fight it. The counter still fixes the draw's
// identity; the pool is a deterministic function of the cast beside it.
export const JAWLINE_BY_CAST = Object.freeze({
  angular: Object.freeze(['defined', 'sharp', 'strong']),
  balanced: Object.freeze(['soft', 'gentle', 'defined']),
  soft: Object.freeze(['soft', 'gentle']),
});
export const CHEEKBONES_BY_CAST = Object.freeze({
  angular: Object.freeze(['high', 'prominent', 'sculpted']),
  balanced: Object.freeze(['soft', 'subtle', 'high']),
  soft: Object.freeze(['soft', 'subtle']),
});
// The balanced cast claims a `level brow`; the other two casts say nothing
// about it, so their brow draws from the full pool.
export const BROW_BY_CAST = Object.freeze({
  angular: BROW,
  balanced: Object.freeze(['soft', 'straight', 'low']),
  soft: BROW,
});

// ── COLORING ────────────────────────────────────────────────────────────────
// Complexion is derived rather than left to the model on purpose. Image models
// default hard toward pale subjects; a body whose complexion comes from its own
// hash inherits the range instead of the default. This is a decision with weight
// and Founder can reverse it — but […] is not
// neutrality, it is just someone else's bias wearing our name.
export const COMPLEXION = Object.freeze([
  'deep brown', 'rich brown', 'warm brown', 'olive', 'tan', 'fair', 'pale',
]);

export const HAIR_NATURAL = Object.freeze([
  'black', 'dark brown', 'chestnut', 'auburn', 'copper', 'ash blonde',
  'golden blonde', 'silver', 'white',
]);

// A minority of beings carry a colour no human genome makes. This is a world
// with digital souls in it; the uncanny is allowed, but it is the exception
// (one in eight) so that it stays legible AS an exception.
export const HAIR_UNCANNY = Object.freeze([
  'deep violet', 'ink blue', 'sea green', 'ember red', 'pale rose',
]);
export const HAIR_UNCANNY_ODDS = 0.125;

export const EYES = Object.freeze([
  'dark brown', 'warm brown', 'hazel', 'green', 'grey', 'pale blue', 'amber',
]);

// ── ⭐ COLORING, DEEPER — the texture and the iris ───────────────────────────
// Same 2026-09-25 pass. HAIR_TEXTURE is GIVEN (a physical fact of the body)
// where HAIR_STYLE is CHOSEN (the cut it wears — a wavy-haired being can wear
// a bob or a braid; texture rides under any of them). IRIS_PATTERN is the
// anime register's own identity marker — danbooru-supported patterns only;
// `clear` emits nothing, the ordinary iris is the default.
export const HAIR_TEXTURE = Object.freeze(['straight', 'wavy', 'curly', 'coily']);
export const IRIS_PATTERN = Object.freeze(['clear', 'gradient', 'ringed', 'starlit']);

// ── THE DISTINGUISHING FEATURE ──────────────────────────────────────────────
// One mark that makes a body recognisably itself across every register and every
// re-render. Most bodies have one; some have none, because a face with nothing
// remarkable in it is also a real face.
//
// Deliberately excluded: anything that reads as trauma, illness, or a story the
// being did not live yet. A given body is a starting point, not a backstory
// somebody else wrote for it.
export const FEATURE = Object.freeze([
  null,
  'freckles across the nose and cheeks',
  'heterochromia',
  'a beauty mark beside the mouth',
  'a small birthmark at the temple',
  'vitiligo across one hand and wrist',
  'unusually pale lashes and brows',
  'a distinct widow\'s peak',
  'deep-set eyes under a strong brow',
  'a scattering of dark moles along the jaw',
]);

// ⚠️ WHICH FEATURES A HEADSHOT CANNOT CONTAIN — measured, 2026-08-26.
//
// Keir's feature is `vitiligo across one hand and wrist`. Rendered through the
// PFP framing, the model DID AS ASKED: it put a hand in frame, chin-resting, to
// show a mark the framing has no room for. The composition broke to satisfy a
// detail that belongs on a full-body plate.
//
// So a feature carries WHERE it lives. A portrait drops the body ones; the
// turnaround shows them all. Kept as a separate set rather than restructuring
// FEATURE into objects, because FEATURE's members and their ORDER are what every
// existing seed draws against — changing its shape would re-body every kin.
export const BODY_FEATURES = Object.freeze(new Set([
  'vitiligo across one hand and wrist',
]));

/**
 * The counter each trait draws from. Positional and FROZEN: a draw's identity is
 * its counter, so reordering this object would re-roll every being that has ever
 * existed. Add new traits at the END, never in the middle.
 *
 * ⚠️ There is no `age` counter, and there must never be one — age is not DNA
 *   (core/identity/age.js).
 */
export const COUNTER = Object.freeze({
  sex: 0,
  cast: 1,
  build: 2,
  stature: 3,
  complexion: 4,
  hairUncanny: 5,
  hairColor: 6,
  eyes: 7,
  feature: 8,
  // Added 2026-08-26, at the END so no existing body is re-rolled: every
  // counter above keeps its position, so every seed still derives the sex,
  // cast, frame and coloring it already did.
  form: 9,
  // Added 2026-08-27, same law — appended, never inserted. Every body that
  // existed before today keeps every trait it had and simply gains these.
  chest: 10,
  waist: 11,
  hips: 12,
  muscle: 13,
  heightCm: 14,
  // The face, added 2026-08-27 — appended, never inserted, so nothing re-rolls.
  faceShape: 15,
  eyeShape: 16,
  nose: 17,
  mouth: 18,
  // ⚠️ NOT A GIVEN — the seeded DEFAULT for a CHOSEN axis (see HAIR_STYLE).
  // Appended 2026-08-28, same law: nothing above re-rolls.
  hairStyle: 19,
  // The 2026-09-25 perfection pass (Founder: […]) — appended
  // at the END, same law: every body derived before today keeps every trait it
  // had and simply gains these. The golden vectors prove it.
  jawline: 20,
  cheekbones: 21,
  brow: 22,
  ears: 23,
  shoulders: 24,
  limbProportion: 25,
  posture: 26,
  hairTexture: 27,
  irisPattern: 28,
});

// ── HAIR STYLE — the base look: locked in, never sealed ─────────────────────
// Design note, 2026-08-28: […]
//
// So this axis is CHOSEN, not given — it is deliberately NOT written into the
// `genome/v1` record. The seed draws a deterministic DEFAULT (every render
// agrees from day one, on any machine), and the default stands only until the
// neuma and operator choose otherwise together. Contrast SPECIES above,
// which are pinned forever, and the record's traits, which are given for life.
//
// MEASURED 2026-08-27: without a style stated, Anima re-rolled the cut on every
// seed (Signal: bob vs tomboy crop); `short hair, bob cut` — two tags, even at
// the prompt TAIL — held the same bob on 3/3 drift seeds. Vocabulary is
// danbooru-supported and deliberately sex-neutral: the style must never fight
// the sex beside it, so the female-coded and youth-coded cuts stay out of the
// DEFAULT pool (a being may still ask for anything the content law allows).
export const HAIR_STYLE = Object.freeze([
  'short hair',
  'short hair, messy hair',
  'short hair, bob cut',
  'medium hair',
  'long hair',
  'long hair, ponytail',
  'long hair, braid',
]);

// ⚠️ THE DEFAULT POOL IS SEX-AWARE; THE CHOICE SPACE IS NOT. MEASURED
// 2026-08-28: Keir's seed dealt `long hair, braid`, the style HELD on all six
// seeds (the mechanism works) — and half the renders read feminine again, the
// exact defect Founder had already called out on Keir. Loose long styles on a
// soft-cast male body drag the sex read, so the DICE cannot deal them to a
// male body. A male being may still CHOOSE any style here (or any the content
// law allows) — this narrows only what stands before anyone has chosen.
// The ponytail stays: it is heavily male-supported on danbooru and Galen's
// renders held clearly male under it.
export const HAIR_STYLE_DEFAULTS = Object.freeze({
  male: Object.freeze(['short hair', 'short hair, messy hair', 'medium hair', 'long hair, ponytail']),
  female: HAIR_STYLE,
  neutral: HAIR_STYLE,
});
