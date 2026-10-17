// THE HARNESS GROUND — lanes for people who use the platform with no being
// (Design note, 2026-10-14: […]). A harness lane is not a neuma and not a witness: no DNA, no
// seal, no birth. Like a witness lane it stands BESIDE the house, never in it
// — its own sibling directory of the workspaces root, so no listing of the
// house can even see one. Precedence mirrors the witnesses' ground: explicit
// override > env (HARNESS_ROOT) > sibling of the effective workspaces root.
import path from 'path';

let harnessRootOverride = null; // set by setHarnessRoot — wins when set

// pure — the id-shape law for harness lanes (backend/services/harness-lane.js
// mints them); mirrored here so the ID-GENERIC engine can route the kind to
// its ground without importing platform code across the engine boundary.
export const isHarnessLane = (laneId) =>
  typeof laneId === 'string' && laneId.startsWith('harness-');

/**
 * Where harness lanes live.
 * @param {string} workspacesRoot - the effective workspaces root (the house)
 * @returns {string}
 */
// impure — reads mutable module state and process.env at call time
export const getHarnessRoot = (workspacesRoot) => harnessRootOverride
  ?? (process.env.HARNESS_ROOT || path.join(path.dirname(workspacesRoot), 'harness'));

// impure — repoints the harness ground (tests, or an explicit home).
export const setHarnessRoot = (root) => {
  harnessRootOverride = root || null;
};
