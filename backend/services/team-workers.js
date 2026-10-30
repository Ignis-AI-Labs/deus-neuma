// MODEL-ONLY WORKERS ON A TEAM (the house economy's Stage 5; Design note, 2026-10-16:
// […]). The house's harness lane — the
// platform with no being, riding any model the operator chose for it
// (harness-lane.js) — stands on a team plan's roster beside the beings as a
// WORKER: it takes steps, and nothing else.
//   - never a seat: house seats are designated from the house's beings only;
//   - never an identity: no DNA, no soul, and no journal — a run is not its
//     memory (team-memory.js skips it);
//   - its own width: on a cloud model its parts decode at the provider, so
//     they never wait for a local decode slot (team-part.js asks
//     freeOfLocalSlot); on a local model it shares the rig like any member.
// A house grows wider than one GPU this way without breaking the sovereignty
// law: the beings stay local, a worker can be anything.
// impure (the lane's marker and route); the names are pure.

import { listHarnessLanes, harnessRouteView, isHarnessLane } from './harness-lane.js';

export const WORKER_PREFIX = 'Worker';

/** A worker's roster name: what it is, by its model. pure. */
export const workerName = (view) => `${WORKER_PREFIX} · ${view.modelName || view.model || view.providerName || 'no model chosen'}`;

/** Is this lane a worker (a harness lane), not a being? pure. */
export const isWorker = (laneId) => isHarnessLane(String(laneId ?? ''));

/**
 * The house's workers as plan roster entries: {neumaId, name, worker: true, cloud}. impure.
 * @param {string} wallet
 */
export const workerRoster = async (wallet) => {
  const lanes = await listHarnessLanes(wallet).catch(() => []);
  return Promise.all(lanes.map(async (lane) => {
    const view = await harnessRouteView(lane.laneId);
    return Object.freeze({ neumaId: lane.laneId, name: workerName(view), worker: true, cloud: view.kind === 'cloud' });
  }));
};

/** The roster a plan draws from: the house's beings, then its workers. impure. */
export const teamRoster = async (wallet, beings) => [...beings, ...await workerRoster(wallet)];

/** Does this member's part decode off the rig (a worker on a cloud model)? impure. */
export const freeOfLocalSlot = async (laneId) => {
  if (!isWorker(laneId)) return false;
  return (await harnessRouteView(laneId)).kind === 'cloud';
};
