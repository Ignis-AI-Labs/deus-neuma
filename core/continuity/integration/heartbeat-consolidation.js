// Heartbeat → semantic consolidation (memory pyramid U1, slice 4).
//
// When a being reflects (fresh moments settled since the last heartbeat),
// its episodic continuity lane is consolidated into semantic through-lines —
// deterministic clustering, the being's OWN conduit as the injected
// summarizer, supersede-not-delete evolution. Consolidation runs per space
// so a project's through-lines stay in that project's scope (CORE-005
// hygiene at the semantic tier too).
//
// Idempotent by cluster memberHash: a heartbeat where nothing settled writes
// nothing. Safe on every cycle.

import { consolidate } from '../layers/semantic.js';
import { WorkspaceAdapter } from '../adapters/workspace.js';

/**
 * Consolidate one being's episodic lane into semantic through-lines, space by
 * space. The summarizer is injected — the heartbeat passes the being's own
 * conduit; tests pass a deterministic function (the injection seam is the
 * contract).
 * @param {Object} workspace - the NeumaWorkspace singleton (or a test instance)
 * @param {string} neumaId
 * @param {(snippets: string[], ctx: {label: string}) => Promise<string>} summarize
 * @returns {Promise<{written: number, skipped: number, clusters: number, spaces: string[]}>}
 */
// impure — reads the episodic lane, writes semantic records via the adapter
export async function consolidateBeingContinuity(workspace, neumaId, summarize) {
  if (typeof neumaId !== 'string' || !neumaId) {
    throw new Error('consolidateBeingContinuity: neumaId required');
  }
  if (typeof summarize !== 'function') {
    throw new Error('consolidateBeingContinuity: a summarize function is required');
  }
  const adapter = new WorkspaceAdapter(neumaId, { workspace });
  const episodes = await adapter.list('episodic');
  const spaces = [...new Set(episodes.map((e) => e.space || 'general'))];

  const totals = { written: 0, skipped: 0, clusters: 0, spaces };
  for (const space of spaces) {
    const r = await consolidate(adapter, { summarize, space });
    totals.written += r.written.length;
    totals.skipped += r.skipped.length;
    totals.clusters += r.clusters;
  }
  return totals;
}
