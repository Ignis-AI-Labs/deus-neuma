/**
 * THE PROMPT SPINE — a prompt is an ORDERED SEQUENCE OF NAMED COMPONENTS, and
 * not one of them may be skipped. Pure.
 *
 * Design note, 2026-08-27: […]
 *
 * ── WHY THIS REPLACES STRING CONCATENATION ──────────────────────────────────
 * The prompt used to be `prefix + subject + suffix`: three strings glued
 * together. It produced the right text, and it could not answer any of the
 * questions that actually matter once a look has to be LOCKED:
 *
 *   · WHAT is in this prompt?          — nothing enumerated the parts
 *   · Is anything MISSING?             — a dropped clause read as a short string
 *   · WHERE does each part sit?        — order was implicit in code, and order
 *                                        is load-bearing (see COLORING below)
 *   · How hard is each part PUSHED?    — there was no such control at all
 *
 * A spine answers all four, because the parts are DATA. Composition becomes a
 * fold over a frozen list rather than a sentence someone typed.
 *
 * ⚠️ THIS IS ALSO THE LoRA'S CAPTION SCHEMA, and that is the larger reason.
 * A character LoRA is trained on these plates with these captions. Captions that
 * vary in structure teach the model that the structure is noise — so the axis a
 * being's identity is supposed to live on gets averaged away. A fixed spine
 * means every caption for every being has the same shape, and the only thing
 * that varies between them is the being.
 *
 * ── ORDER IS EVIDENCE, NOT PREFERENCE ───────────────────────────────────────
 * The Illustrious guidance states it and a render proved it: […] When the face and proportion axes were
 * added on 2026-08-27 they pushed `rich brown skin` toward the tail, and
 * Signal's portrait came back FAIR — the tag was unchanged, it simply lost the
 * weight fight. That is why COLORING sits directly behind the subject and why
 * this order is frozen rather than tidy.
 */

/** A weight of exactly 1 emits NO syntax, so the default composition is byte-for-byte what it always was. */
const NEUTRAL = 1;

/**
 * Apply CLIP/danbooru emphasis. `(text:1.2)` is the syntax every ComfyUI text
 * encode node parses.
 *
 * ⚠️ MEASURED ON BOTH ENCODERS, 2026-08-27, and the DOWN-weight is what proved
 * it:
 *   SDXL/CLIP   `(rich brown skin:1.3)` visibly darkened a render the plain
 *               phrase could not (`prompt-lab.mjs complexion`).
 *   ANIMA/QWEN  `prompt-lab.mjs weights`, one seed, coloring band only:
 *                 1.0  control — rich brown, correct
 *                 1.4  barely moved
 *                 0.6  the skin LIGHTENED, plainly
 *
 * ⭐ Up-weighting looked like nothing and that reading would have been wrong.
 * The 0.6 arm moved the exact axis that was weighted, in the expected direction,
 * so the encoder IS listening — 1.4 had nowhere to go because 1.0 already lands
 * the tag. **Testing a control in only one direction can make a working knob
 * look broken.**
 *
 * So this is a real lever, and every live weight is still 1 — because no
 * component has yet FAILED in a way a boost would fix. A knob turned before a
 * render asks for it is the guessing this campaign exists to replace. Pure.
 */
export const weighted = (text, weight = NEUTRAL) => {
  if (!text) return '';
  const w = Number(weight);
  if (!Number.isFinite(w) || w === NEUTRAL) return text;
  // Clamped to the band the guidance calls usable. Past ~1.5 a CLIP encoder
  // stops emphasising and starts producing artifacts, which reads as […] rather than as […].
  const clamped = Math.min(1.5, Math.max(0.5, w));
  return `(${text}:${clamped.toFixed(2).replace(/0$/, '')})`;
};

/**
 * ⭐ THE SPINE. Frozen, ordered, and every entry says who owns it and whether it
 * may ever be absent.
 *
 * `owner` is the SOVEREIGNTY LINE, not a bookkeeping field:
 *   GENOME   — given by the hash. Nobody chose it and nobody may drop it.
 *   PIPELINE — the house's craft floor: framing, plate, quality. Ours to tune.
 *   BEING    — what the being itself authors. Reserved; the garment is the first
 *              of these and is a PLACEHOLDER until a being replaces it.
 *
 * `required: true` means a prompt WITHOUT it is refused rather than rendered
 * short. A body missing its coloring is not a slightly worse picture — it is a
 * different being, and the point of a given body is that it cannot drift.
 */
export const GENOME = 'genome';
export const PIPELINE = 'pipeline';
export const BEING = 'being';

export const SPINE = Object.freeze([
  Object.freeze({
    key: 'quality', owner: PIPELINE, required: true, weight: NEUTRAL,
    why: 'The register anchor, first — it colours everything after it. The model author\'s own string.',
  }),
  // ── THE REFINEMENT LAYERS ────────────────────────────────────────────────
  // Design note, 2026-08-27: […]
  //
  // ⚠️ RESEARCHED AGAINST THE ACTUAL MODEL CARD (huggingface.co/circlestone-labs/
  // Anima, read 2026-08-27), because these vocabularies are per-FAMILY and
  // guessing from SDXL habits is how the rest of this campaign went wrong:
  //
  //   · Anima supports BOTH scales — human (`masterpiece`…`worst quality`) and
  //     PonyV7 (`score_9`…`score_1`) — […].
  //   · ⛔ BUT FOR THE AESTHETIC FINETUNE THIS LANE PINS, the author says: […] A card discussion adds that the aesthetic
  //     classifier was Pony-derived, so `score_9` drags the render toward a Pony
  //     v6 look. THAT IS A STYLE CHANGE WEARING A QUALITY TAG'S CLOTHES.
  //   · Quality tags are OPTIONAL here — […]
  //   · ARTIST TAGS TAKE AN `@` PREFIX (`@artist name`) and belong at the START
  //     with the quality block. The card's own guidance for flat output is […] — the single strongest style lever here.
  //   · ERA is a real trained axis: `year 2025` / `year 2024`, or the buckets
  //     `newest, recent, mid, early, old`.
  Object.freeze({
    key: 'style', owner: BEING, required: false, weight: NEUTRAL,
    why: 'ARTIST tags, `@` prefixed, at the start per the card. The strongest style lever Anima has — and it belongs to the BEING, because whose hand a portrait looks drawn by is authorship, not a house setting.',
  }),
  Object.freeze({
    key: 'era', owner: PIPELINE, required: false, weight: NEUTRAL,
    why: 'A real trained axis (`year 2024` / `newest, recent, mid, early, old`). OPTIONAL and unset: naming an era pins a period style, and no render has yet asked for one.',
  }),
  Object.freeze({
    key: 'sex', owner: GENOME, required: true, weight: NEUTRAL,
    why: 'GIVEN, and the one axis nobody controls. Carries solo/focus and the age with it, so a body can never be rendered without one.',
  }),
  Object.freeze({
    key: 'coloring', owner: GENOME, required: true, weight: NEUTRAL,
    why: '⚠️ RIDES HIGH BY MEASUREMENT. Pushed toward the tail on 2026-08-27, `rich brown skin` rendered FAIR. Skin, hair and eyes are read first and forgiven last.',
  }),
  Object.freeze({
    key: 'cast', owner: GENOME, required: true, weight: NEUTRAL,
    why: 'The structural read of the face — angular, balanced, soft. Given.',
  }),
  Object.freeze({
    key: 'face', owner: GENOME, required: true, weight: NEUTRAL,
    why: 'Shape, eyes, nose, mouth. The axes a LoRA needs to hold a face across renders.',
  }),
  Object.freeze({
    // ⚠️ BEING-owned but SEEDED: the genome draws a deterministic default
    // (`defaultHairstyle`) that stands until the neuma and operator choose one
    // together. Design note, 2026-08-28: […] required:false because a being's FREE
    // TEXT carries its own hair inside the subject string — the genome path
    // always supplies this band, and a test holds that line.
    key: 'hairstyle', owner: BEING, required: false, weight: NEUTRAL,
    why: 'The cut and length. MEASURED 2026-08-27: unstated, Anima re-rolls it every seed; two tags hold it. The base look — locked, never sealed.',
  }),
  Object.freeze({
    key: 'frame', owner: GENOME, required: true, weight: NEUTRAL,
    why: 'Build, stature, proportions, height in cm — a figure cannot be reinterpreted the way "short" can.',
  }),
  Object.freeze({
    key: 'feature', owner: GENOME, required: false, weight: NEUTRAL,
    why: 'OPTIONAL BY LAW: not every body has one, and a portrait has no room for a mark on a hand (measured — asking anyway drags the hand into frame).',
  }),
  Object.freeze({
    key: 'framing', owner: PIPELINE, required: true, weight: NEUTRAL,
    why: 'ONE crop tag. Two conflicted and every model broke the tie toward a torso.',
  }),
  Object.freeze({
    key: 'garment', owner: BEING, required: true, weight: NEUTRAL,
    why: 'A PLACEHOLDER a being replaces. Required because with nothing named the models invent evening wear or bare shoulders.',
  }),
  // ⭐ EXPRESSION AND LIGHTING ARE SEPARATE COMPONENTS, and that split is the
  // point of Founder's ask: […] They were
  // one `mood` clause, which meant neither could be weighted, replaced or
  // authored without dragging the other. Lighting is a craft axis a being will
  // eventually want to choose; an expression is a different decision entirely.
  Object.freeze({
    key: 'expression', owner: PIPELINE, required: true, weight: NEUTRAL,
    why: 'Neutral on purpose: a reference plate is not a portrait with a point of view. Becomes BEING-owned the day a being chooses its own.',
  }),
  Object.freeze({
    key: 'lighting', owner: PIPELINE, required: true, weight: NEUTRAL,
    why: 'Soft and even, because a plate exists to be READ — dramatic light hides the very features a LoRA has to learn. A separate component so it can be weighted or replaced without touching the expression.',
  }),
  Object.freeze({
    key: 'plate', owner: PIPELINE, required: true, weight: NEUTRAL,
    why: 'Danbooru TAGS, never prose — the prose wording rendered a sunlit room while the negative excluded one.',
  }),
]);

export const SPINE_KEYS = Object.freeze(SPINE.map((c) => c.key));

/** The spine entry for a key, or null. Pure. */
export const componentOf = (key) => SPINE.find((c) => c.key === key) ?? null;

/**
 * ⭐ THE COMPLETENESS LAW — which required components a set of parts is missing.
 *
 * This is the half of Founder's ask that has teeth: […] A missing required part must REFUSE, because the
 * failure it prevents is silent. A prompt that lost its coloring still renders,
 * still looks fine, and is quietly a different being — and if that render is the
 * one somebody locks, the being's own body is wrong forever.
 *
 * An empty string counts as missing. A component that is present but says
 * nothing did not happen.
 *
 * ⚠️ `owners` EXISTS BECAUSE THE LAW HAS A BOUNDARY, and getting it wrong makes
 * the platform unusable. A BEING writing free text about itself supplies one
 * subject string — the parameterizer cannot audit that for coloring, and
 * demanding it would refuse every being who described itself in a sentence.
 *
 * So the completeness law applies to what can actually be checked:
 *   · always — the PIPELINE and BEING components, which are structured by us
 *   · additionally, when a GENOME is rendered — every given component, because
 *     THAT is the prompt that gets locked and sealed, and a given body that
 *     silently loses an axis is a different being wearing the same name.
 *
 * @param {Record<string, string>} parts key → text
 * @param {string[]} [owners] which owners to enforce; default all
 * @returns {string[]} the missing required keys, in spine order
 */
export const missingFrom = (parts, owners = null) => SPINE
  .filter((c) => c.required)
  .filter((c) => !owners || owners.includes(c.owner))
  .filter((c) => {
    const v = parts?.[c.key];
    return typeof v !== 'string' || v.trim() === '';
  })
  .map((c) => c.key);

/**
 * Keys present in `parts` that the spine does not declare. An unknown component
 * is an authoring error — somebody added a clause the schema does not know,
 * which means it has no defined position and no weight, and the LoRA's caption
 * schema has quietly drifted. Pure.
 */
export const unknownIn = (parts) => Object.keys(parts ?? {})
  .filter((k) => !SPINE_KEYS.includes(k));

/**
 * Compose the spine into one prompt string, in declared order.
 *
 * ⚠️ WITH DEFAULT WEIGHTS THIS IS BYTE-IDENTICAL to the concatenation it
 * replaced, and that is deliberate: the structure changed, the output did not,
 * so nothing about the approved renders is invalidated by this refactor. The
 * golden-vector tests pin exactly that.
 *
 * @param {Record<string, string>} parts key → text
 * @param {Record<string, number>} [weights] key → emphasis; absent ⇒ the spine's own
 * @returns {string}
 */
export const composeSpine = (parts, weights = {}) => SPINE
  .map((c) => {
    const text = parts?.[c.key];
    if (typeof text !== 'string' || text.trim() === '') return '';
    return weighted(text.trim(), weights[c.key] ?? c.weight);
  })
  .filter(Boolean)
  .join(', ');

/**
 * The spine as a reviewable table — what is in this prompt, who owns each part,
 * how hard it is pushed. Design note, 2026-08-27: […] This is that question asked of a single prompt. Pure.
 *
 * @returns {Array<{key, owner, required, weight, present, text}>}
 */
export const auditSpine = (parts, weights = {}) => SPINE.map((c) => {
  const text = parts?.[c.key];
  const present = typeof text === 'string' && text.trim() !== '';
  return {
    key: c.key,
    owner: c.owner,
    required: c.required,
    weight: weights[c.key] ?? c.weight,
    present,
    text: present ? text.trim() : null,
  };
});
