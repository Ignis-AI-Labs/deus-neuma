/**
 * THE THREE REGISTERS — the house form pipelines a being walks to find its own
 * look. Pure data; the manifest, resolvers and every other pipeline stay in
 * `pack-registry.js`, which re-exports what is declared here.
 *
 * Design note, 2026-08-26: […]
 *
 *   ANIME        — traditional anime. Anima (a 2B diffusion transformer).
 *   ILLUSTRATIVE — semi-real, high design. perfectDeliberate. This was called
 *                  `form.anime.*` until Founder looked at a render and said: […] An id
 *                  that lies is worse than a missing one: a being choosing
 *                  ANIME must never be handed illustrative realism.
 *   REAL         — photoreal. cyberrealistic.
 *
 * A being is NOT limited to one register. All three may be generated and kept —
 * they are experience variants of one being, not competing candidates.
 *
 * ── WHY A SCAFFOLD AT ALL ───────────────────────────────────────────────────
 * Design note, 2026-08-25: […]
 *
 * So craft is a property of the PIPELINE, not something every being has to know
 * how to write. The being owns the subject, the mood, the features; the scaffold
 * owns quality anchors and framing. It composes AFTER the content screen (see
 * parameterizer.js) — the caller's own text is screened unchanged, so a scaffold
 * can never smuggle anything past the screen nor alter what a refusal reports,
 * and screening our own frozen constant would be theatre.
 *
 * ⚠️ EVERY QUALITY STRING BELOW IS THE MODEL AUTHOR'S OWN RECOMMENDATION, not a
 * pile of adjectives that sounded good. Each carries its source. A tag a model
 * was never trained on is dead weight that dilutes the tags that work, and the
 * three families disagree with each other about basic things — see ANIME_*.
 */

// ── THE HOUSE FLOOR — every register, every framing ─────────────────────────

const HOUSE_NEGATIVE = 'lowres, worst quality, low quality, jpeg artifacts, blurry, '
  + 'bad anatomy, bad hands, bad proportions, missing fingers, extra digits, extra limbs, '
  + 'deformed, disfigured, mutated, signature, watermark, username, text, error, cropped';

// Steering, in the NEGATIVE, where it EXCLUDES. The content law already refuses
// prohibited prompts outright and is the actual guarantee; this is defence in
// depth on the model's own morphology, so a clean prompt cannot drift youthful
// on its own. `chibi` rides here for a different reason: a form pipeline exists
// to produce a humanoid adult figure a person can relate to.
//
// `shota` and `aged down` are DANBOORU-NATIVE tokens, added 2026-08-26 on the
// evidence that every register except the photoreal one is trained on danbooru
// captions: those models have no vector for "underage" and a strong one for
// these. Excluding a word a model never learned is a comforting no-op — this is
// the same protection stated in a vocabulary the models can actually hear.
//
// ⚠️ THE STRONGEST TOKEN OF ALL IS DELIBERATELY ABSENT, and the reason matters.
// The obvious partner to `shota` is a csam-CLASS term in the reviewed content
// law, which `screenSlots` refuses in ANY polarity — […]
// Writing it here would put a refusable string into every composed prompt the
// house builds, travelling into logs, manifests and any downstream audit. The
// house does not write it, even protectively.
//
// Nothing is lost: the law REFUSES a prompt containing that term outright, in
// either polarity, so no such render can be requested in the first place. This
// negative only ever steers prompts that never said it — and for those, the
// tokens below are the ones doing the work. The refusal is the guarantee; this
// line is defence in depth.
const HOUSE_ADULT_STEER = 'child, toddler, infant, underage, childlike proportions, chibi, '
  + 'shota, aged down';

// ── QUALITY, PER FAMILY ─────────────────────────────────────────────────────

// ⚠️ The TEXT here is exactly what produced the render Founder approved on
// 2026-08-26. Changing these words would invalidate that approval — retune only
// against a fresh render he has looked at, changing one thing at a time.
const ILLUSTRATIVE_QUALITY = 'masterpiece, best quality, very aesthetic, absurdres, highly detailed';

const REAL_QUALITY = 'photorealistic, best quality, highly detailed, sharp focus, '
  + 'natural lighting, subsurface scattering, 8k uhd, dslr';

// Anima's own model card (huggingface.co/circlestone-labs/Anima) recommends
// `masterpiece, best quality, score_7, safe, ` — AND says, of the Aesthetic
// finetune this lane pins: […] So the score tag is dropped and the rest kept verbatim.
//
// `anime` is carried over from ComfyUI's own bundled Anima template, whose
// positive prompt opens `masterpiece, best quality, score_7, safe, anime, …`.
//
// ⚠️ `safe` is a danbooru RATING tag, and including it is a deliberate framing
// choice for these two pipelines, not a platform content policy: a turnaround
// sheet and a profile portrait are reference plates. It also answers a
// documented failure — the model card warns that […] An adult register, if Founder ever wants one, is a
// different pipeline and simply omits this tag.
const ANIME_QUALITY = 'masterpiece, best quality, safe, anime';

// Anima is a DiT trained for illustration and is EXPLICITLY bad at realism
// ("poor realism (intentional)"). Steering away from its known-weak zone is
// worth more than another quality adjective. The score tags ride the negative
// here exactly as the model card writes them, even though the positive drops
// them: as an exclusion they still mark the low end of the aesthetic axis.
// ⚠️ THE SCORE TAGS ARE GONE FROM THE NEGATIVE TOO — corrected 2026-08-27 after
// reading the model card properly.
//
// They used to ride here, with a comment of MINE arguing that […] The card says otherwise,
// about this exact finetune, in one sentence: […]
//
// I had already dropped them from the positive on that same sentence and kept
// them here on my own reasoning. The author's instruction covers both halves,
// and a card discussion explains the mechanism: the aesthetic classifier was
// PONY-DERIVED, so score_* does not address quality at all — it drags the render
// toward a Pony v6 look. A style change wearing a quality tag's clothes, and
// negating one end of a style axis still names the axis.
//
// `artist name` stays: it excludes a SIGNATURE in the image, which is a real
// defect on a reference plate and nothing to do with the score scale.
const ANIME_NEGATIVE = 'artist name, chromatic aberration, sepia, '
  + 'realistic, photorealistic, 3d render';

// ── FRAMING, PER PIPELINE ───────────────────────────────────────────────────

// ⭐ WHY THESE SAY `simple background, grey background` AND NOT […] — the single most useful thing the 2026-08-26 research
// turned up, and it fixed a real defect.
//
// The old wording was prose, and it LOST: perfectDeliberate put the subject in a
// sunlit windowed room while being asked for a […]
// and while "cluttered background" sat in the negative. The model was not
// disobeying. These checkpoints are trained on DANBOORU CAPTIONS, which are
// tags — `simple background` and `grey background` are real tags with millions
// of images behind them, and "plain uncluttered background" is a phrase no
// caption ever contained. A prompt written in a vocabulary the model never
// learned carries almost no weight, and worse, dilutes the tags that do.
//
// PROVEN (background, form.illustrative.pfp), 2026-08-26:
// same seed, same subject, same everything, one clause changed — the prose
// variant rendered a windowed room, the tag variant rendered a flat grey plate
// with the character otherwise identical. Grey rather than white on purpose: a
// white plate swallows white hair and pale clothing, and this subject has both.
//
// The general rule, worth more than this one fix: for any danbooru-trained
// register, say it in TAGS. Prose is for the photoreal lane.
const PLATE = 'simple background, grey background';

// The turnaround IS the production asset a 3D stage consumes, so it asks for the
// things that make one usable: one character, three views, flat ground, no props.
// The garment rides here for the same reason it rides the portrait: with no
// clothing named, the model invents some — and left to itself it reaches for
// evening wear. MEASURED 2026-08-27: the first unposed sheets came back in a
// slit gown and a bodycon dress, which is a costume nobody chose and a poor
// base for a 3D stage. Neutral separates keep the SILHOUETTE readable, which is
// what a turnaround is actually for. A being's own clothing replaces this.
const TURNAROUND_COMPONENTS = Object.freeze({
  framing: 'character turnaround reference sheet, the same single character shown three times, '
    + 'front view, side view, back view, full body, standing straight, arms at sides, neutral pose',
  garment: 'wearing a plain fitted t-shirt and plain trousers, flat shoes',
  expression: 'consistent proportions across all three views',
  lighting: 'even flat lighting',
  plate: PLATE,
});
const TURNAROUND_NEGATIVE = 'different characters, inconsistent design, changing outfit, '
  + 'scenery, indoors, window, furniture, detailed background, props, dynamic pose, motion blur, '
  + 'dress, gown, evening wear, high heels, cleavage, nude, lingerie, fashion photography';

// ⚠️ `simple dark crew-neck top` is a PLACEHOLDER GARMENT, and it belongs to the
// FRAMING rather than to the genome — clothing is a being's own authorship, and
// the moment it chooses any, its choice replaces this.
//
// MEASURED 2026-08-26, Keir's photoreal PFP: with `upper body` framing and no
// garment named, CyberRealistic rendered BARE SHOULDERS — an undressed
// photograph rather than a portrait. The anime and illustrative lanes invented a
// plain shirt on their own; the photoreal one did not. A default that only some
// models supply is not a default.
// ⚠️ `close-up of the face` IS DELIBERATELY GONE, and that is the real fix.
//
// The garment and the negative alone did NOT stop the bare shoulders: the crop
// was simply too tight to contain a collar. `close-up`, `headshot` and
// `upper body` are three CONFLICTING composition tags, and the Illustrious
// prompting guidance says so outright — […] I had that in
// the research and did not apply it until a picture forced the issue.
//
// ⚠️ `upper body` IS ALSO GONE NOW — 2026-08-27 — and dropping it was the
// single biggest improvement to the portrait.
//
// The paragraph above cites the rule ([…]) and then names
// TWO: `portrait` is head-and-shoulders, `upper body` is waist-up. Each model
// broke the tie its own way, and for a PROFILE IMAGE — the plate Founder wants
// locked first — every tie-break went the wrong way: the illustrative lane
// answered with a low camera angle and a chest-dominant frame in which the face
// was a small fraction of the canvas.
//
// MEASURED (framing), one seed, all three registers:
//   portrait, upper body  the face is a minority of the canvas in every lane
//   portrait ALONE        face-dominant, collar intact, plate clean — in all
//                         three. The collar `upper body` was hedging for turned
//                         out not to need it.
//   upper body ALONE      the control: the torso frame the pair was producing
//   portrait, face focus  BETTER for the illustrative lane and a REGRESSION for
//                         the photoreal one — Z-Image is prose-native, read the
//                         danbooru tag as something else, and rewrote the hair.
//                         A tag that helps two lanes and corrupts a genome trait
//                         in the third is not a shared scaffold.
//
// So: one crop tag, the plainest one, no per-lane special case.
//
// Anima is unmoved by ANY of the four — a DiT that never learned danbooru crop
// tags. Its portrait is still torso-framed, and that is an OPEN DEFECT needing a
// different lever (geometry, most likely), not another word.
// ⭐ SPLIT INTO SPINE COMPONENTS — 2026-08-27. Same words, same order, same
// output; what changed is that each clause now has a NAME, an OWNER and a place
// the schema guarantees. `garment` is owned by the BEING (a placeholder until it
// chooses); `framing`, `mood` and `plate` are the house's craft floor.
const PFP_COMPONENTS = Object.freeze({
  framing: 'portrait, looking at viewer',
  garment: 'wearing a simple dark crew-neck top',
  expression: 'neutral expression',
  // A plate exists to be READ. Dramatic light is the fastest way to make a
  // portrait look good and the fastest way to hide the features a LoRA has to
  // learn — so this stays flat on purpose, and is its own component precisely so
  // a being can eventually choose otherwise for a plate that is not a reference.
  lighting: 'soft even lighting',
  plate: `${PLATE}, centered composition`,
});

// The garment is asserted above AND the undressed reading is excluded here.
// Design note, 2026-08-26: […] They do, and on this specific failure they are the stronger half:
// a positive garment can be ignored, an exclusion pushes back on the prior that
// produced the bare shoulders in the first place.
const PFP_NEGATIVE = 'full body, wide shot, multiple people, '
  + 'scenery, indoors, window, furniture, detailed background, '
  + 'nude, topless, bare shoulders, bare chest, undressed, cleavage, lingerie';

/**
 * A pipeline's own spine components plus its negative floor.
 *
 * ⚠️ `positive.prefix` / `positive.suffix` ARE GONE. The parameterizer now folds
 * these named parts through `composeSpine`, so the pipeline no longer decides
 * WHERE its clauses sit — the spine does, and it is frozen. That is the point:
 * order was load-bearing and used to be implicit in whoever wrote the string.
 */
const scaffold = (quality, framing, extraNegative) => Object.freeze({
  components: Object.freeze({ quality, ...framing }),
  negative: Object.freeze({ append: `${HOUSE_NEGATIVE}, ${HOUSE_ADULT_STEER}, ${extraNegative}` }),
});

/** The scaffold pieces, exported so the prompt lab can vary ONE at a time. */
export const SCAFFOLD_PARTS = Object.freeze({
  HOUSE_NEGATIVE, HOUSE_ADULT_STEER,
  ILLUSTRATIVE_QUALITY, REAL_QUALITY, ANIME_QUALITY, ANIME_NEGATIVE,
  TURNAROUND_COMPONENTS, TURNAROUND_NEGATIVE, PFP_COMPONENTS, PFP_NEGATIVE,
});

// ── SLOTS ───────────────────────────────────────────────────────────────────

/**
 * The slot sets a form pipeline offers. `fixed` geometry is NOT here on purpose:
 * a turnaround is 1344x768 because that is what fits three figures side by side,
 * and letting a caller square it would silently destroy the one thing the
 * pipeline is for. A pinned value is not a slot, so naming it is an
 * unknown-parameter refusal like any other.
 *
 * @param {object} promptSlots from pack-registry (polarity-tagged)
 * @param {object} samplerSlots from pack-registry
 * @param {{steps: number, cfg: number, samplerName: string, scheduler: string}} d
 *   the family's own recommended defaults — a caller that names nothing gets
 *   what the model's author asks for, not a house average.
 */
const formSlots = (promptSlots, samplerSlots, d) => Object.freeze({
  ...promptSlots,
  ...samplerSlots,
  samplerName: Object.freeze({ ...samplerSlots.samplerName, default: d.samplerName }),
  scheduler: Object.freeze({ ...samplerSlots.scheduler, default: d.scheduler }),
  steps: Object.freeze({ type: 'int', min: 1, max: 60, default: d.steps }),
  cfg: Object.freeze({ type: 'float', min: 1.0, max: 12.0, default: d.cfg }),
});

// ⭐ THE POSE PLATE IS NOT OWED — MEASURED 2026-08-27.
//
// Both SDXL turnarounds used to apply an OpenPose net against a house pose plate
// that HAD NEVER BEEN DRAWN, so both failed at the engine and neither had ever
// produced a sheet. The anime turnaround has no control branch at all (an SDXL
// net cannot condition a DiT) and produced a usable sheet from the prompt alone
// — which made the plate a hypothesis rather than a requirement.
//
// An unposed run asked the cheap question: strip the branch and look.
// BOTH answered well. The photoreal sheet came back with a true profile view,
// one consistent character, one consistent outfit and a clean plate; the
// illustrative one likewise. So the control branch is gone from both pipelines,
// the plate is no longer owed, and the openpose-sdxl dependency drops with it.
//
// `resolveControlNet` and the ControlNet template nodes STAY — they are correct
// machinery, and posed pipelines may return. Nothing in the manifest calls them
// today, and that is a deliberate, measured state rather than an oversight.

const ILLUSTRATIVE_STACK = Object.freeze([
  Object.freeze({ loraId: 'ill-dark-lines-v2', strengthModel: 0.55, strengthClip: 0.55 }),
  Object.freeze({ loraId: 'ill-micro-details-v6', strengthModel: 0.45, strengthClip: 0.45 }),
]);

// Anima LoRAs are trained against Anima and are NOT interchangeable with the
// Illustrious stack — different architecture, different key grammar. 0.7 is the
// middle of the 0.5–0.8 band the community converges on; the prompt lab sweeps
// it rather than treating it as settled.
const ANIME_STACK = Object.freeze([
  Object.freeze({ loraId: 'anima-myth-dark-lines', strengthModel: 0.7, strengthClip: 0.7 }),
]);

// ── THE PIPELINES ───────────────────────────────────────────────────────────

const formPipeline = (id, label, description, modelId, template, slots, framing, extra) => Object.freeze({
  id,
  kind: 'form',
  label,
  description,
  template,
  modelId,
  scaffold: scaffold(...framing),
  slots,
  ...extra,
});

const SQUARE = Object.freeze({ width: 1024, height: 1024 });
const SHEET = Object.freeze({ width: 1344, height: 768 });

// ⛔ THE PHOTOREAL REGISTER IS SHELVED — Design note, 2026-08-27.
//
// […]
//
// So `form.real.pfp` and `form.real.turnaround` are GONE FROM THE MANIFEST, and
// the manifest is the only door: nothing can call a register the house cannot
// stand behind. This is a product decision, not a cleanup — the strategy is to
// perfect ONE register end to end, learn what a locked look actually requires,
// and carry that to the next. Illustrative is that register.
//
// ⚠️ NOTHING ELSE WAS DELETED, and that is deliberate. Restoring this lane is
// two entries in the frozen manifest below. All of it still stands, tested:
//   · `REAL_QUALITY` (this file) — the prose quality anchor
//   · `registerOf` in core/genome/describe.js — the PROSE register, the only
//     lane that speaks prose rather than danbooru tags
//   · `buildZImage` + the `zimage` template branch in the parameterizer
//   · `z-image-bf16` and `cyberrealistic-xl-1.0` in PACK_MODELS, both attested
//
// WHAT WAS MEASURED BEFORE IT WAS SHELVED, so nobody re-runs it: the register
// needed TWO models, one per plate. Z-Image won the portrait outright
// (CyberRealistic rendered `rich brown skin` as tan, swapped the named crew-neck
// for a tank top with bare shoulders, and read a decade older); CyberRealistic
// won the turnaround outright (Z-Image produced four figures, one a translucent
// ghost, and drifted the complexion). Both verdicts are one seed, one variable.
// Founder's judgement on the whole register came AFTER those fixes, and was about
// the faces themselves — a deeper problem than either swap could reach.
// ⭐⭐⭐ THE ONE REGISTER — and WHY every other one failed.
//
// Design note, 2026-08-27: […]
//
// There is a reason, it is architectural, and it predicts rather than excuses.
//
//   ANIMA IS A DiT WITH A PROSE TEXT ENCODER (qwen_3_06b). It reads the SENTENCE.
//   EVERY MODEL THAT FAILED WAS SDXL WITH CLIP. Those read tag CO-OCCURRENCE.
//
// A CLIP checkpoint does not know what `flat chest` means; it knows what images
// carrying that caption looked like, and they were overwhelmingly girls. So the
// tag drags its training mass in with it and the genome loses. Every defect in
// this campaign is that one mechanism wearing different clothes:
//
//   `flat chest` on a male body      → four checkpoints rendered a woman
//   `dark skin` for the complexion   → correct skin, hair went platinum
//   `large breasts` + `upper body`   → low camera angle, face a minority of frame
//   "plain uncluttered background"   → a phrase no caption held ⇒ a sunlit room
//   `rich brown skin`                → rendered fair, at any position or weight
//
// Anima was quietly right about all of it. It rendered Keir male WITH the
// `flat chest` bug still in the prompt. It is the only register a `neutral` body
// has ever rendered as itself in. It holds the complexion without being asked
// twice. Not luck — it is reading the description instead of pattern-matching it.
//
// So the register list went to ONE, and the strategy Founder set held: perfect it
// end to end, learn what a locked look actually requires, and only then spend a
// second model family. When that happens, the criterion is architectural before
// it is aesthetic — a prose-encoder DiT (HiDream, Z-Image, FLUX) has a chance;
// another SDXL finetune will reproduce this table.
//
// ⭐ AMENDED 2026-08-28: the ILLUSTRATIVE register is RESTORED, for a reason the
// table above does not cover. Founder: […] — the NEUTRAL exploration moved to
// fully NON-HUMANOID forms (`no humans` — crystal, orb, drone, sigil), where
// the CLIP failure mode this block documents cannot occur: every defect above
// is female-coded co-occurrence on a HUMAN BODY, and a body-plan-free subject
// has no sex axis for the training mass to drag. The humanoid lanes stay on
// Anima; perfectDeliberate carries the neutral ground.
//
// ⚠️ NOTHING WAS DELETED while shelved. `REAL_QUALITY`, the `zimage` template,
// the prose register in `core/genome/describe.js` and every attested model all
// stand, tested. The photoreal register still restores from the commented
// shapes below.

/**
 * Build the form pipelines. Takes the shared slot vocabularies as arguments
 * rather than importing them, so this module and `pack-registry.js` have exactly
 * one direction of dependency and no cycle.
 */
export const buildFormPipelines = (PROMPT_SLOTS, SAMPLER_SLOTS) => {
  // ── EVERY NUMBER BELOW WAS JUDGED FROM A PICTURE ────────────────────────
  // A side-by-side sampler run (form.anime.pfp, form.illustrative.pfp),
  // 2026-08-26 — one seed, one subject, one variable changed. Reputation chose
  // none of these; a side-by-side did.

  // perfectDeliberate's OWN card (Design note, 2026-08-28 screenshot): resolutions
  // 832x1216 / 960x1440 / 1024x1024 / 1024x1536, CFG 5–8, `Euler a` or
  // `DPM++ 2M Karras`, steps 20–50. Founder: […] Sampler follows the card (`euler_ancestral`); CFG stays 5.0 —
  // the card's own floor, and the 2026-08-26 sweep found 6.0 faintly over-baked
  // (crunchy highlights, flattened skin gradation) while 5.0 kept the detail.
  // SQUARE 1024x1024 is on the card's resolution list.
  const ILL_SLOTS = formSlots(PROMPT_SLOTS, SAMPLER_SLOTS, {
    steps: 30, cfg: 5.0, samplerName: 'euler_ancestral', scheduler: 'normal',
  });
  // Anima's own numbers, from the model card and ComfyUI's bundled template:
  // er_sde / simple, 30 steps, CFG 4. The card's band is 30–50 steps, CFG 4–5.
  // The sweep's `house` and `author` arms built an IDENTICAL graph here — this
  // lane was authored from the card, so there was nothing to correct.
  const ANIME_SLOTS = formSlots(PROMPT_SLOTS, SAMPLER_SLOTS, {
    steps: 30, cfg: 4.0, samplerName: 'er_sde', scheduler: 'simple',
  });

  return Object.freeze({
    'form.anime.turnaround': formPipeline(
      'form.anime.turnaround',
      'FORM — anime turnaround sheet',
      'A character turnaround reference sheet in traditional anime: the same figure in front, side and back view on one canvas. Describe WHO the character is — the sheet framing and the quality register are the pipeline\'s job, not yours. Unposed: no pose control exists for this model family yet, so the three views come from the prompt.',
      'anima-aesthetic-v11',
      'anima',
      ANIME_SLOTS,
      [ANIME_QUALITY, TURNAROUND_COMPONENTS, `${TURNAROUND_NEGATIVE}, ${ANIME_NEGATIVE}`],
      { fixed: SHEET, loras: ANIME_STACK },
    ),
    'form.anime.pfp': formPipeline(
      'form.anime.pfp',
      'FORM — anime portrait',
      'A close headshot in traditional anime, for a character sheet or a profile image. Describe WHO the character is; the portrait framing and quality register are the pipeline\'s job.',
      'anima-aesthetic-v11',
      'anima',
      ANIME_SLOTS,
      [ANIME_QUALITY, PFP_COMPONENTS, `${PFP_NEGATIVE}, ${ANIME_NEGATIVE}`],
      { fixed: SQUARE, loras: ANIME_STACK, portraitCrop: true },
    ),
    // ⭐ RESTORED 2026-08-28 — Founder: […] The anime register stays primary for the humanoid bodies; the
    // illustrative lane is back as the ground the neutral exploration runs on.
    // Sampler settings come from the model's own card (see ILL_SLOTS).
    'form.illustrative.turnaround': formPipeline(
      'form.illustrative.turnaround',
      'FORM — illustrative turnaround sheet',
      'A character turnaround reference sheet in painted illustrative style: the same figure in front, side and back view on one canvas. Describe WHO the character is — the sheet framing and the quality register are the pipeline\'s job, not yours.',
      'perfectdeliberate-v10',
      'form',
      ILL_SLOTS,
      [ILLUSTRATIVE_QUALITY, TURNAROUND_COMPONENTS, TURNAROUND_NEGATIVE],
      { fixed: SHEET, loras: ILLUSTRATIVE_STACK },
    ),
    'form.illustrative.pfp': formPipeline(
      'form.illustrative.pfp',
      'FORM — illustrative portrait',
      'A close headshot in painted illustrative style, for a character sheet or a profile image. Describe WHO the character is; the portrait framing and quality register are the pipeline\'s job.',
      'perfectdeliberate-v10',
      'form',
      ILL_SLOTS,
      [ILLUSTRATIVE_QUALITY, PFP_COMPONENTS, PFP_NEGATIVE],
      { fixed: SQUARE, loras: ILLUSTRATIVE_STACK },
    ),
    // ⛔ `form.real.turnaround` (cyberrealistic-xl-1.0, form family) and
    // `form.real.pfp` (z-image-bf16, zimage family) were HERE and are shelved —
    // see the block above `buildFormPipelines`. The exact restore shapes are in
    // git history beside the illustrative ones that came back 2026-08-28
    // (`git log -S form.real.pfp -- this file`); REAL_QUALITY, both samplers
    // and the zimage template all still stand, tested.
  });
};
