/**
 * DESK STATUS POLLER — the desk's one shared instance (friction-map D1).
 *
 * The substrate is ONE machine fact; a lane's route health is ONE lane fact.
 * This module binds the generic poller factory to the desk's two probes, so
 * every stream instance (desk, tabs, torn-out windows) in this renderer
 * subscribes to the same timers instead of each owning its own interval and
 * re-asking the backend — and the upstream behind it — N times per 15s.
 */
import { getSubstrateHealth } from './substrate-health.js';
import { getLaneRouteHealth } from './route-health.js';
import { createStatusPoller } from './status-poller.js';

// `route:<neumaId>` keys need the lane object at fire time; the hook
// registers the CURRENT binding at subscribe time.
const laneRegistry = new Map();

export const registerLaneForPolling = (key, lane) => { laneRegistry.set(key, lane); };

// A hidden desk (another app in front, the window minimized to the OS) asks
// nothing; shown again, every owed light reads at once.
const pageHidden = () => typeof document !== 'undefined' && document.hidden;

export const sharedStatusPoller = createStatusPoller(async (key) => {
  if (key === 'substrate') return getSubstrateHealth();
  const lane = laneRegistry.get(key);
  return lane ? getLaneRouteHealth(lane) : { live: null, provider: null };
}, { hidden: pageHidden });

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sharedStatusPoller.wake(); });
}
