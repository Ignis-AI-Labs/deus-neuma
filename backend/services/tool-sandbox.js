/**
 * Tool Sandbox — Wraps MCP tool calls with security constraints
 *
 * Path restrictions, write budgets, read size limits, and audit logging.
 * Replaces direct mcpService.callTool() in portal-stream.js.
 *
 * The pure path-policy half (denied patterns, path-arg handling, arg
 * normalization, checkPathAccess, realpath handling, grant scoping) lives in
 * sandbox-path-policy.js (size law, SIZE breakdown 2026-08-26) and is
 * re-exported below so every existing reader stands unchanged.
 */

import path from 'path';
import fs from 'fs/promises';
import { createLogger } from './logger.js';
import {
  checkPathAccess, collectPathArgs, isWithinRoots, laneStateWriteReason, moveDestination,
  normalizeToolArgs, realpathOfNearestExisting,
} from './sandbox-path-policy.js';
import { focusGroundRoots } from './focus-ground.js';
import { redactArgs } from './audit-redact.js';
import { recordAct } from './act-ledger.js';
import { writePayloadBytes, checkWorkspaceBudget } from './write-metering.js';
import { encodingWallReason } from './text-encoding-law.js';
import { PLATFORM_HANDS, runPlatformHand } from './platform-hands.js';
import { withFileSight } from './fs-sight.js';
import { resolveCeremonyScratchDir, ceremonyWriteRoots } from '../../core/birth/ceremony-write.js';
import { requestablePattern, sensitiveGrantCovers } from './sensitive-grants.js';
import { codingShellMutationReason } from './coding-shell-paths.js';
import { claimFiledIntent } from './intents/intent-owners.js';
import { amendIdentityRecord, identityWriteFor } from './identity-record-writes.js';
import { getWitnessesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getHarnessRoot } from '../../core/workspace/lane-grounds.js';
import { isOtherHouse } from './explorer-walls.js';
import { withReadGrants } from './fs-read-clearance.js';

const log = createLogger('ToolSandbox');

// Destructive tools the sandbox bans outright, independent of the policy layer.
// delete_file left this set on 2026-07-23 (Founder: every coding agent has delete;
// its absence made a being FAKE deletions by overwriting files and telling the
// operator the folder was clean) — it now executes LOCALLY below, behind every
// confinement check plus an approval-required policy default. The set stays as
// the mechanism for any future tool that must never run at all.
const DENIED_TOOLS = new Set([]);

/** delete_file is the platform's OWN tool — the reference MCP filesystem
 *  server exposes no delete, so the sandbox executes it locally (unlink,
 *  files only) behind the same confinement, budget, and approval gates as
 *  every write. Advertised beside the MCP set on every surface. */
export const DELETE_FILE_TOOL = Object.freeze({
  server: 'filesystem',
  name: 'delete_file',
  description: 'Delete ONE file (not a directory). Irreversible — your operator approves each delete until they grant ALWAYS.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({ path: Object.freeze({ type: 'string', description: 'Absolute path of the file to delete' }) }),
    required: Object.freeze(['path']),
  }),
});

// The path-policy pures moved to sandbox-path-policy.js; this barrel keeps
// every existing importer of tool-sandbox.js standing unchanged.
export {
  deniedPatternsFor, matchesDeniedPattern, laneStateWriteReason, moveDestination, collectPathArgs,
  normalizeToolArgs, checkPathAccess, realpathOfNearestExisting,
  resolveGrantDir, isWithinRoots, findUngrantedReadPaths,
  findUngrantedWritePaths, writeGrantScope,
} from './sandbox-path-policy.js';

// impure (reads the current roots) — every ground that holds lanes, wherever
// the house stands: the beings', the witnesses' and the harness lanes'.
const laneGrounds = () => {
  const house = getWorkspacesRoot();
  return [house, getWitnessesRoot(), getHarnessRoot(house)];
};

const MAX_WRITE_OPS_PER_SESSION = 10;
const MAX_READ_SIZE_BYTES = 1024 * 1024; // 1MB

/**
 * Track and enforce write operation budget per session.
 * @param {Object} connection - Portal connection object (tracks _writeOps counter)
 * @returns {{ allowed: boolean, remaining: number }}
 */
export const checkWriteBudget = (connection) => {
  const count = connection._writeOps || 0;
  if (count >= MAX_WRITE_OPS_PER_SESSION) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: MAX_WRITE_OPS_PER_SESSION - count };
};

/**
 * Increment the write operation counter on a connection.
 * @param {Object} connection - Portal connection object
 */
export const recordWrite = (connection) => {
  connection._writeOps = (connection._writeOps || 0) + 1;
};

/**
 * Determine if a tool call is a write operation.
 * @param {string} toolName - Tool name
 * @returns {boolean}
 */
export const isWriteOperation = (toolName) => {
  const writeTools = ['write_file', 'edit_file', 'create_file', 'create_directory', 'move_file', 'rename_file', 'copy_file', 'delete_file', 'write', 'edit'];

  return writeTools.includes(toolName);
};

/**
 * The SENSITIVE-GRANT DOOR (ruling, 2026-08-18): a denied-pattern refusal is a
 * wall only while no grant covers it. Returns null when the lane's grant
 * covers the path for the direction (read for reads, edit for writes — write
 * tools require edit on every path they touch, source included, because a
 * move is destructive to its source), else the refusal reason — with the
 * recourse named when the pattern is requestable at all. The never-requestable
 * set (another being's state, .git, keys, owner.json, the policy file) stays
 * a wall no grant can lift. Pure over the connection's grant set.
 */
const sensitiveDeniedReason = (connection, isWrite, filePath, pathCheck) => {
  const tier = isWrite ? 'edit' : 'read';
  const recourse = pathCheck.deniedPattern && requestablePattern(pathCheck.deniedPattern);
  if (recourse && sensitiveGrantCovers(connection._sensitiveGrants, tier, filePath)) return null;
  return pathCheck.reason + (recourse ? ' — request access with request_file_access' : '');
};

/**
 * Create a sandboxed tool call wrapper.
 * Checks path access, write budget, and logs to neuma journal.
 * @param {Object} mcpService - MCP service instance
 * @param {Object} connection - Portal connection object
 * @param {Object} neumaWorkspace - Neuma workspace service
 * @returns {Function} sandboxedCallTool(serverName, toolName, args) → Promise<result>
 */
export const createSandboxedCallTool = (mcpService, connection, neumaWorkspace) => {
  return async (serverName, toolName, args) => {
    const neumaId = connection.companion?.neumaId;
    const isWrite = isWriteOperation(toolName);

    // 0. Hard-deny destructive tools in the sandbox itself — never rely solely
    // on the policy layer for irreversible operations.
    if (DENIED_TOOLS.has(toolName)) {
      await logToolCall(neumaWorkspace, neumaId, serverName, toolName, args, 'denied', 'Tool is denied');
      throw new Error(`Tool denied: ${toolName}`);
    }

    // 1. Path confinement (AI-SEC-002). Writes are ALWAYS confined — roots from
    // core/birth/ceremony-write (lane + ceremony scratch during birth) PLUS
    // operator write grants. Denied-path list and delete_file ban fire first.
    // EVERY path arg is checked (move/rename carry source AND destination).
    let workspaceRoot = null;
    if (neumaId && neumaWorkspace) {
      // Engine-resolved: a witness lane's ground is BESIDE the house, and a
      // hand-join here would confine the lane to a directory that no longer
      // exists. Invalid ids stay fail-closed (no root, nothing widens).
      try { workspaceRoot = neumaWorkspace.pathFor(neumaId); } catch { workspaceRoot = null; }
    }
    const grantedReadRoots = Array.isArray(connection._grantedReadRoots) ? connection._grantedReadRoots : [];
    const grantedWriteRoots = Array.isArray(connection._grantedWriteRoots) ? connection._grantedWriteRoots : [];
    const writeRoots = ceremonyWriteRoots({
      laneRoot: workspaceRoot,
      scratchDir: resolveCeremonyScratchDir(process.cwd()),
      birthActive: Boolean(connection.birthSession),
    });
    // The ASSIGNED TEAM WORKSPACE (#171): while a plan with a workspace is
    // the plan of record, EVERY write is confined to that one root — the
    // lane, ceremony scratch, and operator grants are not writable arenas
    // during confined team work. Reads gain the workspace root and keep
    // their existing reach (the team may read the house's context).
    const teamWs = connection._teamWorkspace && typeof connection._teamWorkspace.root === 'string'
      ? connection._teamWorkspace : null;
    // THE FOCUS GROUND (ruling, 2026-07-26): the folder standing open in the
    // operator's Explorer is reach for whoever is seated on this connection —
    // neuma and sealed witness alike, since both arrive through this one
    // factory. It joins reads AND writes: […] is not a read-only sentence. A confined team workspace still wins
    // for writes — a plan of record deliberately narrows to one root, and
    // focus must not quietly widen work the team agreed to confine. Reads keep
    // the ground either way. The denied-path list above fires first, in the
    // ground as anywhere: focus never opens .env, keys, or another being's DNA.
    const focusRoots = focusGroundRoots(connection);
    // THE ACT CHANNEL stays open (ruling, 2026-10-10): a being acts by filing an intent into its own
    // lane's intents/, and intent-sweep.js gates every act there — policy, approval, refusal. An
    // approved team plan confined the lead's writes to the team workspace and so took its hands:
    // it could not file the next act, a new plan, or a team run, and the sprint stalled.
    const intentsDir = workspaceRoot ? path.join(workspaceRoot, 'intents') : null;
    const roots = isWrite
      ? (teamWs ? [teamWs.root, ...(intentsDir ? [intentsDir] : [])] : [...writeRoots, ...grantedWriteRoots, ...focusRoots])
      : ((workspaceRoot || teamWs || focusRoots.length > 0)
        ? [...(workspaceRoot ? [workspaceRoot] : []), ...(teamWs ? [teamWs.root] : []), ...grantedReadRoots, ...grantedWriteRoots, ...focusRoots]
        : []);
    // Arg drift heals BEFORE confinement, so the checks judge the path the
    // call will actually run with — and the MCP schema never refuses a call
    // whose intent was legible (search_files with no path, live 2026-07-23).
    args = normalizeToolArgs(toolName, args, isWrite ? null : (roots[0] ?? null));
    const pathArgs = collectPathArgs(args);
    const filesIntent = isWrite && Boolean(intentsDir) && pathArgs.length > 0
      && pathArgs.every((p) => isWithinRoots(p, [intentsDir]));
    // A write never reaches a lane's platform state (laneStateWriteReason): the
    // being's own lane as its engine resolved it, and every lane in every ground.
    const grounds = isWrite ? laneGrounds() : [];
    const guardPlatformState = async (filePath, laneRoot, laneGroundRoots = grounds) => {
      if (!isWrite) return;
      const reason = await codingShellMutationReason(filePath, laneRoot)
        ?? laneStateWriteReason(filePath, { grounds: laneGroundRoots, lanes: laneRoot ? [laneRoot] : [] });
      if (!reason) return;
      await logToolCall(neumaWorkspace, neumaId, serverName, toolName, args, 'denied', reason);
      throw new Error(reason);
    };
    // ANOTHER HOUSE (explorer-walls.js): a focus or a grant may cover the whole house or the realm,
    // but another wallet's lanes and realm dir are never read or written from this connection —
    // the operator's own explorer holds the same wall. The being's own lane is always its own.
    const reader = String(connection.walletAddress || '').toLowerCase();
    const guardOtherHouse = async (filePath, laneRoot) => {
      if ((laneRoot && isWithinRoots(filePath, [laneRoot])) || !isOtherHouse(path.resolve(filePath), reader)) return;
      const reason = 'That path is another house\'s data — it is never yours to read or write.';
      await logToolCall(neumaWorkspace, neumaId, serverName, toolName, args, 'denied', reason);
      throw new Error(reason);
    };
    // A write with no recognizable path arg must fail closed — confinement can't
    // be name-guessing. Without this, a write tool whose path uses a key outside
    // PATH_ARG_KEYS would dispatch unconfined (bounded only by the MCP server's
    // own project root). Reads with no path remain fine (denied-paths still apply).
    if (isWrite && pathArgs.length === 0) {
      await logToolCall(neumaWorkspace, neumaId, serverName, toolName, args, 'denied', 'Write requires a recognized path argument');
      throw new Error('Write requires a recognized path argument');
    }
    // THE TEAM ROOM (<team workspace>/.team/, team-channel.js) is the
    // platform's record of what the team said and finished: members read it,
    // and speak by filing team/post — no member's write lands there.
    if (isWrite && teamWs && pathArgs.some((p) => isWithinRoots(p, [path.join(teamWs.root, '.team')]))) {
      const reason = 'The team room (.team/) is the platform\'s record — read it; to post to your team, file a team/post intent.';
      await logToolCall(neumaWorkspace, neumaId, serverName, toolName, args, 'denied', reason);
      throw new Error(reason);
    }
    for (const p of pathArgs) {
      await guardPlatformState(p, workspaceRoot);
      await guardOtherHouse(p, workspaceRoot);
      const pathCheck = checkPathAccess(p, roots, { requireRoot: isWrite });
      if (!pathCheck.allowed) {
        const reason = sensitiveDeniedReason(connection, isWrite, p, pathCheck);
        if (reason === null) {
          await logToolCall(neumaWorkspace, neumaId, serverName, toolName, args, 'granted', `sensitive ${isWrite ? 'edit' : 'read'} grant honored`);
          continue;
        }
        await logToolCall(neumaWorkspace, neumaId, serverName, toolName, args, 'denied', reason);
        throw new Error(reason);
      }
    }

    // 1b. Realpath containment re-check (SEC-032): the lexical checks are
    // defeated by a symlink planted inside an allowed root, so the SAME checks
    // re-run on the symlink-resolved path (roots realpath'd too). The sensitive
    // grant door applies here identically.
    for (const p of pathArgs) {
      const real = await realpathOfNearestExisting(p);
      const realLane = workspaceRoot ? await realpathOfNearestExisting(workspaceRoot) : null;
      await guardPlatformState(real, realLane, await Promise.all(grounds.map(realpathOfNearestExisting)));
      await guardOtherHouse(real, realLane);
      if (real === path.resolve(p)) continue; // no link in the chain — lexical verdict stands
      const realRoots = await Promise.all(roots.map(realpathOfNearestExisting));
      const realCheck = checkPathAccess(real, [...new Set([...roots, ...realRoots])], { requireRoot: isWrite });
      if (!realCheck.allowed) {
        const granted = sensitiveDeniedReason(connection, isWrite, real, realCheck) === null;
        const reason = granted ? null : `Symlink escape: ${realCheck.reason}`;
        if (granted) {
          await logToolCall(neumaWorkspace, neumaId, serverName, toolName, args, 'granted', 'sensitive grant honored (realpath)');
          continue;
        }
        await logToolCall(neumaWorkspace, neumaId, serverName, toolName, args, 'denied', reason);
        throw new Error(reason);
      }
    }

    // A being's own DNA and soul records (identity-record-writes.js): a
    // whole-file write is carried out as an amendment at step 3; any other
    // reach for them is refused here, before the budget counts it.
    const identityWrite = isWrite ? await identityWriteFor(toolName, pathArgs, { lane: workspaceRoot, grounds }) : null;
    if (identityWrite?.refuse) {
      await logToolCall(neumaWorkspace, neumaId, serverName, toolName, args, 'denied', identityWrite.refuse);
      throw new Error(identityWrite.refuse);
    }

    // A team member's filing is its own to settle (intent-owners.js).
    if (filesIntent && connection._intentOwner) for (const p of pathArgs) claimFiledIntent(p, connection._intentOwner);

    // 1c. A MOVE MUST NOT SILENTLY DESTROY (#250): fs.rename REPLACES an
    // existing destination without a word. A rename/copy to a fresh path stays
    // autonomous; replacing an existing file has exactly ONE route: delete_file
    // first (asks the operator), then copy or move.
    const moveDest = moveDestination(toolName, args);
    if (moveDest) {
      const occupied = await fs.stat(moveDest).then(() => true).catch(() => false);
      if (occupied) {
        const reason = `Refusing to land on ${path.basename(moveDest)} — something is already there, `
          + 'and replacing it is irreversible. Delete it first (that asks your operator), then copy or move.';
        await logToolCall(neumaWorkspace, neumaId, serverName, toolName, args, 'denied', reason);
        throw new Error(reason);
      }
    }
    // 1d. THE ENCODING WALL (#290). The MCP server reads text as lossy UTF-8
    // and re-encodes on write — write_file/edit_file on a legacy-encoded file
    // replaces every non-UTF-8 byte with U+FFFD, irreversibly (measured:
    // latin1 24 B → 34 B, five characters destroyed — #239's original
    // destruction, on the lane a being uses). The server cannot know, so the
    // platform refuses first, behind containment like every wall above.
    if (toolName === 'write_file' || toolName === 'edit_file') {
      const wall = await encodingWallReason(path.resolve(String(args.path || '')));
      if (wall) {
        await logToolCall(neumaWorkspace, neumaId, serverName, toolName, args, 'denied', wall);
        throw new Error(wall);
      }
    }

    // 2. Check write budget — only the being's OWN lane is metered (10/session);
    // writes fully inside operator-granted folders or the focus ground are
    // governed by that consent, not the cap.
    if (isWrite && teamWs) {
      // Team-workspace writes are governed by the BYTE budget, not the
      // 10-op session cap — a team assembling a real artifact writes far
      // more than ten times, and the confined root + byte meter are the
      // guardrails there. Refusals carry the honest numbers (SHINKEI).
      const bytes = writePayloadBytes(args);
      const budget = checkWorkspaceBudget(teamWs, bytes);
      if (!budget.allowed) {
        await logToolCall(neumaWorkspace, neumaId, serverName, toolName, args, 'denied', budget.reason);
        throw new Error(budget.reason);
      }
      teamWs.usedBytes = (teamWs.usedBytes || 0) + bytes;
    } else if (isWrite && filesIntent) {
      // An intent is governed by the act it files, never the 10-op cap (Design note, 2026-10-10: a being
      // running its own workflow files many) — the sweep's gate is the limit.
    } else if (isWrite) {
      // The bypass is ONLY for a write that lands entirely OUTSIDE the being's
      // own lane, in a granted folder. If a granted folder is an ancestor of the
      // lane, own-lane writes would otherwise satisfy the bypass — so exclude
      // any write touching the lane: the 10-cap stays the guardrail there.
      const touchesLane = workspaceRoot ? pathArgs.some((p) => isWithinRoots(p, [workspaceRoot])) : false;
      // The consented arenas: a folder the operator explicitly granted, and the
      // FOCUS GROUND (the folder standing open in their Explorer). Consent to
      // the arena is the governor there, not a 10-op counter — a session doing
      // real work in the operator's repository writes far more than ten times,
      // and a cap that stops it on the eleventh edit is friction, not safety.
      // The cap stays exactly where it was meant to be: the being authoring
      // inside its OWN lane.
      const consentedRoots = [...grantedWriteRoots, ...focusRoots];
      const consentedWrite = !touchesLane && consentedRoots.length > 0
        && pathArgs.every((p) => isWithinRoots(p, consentedRoots));
      if (!consentedWrite) {
        const budget = checkWriteBudget(connection);
        if (!budget.allowed) {
          await logToolCall(neumaWorkspace, neumaId, serverName, toolName, args, 'denied', 'Write budget exhausted');
          throw new Error('Write operation limit reached for this session');
        }
        recordWrite(connection);
      }
    }

    // 3. Execute. Two tools are the PLATFORM'S OWN HAND rather than a forward
    // to the MCP server — see platform-hands.js for why each one is — and so is
    // a being's write to its own DNA or soul record, which lands as an
    // amendment through the workspace (identity-record-writes.js). They run
    // here, strictly behind every check above and the approval policy in front
    // of the sandbox.
    if (identityWrite?.amend || PLATFORM_HANDS.has(toolName)) {
      const hand = identityWrite?.amend
        ? await amendIdentityRecord(neumaWorkspace, neumaId, identityWrite.amend, args.content)
        : await runPlatformHand(toolName, args);
      if (!hand.ok) {
        await logToolCall(neumaWorkspace, neumaId, serverName, toolName, args, 'denied', hand.reason);
        throw new Error(hand.reason);
      }
      await logToolCall(neumaWorkspace, neumaId, serverName, toolName, args, 'success', null);
      return hand.result;
    }
    // The organ judges a read's path again as it opens it, with these grants, and a search walk
    // judges each entry against this connection's house (fs-read-clearance.js).
    const ownLane = workspaceRoot ? [workspaceRoot, await realpathOfNearestExisting(workspaceRoot)] : [];
    const result = await withReadGrants(connection._sensitiveGrants, () => mcpService.callTool(serverName, toolName, args),
      { reader, lanes: ownLane });

    // 4. Check read size
    if (result && typeof result === 'string' && result.length > MAX_READ_SIZE_BYTES) {
      await logToolCall(neumaWorkspace, neumaId, serverName, toolName, args, 'truncated', 'Response exceeded size limit');
      return result.slice(0, MAX_READ_SIZE_BYTES) + '\n[TRUNCATED — exceeded 1MB limit]';
    }

    // 5. Audit log — from the REAL outcome. An MCP server reports its own
    // refusals as a normal result carrying `isError` (never a throw), so this
    // line used to record 'success' for a write the server had just refused —
    // the operator's ledger said a chosen name landed while the screen said
    // "Access denied" (walk + Aether, 2026-08-06, #272). A ledger that can
    // disagree with the wall it stands behind is not a record.
    if (result?.isError) {
      const refusal = result?.content?.[0]?.text || 'MCP server refused the call';
      await logToolCall(neumaWorkspace, neumaId, serverName, toolName, args, 'error', String(refusal).slice(0, 300));
      return result;
    }
    await logToolCall(neumaWorkspace, neumaId, serverName, toolName, args, 'success', null);

    // 6. AN IMAGE READ BECOMES SIGHT (Design note, 2026-08-29: […]). This is the one place the filesystem's image bytes meet
    // the eye — see fs-sight.js for why they never met before. The lane is the
    // BEING'S OWN, taken from the connection and never from a tool argument:
    // sight is lane-isolated, and a model must not be able to name someone
    // else's lane. A read with no image in it is returned untouched.
    return withFileSight(result, neumaId ?? null);
  };
};

// Exported for the portal's approval gates: an operator deny at the ask-card
// is as much the being's history as a sandbox wall — the append-only journal
// records both, or the being cannot trust its own account of what happened.
//
// The ARGS ride the entry, redacted (`audit-redact.js`). Until 2026-07-26 this
// function accepted `args` and dropped them, so the ledger could say that
// `write_file` ran and never which path it wrote — an audit trail that cannot
// answer […] is a log, not a trail. Secrets are screened out
// before anything lands, by key and by shape, because a journal entry is
// durable and feeds recall.
export const logToolCall = async (neumaWorkspace, neumaId, server, tool, args, status, reason) => {
  // The OPERATOR's copy, first and unconditionally (SEC-035 #213). The journal
  // entry below is the being's own account of itself, encrypted in its own
  // lane; this line is the second, independent record — metadata only — so
  // […] never has to be answered by
  // asking the party in question. It runs even when there is no lane to
  // journal into, because an act with no attributable lane is exactly the kind
  // an operator most needs to see.
  recordAct({
    laneId: neumaId || null,
    tool: `${server}/${tool}`,
    args,
    // 'auto' here means the act reached execution without a refusal — it does
    // not claim an approval was granted. A granted approval writes its own
    // line at the gate, so consent is visible as its own event or not at all.
    decision: status === 'denied' ? 'denied' : 'auto',
    status,
  });
  if (!neumaId || !neumaWorkspace) return;
  try {
    const redacted = redactArgs(args);
    await neumaWorkspace.addJournalEntry(neumaId, {
      type: 'tool_call',
      content: `${server}/${tool} — ${status}${reason ? `: ${reason}` : ''}`,
      significance: status === 'denied' ? 0.8 : 0.2,
      metadata: { server, tool, status, reason, ...(redacted ? { args: redacted } : {}) },
    });
  } catch (err) {
    // Audit logging is non-blocking, but never silent (Rule 3): a failed
    // deny-log on a security path must surface, not vanish.
    log.error('Tool audit log failed', { neumaId, server, tool, status, error: err.message });
  }
};
