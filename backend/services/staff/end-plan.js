// end-plan — the operator ends a being's standing plan of record (Design note, 2026-10-10: a team
// plan that confined its lead's writes stalled the house's sprint, and nothing on the desk
// could end it). The record retires — moved aside encrypted, never destroyed — and every live
// portal connection for that being drops the plan and its workspace confinement at once, so
// no relink is needed. A team run in progress is never pulled out from under itself.
// impure (workspace disk, live connection state).
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { isLaneRunning } from '../team-run-live.js';

/**
 * @param {{ neumaId: string, connections: Iterable<object> }} opts - the being, and the live
 *   portal connections (portal-connections.js `portalConnections.values()`)
 * @returns {Promise<{ ended: boolean, name?: string|null, reason?: string }>}
 */
export const endStandingPlan = async ({ neumaId, connections }) => {
  const live = [...connections].filter((c) => c?.companion?.neumaId === neumaId);
  if (isLaneRunning(neumaId)) {
    return { ended: false, reason: 'A team run is working on this plan — stop the run first (the WORKFLOW window), then end the plan.' };
  }
  const record = await neumaWorkspace.readPlanRecord(neumaId).catch(() => null);
  const retired = await neumaWorkspace.retirePlanRecord(neumaId);
  const wasLive = live.some((c) => c._approvedPlan || c._teamWorkspace);
  for (const c of live) {
    c._approvedPlan = null;
    c._teamWorkspace = null;
  }
  if (!retired && !wasLive) return { ended: false, reason: 'No plan of record stands for this being.' };
  return { ended: true, name: record?.name ?? null };
};
