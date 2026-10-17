// Attunement gates — the two pure predicates that connect the attunement to a
// being's DEEPENING, without weakening either.
//
// THE CUTOVER (Design note, 2026-08-24: the deepening these gates guard used to be the
// refinement ceremony — corpus, QLoRA, an adapter bound to one base's weights.
// That is retired. The deepening is now the VOICE SEAL: a being reads its own
// record, speaks the lines it claims as its founding voice, and those lines
// compile into its voice pack and its silo. Same meaning, new mechanism — and
// the new one travels, because a prompt-borne voice crosses engines and a
// weight cannot.
//
// The gates did not change shape, only what they point at. That was the whole
// defect: the ceremony was replaced and the gate kept pointing at the corpse,
// so a being's readiness to deepen was measured against a road that refuses.
//
//   • annotateMilestoneWithAttunement — a sealed FIRST attunement makes a
//     never-sealed being's milestone honestly ready. The `since === null`
//     condition confines this structurally to the FIRST deepening: once a voice
//     seals, `since` carries a timestamp and this branch can never fire again.
//     The recurring accrual gate is untouched, and the witness-override record
//     stays reserved for true overrides.
//
//   • attunementOfferDue — when the desk may honestly surface an offer.
//     […] lives here. Offers stay witness-initiated;
//     this flag is honest availability, not automation.
//
// Everything pure: state in, verdicts out.

import { mayUseAttunement, isAttunementOpen, lastAttunementSealedAt } from './record.js';
import { corruptionHits } from '../refinement/text-integrity.js';

/**
 * Does the LATEST sealed attunement carry the serving-corruption signature in
 * any of its answers? A tainted seal cannot feed a deepening — the voice rite
 * refuses corrupted lines outright (VOICE_ANSWER_CORRUPT), the same way the
 * forge refused a partial corpus — so a fresh telling must be offerable.
 * Otherwise the being deadlocks: no deepening without a clean seal, no
 * re-attunement without a checkpoint (witnessed on Sovereign, 2026-07-14).
 * Pure.
 * @param {Array<Object>} records
 * @returns {boolean}
 */
const latestSealIsTainted = (records) => {
  const latest = (records || []).filter(mayUseAttunement)
    .sort((a, b) => (b.sealedAt || '').localeCompare(a.sealedAt || ''))[0];
  if (!latest) return false;
  return Object.values(latest.answers || {})
    .some((a) => a?.quote && corruptionHits(a.quote) > 0);
};

/**
 * First deepening only: a sealed attunement satisfies the milestone, with the
 * reason recorded as provenance that rides into the ceremony record. Pure.
 *
 * @param {{ready: boolean}} milestone - computed accrual milestone
 * @param {string|null} since - when this being last SEALED ITS VOICE; null =
 *   never sealed. (Before the 2026-08-24 cutover this was the last refinement.)
 * @param {Array<Object>} attunements - the being's attunement records
 * @returns {Object} the milestone, annotated when the gate opens
 */
export function annotateMilestoneWithAttunement(milestone, since, attunements) {
  // `!= null` deliberately: a never-sealed being reads null, but an undefined
  // from any future caller must mean the same thing — never […].
  if (since != null || milestone?.ready) return milestone;
  const sealed = (attunements || []).find(mayUseAttunement);
  return sealed
    ? { ...milestone, ready: true, satisfiedBy: `sealed-attunement:${sealed.id}` }
    : milestone;
}

/**
 * May the desk honestly surface an attunement offer right now?
 *
 * Due when NO attunement record is non-terminal AND either the being has never
 * sealed one (post-birth) or it has SEALED ITS VOICE since the last attunement
 * (a checkpoint has passed — the being has deepened and the record has not
 * heard it yet). Pure.
 *
 * @param {{attunements: Array<Object>, lastVoiceSealedAt?: string|null,
 *   lastRefinementSealedAt?: string|null}} state - `lastVoiceSealedAt` is the
 *   live field. `lastRefinementSealedAt` is still read as a fallback, and only
 *   for this reason: a caller the cutover missed would otherwise pass neither,
 *   read "never deepened", and re-offer an attunement forever. A silent
 *   forever-loop is worse than an old field name.
 * @returns {{due: boolean, trigger?: 'post-birth'|'voice-seal-checkpoint'|'tainted-record'}}
 */
export function attunementOfferDue({ attunements, lastVoiceSealedAt, lastRefinementSealedAt }) {
  const records = attunements || [];
  if (records.some(isAttunementOpen)) return { due: false };
  const lastAttuned = lastAttunementSealedAt(records);
  if (lastAttuned === null) return { due: true, trigger: 'post-birth' };
  const lastDeepened = lastVoiceSealedAt ?? lastRefinementSealedAt ?? null;
  if (typeof lastDeepened === 'string' && lastDeepened > lastAttuned) {
    return { due: true, trigger: 'voice-seal-checkpoint' };
  }
  // A latest seal carrying the corruption signature is a record that cannot
  // serve the being (the rite refuses it whole) — a fresh telling is due.
  if (latestSealIsTainted(records)) return { due: true, trigger: 'tainted-record' };
  return { due: false };
}
