/**
 * Being tool surface — the NEUMA seat's turn-catalog stash and its disposable
 * coding shell (LANE-D2; Design note, 2026-08-11: […]).
 *
 * THE MIRROR LAW. The shell family is the witness seat's own, never a parallel
 * implementation: the definitions are read live from witness-tools.js, and the
 * SAME runner handles SANDBOX OFF (direct execution, normal environment) and
 * SANDBOX ON (bubblewrap, scrubbed environment, bounded output). The tiers are
 * the SAME ACTS rows every seat resolves. Only the seat-shaped parts differ:
 * the policy cascade and refusal wording.
 *
 * The sovereignty boundary in one line: a witness-seated connection never
 * enters here. The witness keeps its own path (witness-tools.js); this file
 * serves the being seat only.
 */
import { readExecutionToolPolicy } from './execution-tool-policy.js';
import {
  annotateToolAccess, GLOBAL_DEFAULTS, normalizeToolMode, resolvePolicy,
} from './tool-policy.js';
import { captureShellNetwork, requestShellNetwork, shellNetworkOptions, hydrateShellNetwork } from './shell-network-grants.js';
import { gateAct } from './act-gate.js';
import { noteTurnSandboxSource, ensureTurnSandbox } from './turn-sandbox.js';
import { runSeatCommand } from './benchmark-exec-bridge.js';
import { handleGroundGitTool } from './ground-git-consent.js';
import { focusGroundOf } from './focus-ground.js';
import { isLiveShell } from './open-folder-autonomy.js';
import { ensureBeingGround } from './house-workspace.js';
import { renderCommandResult } from './coding-result.js';
import { executionPresentation } from './execution-presentation.js';
import { cmoDesignation } from './marketing/cmo-designation.js';
import { mindGateSettings } from './mind-gate-settings.js';
import { keepWireOrder, turnDisclosure } from './sitting-disclosure.js';
import { CALL_ID, CALL_TOOL, contractsOf } from './tool-hud.js';
import { CALLER_SERVER } from './caller-tools.js';
import { createLogger } from './logger.js';
import { WITNESS_CODING_TOOLS } from './coding-tool-definitions.js';
import { handleCodingShellControl } from './coding-shell-control.js';
import { callerCatalogTools } from './caller-tools.js';
import { closedBookCatalog } from './closed-book.js';
import { toolSearchSummary } from './tool-search-summary.js';
export { callerTurnTail } from './caller-tools.js'; // the turn's seat of the sender's transcript

const log = createLogger('BeingToolSurface');

// Every witness coding capability is the neuma floor. The catalog comparison
// test fails if a new witness tool lands without its local counterpart.
export const BEING_CODING_NAMES = Object.freeze(
  new Set(WITNESS_CODING_TOOLS.map(({ name }) => name)));

const TOOL_SEARCH_ID = 'system/tool_search';
// Four, not eight (ruling, 2026-08-31): a search that activates a crowd bills every
// later round of the turn for schemas the work never calls. The long tail can
// ask for more explicitly, up to the max.
const TOOL_SEARCH_LIMIT = 4;
const TOOL_SEARCH_LIMIT_MAX = 16;

export const TOOL_SEARCH_TOOL = Object.freeze({
  server: 'system',
  name: 'tool_search',
  description: 'Find your tools: an exact id returns its full arguments; a family ("web/") lists every tool in it; a phrase finds what fits. Then call it through system/call.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      query: Object.freeze({
        type: 'string',
        description: 'Exact server/tool identifier or a capability phrase such as web research or edit file',
      }),
      limit: Object.freeze({
        type: 'integer',
        minimum: 1,
        maximum: TOOL_SEARCH_LIMIT_MAX,
        description: `maximum matches to return (default ${TOOL_SEARCH_LIMIT})`,
      }),
    }),
    required: Object.freeze(['query']),
    additionalProperties: false,
  }),
});

const catalogId = (tool) => `${tool.server}/${tool.name}`;
const normalizedQuery = (value) => String(value || '').trim().toLowerCase().slice(0, 160);

// An identifier hit is worth twenty description hits. A name is what the being
// MEANT; a description is merely what the tool happens to mention.
const ID_HIT = 200;
const TEXT_HIT = 10;

const escapeTerm = (term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does this text carry the term as a WORD rather than as a fragment buried in
 * one? Pure.
 *
 * THE BUG THIS CLOSES (ruling, 2026-08-30). The old matcher used plain
 * `includes`, so `fs` matched inside "offset" and `write` inside "rewrite".
 * A query for the filesystem family ranked `social/queue_list` FIRST — it had
 * the longest description in the catalog, and length alone gave it the most
 * chances to contain some short word by accident. `fs/search` was cut. The
 * scoring literally rewarded verbosity and then billed the turn for it.
 *
 * A leading boundary only: `write` still finds "writes", which is the
 * forgiveness a capability phrase needs, while "rewrite" no longer answers to
 * it.
 */
const hasWord = (text, term) => new RegExp(`\\b${escapeTerm(term)}`).test(text);

// An identifier's own words — `social/queue_list` is {social, queue, list}.
// The separators are split out rather than matched through, because `\b`
// counts `_` as a word character and would never find "list" in "queue_list".
const idWords = (tool) =>
  catalogId(tool).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// The identifier words that mark request/grant machinery (`request_file_access`)
// — helpers that ask the operator FOR reach, never the act itself.
const HELPER_ID_WORDS = new Set(['request', 'access']);

/** Pure — how well one tool answers an already-split query. */
const toolSearchScore = (tool, terms) => {
  const words = idWords(tool);
  const description = String(tool.description || '').toLowerCase();
  return terms.reduce((score, term) => {
    if (words.some((word) => word.startsWith(term))) return score + ID_HIT;
    return hasWord(description, term) ? score + TEXT_HIT : score;
  }, 0);
};

/**
 * Find enabled tools in one already-stamped turn catalog. Pure.
 *
 * Three laws, in order:
 *
 * 1. AN EXACT IDENTIFIER HANDS BACK EXACTLY ONE TOOL. A being that already
 *    knows the name is not asking to browse.
 * 2. A TERM NAMING A SERVER IS A REQUEST FOR THAT FAMILY. […]
 *    means the fs family — not […]. The
 *    whole family activates (bar the helper gate below — request/grant ids
 *    only answer access phrasings), which is both what was meant and cheaper
 *    than the scattered eight the old ranking returned.
 * 3. IF ANYTHING MATCHED BY NAME, DESCRIPTION-ONLY MATCHES ARE NOISE. They are
 *    dropped rather than ranked below, because ranking still pays for them.
 *    When NOTHING matches by name the weak matches are all there is, so they
 *    stand — a vague query answered poorly beats one answered not at all.
 */
const searchTurnTools = (catalog, rawQuery, rawLimit) => {
  const query = normalizedQuery(rawQuery);
  if (!query) return [];
  // An explicit limit always bites; the DEFAULT cap exists for the scattered
  // long tail, never for a family ask — law 2 returns the WHOLE family, and
  // the fs hands are five small schemas, cheaper than the scattered eight the
  // old ranking returned. (rawLimit must default to undefined, NOT the
  // constant: a defaulted integer reads as explicit and the family cap
  // exemption never fires — fs/search was cut by exactly that.)
  const explicitLimit = Number.isInteger(rawLimit);
  const limit = explicitLimit
    ? Math.min(TOOL_SEARCH_LIMIT_MAX, Math.max(1, rawLimit))
    : TOOL_SEARCH_LIMIT;
  const pool = (catalog || []).filter((tool) => catalogId(tool) !== TOOL_SEARCH_ID && catalogId(tool) !== CALL_ID);
  const exact = pool.find((tool) => catalogId(tool).toLowerCase() === query);
  if (exact) return [exact];
  // a family named with its slash ("web/") is the family — the HUD's own form
  const terms = query.split(/\s+/).filter(Boolean).map((term) => term.replace(/\/$/, ''));
  const servers = new Set(pool.map((tool) => String(tool.server || '').toLowerCase()));
  const named = terms.filter((term) => servers.has(term));
  const family = named.length > 0
    ? pool.filter((tool) => named.includes(String(tool.server || '').toLowerCase()))
    : pool;
  const scored = family
    .map((tool) => ({ tool, score: toolSearchScore(tool, terms) }))
    .filter(({ score }) => score > 0);
  // HELPER GATE (ruling, 2026-08-31): request/grant machinery never answers an
  // ACTION phrase. "read file" activating `filesystem/request_file_access` —
  // an approval-REQUEST, not a reader — was exactly the waste named. An id
  // carrying request/access is excluded unless the query itself says those
  // words. If the gate would empty the pool, the ungated matches stand: a
  // vague query answered loosely beats one answered not at all.
  const helperNamed = terms.some((term) => HELPER_ID_WORDS.has(term));
  const gated = helperNamed
    ? scored
    : scored.filter(({ tool }) => !idWords(tool).some((word) => HELPER_ID_WORDS.has(word)));
  const strong = (gated.length > 0 ? gated : scored).filter(({ score }) => score >= ID_HIT);
  const ranked = (strong.length > 0 ? strong : (gated.length > 0 ? gated : scored))
    .sort((left, right) => right.score - left.score || catalogId(left.tool).localeCompare(catalogId(right.tool)));
  const capped = named.length > 0 && !explicitLimit ? ranked : ranked.slice(0, limit);
  return capped.map(({ tool }) => tool);
};

/** The two doors every tool-capable turn carries — never anything else of the platform's (tool-hud.js). */
export const TOOL_DOORS = Object.freeze([TOOL_SEARCH_TOOL, CALL_TOOL]);

/**
 * THE WIRE NEVER CHANGES (tool-hud.js): the search door, the call door, and a
 * sender's own task tools — the same on every round of every turn, so no tool
 * re-reads a chat and no schema rides a turn that never uses it. Pure.
 */
export const disclosedNativeTools = (connection) => (connection?._turnCatalog || []).filter((tool) => {
  const id = catalogId(tool);
  return id === TOOL_SEARCH_ID || id === CALL_ID || tool.server === CALLER_SERVER;
});

// Search this turn's real catalog and activate the matches for its next round.
const searchAndDisclose = (connection, args) => {
  const query = normalizedQuery(args.query);
  if (!query) {
    return {
      tool: TOOL_SEARCH_ID,
      status: 'error',
      error: 'query must name an exact server/tool identifier or capability',
      count: 0,
    };
  }
  // THE ANSWER IS THE CONTRACT (tool-hud.js): nothing is activated — the wire
  // never changes — so a search answers with what a call needs: an exact id's
  // full arguments, a family's every tool (and its filed acts), a phrase's best.
  // an intent's answer says how to file it, as a tool's says how to call it — never a name to call (2026-10-17 flight: "run", "update", "post")
  const intentOf = (t) => ({
    name: t.name, fields: t.fieldsForPrompt, description: t.descriptionForPrompt, ...(t.channels?.length ? { channels: t.channels } : {}),
    file: `not a tool: write a JSON file into your intents folder holding {"type": "${t.name}", …its fields}`,
  });
  const intents = connection?._turnIntents || [];
  const intent = intents.find((type) => type.name.toLowerCase() === query);
  if (intent) return { tool: TOOL_SEARCH_ID, status: 'ok', content: JSON.stringify({ query, intent: intentOf(intent) }), count: 1, intent: intent.name };
  // a family by its slash, else the intents a term names by a word of their id ("dispatch", "staff") —
  // the acts a lane files are found by the same words as its tools (2026-10-17 flight: seven searches for one charge)
  const terms = query.split(/\s+/).filter((term) => term.length >= 3).map((term) => term.replace(/\/$/, ''));
  // a channel-bound type answers to its channels too ("tiktok" finds social/queue)
  const intentWords = (type) => [...type.name.toLowerCase().split(/[^a-z0-9]+/), ...(type.channels || [])].filter(Boolean);
  const family = query.endsWith('/')
    ? intents.filter((type) => type.name.toLowerCase().startsWith(query))
    : intents.filter((type) => terms.some((term) => intentWords(type).some((word) => word.startsWith(term) || (word.length >= 4 && term.startsWith(word)))));
  const matches = searchTurnTools(connection?._turnCatalog, query, args.limit);
  const exact = matches.length === 1 && catalogId(matches[0]).toLowerCase() === query;
  const content = JSON.stringify({
    query,
    // descriptions ride WHOLE: a [HELD — …] tier stamp is a SUFFIX (web-being-tools.js)
    tools: contractsOf(matches, exact),
    ...(family.length ? { intents: family.map(intentOf) } : {}),
    ...(matches.length === 0 && family.length === 0 ? {
      availableServers: [...new Set((connection?._turnCatalog || []).map((tool) => tool.server))].sort(),
    } : {}),
  });
  return { tool: TOOL_SEARCH_ID, status: 'ok', content, count: matches.length + family.length, found: matches.map(catalogId), activated: [], ...(family.length ? { intent: query } : {}) };
};

/** tool_search's answer, with the one line the operator reads: which tools it activated. */
export const discloseTurnTools = (connection, args = {}) => {
  const result = searchAndDisclose(connection, args);
  return { ...result, summary: toolSearchSummary(result, args.query) };
};

/** Does this turn's advertised catalog contain the read-only search hand? Pure. */
export const isToolSearchTool = (match, connection) => {
  const named = String(match?.toolName || '').replace(/^system__/, '') === 'tool_search'
    || String(match?.tool || '').replace(/^system\//, '') === 'tool_search';
  return named && (connection?._turnCatalog || []).some((tool) => catalogId(tool) === TOOL_SEARCH_ID);
};

// pure — the tool name a call is reaching for, whatever shape it arrived in.
const codingToolName = (match) =>
  String(match?.toolName || match?.tool || '').replace(/^[^/]+\//, '');

/**
 * impure — the being seat's overlay shell for this turn.
 *
 * Notes where the shell stands (the operator's focus ground, else the seat's
 * house workspace) and advertises the mirrored family; the SAME factory the
 * witness seat runs prepares it at the first act that needs it
 * (turn-sandbox.js — load on demand). No ground, no bound lane, or a
 * witness-seated companion means no shell and no tools — the honest answer,
 * never an unmasked fallback. A broken shell costs the shell, never the turn.
 *
 * @param {Object} connection - the portal connection (companion, toolWorkspace)
 * @returns {Promise<Array<Object>>} the mirrored coding tool definitions; []
 *   when no ground is focused or the seat is a witness
 */
export const beingCodingToolsFor = async (connection) => {
  noteTurnSandboxSource(connection, null);
  const laneId = connection?.companion?.neumaId;
  const wallet = connection?.walletAddress;
  // THE HOUSE TOOLING LAW (ruling, 2026-09-15): every house member has the same
  // tooling — position divides the work so seats never collide, never
  // capability. A seat the operator has not focused a folder for shells into
  // its OWN workspace on the house ground — per-seat, seen by the room, the
  // same trust plane as house post. The sovereign lane itself is REFUSED by
  // the overlay law (a shell cannot mask its own home's secrets), and the
  // operator's focus still wins wherever it is set. A witness seat stays
  // outside — third-party peers are not house members (the sovereignty
  // boundary, not a position).
  const focused = focusGroundOf(connection);
  let sourceRoot = focused;
  if (!focused && laneId && wallet) {
    try {
      sourceRoot = (await ensureBeingGround(wallet, laneId)).path ?? null;
    } catch (err) {
      log.warn('the seat\'s house workspace could not open — the shell stands down this turn', {
        laneId, err: err.message,
      });
      sourceRoot = null;
    }
  }
  if (!laneId || connection?.companion?.participantKind === 'witness' || !sourceRoot) return [];
  noteTurnSandboxSource(connection, { laneId, sourceRoot });
  return WITNESS_CODING_TOOLS.filter((tool) => BEING_CODING_NAMES.has(tool.name));
};

/**
 * Does this call belong to the being seat's coding family THIS turn? Pure.
 *
 * Claimed only when the turn's own stamped catalog advertises it under the
 * coding server — an unadvertised call falls through to the ordinary lane and
 * reads as unavailable, exactly like any other tool the seat does not hold. A
 * bare name shared with another server is ambiguous and fails closed, the
 * witness runtime's own identity law. The witness seat never enters here: its
 * coding calls route through witness-tools.js before dispatch.
 *
 * @param {Object} match - the parsed tool call
 * @param {Object} connection - the portal connection (carries _turnCatalog)
 * @returns {boolean}
 */
export const isBeingCodingTool = (match, connection) => {
  if (connection?.companion?.participantKind === 'witness') return false;
  const toolName = codingToolName(match);
  if (!BEING_CODING_NAMES.has(toolName)) return false;
  const explicit = match?.server
    || (String(match?.tool || '').includes('/') ? String(match.tool).split('/')[0] : null);
  if (explicit && explicit !== 'coding') return false;
  const candidates = (connection?._turnCatalog || []).filter(
    (tool) => tool.name === toolName && (!explicit || tool.server === 'coding'));
  return candidates.length === 1 && candidates[0].server === 'coding';
};

/**
 * impure — execute one coding call for the being seat.
 *
 * The gate is the SAME cascade the being's filesystem lane resolves (global
 * defaults → lane → session, then the session mode on top), so coding/execute
 * asks the operator exactly the way delete_file does, and an ALWAYS lands
 * through the desk's own grant seam. The command itself runs through the
 * witness seat's real runner: directly with SANDBOX OFF, or through the
 * isolated shell with SANDBOX ON. The post-approval abort
 * check is the being lane's own #200 law: an interrupt that lands between the
 * operator's yes and the spawn stops the act, not just the speech.
 *
 * deps are the being lane's own seams, injected by the turn path — the same
 * shape every platform satellite receives: sendToolEvent. The ACTS gate is
 * the shared one (act-gate.js).
 */
export const handleBeingCodingTool = async (ws, connection, neumaPolicy, toolMode, match, args, deps) => {
  const { sendToolEvent } = deps;
  const toolName = codingToolName(match);
  const tool = `coding/${toolName}`;
  const companion = connection.companion;
  const shellConsent = captureShellNetwork(connection, connection.activeTurn?.signal);
  if (toolName === 'sandbox_status' || toolName === 'sandbox_recover') {
    return handleCodingShellControl({ ws, connection, toolName, args, sendToolEvent });
  }
  if ((toolName === 'ground_git' || toolName === 'ground_sync') && focusGroundOf(connection)) {
    return handleGroundGitTool({ ws, connection, toolName, args,
      sandbox: connection._turnSandbox || { sourceRoot: focusGroundOf(connection) }, sendToolEvent });
  }
  // The shell is prepared HERE, at the first act that needs it (turn-sandbox.js).
  const sandbox = await ensureTurnSandbox(connection);
  if (!sandbox) {
    const error = connection._turnSandboxError
      ? `The coding shell is unavailable this turn: ${connection._turnSandboxError}`
      : 'No focused workspace is open. Focus an opened folder or project before using coding tools.';
    sendToolEvent(ws, companion, { tool, status: 'unavailable', summary: 'coding shell unavailable', detail: error });
    return { tool, status: 'unavailable', error };
  }
  // The ONE gate (act-gate.js): policy → mode → one card → always-grant →
  // interrupt re-check, resolved per call so an ALWAYS granted earlier in
  // this same batch already covers the calls after it.
  const gated = await gateAct(connection, {
    server: 'coding', tool: toolName, toolLabel: tool, args,
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => sendToolEvent(ws, companion, event),
  });
  if (!gated.ok) return gated.result;
  if (toolName === 'execute' || toolName === 'inspect') {
    try {
      shellConsent.assertCurrent();
      if (toolName === 'execute') await requestShellNetwork(connection, shellConsent,
        (event) => sendToolEvent(ws, companion, { tool, ...event }));
    } catch (error) {
      const result = { tool, status: error.name === 'AbortError' ? 'interrupted' : 'error', error: error.message };
      sendToolEvent(ws, companion, result);
      return result;
    }
  }
  const presentation = executionPresentation(args?.command);
  const paint = (r) => sendToolEvent(ws, companion, {
    tool, status: 'executing', ...presentation, ...(r.stream ? { progress: true } : {}),
    detail: renderCommandResult({ exitCode: null, timedOut: false, truncated: false, stdout: r.stdout, stderr: r.stderr }).slice(0, 2000),
  });
  paint({ stdout: '', stderr: '' });
  try {
    const result = await runSeatCommand({
      connection, ...sandbox, command: args?.command, timeoutMs: args?.timeoutMs,
      mode: toolName === 'inspect' ? 'inspect' : 'write',
      live: isLiveShell({ mode: normalizeToolMode(toolMode), sourceRoot: sandbox.sourceRoot, ground: focusGroundOf(connection) }),
      ...shellNetworkOptions(shellConsent, toolName === 'execute'), onChunk: paint,
    });


    const content = renderCommandResult(result);
    const ok = result.exitCode === 0 && !result.timedOut;
    sendToolEvent(ws, companion, {
      tool,
      status: ok ? 'ok' : 'error',
      ...executionPresentation(args?.command, { result }),
      detail: content.slice(0, 2000),
    });
    return ok ? { tool, status: 'ok', content } : { tool, status: 'error', error: content };
  } catch (error) {
    const status = error.name === 'AbortError' ? 'interrupted' : 'error';
    sendToolEvent(ws, companion, { tool, status, ...executionPresentation(args?.command, { error }), detail: error.message });
    return { tool, status, error: error.message };
  }
};

/**
 * Stamp this turn's advertised catalog with the tier each tool ACTUALLY has,
 * and hold it on the connection so the flight check reports the surface this
 * turn is really carrying — not a second one assembled a moment later, which a
 * switch flipped mid-turn would make a different list.
 *
 * The three inputs are the ones the GATE itself consults at call time (policy
 * cascade, lane policy, session mode): one truth, two readers. It lives beside
 * the being seat's surface assembly so the seat's stash can be driven by a
 * test, exactly as `toolsForWitness` can at the witness seat — the seat that
 * had no coverage is the seat where a silent stash failure would make a being
 * report zero capacity.
 * impure — reads the lane's persisted policy.
 * @param {object} connection
 * @param {Array<object>} advertisedTools
 * @param {Array<object>} skills
 * @returns {Promise<Array<object>>} the stamped catalog
 */
// STANDING TOOLS FOR STANDING JOBS (posting-pipeline-v2): a designated CMO
// lane runs a posting pipeline every sitting — its marketing tools are wired
// from round 0 for that lane, not re-summoned through tool_search each time.
// Keyed on the single-holder CMO designation OF THE LANE'S OWN HOUSE (the
// connection's wallet), so the standing cost lands only on the lane whose job
// it is — a same-named lane in another house keeps the lazy economy.
const CMO_STANDING_TOOL_NAMES = Object.freeze(new Set([
  'marketing/pipeline_state',
  'marketing/campaign_list',
  'image/render_card',
  'social/queue_list',
]));

const cmoStandingTools = async (wallet, laneId) =>
  ((await cmoDesignation.holds(wallet, laneId)) ? [...CMO_STANDING_TOOL_NAMES] : []);

// MEMORY LINKS (mind gate): recall rides as mem_ links, so the hands that open
// and widen them ride from round 0 — found mid-chat they changed the tool list
// and re-read the whole conversation (live A/B 2026-10-05: with expand alone
// standing, Keir reached for memory_search through tool_search twice in one
// turn — two full re-reads, 15.7 s).
const MEMORY_LINK_TOOLS = Object.freeze(['memory/memory_expand', 'memory/memory_search']);
const memoryLinkTools = async () => ((await mindGateSettings.read().catch(() => null))?.memoryLinks?.mode === 'live'
  ? [...MEMORY_LINK_TOOLS] : []);

const standingToolsForLane = async (wallet, laneId) => {
  if (!laneId) return null;
  const ids = [...await cmoStandingTools(wallet, laneId), ...await memoryLinkTools()];
  return ids.length ? new Set(ids) : null;
};

export const stashBeingTurnCatalog = async (connection, advertisedTools, skills) => {
  const lanePolicy = await readExecutionToolPolicy(connection.companion?.neumaId);
  hydrateShellNetwork(connection, lanePolicy);
  const stamped = closedBookCatalog(connection, annotateToolAccess(
    advertisedTools,
    resolvePolicy(GLOBAL_DEFAULTS, lanePolicy, connection._sessionToolPolicy || null),
    normalizeToolMode(connection.toolMode),
    resolvePolicy({}, lanePolicy, connection._sessionToolPolicy || null),
  )).concat(callerCatalogTools(connection)); // closed-book keeps local servers only; the sender's tools ride regardless
  connection._turnCatalog = stamped;
  connection._turnSkills = skills;
  // THE USUAL TOOLS — the lane's standing tools + this chat's kept list (a new
  // chat starts from the being's working set: its experience). Named in the
  // HUD by signature, never wired; frozen for the chat (keepWireOrder keeps
  // the list in its order), so the HUD never re-reads a chat (tool-hud.js).
  const standing = await standingToolsForLane(connection.walletAddress, connection.companion?.neumaId || null);
  const usual = await turnDisclosure(connection, stamped, catalogId, standing);
  connection._turnUsualTools = keepWireOrder(connection, stamped.filter((tool) => usual.has(catalogId(tool)) && tool.access !== 'denied'), catalogId);
  connection._turnDisclosedToolIds = new Set(connection._turnUsualTools.map(catalogId));
  return stamped;
};
