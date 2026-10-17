/**
 * PATH-GRANT PLUMBING — landing an operator's yes at EVERY layer that can
 * block it: the connection (sandbox roots), the filesystem server
 * (reconnected with the root), and — for an ALWAYS — the neuma's own
 * persisted policy. A grant that only touches one layer is the lie the
 * operator saw on 2026-07-03: "ALWAYS ALLOWED" on screen, "failed"
 * underneath.
 *
 * Extracted VERBATIM from the tool loop (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 9 / #278) — side-state
 * services the loop consults, separable from the gate ordering the loop
 * itself enforces. Leaf module: imports shared leaves only, never the loop,
 * never portal-stream.
 */
import { createLogger } from './logger.js';
import { neumaWorkspace } from '../../core/index.js';
import { readProjectStore } from './user-projects.js';
import { ensureFilesystemRoots } from './mcp-filesystem.js';
import { addGrantedReadRoot, addGrantedWriteRoot } from './tool-policy.js';
import { hydrateShellNetwork } from './shell-network-grants.js';
import { capturePolicyGrant } from './policy-grant-context.js';

const log = createLogger('Portal');

// impure — hydrate the connection's read-scope grants from the neuma's
// persisted policy (once per connection), and widen the filesystem server so
// a persisted grant is honored on the very first call of a new session.
export const hydratePathGrants = async (connection, neumaPolicy) => {
  hydrateShellNetwork(connection, neumaPolicy);
  if (connection._pathGrantsHydrated) return;
  connection._pathGrantsHydrated = true;
  const persistedRead = Array.isArray(neumaPolicy?.pathGrants?.read) ? neumaPolicy.pathGrants.read : [];
  const persistedWrite = Array.isArray(neumaPolicy?.pathGrants?.write) ? neumaPolicy.pathGrants.write : [];
  connection._grantedReadRoots = [...new Set([...(connection._grantedReadRoots || []), ...persistedRead])];
  connection._grantedWriteRoots = [...new Set([...(connection._grantedWriteRoots || []), ...persistedWrite])];
  // Sensitive grants hydrate here; network consent is refreshed above even
  // when path hydration already ran, so durable revocation cannot stay sticky.
  connection._sensitiveGrants = neumaPolicy?.sensitiveGrants || {};
  // Widen the filesystem server for BOTH so a persisted grant is honored on the
  // very first call of a new session (write scope also needs the server rooted).
  const allDirs = [...new Set([...connection._grantedReadRoots, ...connection._grantedWriteRoots])];
  if (allDirs.length > 0) {
    await ensureFilesystemRoots(allDirs).catch((err) =>
      log.warn('Filesystem server not widened for persisted path grants', { err: err.message }));
  }
};

// impure — land a read-scope grant at EVERY layer that can block it: the
// connection (sandbox), the filesystem server (reconnected with the root),
// and — for an ALWAYS — the neuma's own persisted policy. A grant that only
// touches one layer is the lie the operator saw on 2026-07-03: […] on screen, […] underneath.
export const grantReadScope = async (connection, dirs, persist, origin = capturePolicyGrant(connection)) => {
  origin.beforeCommit();
  const current = connection._grantedReadRoots || [];
  connection._grantedReadRoots = [...new Set([...current, ...dirs])];
  await ensureFilesystemRoots(dirs).catch((err) =>
    log.warn('Filesystem server did not accept a granted root', { dirs, err: err.message }));
  origin.beforeCommit();
  if (!persist) return;
  const neumaId = origin.laneId;
  if (!neumaId) return;
  try {
    await neumaWorkspace.updateToolPolicy(neumaId,
      (policy) => dirs.reduce((current, dir) => addGrantedReadRoot(current, dir), policy), origin);
  } catch (err) {
    origin.beforeCommit();
    log.warn('Read-scope grant not persisted — holds for this session only', { dirs, err: err.message });
  }
};

// impure — land a WRITE-scope grant at every layer that can block it, exactly
// as grantReadScope does for reads: the connection (sandbox write roots), the
// filesystem server (reconnected with the root), and — for an ALWAYS — the
// neuma's persisted policy (pathGrants.write). A write grant is a deliberate
// escalation, only ever reached for a folder inside the active project (the
// gate enforces that bound); the sandbox denied-path list still fires first.
export const grantWriteScope = async (connection, dirs, persist, origin = capturePolicyGrant(connection)) => {
  origin.beforeCommit();
  const current = connection._grantedWriteRoots || [];
  connection._grantedWriteRoots = [...new Set([...current, ...dirs])];
  await ensureFilesystemRoots(dirs).catch((err) =>
    log.warn('Filesystem server did not accept a granted write root', { dirs, err: err.message }));
  origin.beforeCommit();
  if (!persist) return;
  const neumaId = origin.laneId;
  if (!neumaId) return;
  try {
    await neumaWorkspace.updateToolPolicy(neumaId,
      (policy) => dirs.reduce((current, dir) => addGrantedWriteRoot(current, dir), policy), origin);
  } catch (err) {
    origin.beforeCommit();
    log.warn('Write-scope grant not persisted — holds for this session only', { dirs, err: err.message });
  }
};

// impure — the folders attached to the turn's active project (its space). The
// bound on write grants: a neuma may only be granted write scope INSIDE one of
// these, never an arbitrary directory. Empty when the turn carries no project
// space or the project can't be read.
export const activeProjectFolders = async (connection) => {
  const space = connection.space;
  if (!space || space.kind !== 'project' || !connection.walletAddress) return [];
  try {
    const store = await readProjectStore(connection.walletAddress);
    const project = store.projects.find((p) => p.id === space.id);
    return project ? (project.folders || []).map((f) => f.path) : [];
  } catch (err) {
    log.warn('could not resolve project folders for write scope', { project: space.id, err: err.message });
    return [];
  }
};
