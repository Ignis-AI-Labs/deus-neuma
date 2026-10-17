// Apply an approved PROMPT proposal — the backend's half of […]. One chained amendment entry, then the
// proposal closes as applied. Idempotent against the half-applied crash: if
// the chain already carries this proposalId un-retracted, the entry is not
// doubled — the proposal just finishes closing. The being's next turn
// carries the words (portal-stream reads activeAmendments per turn); nothing
// here touches a prompt directly — standing law lives in the record.

import { appendAmendment, activeAmendments } from './amendment-store.js';
import { markProposalApplied } from './proposal-store.js';

/**
 * @param {string} neumaId
 * @param {Object} proposal - an APPROVED prompt-class proposal (verified by the caller)
 * @param {{wallet: string}} evidence - who approved (the decide route's authenticated wallet)
 * @returns {Promise<Object>} the chained amendment entry
 */
// impure
export const applyPromptProposal = async (neumaId, proposal, { wallet }) => {
  const standing = await activeAmendments(neumaId, 'prompt');
  const already = standing.find((e) => e.proposalId === proposal.id);
  const entry = already || await appendAmendment(neumaId, {
    proposalId: proposal.id,
    class: 'prompt',
    patch: { text: proposal.patch.text },
    by: wallet || null,
  });
  await markProposalApplied(neumaId, proposal.id);
  return entry;
};
