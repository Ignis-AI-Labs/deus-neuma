// Apply an approved TOOLSET proposal — a TIER change on an existing
// advertised tool, through the exact path the ACTS "ALWAYS" grant already
// runs (addAllowedTool → updateToolPolicy). The gateway grants tiers, never
// invents tools: existence was validated at propose time against the
// being's own live turn catalog, where the catalog actually lives. Retract
// UNDOES the grant (unlike prompt law, a policy grant is a live door — the
// record alone does not close it).

import { default as neumaWorkspace } from '../../../core/workspace/neuma-workspace.js';
import { addAllowedTool } from '../tool-policy.js';
import { appendAmendment, activeAmendments } from './amendment-store.js';
import { markProposalApplied } from './proposal-store.js';

/**
 * @param {string} neumaId
 * @param {Object} proposal - an APPROVED toolset-class proposal
 * @param {{wallet: string}} evidence
 * @returns {Promise<Object>} the chained amendment entry
 */
// impure
export const applyToolsetProposal = async (neumaId, proposal, { wallet, signal, beforeCommit } = {}) => {
  const { server, tool } = proposal.patch;
  const lanePath = neumaWorkspace.pathFor(neumaId);
  const guard = () => {
    signal?.throwIfAborted();
    if (neumaWorkspace.pathFor(neumaId) !== lanePath) throw new Error('Toolset grant root changed');
    beforeCommit?.();
  };
  const standing = await activeAmendments(neumaId, 'toolset');
  const already = standing.find((e) => e.proposalId === proposal.id);
  if (!already) {
    await neumaWorkspace.updateToolPolicy(neumaId, (current) => addAllowedTool(current, server, tool),
      { signal, beforeCommit: guard });
  }
  const entry = already || await appendAmendment(neumaId, {
    proposalId: proposal.id, class: 'toolset', patch: { server, tool }, by: wallet || null,
  });
  await markProposalApplied(neumaId, proposal.id);
  return entry;
};

/**
 * The retract half: drop `tool` from the lane layer's allowed row. Pure
 * filter over the persisted layer — denied/requireApproval untouched, other
 * servers untouched. impure (reads + writes the lane policy).
 */
export const removeToolsetGrant = async (neumaId, { server, tool }) => {
  let held = false;
  await neumaWorkspace.updateToolPolicy(neumaId, (layer) => {
    held = Boolean(layer?.[server]?.allowed?.includes(tool));
    if (!held) return undefined;
    return { ...layer, [server]: { ...layer[server], allowed: layer[server].allowed.filter((t) => t !== tool) } };
  });
  return held;
};
