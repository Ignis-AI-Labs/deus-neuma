/**
 * Clear caches whose owner is the departed lane. Durable records remain in
 * that lane; the arriving participant must hydrate its own authority.
 * @param {Object} connection
 */
// impure — clears connection-local state after navigation settles the turn.
export const clearLaneRuntime = (connection) => {
  for (const key of [
    '_approvedPlan', '_teamWorkspace', '_sensitiveGrants', '_turnSandbox',
    '_turnSandboxError', '_turnSandboxRecoverable', '_turnCatalog',
    '_turnSkills', '_turnDisclosedToolIds', '_siloBySitting', '_siloDriverBySitting', '_runningToolOperation', '_operationRecoveryStopped',
  ]) delete connection[key];
  connection.toolWorkspace = null;
};
