import { neumaWorkspace } from '../../core/index.js';
import { isWithinRoots } from './tool-sandbox.js';
import { focusGroundRoots } from './focus-ground.js';

/** AUTO may acquire read scope only inside the lane or the operator's open folder. Pure. */
export const autoReadGrantAllowed = (connection, dirs) => {
  const laneRoot = connection.companion?.neumaId ? neumaWorkspace.pathFor(connection.companion.neumaId) : null;
  const open = [...new Set([...(laneRoot ? [laneRoot] : []), ...focusGroundRoots(connection)])];
  return open.length > 0 && dirs.every((dir) => isWithinRoots(dir, open));
};
