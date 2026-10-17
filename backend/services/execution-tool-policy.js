import workspace from '../../core/workspace/neuma-workspace.js';
import { createLogger } from './logger.js';

const log = createLogger('ExecutionToolPolicy');

/** Read authority through the existing file queue; unreadable is never absent.
 * Errors are safe to surface to a being: JSON parser text can contain file data.
 * @param {string|undefined} laneId
 * @returns {Promise<Object|null>}
 * impure - locked disk read and structured diagnostic, no new policy layer.
 */
export const readExecutionToolPolicy = async (laneId) => {
  if (!laneId) return null;
  try {
    return await workspace.readToolPolicy(laneId);
  } catch (error) {
    log.error('Tool policy unreadable; execution refused', {
      laneId, errorName: error.name, errorCode: error.code || null,
    });
    throw Object.assign(new Error('Tool policy is unreadable; execution is unavailable.'), {
      code: 'TOOL_POLICY_UNREADABLE',
    });
  }
};
