// impure: clear the SAME session copies and cancel captured work during revoke.
import { portalConnections } from '../routes/portal-connections.js';
import { removeAllowedTool } from './tool-policy.js';
import { cancelIntentSweeps } from './intents/intent-context.js';

/** Remove one runtime grant; return whether any session held it. No policy IO. */
export const revokeRuntimePermission = (neumaId, descriptor, { held = false } = {}) => {
  let sessionHeld = false;
  for (const connection of portalConnections.values()) {
    if (connection.companion?.neumaId !== neumaId) continue;
    if (descriptor.kind === 'act') {
      sessionHeld ||= Boolean(connection._sessionToolPolicy?.[descriptor.server]?.allowed?.includes(descriptor.tool));
      connection._sessionToolPolicy = removeAllowedTool(connection._sessionToolPolicy, descriptor.server, descriptor.tool);
    } else if (descriptor.kind === 'folder') {
      const field = descriptor.access === 'write' ? '_grantedWriteRoots' : '_grantedReadRoots';
      sessionHeld ||= Boolean(connection[field]?.includes(descriptor.path));
      connection[field] = (connection[field] || []).filter((root) => root !== descriptor.path);
      connection._pathGrantsHydrated = false;
    } else if (descriptor.kind === 'file') {
      sessionHeld ||= Boolean(connection._sensitiveGrants?.[descriptor.access]?.includes(descriptor.path));
      connection._sensitiveGrants = { ...(connection._sensitiveGrants || {}),
        [descriptor.access]: (connection._sensitiveGrants?.[descriptor.access] || []).filter((file) => file !== descriptor.path) };
    }
    // Even an absent policy row can have an ALWAYS still awaiting persistence.
    // Cancel that origin too, or it could enter the file queue after this revoke.
    if (descriptor.kind !== 'spend' || held) {
      connection.activeTurn?.abort();
      cancelIntentSweeps(connection);
    }
  }
  return sessionHeld;
};
