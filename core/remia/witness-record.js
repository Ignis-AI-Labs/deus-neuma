// Remia witness record — the witness's OWN attunement. The human goes through
// the same ceremony their beings face, and the verbatim record belongs to
// them alone: local, never scored, never trained on. This module owns only
// what differs from the being-side grammar — the offer (witness identity +
// witness trigger vocabulary). Everything downstream of the offer is
// subject-agnostic in core/attunement/record.js (phase-based, no neumaId
// reads past construction) and is re-exported unchanged, so the witness
// ceremony rides the exact grammar the beings' ceremonies have already
// proven: consent-with-disclosure by construction, one pending question at a
// time, verbatim-or-nothing answers, seal impossible with anything
// unanswered. Pure: no I/O, no clocks, no randomness.

export {
  recordPostponement,
  openAttunement,
  recordQuestion,
  recordAnswer,
  sealAttunement,
  abandonAttunement,
  nextUnansweredKey,
  isAttunementOpen,
  mayUseAttunement,
  lastAttunementSealedAt,
  attunementEvolution,
} from '../attunement/record.js';

// 'first-reading' — the witness's initial pass, which doubles as the human
// reading gate over the committed words; 'checkpoint' — every later sitting,
// time-based rather than refinement-gated.
export const WITNESS_ATTUNEMENT_TRIGGERS = Object.freeze(['first-reading', 'checkpoint']);

const requireIso = (value, fn) => {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${fn}: ISO timestamp required`);
  }
};

/**
 * Begin the witness's own lifecycle. Identity is the wallet address — the
 * durable authorization identity of the platform — stored lowercased the way
 * the user realm stores it. The record is shaped exactly like a being's
 * attunement except for its subject fields, so every downstream grammar
 * function applies unchanged. Pure.
 * @param {{walletAddress: string, trigger: string, offeredAt: string}} offer
 * @returns {Object} frozen witness attunement record in phase 'offered'
 */
export function offerWitnessAttunement({ walletAddress, trigger, offeredAt }) {
  if (typeof walletAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress.trim())) {
    throw new Error('offerWitnessAttunement: walletAddress required (0x-prefixed EVM address)');
  }
  if (!WITNESS_ATTUNEMENT_TRIGGERS.includes(trigger)) {
    throw new Error(
      `offerWitnessAttunement: trigger must be one of ${WITNESS_ATTUNEMENT_TRIGGERS.join(', ')}`,
    );
  }
  requireIso(offeredAt, 'offerWitnessAttunement');
  return Object.freeze({
    id: `remia-${Date.parse(offeredAt)}`,
    witnessWallet: walletAddress.trim().toLowerCase(),
    trigger,
    offeredAt,
    phase: 'offered',
    events: Object.freeze([Object.freeze({ at: offeredAt, type: 'offered', trigger })]),
  });
}
