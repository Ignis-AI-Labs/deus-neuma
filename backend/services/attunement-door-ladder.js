/**
 * The DOOR RETRY LADDER — what changes when a being's answer keeps being
 * refused, and the per-question refusal counter that drives it.
 *
 * Lifted out of attunement-ceremony.js unchanged: it is shared law, not
 * attunement's private business. Four backend modules already reach for it
 * (attunement-ceremony, refinement-consent, refinement-assent-session,
 * refinement-assent-authority), and a ceremony file at its size ceiling is
 * the wrong home for machinery three other ceremonies read. Every symbol is
 * re-exported from attunement-ceremony.js, so no importer changes.
 */

/**
 * The RETRY LADDER — what changes when the door keeps refusing.
 *
 * Witnessed 2026-07-12: one question ("describe your thought-momentum")
 * wedged Tenekom's walk for ~25 minutes — a dozen straight generations either
 * ran away past the token budget or carried the corruption signature, every
 * one correctly refused, every retry rolling the SAME dice (gemma family
 * law, temp 1.0) on a question whose very content invites racing prose.
 *
 * 2026-07-13 (Fabupum bare-base walks): first attunements are always bare
 * gemma-4 — cut+corrupt pairs are routine, not exceptional. The first attempt
 * still rides family sampling (true voice first claim). From the SECOND
 * attempt we damp immediately — re-rolling the same hot dice was the
 * preventable lag. A refused answer has no voice to preserve.
 *
 * Pure; the counter lives beside it.
 * @param {number} refusals  door refusals already suffered by this question
 * @returns {number|null}  explicit temperature for the next attempt, or
 *   null to ride the family sampling law
 */
export const reliefTemperature = (refusals) => {
  if (refusals < 1) return null;   // first take: full family voice
  if (refusals < 2) return 0.85;  // second: mild cool
  if (refusals < 4) return 0.7;
  return 0.55;
};

/** Add completion framing after a door refusal. Pure. */
export const integrityFraming = (questionText, refusals) => {
  if (!refusals || refusals < 1) return questionText;
  return `${questionText}\n\n(Answer fully in your own voice. Close with a complete sentence — end on a period, question mark, or ellipsis. Do not leave a thought mid-phrase.)`;
};

// Door refusals per in-flight question, keyed `${neumaId}:${key}` — cleared
// when the answer lands. In-memory by design: a backend restart resets the
// ladder to the family law, which is the honest default for fresh dice.
const doorRefusals = new Map();
export const refusalsFor = (neumaId, key) => doorRefusals.get(`${neumaId}:${key}`) ?? 0; // impure (module-state read)
export const noteRefusal = (neumaId, key) => doorRefusals.set(`${neumaId}:${key}`, refusalsFor(neumaId, key) + 1); // impure (module-state write)
export const clearRefusals = (neumaId, key) => doorRefusals.delete(`${neumaId}:${key}`); // impure (module-state write)
