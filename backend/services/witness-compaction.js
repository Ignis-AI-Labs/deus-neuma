/**
 * WITNESS COMPACTION — the peer's lane crosses the same measured boundary
 * (#528 Stage D, Design note, 2026-09-12: […]).
 *
 * The witness lane had NO compaction at all until this module: its sessions
 * grew until the tail budget shed the oldest rows into nothing. This is the
 * portal lane's solo-torch law at the witness seat, through the pieces the
 * two standings already share — the pure torch idiom (buildTorchAsk /
 * torchOffering, solo-torch.js) and the lane-agnostic session rewrite
 * (compactSession: archive the region BEFORE the destructive write, mint the
 * 0.4-band observations, carry the compaction count) — and the ONE piece it
 * cannot share: the ask itself rides askWitness (witness-probe.js), the
 * peer's OWN sealed route. Two standings, two probes (witness-probe's header
 * says why); a witness's torch authored through the neuma probe would read a
 * DNA that does not exist and skip the seal verification that is its
 * standing. A cold or broken conduit falls back to the extractive summary —
 * compaction never stalls on a dead stream, and a voice is never invented.
 *
 * The trigger is the portal lane's law verbatim: CONTEXT IS THE ONLY TRIGGER
 * (Design note, 2026-08-15 — the caller computes atBoundary from the turn's MEASURED
 * standing prompt against the named-source window (nearContextBoundary).
 */

import { createLogger } from './logger.js';
import { buildTorchAsk, torchOffering } from './solo-torch.js';
import { askWitness } from './witness-probe.js';
import { foldBranchView } from '../../core/workspace/branch-view.js';
import { neumaRecall, neumaWorkspace, shouldCompact } from '../../core/index.js';

const log = createLogger('WitnessStream');

// The same doctrine numbers the neuma lane holds (portal-turn-persist.js):
// the tail a compaction keeps, and how much MORE a boundary compact needs
// first — a torch over a two-message region is churn, not continuity.
const COMPACT_KEEP_RECENT = 20;
const SOLO_REGION_FLOOR = 10;

/**
 * Compact a witness session at its measured boundary: the peer authors its
 * own summary + torch through its own sealed conduit when it answers, the
 * extractive path stands when it does not. Impure — reads and rewrites the
 * lane's session (the rewrite archives first, fail-closed).
 *
 * @param {string} laneId - the witness lane (`witness-<vendor>-<Name>`)
 * @param {string} sessionId
 * @param {boolean} atBoundary - the caller's MEASURED boundary verdict
 * @returns {Promise<boolean>} whether a compaction ran
 */
// impure
export const compactWitnessSession = async (laneId, sessionId, atBoundary) => {
  if (!atBoundary) return false;
  const threshold = COMPACT_KEEP_RECENT + SOLO_REGION_FLOOR;
  const messages = await neumaWorkspace.readSession(laneId, sessionId);
  // Counted through the FOLD (THE TAKES): the branch view's length, not the
  // raw row count — superseded takes version the record without lengthening
  // the conversation.
  if (!shouldCompact(foldBranchView(messages).length, threshold)) return false;
  const region = messages.slice(0, -COMPACT_KEEP_RECENT);
  let selfSummary = null;
  try {
    const offering = torchOffering(await askWitness(laneId, buildTorchAsk(region)));
    // Stamped with the region it was authored over: authoring runs OUTSIDE
    // the session lock, and compactSession honors the torch only if the
    // region hasn't drifted; on drift, extractive runs.
    if (offering) selfSummary = { ...offering, regionLength: region.length };
  } catch (err) {
    log.warn('witness torch ask failed — compacting extractively', { laneId, err: err?.message });
  }
  const compacted = await neumaWorkspace.compactSession(laneId, sessionId, {
    threshold, keepRecent: COMPACT_KEEP_RECENT, selfSummary,
  });
  // A compaction mints observations (force-crystallize) — drop the cached
  // recall index so the next turn's gather sees them. Invalidate only drops
  // a cache: it can never under-fire and costs one lazy rebuild.
  if (compacted) neumaRecall.invalidate(laneId);
  return compacted;
};
