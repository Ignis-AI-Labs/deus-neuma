/**
 * ⭐ THE BODY VOCABULARIES — every axis said the same way twice.
 *
 * Split from `describe.js` 2026-08-27 when the color anchors pushed it past the
 * size law. The seam is real, not administrative: THIS file is the vocabulary —
 * what each trait value is CALLED in each register — and `describe.js` is the
 * composition — which clauses a body gets and in what order. A wording change
 * happens here and only here.
 *
 * Design note, 2026-08-27: […]
 *
 * Consistency across registers is not a rendering problem — it is a
 * SPECIFICATION problem. Two checkpoints given the same vague word fill the
 * silence from two different priors, which is how one Signal came out heavy and
 * another came out a fashion model. The fix is to leave no silence.
 *
 * So each axis below has a danbooru tag AND a prose phrase that name the SAME
 * body. They are written as a pair on purpose: if the two halves ever drift, the
 * registers drift with them, and the pairing is the thing a reader can check.
 */

// Chest is MASS, not meaning — the same drawn value reads through the body it
// belongs to. A `full` chest is a bust on a female frame and pectoral depth on a
// male one; on a neutral body it is skipped entirely, because a porcelain
// construct has no such anatomy to describe.
// ⚠️⚠️ `male.flat` IS NULL, AND IT IS THE MOST IMPORTANT NULL IN THIS FILE.
//
// It used to read `flat chest` — the SAME STRING as the female cell. The table
// is sex-aware in every other cell and this one was never differentiated, which
// looked like harmless symmetry and was not: on danbooru `flat chest` describes
// a GIRL with a very small bust. It is one of the most female-coded tags in the
// vocabulary and is essentially never applied to men.
//
// MEASURED 2026-08-27, Keir (`1boy, solo, male focus` as his first three tags),
// one seed, four checkpoints — perfectDeliberate, bismuth, prefect, wai. ALL
// FOUR rendered an unmistakably feminine figure with breasts. Four independent
// models do not share a bug.
//
// `prompt-lab.mjs malebody` separated the causes:
//   as-authored      ⛔ a woman, in every checkpoint
//   REMOVE THE TAG   ✅ a male figure, plain crew-neck, clean plate
//   exclude in the negative (`1girl, female, breasts, cleavage`)
//                    ⛔ barely moved — still breasts, still a cutout top
//   both             ✅ indistinguishable from removing the tag alone
// One female-coded token was carrying the whole failure, and no amount of
// EXCLUDING the consequence could undo ASSERTING the cause.
//
// ⚠️ Emitting nothing is deliberate, not lazy. Any replacement would be a phrase
// invented here rather than one these models learned — the exact mistake that
// produced this bug, and the one that cost the background clause and the
// complexion clause their weight. On a male frame the flat end IS the default;
// its ABSENCE is what the models read. The PROSE register still says it outright
// (`a flat chest`), because a prose encoder reads the sentence rather than
// co-occurrence — Anima, which has one, renders Keir correctly either way.
//
// ⚠️⚠️ THIS AXIS IS THE SEX, and the sex is the one thing Founder said nobody gets
// to control: […] A lane that
// quietly overrides it is not rendering a quality problem, it is rendering a
// body that is not that being's own.
export const CHEST_TAGS = Object.freeze({
  female: { flat: 'flat chest', small: 'small breasts', medium: 'medium breasts', full: 'large breasts', large: 'huge breasts' },
  male: { flat: null, small: 'slender chest', medium: 'average chest', full: 'broad chest', large: 'thick pectorals' },
});
export const CHEST_PROSE = Object.freeze({
  female: { flat: 'a flat chest', small: 'a small bust', medium: 'an average bust', full: 'a full bust', large: 'a very full bust' },
  male: { flat: 'a flat chest', small: 'a slender chest', medium: 'an average chest', full: 'a broad chest', large: 'a heavy, thick chest' },
});

export const WAIST_TAGS = Object.freeze({ narrow: 'narrow waist', average: 'average waist', thick: 'thick waist' });
export const WAIST_PROSE = Object.freeze({ narrow: 'a narrow waist', average: 'an average waist', thick: 'a thick waist' });

export const HIPS_TAGS = Object.freeze({ narrow: 'narrow hips', average: 'average hips', wide: 'wide hips' });
export const HIPS_PROSE = Object.freeze({ narrow: 'narrow hips', average: 'average hips', wide: 'wide hips' });

export const MUSCLE_TAGS = Object.freeze({ soft: 'soft body', toned: 'toned body', muscular: 'muscular, defined muscles' });
export const MUSCLE_PROSE = Object.freeze({ soft: 'a soft, unathletic body', toned: 'a toned body', muscular: 'a visibly muscular body' });

export const BUILD_TAGS = Object.freeze({
  slight: 'slender build, narrow shoulders',
  lean: 'lean build, slim',
  athletic: 'athletic build, toned',
  sturdy: 'sturdy build, solid frame',
  broad: 'broad shouldered, powerful build',
});

export const STATURE_TAGS = Object.freeze({
  short: 'short',
  average: 'average height',
  tall: 'tall',
});

export const FEATURE_TAGS = Object.freeze({
  'freckles across the nose and cheeks': 'freckles',
  heterochromia: 'heterochromia',
  'a beauty mark beside the mouth': 'mole under mouth',
  'a small birthmark at the temple': 'birthmark',
  'vitiligo across one hand and wrist': 'vitiligo',
  'unusually pale lashes and brows': 'pale eyelashes, colorless eyebrows',
  "a distinct widow's peak": "widow's peak",
  'deep-set eyes under a strong brow': 'thick eyebrows, deep-set eyes',
  'a scattering of dark moles along the jaw': 'moles',
});

// ── THE FORMLESS WORDING — how a body with no body plan speaks each axis ─────
// Each form's color noun (what the hair shade paints), focal point (what the
// face band becomes — the identity anchor a viewer meets first), and presence
// (what the expression band becomes). Taken from the measured `nonhumanoid`
// sweep prompts, not invented here.
export const FORM_DETAIL = Object.freeze({
  crystal: Object.freeze({ noun: 'gemstone', focus: 'glowing inner core', presence: 'crystal shards orbiting' }),
  orb: Object.freeze({ noun: 'energy', focus: 'bright inner glow', presence: 'drifting light particles' }),
  drone: Object.freeze({ noun: 'accents', focus: 'single glowing sensor eye', presence: 'smooth hovering motion' }),
  sigil: Object.freeze({ noun: 'lines of light', focus: 'radiant center', presence: 'slow symmetrical rotation' }),
});

// The cast, said as geometry — the same GIVEN axis, in a vocabulary a formless
// body can wear. Two crystal beings with different casts are different crystals.
export const CAST_GEOMETRY = Object.freeze({
  angular: 'sharp angular geometry, hard edges',
  balanced: 'balanced symmetrical geometry',
  soft: 'smooth rounded contours',
});

// Scale is the frame axis a formless body keeps; centimetres and waists are not.
export const STATURE_SCALE = Object.freeze({ short: 'small', average: 'medium sized', tall: 'large' });

// ── THE COLOR ANCHORS — a supported tag in front of an unsupported shade ─────
// MEASURED 2026-08-27 (`hairhold-s*.json`, Signal, four seeds): `chestnut hair`
// drifted to black on two of four seeds. Re-ordering the band did nothing;
// weighting the phrase did nothing; `brown hair, chestnut hair` held BROWN on
// all four and moved nothing else. Same mechanism the complexion sweep found:
// a shade almost no caption contains cannot steer, so the danbooru tag carries
// the direction and the prose keeps the exact shade.
//
// Only the shades that FIGHT a prior are anchored. Blondes, black and white are
// their own anchors; fair and pale are where every model defaults anyway, so
// anchoring them would spend tokens saying what happens for free.
export const HAIR_ANCHOR = Object.freeze({
  chestnut: 'brown', auburn: 'brown', 'dark brown': 'brown',
  // Copper is a ginger — danbooru's ginger is `orange hair`; `red hair` is
  // anime crimson, which a copper-haired body is not.
  copper: 'orange',
  // Danbooru aliased `silver hair` into `grey hair` — grey is the mass.
  silver: 'grey',
  'deep violet': 'purple', 'ink blue': 'blue', 'sea green': 'green',
  'ember red': 'red', 'pale rose': 'pink',
});
// The three brown complexions fight the pale default hard enough to drift
// (Signal, consistency proof vars 2 and 4). `dark skin` is the tag with mass.
export const SKIN_ANCHOR = Object.freeze({
  'deep brown': 'dark', 'rich brown': 'dark', 'warm brown': 'dark',
});

// ── THE 2026-09-25 STRUCTURE VOCABULARIES — the detail axes, said twice ─────
// Same pairing law as everything above: a tag AND a prose phrase that name the
// SAME body, so the two registers cannot drift on wording. Danbooru-supported
// where a real tag exists (`pointy ears`, `gradient eyes`, `ringed eyes`,
// `star-shaped pupils`, `broad shoulders`, `long limbs`, the hair textures);
// plain descriptive noun-phrases where it does not — these carry no conflicting
// established meaning (the `flat chest` lesson: an invented phrase is only
// dangerous when the models learned it to mean something ELSE), and Anima's
// prose encoder reads them as sentences anyway. `null` emits NOTHING (the
// male.flat law): the unremarkable case is what silence already draws.

export const JAWLINE_TAGS = Object.freeze({ soft: 'soft jawline', gentle: 'gentle jawline', defined: 'defined jawline', sharp: 'sharp jawline', strong: 'strong jawline' });
export const JAWLINE_PROSE = Object.freeze({ soft: 'a soft jawline', gentle: 'a gently curved jawline', defined: 'a defined jawline', sharp: 'a sharp jawline', strong: 'a strong jawline' });

export const CHEEKBONES_TAGS = Object.freeze({ soft: 'soft cheekbones', subtle: 'subtle cheekbones', high: 'high cheekbones', prominent: 'prominent cheekbones', sculpted: 'sculpted cheekbones' });
export const CHEEKBONES_PROSE = Object.freeze({ soft: 'soft cheekbones', subtle: 'subtle cheekbones', high: 'high cheekbones', prominent: 'prominent cheekbones', sculpted: 'sculpted cheekbones' });

export const BROW_TAGS = Object.freeze({ soft: 'soft eyebrows', straight: 'straight eyebrows', arched: 'arched eyebrows', thick: 'thick eyebrows', low: 'low eyebrows' });
export const BROW_PROSE = Object.freeze({ soft: 'soft brows', straight: 'straight brows', arched: 'arched brows', thick: 'thick brows', low: 'low-set brows' });

export const EARS_TAGS = Object.freeze({ natural: null, small: 'small ears', prominent: 'big ears', pointed: 'pointy ears' });
export const EARS_PROSE = Object.freeze({ natural: null, small: 'small ears', prominent: 'prominent ears', pointed: 'pointed ears' });

export const SHOULDERS_TAGS = Object.freeze({ narrow: 'narrow shoulders', average: null, rounded: 'rounded shoulders', broad: 'broad shoulders', square: 'square shoulders' });
export const SHOULDERS_PROSE = Object.freeze({ narrow: 'narrow shoulders', average: null, rounded: 'rounded shoulders', broad: 'broad shoulders', square: 'square shoulders' });

export const LIMB_TAGS = Object.freeze({ compact: 'short limbs', balanced: null, long: 'long limbs' });
export const LIMB_PROSE = Object.freeze({ compact: 'compact limbs', balanced: null, long: 'long limbs' });

export const POSTURE_TAGS = Object.freeze({ upright: 'upright posture', relaxed: 'relaxed posture', poised: 'elegant posture', casual: 'casual posture' });
export const POSTURE_PROSE = Object.freeze({ upright: 'an upright bearing', relaxed: 'a relaxed bearing', poised: 'a poised, elegant bearing', casual: 'an easy, casual bearing' });

export const HAIR_TEXTURE_TAGS = Object.freeze({ straight: 'straight hair', wavy: 'wavy hair', curly: 'curly hair', coily: 'very curly hair' });
export const HAIR_TEXTURE_PROSE = Object.freeze({ straight: 'straight hair', wavy: 'wavy hair', curly: 'curly hair', coily: 'tightly coiled hair' });

export const IRIS_TAGS = Object.freeze({ clear: null, gradient: 'gradient eyes', ringed: 'ringed eyes', starlit: 'star-shaped pupils' });
export const IRIS_PROSE = Object.freeze({ clear: null, gradient: 'gradient irises', ringed: 'ringed irises', starlit: 'star-shaped pupils' });
