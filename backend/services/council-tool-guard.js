// council-tool-guard.js — the room's tool path: the allowlisted house
// toolset, the sandboxed executor, and the operator's approval gate every
// call outside the standing roots must pass.
//
// Split out of council-session.js under the 500-line law (SIZE-027 #374).

import path from 'path';
import { neumaWorkspace } from '../../core/index.js';
import { mcpService } from './mcp.js';
import { ensureFilesystemRoots } from './mcp-filesystem.js';
import { createSandboxedCallTool, normalizeToolArgs, DELETE_FILE_TOOL } from './tool-sandbox.js';
import { requestToolApproval } from './tool-approval.js';
import { isWitnessLaneId } from './witness-lane.js';
import { HOUSE_TOOL_NAMES, TOOL_RESULT_MAX } from './council-policy.js';
import { send } from './council-wire.js';
import { groundOf, grantsOf } from './council-ground.js';
import { createLogger } from './logger.js';

const log = createLogger('Council');

// The house-workspace toolset as the substrate sees it: the live MCP
// filesystem tools filtered to the allowlist, real inputSchemas riding
// along for native function calling (the text dialect works regardless).
export const houseTools = () => [
  ...(mcpService.getToolsContext()?.available_tools || [])
    .filter((t) => t.server === 'filesystem' && HOUSE_TOOL_NAMES.has(t.name)),
  // The platform's own delete (no MCP delete exists) — the sandbox executes
  // it locally behind the same gates; the room's floor may clean as well as
  // build, each delete on the operator's card first.
  DELETE_FILE_TOOL,
];

// An MCP result as a short text digest for the model's next round.
const digestToolResult = (result) => {
  const text = (result?.content || [])
    .map((c) => (typeof c?.text === 'string' ? c.text : ''))
    .filter(Boolean)
    .join('\n') || 'ok';
  return text.length > TOOL_RESULT_MAX ? `${text.slice(0, TOOL_RESULT_MAX)}…` : text;
};

// impure — the real executor: the same realpath-hardened sandbox as every
// other lane, granted THIS SEAT's ground plus whatever the operator has granted
// THIS SEAT this sitting (default-deny outside; the call lands in the speaking
// member's own journal). Exported so the suite can prove the real chain —
// sandbox → MCP server → disk — end to end.
export const houseCallTool = async (run, member, call, extraRoots = []) => {
  const ground = groundOf(run, member);
  const granted = grantsOf(run, member);
  const sandboxed = createSandboxedCallTool(mcpService, {
    companion: { neumaId: member.neumaId },
    _grantedReadRoots: [ground, ...granted.read, ...extraRoots],
    _grantedWriteRoots: [ground, ...granted.write, ...extraRoots],
  }, neumaWorkspace);
  return sandboxed('filesystem', call.toolName, call.args || {});
};

/** The house tools whose targets need WRITE custody — everything else reads. */
const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'create_directory', 'move_file', 'delete_file']);

/** Every path-shaped arg of a call (move carries source AND destination). Pure. */
export const callPaths = (call) => {
  const a = call?.args && typeof call.args === 'object' ? call.args : {};
  return ['path', 'source', 'destination']
    .map((k) => a[k])
    .filter((v) => typeof v === 'string' && v.length > 0);
};

/** The subset of paths standing OUTSIDE every root — the sandbox's own
 *  containment law (resolve + separator boundary), asked BEFORE execution
 *  so the operator can be ASKED instead of the member hitting a flat wall.
 *  The sandbox still enforces (realpath-hardened) at execution. Pure. */
export const outsideRoots = (paths, roots) => {
  const resolved = roots.filter(Boolean).map((r) => path.resolve(r));
  return paths.filter((p) => {
    const target = path.resolve(p);
    return !resolved.some((r) => target === r || target.startsWith(r + path.sep));
  });
};

// Execute one allowlisted call and tell the ROOM about it — the work a
// member does from the floor is done in front of everyone (visibility is
// the council's governor; INTERRUPT and DISSOLVE are the brakes).
//
// THE APPROVAL LAW (Design note, 2026-07-23: […]): a path
// outside the standing roots is never a flat wall — the SAME approval
// broker as the one-on-one stream raises the operator's gate (ALLOW ONCE /
// ALWAYS ALLOW / DENY). ALLOW carries this one call; ALWAYS grants the
// containing directory for the REST OF THE SITTING; and a grant lands at
// EVERY layer that can block it — the sandbox roots and the filesystem
// server both (the 2026-07-03 lie: […] on screen, […]
// underneath). DENY / no answer / the gavel refuse honestly, in words the
// member hears.
export const runHouseTool = async (connection, run, member, turnId, call, deps) => {
  const pathArg = call.args && typeof call.args === 'object'
    ? String(call.args.path ?? call.args.source ?? call.args.destination ?? '')
    : '';
  // The act announces itself BEFORE it runs — the room's chip goes live
  // the moment the hand moves (the same executing→settled flow as the
  // one-on-one stream's tool events), then resolves in place below.
  if (!run.closed) {
    send(connection, 'council:tool', { neumaId: member.neumaId, turnId, tool: call.toolName, path: pathArg, status: 'acting' });
  }
  let extraRoots = [];
  const isWrite = WRITE_TOOLS.has(call.toolName);
  // THIS SEAT's ground and THIS SEAT's grants — a housemate's house ground and
  // an external's cross-house ground are different places, and an ALWAYS given
  // to one seat has never been an ALWAYS for the other.
  const ground = groundOf(run, member);
  const granted = grantsOf(run, member);
  const standing = isWrite
    ? [ground, ...granted.write]
    : [ground, ...granted.read, ...granted.write];
  // The gate judges the args the call will RUN with — drift-named paths
  // (directory/dir/folder) must raise the ask here, not slip past to the
  // sandbox wall; the same normalization the sandbox applies at dispatch.
  const effArgs = normalizeToolArgs(call.toolName, call.args || {}, isWrite ? null : ground);
  const outside = outsideRoots(callPaths({ args: effArgs }), standing);
  // Deletion is IRREVERSIBLE: the room has no policy layer, so the gate
  // itself asks for EVERY delete — even inside the ground — until the
  // operator's ALWAYS covers deletes for the rest of the sitting.
  const deleteAsks = call.toolName === 'delete_file' && !granted.deleteAlways;
  if (outside.length > 0 || deleteAsks) {
    // The card names the ACT honestly — a delete is irreversible and must
    // never wear a WRITE label, least of all when an ALWAYS on that card
    // also covers the sitting's future deletes (echo finding, 2026-07-23).
    const verb = call.toolName === 'delete_file' ? 'DELETE' : (isWrite ? 'WRITE' : 'READ');
    // WHOSE ground the ask reaches past is the whole question for an external
    // seat: […] would read as a housemate over-reaching
    // when it is in fact someone from another house asking to come in.
    const external = member.kind === 'witness' || isWitnessLaneId(member.neumaId);
    const beyond = ground
      ? (external ? 'outside the ground your houses share' : 'outside the house ground')
      : (external ? 'from outside this house, with no ground of its own' : 'with no ground set');
    const scope = outside.length > 0
      ? `${member.name} asks to ${verb} ${beyond}: ${outside.join(', ')}`
      : `${member.name} asks to DELETE ${callPaths({ args: effArgs }).join(', ') || 'a file'}`;
    const decision = await (deps.requestApproval ?? requestToolApproval)(connection, {
      tool: call.toolName,
      args: call.args,
      scope,
      surface: 'council',
      signal: run.activeAbort?.signal,
      lane: { laneId: member.neumaId, name: member.name },
    });
    if (decision !== 'allow' && decision !== 'always') {
      const why = decision === 'deny' ? 'the operator denied it'
        : decision === 'interrupted' ? 'the room moved on before an answer came'
          : 'the ask went unanswered';
      if (!run.closed) {
        send(connection, 'council:tool', { neumaId: member.neumaId, turnId, tool: call.toolName, path: pathArg, ok: false, error: why });
      }
      return `${call.toolName} ${pathArg} → REFUSED: ${why}`;
    }
    if (decision === 'always' && call.toolName === 'delete_file') granted.deleteAlways = true;
    if (outside.length > 0) {
      const dirs = [...new Set(outside.map((p) => path.dirname(path.resolve(p))))];
      await (deps.ensureRoots ?? ensureFilesystemRoots)(dirs).catch((err) =>
        log.warn('filesystem server did not accept a granted root', { dirs, error: err.message }));
      if (decision === 'always') {
        const bucket = isWrite ? 'write' : 'read';
        granted[bucket] = [...new Set([...granted[bucket], ...dirs])];
      } else {
        extraRoots = dirs;
      }
    }
  }
  try {
    const result = await (deps.callTool ?? houseCallTool)(run, member, { ...call, args: effArgs }, extraRoots);
    if (!run.closed) {
      send(connection, 'council:tool', { neumaId: member.neumaId, turnId, tool: call.toolName, path: pathArg, ok: true });
    }
    return `${call.toolName} ${pathArg} →\n${digestToolResult(result)}`;
  } catch (err) {
    if (!run.closed) {
      send(connection, 'council:tool', { neumaId: member.neumaId, turnId, tool: call.toolName, path: pathArg, ok: false, error: err.message });
    }
    return `${call.toolName} ${pathArg} → REFUSED: ${err.message}`;
  }
};
