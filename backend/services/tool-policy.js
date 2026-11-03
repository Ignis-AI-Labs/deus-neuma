/**
 * Tool Policy Cascading — Controls MCP tool access per neuma
 *
 * Pure functions for policy resolution and access checking.
 * Global defaults (tool-policy-defaults.js) → neuma overrides → session overrides.
 */
import { GLOBAL_DEFAULTS } from './tool-policy-defaults.js';
import { RETIRED_TOOL_HINTS } from './intents/retired-tools.js';
import { applyProtocolGuard } from './protocol-guard.js';

export { GLOBAL_DEFAULTS };

// Reserved policy-file keys that are NOT server rule blocks. `pathGrants`
// carries operator-granted read scopes ({ read: [dirs] }) — resolved by the
// sandbox layer, not the tool-name cascade.
const RESERVED_POLICY_KEYS = new Set(['pathGrants', 'sensitiveGrants']);

/**
 * Resolve a tool policy by merging global defaults with neuma and session overrides.
 * Later layers override earlier layers. Returns a flat map: `server/tool` → access level.
 * @param {Object} globalDefaults - Global policy defaults (server → { allowed, denied, requireApproval })
 * @param {Object|null} neumaOverrides - Per-neuma overrides (same shape)
 * @param {Object|null} sessionOverrides - Per-session overrides (same shape)
 * @returns {Object} Flat policy map: `{ 'server/tool': 'allowed'|'denied'|'approval_required' }`
 */
export const resolvePolicy = (globalDefaults, neumaOverrides = null, sessionOverrides = null) => {
  const policy = {};

  const applyLayer = (layer) => {
    if (!layer) return;
    for (const [server, rules] of Object.entries(layer)) {
      if (RESERVED_POLICY_KEYS.has(server)) continue;
      for (const tool of (rules.allowed || [])) {
        policy[`${server}/${tool}`] = 'allowed';
      }
      for (const tool of (rules.denied || [])) {
        policy[`${server}/${tool}`] = 'denied';
      }
      for (const tool of (rules.requireApproval || [])) {
        policy[`${server}/${tool}`] = 'approval_required';
      }
    }
  };

  applyLayer(globalDefaults);
  applyLayer(neumaOverrides);
  applyLayer(sessionOverrides);

  return policy;
};

/**
 * Check if a specific tool call is allowed by the resolved policy.
 * Tools not in the policy default to 'approval_required' (fail-closed — AI-SEC-003).
 * Principle of least privilege: unknown tools must be explicitly permitted.
 * @param {Object} policy - Resolved flat policy map from resolvePolicy
 * @param {string} serverName - MCP server name
 * @param {string} toolName - Tool name
 * @returns {'allowed'|'denied'|'approval_required'} Access level
 */
export const checkToolAccess = (policy, serverName, toolName) => {
  const key = `${serverName}/${toolName}`;
  return policy[key] || 'approval_required';
};

/**
 * Does this tool still belong in the catalog the model is shown? Pure.
 *
 * THE CATALOG CUT (#414). A tool named in RETIRED_TOOL_HINTS has a live
 * replacement — every one of the fourteen is a `vault/*`, `tasks/*`,
 * `leads/*` or `campaigns/*` intent carrying the same act. Advertising both
 * spent 38% of a bound neuma's tool budget (14,331 of 37,678 characters,
 * measured through platformToolsFor) describing the same fourteen acts twice,
 * in two different dialects, every single turn — while the prompt doctrine
 * told the being to use the intent and the tool description told it to use
 * the tool.
 *
 * DISPATCH IS DELIBERATELY UNTOUCHED. The handlers still answer, so a being
 * mid-sitting on a stale catalog, or a standing plan or skills pack emitting
 * an old name, does not have an act fail under it. What changes is only what
 * the model is SHOWN. Deleting the handlers is the second half of #414.
 *
 * @param {{name?: string}} tool - an advertised tool definition
 * @returns {boolean} false when a live replacement makes it a duplicate
 */
export const isAdvertisedTool = (tool) =>
  !Object.hasOwn(RETIRED_TOOL_HINTS, String(tool?.name || ''));

// The other half of the cut, re-exported through the governance face so the
// unavailable wall can answer in the same breath it refuses. retired-tools.js
// states the law — […] — and the witness seat has been keeping it alone.
export { retiredToolHint } from './intents/retired-tools.js';

// --- Session tool modes (the operator's standing stance for this session) ---

/**
 * ask     — approval-required calls prompt the operator per call (default)
 * auto    — approval-required calls run without prompting; denials still hold
 * observe — only read-shaped tools act; every acting tool is held, even
 *           policy-allowed ones (the operator wants to watch, not act)
 */
export const TOOL_MODES = Object.freeze(['ask', 'auto', 'observe']);

/**
 * Normalize an untrusted mode value to a valid tool mode (fail to 'ask').
 * @param {*} raw - Untrusted mode value (client input)
 * @returns {'ask'|'auto'|'observe'} Valid mode
 */
export const normalizeToolMode = (raw) => (TOOL_MODES.includes(raw) ? raw : 'ask');

// --- Chat modes (the operator's standing mode for this conversation) ---
//
// The composer's mode chip. One declaration carries both meanings: the chat's
// bearing (free flow / strictly planning / hands-off) AND the ACTS tier the
// gate enforces, derived below — the operator never sets the two separately.
export const CHAT_MODES = Object.freeze(['default', 'plan', 'auto']);

/**
 * Normalize an untrusted chat mode value (fail to 'default' — free flow
 * with per-act cards, the least authority a mode can carry).
 * @param {*} raw - Untrusted mode value (client input)
 * @returns {'default'|'plan'|'auto'} Valid chat mode
 */
export const normalizeChatMode = (raw) => (CHAT_MODES.includes(raw) ? raw : 'default');

/**
 * The ACTS tier a chat mode enforces. Pure.
 * default → ask (gated acts raise the card), plan → observe (read-only —
 * planning never acts), auto → auto (gated acts flow, minus the protocol
 * guard's hard-gated classes in protocol-guard.js).
 * @param {'default'|'plan'|'auto'} chatMode
 * @returns {'ask'|'auto'|'observe'}
 */
export const toolModeForChatMode = (chatMode) => (
  chatMode === 'auto' ? 'auto' : chatMode === 'plan' ? 'observe' : 'ask'
);

// Read-shaped tools: observation with no side effects. In observe mode these
// keep their policy access; everything else is held.
export const READ_TOOLS = Object.freeze(new Set([
  // The fs primitives (the 16 organ spellings are internal — fs-primitives.js).
  'read', 'list', 'search',
  // ground_git only reports the live checkout's branch state — observation, and
  // the one tool that stays open precisely so an operator watching in observe mode
  // can still tell which branch it is looking at.
  'sandbox_status', 'ground_git', 'inspect',
  // Self-knowledge is observation. Held in observe mode, a being could not
  // answer […] precisely when its operator is watching.
  'flight_check', 'get_telemetry', 'get_view',
  // A being reading its own refinement state is pure observation; the dial
  // (refinement_dial) acts, so observe mode holds it like any acting tool.
  'refinement_sense',
  // Recall is pure observation of the being's own record; the acting tools
  // (memory_note/pin/unpin/supersede/retract/merge/archive) write to its
  // store, so observe mode holds them. memory_list only WALKS the record —
  // the audit lane stays open while the operator watches.
  'memory_search', 'memory_expand', 'memory_list', 'mind_read', 'self_read',
  // Its own journal and past conversations are its own record too.
  'journal_read', 'chats_list', 'chat_read',
  // A being reading its own skies is pure observation of a write-once record;
  // so is reading its own given body (the genome).
  'skies_read', 'genome_read',
  // Collecting one's own house post is reading one's own mail; sending
  // (post_send) acts on a housemate's context, so observe mode holds it.
  // Listing the house's open chats reads the desk's own tabs; chat/send holds.
  'post_check', 'open_chats',
  // Handing the operator a list acts on NOTHING — no egress, no store, no
  // change beyond the card in this conversation. And the mode argument is
  // decisive rather than merely permissive: chat mode `plan` resolves to
  // `observe`, and planning is EXACTLY when an operator wants options laid out
  // to choose between. Held here, the tool would be dead in the one mode it
  // was most obviously built for.
  'share_findings',
  // Reading one's own wallet is observation — the address and a public chain
  // balance, no key and no send. The dispatcher has always run it ahead of any
  // mode check for a neuma; naming it here makes the advertised tier match
  // that, instead of promising a hold the runtime does not honour.
  'wallet_view',
  // NOTE — the queue, bench, ledger and task-list reads are policy-`allowed`
  // (no approval card) but deliberately NOT here. The line this set draws is
  // the being's OWN record — its memory, its skies, its mail — which opens
  // even while the operator is only watching. The campaign queue, the bench
  // and the lead ledger are SHARED house state; observe mode is the operator
  // saying […], and that stance holds over shared
  // state too. Same law as vault_list: allowed, still held in observe.
]));

// Tools that OBSERVE and cannot change state (BE-142 #214).
//
// A deliberately different question from READ_TOOLS above, and the two sets are
// not interchangeable. READ_TOOLS answers […] — a stance about the being's OWN record, which is why the
// campaign queue, the bench and the task ledger are excluded from it on
// purpose. This set answers […],
// task reads are now in the WORKING STATE prompt section (task_list retired)
// and not there; the two lists disagreeing is correct.
//
// Membership is fail-safe in the direction that costs least: an unlisted tool
// is treated as a MUTATION, so an unknown tool keeps the old dedup protection
// (a repeat is held) rather than risking a double execution. The cost of
// omitting a read here is the status quo; the cost of wrongly listing a write
// would be running it twice.
export const OBSERVATION_TOOLS = Object.freeze(new Set([
  // The being's own record
  'memory_search', 'memory_expand', 'memory_list', 'mind_read', 'self_read',
  'journal_read', 'chats_list', 'chat_read', 'charter_read',
  // vault reads retired (prompt + fs); vault mutations are intents only
  'skies_read', 'genome_read', 'post_check', 'open_chats', 'refinement_sense', 'wallet_view',
  'flight_check', 'get_telemetry', 'get_view', 'inspect', 'sandbox_status', 'ground_git',
  // Handing the operator a list REACHES NOTHING — no egress, no store, no
  // change to anything but this conversation's own card. Observe mode holds
  // acts, and reporting to the person watching is not an act on the world.
  'share_findings',
  // Shared house state — reads, even though observe mode holds them
  'task_list', 'calendar_read', 'queue_list', 'queue_get', 'replies_list', 'campaign_list', 'lead_list', 'board_read',
  // The whole posting posture in one call — computed from the real stores,
  // no egress, no mutation (posting-pipeline-v2; it carded once because its
  // policy ROW was absent — this set is the second half of the same lesson).
  'pipeline_state',
  'security_posture', 'security_threats_list', 'security_threat_get',
  'security_attack_surface', 'security_telemetry',
  'legal_posture', 'legal_matters_list', 'legal_matter_get', 'legal_sources', 'legal_research_api', 'bench_list', 'bench_status',
  'media_library', 'map_read', 'read_architecture', 'read_history', 'read_x', 'read_tiktok',
  'read_youtube', 'read_facebook', 'read_bluesky', 'read_mastodon',
  'retrieve_result', 'image_search',
  // The filesystem lane — the observation verbs among the seven primitives
  'read', 'list', 'search',
  // The outside world. Nothing local changes, and a re-fetch after a write is
  // the model verifying rather than repeating itself.
  'web_search', 'web_fetch',
  // The platform's live aggregate. Emphatically re-readable: the numbers move
  // on their own, so a second call in one turn is the being watching reality
  // change, never repeating itself.
  //
  // NOT in READ_TOOLS above, and the omission is deliberate. That set is the
  // being's OWN record — memory, skies, mail — which stays open while the
  // operator is merely watching. This read leaves the machine, and the standing
  // law two lines up is that egress is not observation. Observe mode holds it,
  // exactly as it holds web_search.
  'platform_data',
  // Chain reads through the operator's own keyed RPC — public chain state, no
  // mutation possible, and emphatically re-readable: a balance after a send is
  // the being verifying, never repeating (the repeat-guard hold that stranded
  // a being's Phase 3 supply check, 2026-09-23). Same egress law as
  // platform_data: observe mode holds the family.
  'chain_chains', 'chain_balance', 'chain_token', 'chain_call', 'chain_logs', 'chain_holders',
]));

/**
 * Does this call only observe? Pure.
 * @param {{toolName?: string, tool?: string}|string} call - a tool call or bare name
 * @returns {boolean} true when repeating it cannot execute an act
 */
export const isObservationTool = (call) => {
  const name = typeof call === 'string' ? call : (call?.toolName || call?.tool || '');
  return OBSERVATION_TOOLS.has(name);
};

/**
 * Apply the session tool mode on top of a resolved access level. Pure.
 * A policy denial always survives — no mode widens past 'denied'.
 * @param {'allowed'|'denied'|'approval_required'} access - Resolved policy access
 * @param {'ask'|'auto'|'observe'} mode - Session tool mode
 * @param {string} toolName - Tool name (mode-sensitive for observe)
 * @returns {'allowed'|'denied'|'approval_required'} Effective access
 */
export const applyToolMode = (access, mode, toolName) => {
  if (access === 'denied') return 'denied';
  if (mode === 'observe') return READ_TOOLS.has(toolName) ? access : 'denied';
  if (mode === 'auto' && access === 'approval_required'
    && !['ground_git', 'ground_sync', 'read_history', 'sandbox_recover'].includes(toolName)) return 'allowed';
  return access;
};

/**
 * Stamp each advertised tool with the access it ACTUALLY has this turn. Pure.
 *
 * The catalog and the gate were two separate truths until 2026-07-26: a being
 * was handed a list of tool names and discovered a tool's tier only by calling
 * it and being refused. Learning your own permissions by tripping over them is
 * not a capability manifest — so the resolved tier rides the same list the
 * prompt renders, and the being knows before it reaches.
 *
 * @param {Array<{server: string, name: string}>} tools - the advertised catalog
 * @param {Object} policy - resolved flat policy map from resolvePolicy
 * @param {'ask'|'auto'|'observe'} mode - session tool mode
 * @returns {Array<Object>} new tool objects carrying `access`
 */
export const annotateToolAccess = (tools, policy, mode, operatorPolicy = {}) => (tools || []).map((tool) => ({
  ...tool,
  access: applyProtocolGuard(applyToolMode(checkToolAccess(policy, tool.server, tool.name), mode, tool.name),
    mode, tool.server, tool.name, operatorPolicy[`${tool.server}/${tool.name}`] === 'allowed'),
}));

/**
 * Return a new policy layer with `server/tool` granted (ALWAYS ALLOW). Pure —
 * the input layer is never mutated; null grows a fresh layer.
 * @param {Object|null} layer - Existing policy layer (server → { allowed, denied, requireApproval })
 * @param {string} server - MCP server name
 * @param {string} tool - Tool name
 * @returns {Object} New layer with the grant applied
 */
export const addAllowedTool = (layer, server, tool) => {
  const existing = layer?.[server] || {};
  const allowed = existing.allowed || [];
  return {
    ...(layer || {}),
    [server]: {
      ...existing,
      allowed: allowed.includes(tool) ? allowed : [...allowed, tool],
    },
  };
};

/**
 * Return a new policy layer with `dir` added to the operator-granted READ
 * scopes (pathGrants.read). Pure — never mutates; null grows a fresh layer.
 * @param {Object|null} layer - Existing policy layer
 * @param {string} dir - Absolute directory to grant read access to
 * @returns {Object} New layer with the grant applied
 */
export const addGrantedReadRoot = (layer, dir) => {
  const read = layer?.pathGrants?.read || [];
  return {
    ...(layer || {}),
    pathGrants: {
      ...(layer?.pathGrants || {}),
      read: read.includes(dir) ? read : [...read, dir],
    },
  };
};

/**
 * Return a new policy layer with `dir` added to the operator-granted WRITE
 * scopes (pathGrants.write). Pure — never mutates; null grows a fresh layer.
 * A write grant is a deliberate escalation past the being's own lane, so it is
 * only ever handed out for a folder inside the ACTIVE project (the portal write
 * gate enforces that bound + default-deny), and the sandbox's denied-path list
 * still fires first — a granted folder never opens .git/.env/keys/config or
 * another being's DNA. Write scope also grants read (you can read where you can
 * write); the sandbox folds pathGrants.write into the read roots.
 * @param {Object|null} layer - Existing policy layer
 * @param {string} dir - Absolute directory to grant write access to
 * @returns {Object} New layer with the grant applied
 */
export const addGrantedWriteRoot = (layer, dir) => {
  const write = layer?.pathGrants?.write || [];
  return {
    ...(layer || {}),
    pathGrants: {
      ...(layer?.pathGrants || {}),
      write: write.includes(dir) ? write : [...write, dir],
    },
  };
};

// ── TAKING A GRANT BACK ───────────────────────────────────────────────────────
//
// Design note, 2026-08-30, looking at the PERMISSIONS panel: […]
//
// Each remover is the exact inverse of the adder above it, and each REMOVES
// ONLY WHAT IT NAMES. Three laws they all keep:
//
//   1. Revoking something that was never granted is a no-op, not an error. The
//      operator's intent — […] — is satisfied
//      either way, and a surface that errors on an already-revoked row teaches
//      nobody anything.
//   2. The layer's OTHER settings survive. A grant lives beside `denied` and
//      `requireApproval` on the same server entry, and dropping the server
//      wholesale to remove one tool would quietly discard a denial — turning a
//      revoke into a widening, which is the worst possible bug in this file.
//   3. Pure. The input layer is never mutated; the caller writes the result.

/**
 * Return a new policy layer with `server/tool` no longer always-allowed.
 * The server entry is KEPT even when its allowed list empties, because it may
 * still carry denials. Pure.
 * @param {Object|null} layer
 * @param {string} server
 * @param {string} tool
 * @returns {Object} New layer with the grant withdrawn
 */
export const removeAllowedTool = (layer, server, tool) => {
  const existing = layer?.[server];
  if (!existing?.allowed?.includes(tool)) return { ...(layer || {}) };
  return {
    ...(layer || {}),
    [server]: { ...existing, allowed: existing.allowed.filter((t) => t !== tool) },
  };
};

/**
 * Return a new policy layer with `dir` removed from the granted READ scopes.
 * Pure. Exact-match only: revoking a parent must never silently strip a child
 * grant the operator made separately and still means.
 */
export const removeGrantedReadRoot = (layer, dir) => {
  const read = layer?.pathGrants?.read || [];
  if (!read.includes(dir)) return { ...(layer || {}) };
  return {
    ...(layer || {}),
    pathGrants: { ...(layer?.pathGrants || {}), read: read.filter((d) => d !== dir) },
  };
};

/**
 * Return a new policy layer with `dir` removed from the granted WRITE scopes.
 * Pure. Note the asymmetry with `addGrantedWriteRoot`: write implies read, but
 * they are stored apart, so withdrawing write leaves any read grant standing.
 * That is correct — the operator asked to stop this being WRITING there, and
 * silently taking read as well would revoke something they did not name.
 */
export const removeGrantedWriteRoot = (layer, dir) => {
  const write = layer?.pathGrants?.write || [];
  if (!write.includes(dir)) return { ...(layer || {}) };
  return {
    ...(layer || {}),
    pathGrants: { ...(layer?.pathGrants || {}), write: write.filter((d) => d !== dir) },
  };
};
