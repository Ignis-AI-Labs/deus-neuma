/** Recovery repeats depend on platform-observed shell state, never model arguments. */
import { focusGroundOf } from './focus-ground.js';
import { withCodingSandboxLock } from './witness-coding-sandbox.js';

/** impure — inspect the active generation under its lock before deduplication. */
export const scopeRecoveryCall = async (call, connection) => {
  if ((call.server && call.server !== 'coding')
    || !['sandbox_recover', 'coding/sandbox_recover'].includes(call.toolName || call.tool)) return call;
  const lane = connection.companion?.neumaId;
  const source = focusGroundOf(connection);
  let recoveryState;
  try {
    recoveryState = await withCodingSandboxLock(lane, source, async ({ current, prepareCurrent }) => {
      try {
        await prepareCurrent();
        return JSON.stringify([current.directory, 'ready']);
      } catch (error) {
        return JSON.stringify([current.directory, error.code || 'error', error.message]);
      }
    });
  } catch (error) {
    // The real control handler still owns refusals and approval; this read
    // only identifies them so repeated failures cannot manufacture new acts.
    recoveryState = JSON.stringify([lane, source, error.code || 'error', error.message]);
  }
  return { ...call, recoveryState };
};
