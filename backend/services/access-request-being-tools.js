// The sensitive-access REQUEST flow (ruling, 2026-08-18): a being asks for READ
// or EDIT access to a masked path — two different grants, one operator card.
//
//   request_file_access {path, tier: 'read'|'edit', reason}
//
// The card shows the path, the tier, and the being's reason — NEVER the
// file's content (the secret stays secret while the operator decides). ALLOW
// ONCE grants for the session; ALWAYS grants and persists to the lane's own
// policy (sensitiveGrants), honored from the next connection onward
// (_hydratePathGrants). The never-requestable set has no card: another
// being's sovereign state, .git internals, keys, owner.json, and the policy
// file itself are refused outright. Portal-stream owns the socket, so the
// event sender arrives as an injected port.
//
// This flow cannot ride gateAct (act-gate.js) whole: its card carries a
// hand-declared `scope`, and its ALWAYS is a sensitive path grant
// (addSensitiveGrant), not a tool-policy allow — a blanket always-allow on
// request_file_access would pre-approve every FUTURE request. What it shares
// is the refusal vocabulary (refusalResult).

import path from 'path';
import { resolvePolicy, checkToolAccess, applyToolMode, GLOBAL_DEFAULTS } from './tool-policy.js';
import { requestToolApproval } from './tool-approval.js';
import { refusalResult, refusalForDecision } from './act-gate.js';
import { addSensitiveGrant, requestablePattern, sensitiveGrantCovers } from './sensitive-grants.js';
import { checkPathAccess, resolveGrantDir } from './tool-sandbox.js';
import { ensureFilesystemRoots } from './mcp-filesystem.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { createLogger } from './logger.js';
import { capturePolicyGrant } from './policy-grant-context.js';

const log = createLogger('AccessRequest');

export const ACCESS_REQUEST_TOOL = Object.freeze({
  name: 'request_file_access',
  server: 'filesystem',
  description: 'Ask your operator for access to a sensitive file or directory — args {path, tier, reason}. tier is "read" or "edit" and they are SEPARATE grants: a read grant never confers edit. The operator sees the path, the tier, and your reason — never the file\'s content. ALLOW ONCE lasts this session; ALWAYS persists. Some paths have no card (another being\'s state, .git, keys, owner.json, the policy file) — those refuse outright.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      path: Object.freeze({ type: 'string', description: 'Absolute path to the sensitive file or directory' }),
      tier: Object.freeze({ type: 'string', enum: ['read', 'edit'], description: 'read or edit — separate grants' }),
      reason: Object.freeze({ type: 'string', description: 'Why you need it — shown to the operator' }),
    }),
    required: Object.freeze(['path', 'tier', 'reason']),
    additionalProperties: false,
  }),
});

export const isAccessRequestTool = (match) =>
  match.toolName === ACCESS_REQUEST_TOOL.name
  || String(match.tool || '').replace(/^filesystem\//, '') === ACCESS_REQUEST_TOOL.name;

const fail = (message) => {
  throw new Error(message);
};

// pure-ish — validate the request's shape against the masking law
const validateRequest = (args) => {
  const requested = args?.path;
  if (typeof requested !== 'string' || !path.isAbsolute(requested)) {
    fail('path must be an absolute path');
  }
  const tier = args?.tier;
  if (tier !== 'read' && tier !== 'edit') fail('tier must be "read" or "edit" — they are separate grants');
  const reason = typeof args?.reason === 'string' ? args.reason.trim() : '';
  if (!reason || reason.length > 300) fail('reason is required, 300 chars max — the operator reads it');
  const resolved = path.resolve(requested);
  // A path the law does not mask needs no card; a path the law walls forever
  // has none.
  const check = checkPathAccess(resolved, []);
  if (check.allowed) fail('that path is not masked — you can simply read it');
  if (!check.deniedPattern || !requestablePattern(check.deniedPattern)) {
    fail('no card exists for that path — it is not yours to have, and it is not the operator\'s to give');
  }
  return { resolved, tier, reason };
};

/**
 * Route a request_file_access call: the ACTS cascade, the argument law, the
 * operator's card, and — on a yes — the grant landing at every layer (session
 * connection, and the lane's persisted policy on ALWAYS). Never the MCP path.
 * @returns {Promise<{tool: string, status: string, content?: string, error?: string}>}
 */
// impure
export const handleAccessRequestTool = async (ws, connection, neumaPolicy, toolMode, match, args, ports) => {
  const tool = 'filesystem/request_file_access';
  const { companion } = connection;
  const origin = capturePolicyGrant(connection);
  const policy = resolvePolicy(GLOBAL_DEFAULTS, neumaPolicy, connection._sessionToolPolicy || null);
  const baseAccess = checkToolAccess(policy, 'filesystem', ACCESS_REQUEST_TOOL.name);
  const access = applyToolMode(baseAccess, toolMode, ACCESS_REQUEST_TOOL.name);
  if (access === 'denied') {
    const refusal = refusalResult(tool, baseAccess !== 'denied' ? 'held' : 'policyDenied');
    ports.sendToolEvent(ws, companion, { tool, status: 'denied', summary: `request_file_access — ${refusal.summary}` });
    return { tool, status: 'denied', error: refusal.error };
  }

  const neumaId = companion?.neumaId;
  if (!neumaId) {
    const error = 'no sovereign workspace on this connection';
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'request_file_access — no workspace', detail: error });
    return { tool, status: 'error', error };
  }

  try {
    const { resolved, tier, reason } = validateRequest(args);
    if (sensitiveGrantCovers(connection._sensitiveGrants, tier, resolved)) {
      return { tool, status: 'ok', content: `Already granted — ${tier} access to ${resolved} stands.` };
    }

    const decision = await requestToolApproval(connection, {
      tool,
      args: { path: resolved, tier, reason },
      scope: `${tier} access to ${resolved}`,
      signal: origin.signal,
    });
    if (decision !== 'allow' && decision !== 'always') {
      const refusal = refusalForDecision(connection, decision);
      ports.sendToolEvent(ws, companion, { tool, status: 'denied', summary: `request_file_access — ${refusal.summary}` });
      return { tool, status: 'denied', error: refusal.error };
    }

    // The grant lands at every layer that can block: the live connection, the
    // filesystem server's own root wall (a grant the server never hears about
    // is the […] lie), and the lane's
    // persisted policy on ALWAYS.
    origin.beforeCommit();
    const current = connection._sensitiveGrants || {};
    connection._sensitiveGrants = {
      ...current,
      [tier]: [...new Set([...(current[tier] || []), resolved])],
    };
    await ensureFilesystemRoots([await resolveGrantDir('read_file', resolved)])
      .catch((err) => log.warn('filesystem server not widened for a sensitive grant', { err: err.message }));
    if (decision === 'always') {
      try {
        await neumaWorkspace.updateToolPolicy(neumaId, (existing) => addSensitiveGrant(existing, tier, resolved), origin);
      } catch (err) {
        origin.beforeCommit();
        // Persistence failure degrades to session-only, said loudly — never a
        // silent always-on-screen/session-underneath split.
        log.warn('sensitive grant persistence failed — session-only', { neumaId, err: err.message });
      }
    }
    origin.beforeCommit();
    log.info('Sensitive access granted', { neumaId, tier, path: resolved, persist: decision === 'always' });
    ports.sendToolEvent(ws, companion, {
      tool, status: 'ok', summary: `${tier} access granted — ${path.basename(resolved)}${decision === 'always' ? ' (always)' : ''}`,
    });
    return {
      tool, status: 'ok',
      content: `${tier} access to ${resolved} is granted${decision === 'always' ? ' — it persists across sessions' : ' for this session'}. The walls around it still stand: read grants never confer edit, and this grant covers nothing beside it.`,
    };
  } catch (err) {
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'request_file_access — refused', detail: err.message });
    return { tool, status: 'error', error: err.message };
  }
};
