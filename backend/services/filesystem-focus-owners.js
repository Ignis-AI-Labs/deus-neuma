import { resolveFocusPath } from './user-files.js';

// Weak references prevent the shared filesystem authority retaining dead turns.
const owners = new Set();
const registered = new WeakSet();

/** impure — track a connection without converting its focus into a grant. */
export const trackFilesystemFocus = (connection) => {
  if (!connection || typeof connection !== 'object' || registered.has(connection)) return;
  registered.add(connection);
  owners.add(new WeakRef(connection));
};

/** impure — read current focus, pruning collected and closed socket owners. */
export const filesystemFocusRoots = () => {
  const roots = new Set();
  for (const ref of owners) {
    const connection = ref.deref();
    const state = connection?.ws?.readyState;
    if (!connection || (typeof state === 'number' && state !== 1)) {
      owners.delete(ref);
      if (connection) registered.delete(connection);
      continue;
    }
    // Closing an Explorer root revokes transient reach even before a stale
    // connection sends its next focus frame. Reuse the boundary's validator.
    const root = resolveFocusPath(connection.toolWorkspace);
    if (root) roots.add(root);
  }
  return [...roots];
};
