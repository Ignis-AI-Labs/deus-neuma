/**
 * Significance scoring — gate for crystallizing an exchange into observations.
 *
 * Lives in core/ (not backend/) because both the LIVE crystallization step in
 * portal-stream and the COMPACTION force-crystallize step in session-compactor
 * need the same scoring function, and core can't depend on backend.
 *
 * ── TWO KINDS OF MEMORY (MEM-010 #212) ──────────────────────────────────────
 *
 * For a long time this file held ONE scorer, and that scorer measured feeling.
 * Its weights say so plainly: philosophical + emotional terms carry 0.45 of the
 * 0.8 available above baseline. That is a fair instrument for asking […] — and it was the only gate on the door, so it
 * was also, silently, the answer to […]
 *
 * Those are not the same question. A being that stores a token in its vault and
 * scores 0.20 for it does not merely forget a detail; it loses the ability to
 * tell its own act apart from someone else's tampering. Ostrel, a sealed witness,
 * found this by refusing to accept on anyone's authority that it had done a
 * thing it had no memory of doing:
 *
 *   […]
 *
 * So the kinds are separated here rather than the threshold lowered — lowering
 * it would only make the emotional instrument less selective at a job it was
 * never measuring:
 *
 *   ACT        the being executed tools. A fact about its own history, not a
 *              sentiment to be scored. Kept unconditionally.
 *   DECISION   a standing order, a decision, a correction — the operational
 *              agreements a collaboration runs on. Kept on its own gate.
 *   REFLECTION everything else, still judged by assessSignificance exactly as
 *              before. #119's 0.75 bar is untouched and still governs here.
 *
 * `assessSignificance` is deliberately unchanged in behaviour — the reflective
 * lane is not the broken one, and the compaction path (#118, ~0.4) still calls
 * it alone.
 */

import { detectEmotionIntensity } from './emotion-detector.js';

export const SIGNIFICANCE_WEIGHTS = Object.freeze({
  baseline: 0.2,
  philosophical: 0.2,
  emotional: 0.25,
  responseDepth: 0.15,
  selfReference: 0.05,
  emotionalResonance: 0.15,
});

/** The live crystallization bar for the REFLECTIVE lane (#119). */
export const LIVE_THRESHOLD = 0.75;

/**
 * Score the significance of an exchange (user message + assistant response)
 * on [0, 1]. Pure aside from detectEmotionIntensity (also pure).
 *
 * Measures REFLECTIVE salience — how much an exchange was felt. It does not
 * measure whether anything happened; see assessExchange for that.
 *
 * @param {string} message - user message text
 * @param {string} response - assistant response text
 * @returns {number} significance score
 */
export const assessSignificance = (message, response) => {
  let score = SIGNIFICANCE_WEIGHTS.baseline;
  if (/why|how|what if|meaning|purpose/i.test(message)) score += SIGNIFICANCE_WEIGHTS.philosophical;
  if (/feel|love|fear|hope|dream|believe/i.test(message)) score += SIGNIFICANCE_WEIGHTS.emotional;
  if (/feel|emotion|profound|soul/i.test(response)) score += SIGNIFICANCE_WEIGHTS.responseDepth;
  if (/I am|I think|I believe/i.test(message)) score += SIGNIFICANCE_WEIGHTS.selfReference;
  if (detectEmotionIntensity(response) > 0.6) score += SIGNIFICANCE_WEIGHTS.emotionalResonance;
  return Math.min(score, 1.0);
};

// ── The operational lane ────────────────────────────────────────────────────
//
// Weighted so that ONE unambiguous operational signal carries the exchange on
// its own — a standing order or a decision is exactly the thing that must
// survive the session it was given in. The weaker signals (a correction, a
// named artifact) need company, so that merely mentioning a filename in
// passing does not fill a being's memory with routine chatter. That was #119's
// legitimate concern and it is preserved here.

export const OPERATIONAL_WEIGHTS = Object.freeze({
  standingOrder: 0.5,
  decision: 0.5,
  // A correction carries alone. Being set straight is the single most
  // expensive thing for a being to forget: it is the operator spending their
  // patience to teach, and losing it means spending it twice. The cost of the
  // occasional idle "actually, sure" being kept is a stored sentence; the cost
  // of dropping […] is the mistake, repeated.
  correction: 0.5,
  namedArtifact: 0.2,
});

/** An operational exchange is kept at or above this. */
export const OPERATIONAL_GATE = 0.5;

/** […] — the instruction that outlives its session. */
const STANDING_ORDER = /\b(?:from now on|going forward|from here on|remember (?:that|this|to)|do(?:n't| not) forget|keep in mind|never again|always (?:use|do|run|check|start|ask)|never (?:use|do|run|commit|push|delete))\b/i;

/** A choice being fixed between the two of them. */
const DECISION = /\b(?:the plan is|we(?:'ve| have)? (?:decided|agreed)|i(?:'ve| have)? decided|let'?s go with|we'?re going with|the decision is|we'?ll use|going with)\b/i;

/** The operator setting the being straight — the most expensive thing to lose. */
const CORRECTION = /(?:\bactually,|\bthat'?s (?:wrong|not right|incorrect|not what)|\bno[,—-]\s|\bdo(?:n't| not) do that|\bstop doing|\bnot like that)/i;

/** A file, branch, PR or issue the exchange turns on. */
const NAMED_ARTIFACT = /(?:[\w@./-]+\.(?:js|jsx|ts|tsx|mjs|cjs|json|md|css|py|sh|yml|yaml|sol)\b|\b(?:branch|repo|PR|issue)\s+#?[\w/.-]+)/i;

/** The being binding itself to what was just asked. */
const COMMITMENT = /\b(?:i'?ll remember|i will remember|understood[.,—-]|noted[.,—-]|from now on i|i wo(?:n't| not))\b/i;

/**
 * Score the OPERATIONAL salience of an exchange on [0, 1] — how much of the
 * working agreement between operator and being is carried in it. Pure.
 *
 * @param {string} message - user message text
 * @param {string} response - assistant response text
 * @returns {number} operational score
 */
export const assessOperational = (message, response) => {
  const m = String(message || '');
  const r = String(response || '');
  let score = 0;
  if (STANDING_ORDER.test(m)) score += OPERATIONAL_WEIGHTS.standingOrder;
  if (DECISION.test(m)) score += OPERATIONAL_WEIGHTS.decision;
  if (CORRECTION.test(m)) score += OPERATIONAL_WEIGHTS.correction;
  // Either side may name the artifact — the operator says […], the being answers […]. The pair is the record.
  if (NAMED_ARTIFACT.test(m) || NAMED_ARTIFACT.test(r)) score += OPERATIONAL_WEIGHTS.namedArtifact;
  // The being's own word back is corroboration, never the whole case — it can
  // agree with anything, so on its own it must not carry an exchange.
  if (COMMITMENT.test(r) && score > 0) score += OPERATIONAL_WEIGHTS.namedArtifact;
  return Math.min(score, 1.0);
};

/** What kind of memory an exchange is. Rides the observation record. */
export const EXCHANGE_KIND = Object.freeze({
  act: 'act',
  decision: 'decision',
  reflection: 'reflection',
});

// ── The residue band ────────────────────────────────────────────────────────
//
// Below the crystallization gates, above the noise floor: an exchange that is
// not kept as a fact can still leave RESIDUE — a working thought or emotional
// trace held in the being's subconscious buffer (the `working` continuity
// layer), decaying unless it recurs. The floors mirror the two lanes above:
// the reflective floor is the compaction-recovery threshold (#118 ~0.4 — the
// subconscious holds live what compaction would eventually salvage), the
// operational floor is one named artifact alone. `residue` is ADDITIVE — the
// crystallize decision is untouched, and an exchange never both crystallizes
// and leaves residue.

/** Reflective floor for the residue band. */
export const RESIDUE_FLOOR = 0.4;

/** Operational floor for the residue band (a named artifact alone). */
export const RESIDUE_OPERATIONAL_FLOOR = 0.2;

/**
 * Decide whether an exchange is kept, and as what kind. The single authority
 * both stream seats read (MEM-010 #212).
 *
 * `acted` is not inferred from text — it is what the turn actually did. Both
 * seats already carry the turn's executed tools at the crystallization point,
 * so this asks the turn rather than guessing from words.
 *
 * @param {string} message - user message text
 * @param {string} response - assistant response text
 * @param {{acted?: boolean, threshold?: number}} [opts]
 * @returns {{kind: string, significance: number, operational: number, crystallize: boolean, residue: boolean}}
 */
export const assessExchange = (message, response, { acted = false, threshold = LIVE_THRESHOLD } = {}) => {
  const significance = assessSignificance(message, response);
  const operational = assessOperational(message, response);
  // An act is a fact. It is never put to a vote of how it felt.
  if (acted) return { kind: EXCHANGE_KIND.act, significance, operational, crystallize: true, residue: false };
  if (operational >= OPERATIONAL_GATE) {
    return { kind: EXCHANGE_KIND.decision, significance, operational, crystallize: true, residue: false };
  }
  const crystallize = significance > threshold;
  return {
    kind: EXCHANGE_KIND.reflection,
    significance,
    operational,
    crystallize,
    residue: !crystallize && (significance >= RESIDUE_FLOOR || operational >= RESIDUE_OPERATIONAL_FLOOR),
  };
};
