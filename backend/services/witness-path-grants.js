/**
 * Witness path grants — the witness's half of THE FOCUS GROUND.
 *
 * Extracted VERBATIM from witness-tools.js (size law, SIZE breakdown
 * 2026-08-26): grant hydration, the grant landing at every layer, and the
 * scope gate for one filesystem-shaped witness call. witness-tools.js
 * orchestrates; this module never imports it (direction law).
 */
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { ACT_REFUSALS } from './act-gate.js';
import { focusGroundRoots } from './focus-ground.js';
import { ensureFilesystemRoots } from './mcp-filesystem.js';
import {
  findUngrantedReadPaths, findUngrantedWritePaths, normalizeToolArgs, resolveGrantDir,
} from './sandbox-path-policy.js';
import { requestToolApproval } from './tool-approval.js';
import {
  addGrantedReadRoot, addGrantedWriteRoot, normalizeToolMode, READ_TOOLS,
} from './tool-policy.js';
import { isWriteOperation } from './tool-sandbox.js';
import { sendToolEvent } from './witness-tool-events.js';
import { capturePolicyGrant } from './policy-grant-context.js';
import { createLogger } from './logger.js';

const log = createLogger('WitnessPathGrants');

// ---------------------------------------------------------------------------
// Path scope — the witness's half of THE FOCUS GROUND. Reach is: its own lane,
// the focus ground (the folder open in the operator's Explorer), and past
// operator grants. Inside that, MODE alone decides whether an act asks.
// Outside it, the SAME treatment a neuma gets: a scoped card naming the
// directory a yes opens, ALLOW for the session, ALWAYS to persist — revocable
// like any grant. Before this, an out-of-lane path hit the sandbox wall with
// no way to ask — a peer reporting itself blind instead of requesting access.
// ---------------------------------------------------------------------------

// impure — carry the operator's past grants onto this connection, once. Without
// this a witness's ALWAYS from a previous session is on disk and nowhere else,
// so it asks again for a folder already granted.
export const hydrateWitnessPathGrants = async (connection, lanePolicy) => {
  if (connection._pathGrantsHydrated) return;
  connection._pathGrantsHydrated = true;
  const read = Array.isArray(lanePolicy?.pathGrants?.read) ? lanePolicy.pathGrants.read : [];
  const write = Array.isArray(lanePolicy?.pathGrants?.write) ? lanePolicy.pathGrants.write : [];
  connection._grantedReadRoots = [...new Set([...(connection._grantedReadRoots || []), ...read])];
  connection._grantedWriteRoots = [...new Set([...(connection._grantedWriteRoots || []), ...write])];
  connection._sensitiveGrants = lanePolicy?.sensitiveGrants || {};
  connection._shellNetwork = connection._shellNetwork === true || lanePolicy?.shellNetwork === true;
  const all = [...new Set([...connection._grantedReadRoots, ...connection._grantedWriteRoots])];
  if (all.length > 0) await ensureFilesystemRoots(all).catch(() => {});
};

// impure — land a grant at every layer that could refuse it (connection roots,
// the filesystem server, and for an ALWAYS the lane's persisted policy).
const grantPathScope = async (connection, dirs, { write, persist, origin }) => {
  origin.beforeCommit();
  const key = write ? '_grantedWriteRoots' : '_grantedReadRoots';
  connection[key] = [...new Set([...(connection[key] || []), ...dirs])];
  await ensureFilesystemRoots(dirs).catch((error) => log.warn('Filesystem root grant failed', { error: error.message }));
  origin.beforeCommit();
  if (!persist) return;
  const laneId = origin.laneId;
  if (!laneId) return;
  try {
    const addRoot = write ? addGrantedWriteRoot : addGrantedReadRoot;
    await neumaWorkspace.updateToolPolicy(laneId,
      (policy) => dirs.reduce((current, dir) => addRoot(current, dir), policy), origin);
  } catch (error) {
    origin.beforeCommit();
    log.warn('Path grant not persisted; session only', { laneId, error: error.message });
  }
};

/**
 * impure — the scope gate for one filesystem-shaped witness call. Returns true
 * when the call may proceed (in scope already, or the operator just opened the
 * scope), false when it was refused. Hard-denied paths never reach here as
 * gaps: findUngranted* returns only GRANTABLE ones, so .env, keys and another
 * being's DNA still fail closed at the sandbox without ever offering a button.
 */
export const witnessPathScopeGate = async (ws, connection, identity, args) => {
  const origin = capturePolicyGrant(connection);
  const laneId = connection.companion?.neumaId;
  if (!laneId) return true;
  const write = isWriteOperation(identity.toolName);
  if (!write && !READ_TOOLS.has(identity.toolName)) return true;

  let laneRoot;
  try { laneRoot = neumaWorkspace.pathFor(laneId); } catch { laneRoot = null; }
  const roots = [
    ...(laneRoot ? [laneRoot] : []),
    ...focusGroundRoots(connection),
    ...(connection._grantedWriteRoots || []), // write scope implies read
    ...(write ? [] : (connection._grantedReadRoots || [])),
  ];
  const normalized = normalizeToolArgs(identity.toolName, args, null);
  const gaps = write
    ? findUngrantedWritePaths(normalized, roots)
    : findUngrantedReadPaths(normalized, roots);
  if (gaps.length === 0) return true;

  const scopeDirs = [...new Set(await Promise.all(
    gaps.map((p) => resolveGrantDir(identity.toolName, p)),
  ))];
  const tool = `${identity.server}/${identity.toolName}`;
  const scope = `${write ? 'write' : 'read'} access to ${scopeDirs.join(', ')}`;

  // A READ widening follows the mode: `auto` is the operator's standing yes, so
  // it grants for the session and SAYS so (a widened reach is never silent). A
  // WRITE widening always asks, even on auto — auto governs acting on reach
  // already held, never the acquisition of new write reach into the operator's
  // own files. Inside the focus ground none of this runs at all.
  if (!write && normalizeToolMode(connection.toolMode) === 'auto') {
    await grantPathScope(connection, scopeDirs, { write: false, persist: false, origin });
    sendToolEvent(ws, connection.companion, {
      tool, status: 'ok', summary: `${scope} — granted (auto mode)`,
    });
    return true;
  }

  const decision = await requestToolApproval(connection, {
    tool, args, scope, signal: origin.signal,
  });
  if (decision === 'allow' || decision === 'always') {
    await grantPathScope(connection, scopeDirs, { write, persist: decision === 'always', origin });
    return true;
  }
  const refusal = ACT_REFUSALS[decision] || ACT_REFUSALS.deny;
  sendToolEvent(ws, connection.companion, {
    tool, status: 'denied', summary: `${identity.toolName} — ${refusal.summary}`,
  });
  return false;
};
