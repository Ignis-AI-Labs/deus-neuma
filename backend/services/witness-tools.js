/**
 * Witness tools — the lane-safe execution surface for sealed peers.
 *
 * A sealed peer now carries the SAME platform surface a bound neuma does
 * (ruling, 2026-07-26): the sector lane, The Craft, the campaign bench, the lead
 * ledger, the social reads, the press, the memory hand, the task lists — all
 * assembled by `platformToolsFor` and executed by `dispatchPlatformTool`, the
 * one chain both runtimes drive. Before that, this file hand-rolled a much
 * smaller catalog, and capabilities that had shipped long ago were invisible
 * here; a peer can only report such a thing as "missing".
 *
 * What stays witness-only: a coding shell that reads the live checkout
 * through a kernel overlay (writes land lane-side), and its own context map.
 * Neuma-only by seat: the wallet tools and `request_seal`. Live-repository
 * promotion, background jobs, browser control, remotes, and deployment remain
 * separate consequence tiers for everyone. Every generic MCP call still
 * crosses policy, rogue-argument checks, the path sandbox, and the audit log.
 *
 * Split under the size law (SIZE breakdown 2026-08-26): the path-scope gate
 * lives in witness-path-grants.js, the coding/context handlers in
 * witness-coding-tools.js, the chip sink in witness-tool-events.js. This file
 * keeps the catalog, the act gate, and the dispatch loop, and re-exports
 * `handleContextTool` for its existing readers.
 */
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { readExecutionToolPolicy } from './execution-tool-policy.js';
import { operationReceiptLabel } from './operation-result.js';
import { neutraliseResultText } from './tool-exchange.js';
import { persistOverCapResult } from './portal-tool-result-store.js';
import { compressToolResult } from '../../core/runtime/tool-result-compressor.js';
import { extractMCPContent } from '../routes/mcp-routes.js';
import { mcpService } from './mcp.js';
import { checkToolArgs } from './rogue-detector.js';
import { isAccessRequestTool, handleAccessRequestTool, ACCESS_REQUEST_TOOL } from './access-request-being-tools.js';
import { sensitiveGrantCovers } from './sensitive-grants.js';
import {
  applyToolMode, checkToolAccess, GLOBAL_DEFAULTS, normalizeToolMode,
  resolvePolicy,
} from './tool-policy.js';
import { gateAct } from './act-gate.js';
import { applyProtocolGuard } from './protocol-guard.js';
import { collectPathArgs, createSandboxedCallTool, isWriteOperation } from './tool-sandbox.js';
import { withFsPrimitives, withFsRouting, fsPolicyTarget, fsRetiredHint } from './fs-primitives.js';
import { retiredToolHint } from './intents/retired-tools.js';
import { unknownToolHint, unreadArgsResult } from './tool-hud.js';
import { ensureFocusGroundReachable } from './focus-ground.js';
import { noteTurnSandboxSource, ensureTurnSandbox } from './turn-sandbox.js';
import { handleCodingTool, handleContextTool } from './witness-coding-tools.js';
import { hydrateWitnessPathGrants, witnessPathScopeGate } from './witness-path-grants.js';
import { sendToolEvent } from './witness-tool-events.js';
// The platform surface, from its decomposed homes directly (size-law
// breakdown end-sweep) — this was the last static edge closing the
// portal-stream import ring; the witness lane reads the leaves, not the
// orchestrator barrel.
import { platformToolsFor } from './portal-tool-catalog.js';
import { dispatchPlatformTool } from './portal-tool-dispatch.js';
import { recordWorkAgainstFocus } from './portal-tool-loop.js';
import { sweepBatchIntents } from './intents/intent-sweep.js';
// The lazy native surface (ruling, 2026-09-02): the search hand and the
// disclosure law are the seat-agnostic half of being-tool-surface.js — read
// live from there, never re-implemented here (THE MIRROR LAW, both ways).
import { TOOL_DOORS } from './being-tool-surface.js';
import { createLogger } from './logger.js';

const log = createLogger('WitnessTools');

import { WITNESS_CODING_TOOLS } from './coding-tool-definitions.js';
export { WITNESS_CODING_TOOLS } from './coding-tool-definitions.js';

export const WITNESS_CONTEXT_TOOLS = Object.freeze([
  Object.freeze({
    server: 'context',
    name: 'map_read',
    description: 'Read the exact CONTEXT MAP data for your own sealed witness lane. Use view="composition" for this turn\'s section/token anatomy, view="field" for a paged read of your crystallized-memory graph, or view="node" with a nodeId (a 16-char hex node id from a field page) to inspect ONE node — its graph position, provenance, lifecycle, every neighbor edge (includeNeighbors, default on), and optionally its full-fidelity source (includeSource). This exposes no other being\'s lane and does not imply sight of the operator UI.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        view: Object.freeze({ type: 'string', enum: Object.freeze(['composition', 'field', 'node']) }),
        offset: Object.freeze({ type: 'integer', minimum: 0, description: 'Field node offset' }),
        limit: Object.freeze({ type: 'integer', minimum: 1, maximum: 25, description: 'Field nodes per page' }),
        edgeOffset: Object.freeze({ type: 'integer', minimum: 0, description: 'Field edge offset' }),
        edgeLimit: Object.freeze({ type: 'integer', minimum: 1, maximum: 50, description: 'Field edges per page' }),
        nodeId: Object.freeze({ type: 'string', description: 'Node view: 16-char hex node id from a field page' }),
        includeNeighbors: Object.freeze({ type: 'boolean', description: 'Node view: list every edge touching the node (default true)' }),
        includeSource: Object.freeze({ type: 'boolean', description: 'Node view: reopen the node\'s full-fidelity source when one exists (default false)' }),
      }),
    }),
  }),
]);

const CODING_NAMES = new Set(WITNESS_CODING_TOOLS.map((tool) => tool.name));
const CONTEXT_NAMES = new Set(WITNESS_CONTEXT_TOOLS.map((tool) => tool.name));
// A bounded research result; larger successes persist before compression.
const TOOL_RESULT_LIMIT = 60000;
const WITNESS_DEFAULTS = Object.freeze({
  ...GLOBAL_DEFAULTS,
  // Third-party seats keep explicit execution consent; the local neuma's
  // autonomous overlay default must not widen a witness's authority.
  coding: Object.freeze({
    allowed: Object.freeze(['sandbox_status', 'inspect']),
    denied: Object.freeze([]),
    requireApproval: Object.freeze(['execute', 'ground_git', 'ground_sync', 'sandbox_recover']),
  }),
  // This exists only in the witness runtime. Applying it globally would make
  // an unrelated future MCP tool named context/map_read policy-allowed for a
  // neuma even though this handler and its lane confinement are witness-only.
  context: Object.freeze({
    allowed: Object.freeze(['map_read']), denied: Object.freeze([]), requireApproval: Object.freeze([]),
  }),
  // THE CRAFT. Reading one's own installed instructions is not an act on the
  // world — it is the peer picking up a manual — so it is allowed, exactly as
  // it is for a neuma. Witness-local for the same reason `context` is: the
  // neuma runtime dispatches skills before policy is ever consulted, so a
  // global entry would be dead there while quietly pre-allowing any future
  // MCP server that happened to be named `skill`. Observe mode still holds it
  // (`use_skill` is not a READ_TOOL) — the same held-in-observe the neuma has.
  skill: Object.freeze({
    allowed: Object.freeze(['use_skill']), denied: Object.freeze([]), requireApproval: Object.freeze([]),
  }),
  // A peer reading ITS OWN wallet address and public balance (ruling, 2026-07-26).
  // Declared so the catalog STAMP matches what actually happens: the wallet
  // branch resolves before any policy is consulted, exactly as it does for a
  // neuma, and an unstamped `wallet` server would advertise a card that never
  // appears. There is no send tool at this seat to pair it with.
  wallet: Object.freeze({
    allowed: Object.freeze(['wallet_view']), denied: Object.freeze([]), requireApproval: Object.freeze([]),
  }),
});

const toolIdentity = (match, catalog) => {
  const toolName = String(match.toolName || match.tool || '').replace(/^[^/]+\//, '');
  const explicitServer = match.server || (String(match.tool || '').includes('/') ? String(match.tool).split('/')[0] : null);
  const candidates = catalog.filter((tool) =>
    tool.name === toolName && (!explicitServer || tool.server === explicitServer));
  if (candidates.length !== 1) return null;
  const [definition] = candidates;
  return { definition, server: definition.server, toolName };
};

// Pure — the tier stamp the prompt catalog shows at turn start. The execution
// path gates through act-gate.js, which resolves the same three policy layers
// at call time (with this same map_read observation carve-out), so a witness
// is never told one thing and refused another.
const effectiveAccess = (policy, mode, server, toolName, operatorPolicy) => {
  const base = checkToolAccess(policy, server, toolName);
  // map_read is pure observation, so witness observe mode keeps it open
  // without broadening READ_TOOLS by name across unrelated servers.
  const contextRead = server === 'context' && toolName === 'map_read';
  return { base, effective: contextRead ? base : applyProtocolGuard(applyToolMode(base, mode, toolName),
    mode, server, toolName, operatorPolicy[`${server}/${toolName}`] === 'allowed') };
};

// impure — resolve this witness's three policy layers for the turn.
const policyFor = async (connection) => {
  const laneId = connection.companion?.neumaId;
  const lanePolicy = await readExecutionToolPolicy(laneId);
  return { policy: resolvePolicy(WITNESS_DEFAULTS, lanePolicy, connection._sessionToolPolicy || null),
    operatorPolicy: resolvePolicy({}, lanePolicy, connection._sessionToolPolicy || null) };
};

// impure — the lane's persisted policy, read at the instant of the act so an
// operator's mid-turn change gates the very next call; an unreadable store
// refuses the act rather than falling back to defaults or session grants.
const lanePolicyFor = async (connection) => {
  const laneId = connection.companion?.neumaId;
  return readExecutionToolPolicy(laneId);
};

// impure — every gated witness act crosses the ONE act gate (act-gate.js) on
// the witness defaults; denial chips ride the seat's own tool-event sink, so
// a resumed chat rebuilds them like any other chip.
const gateWitnessAct = async (ws, connection, identity, args, observeExempt = false) => {
  // fs/edit's delete sub-op gates on the delete row — never inside a blanket edit grant.
  const target = fsPolicyTarget(identity.server, identity.toolName, args);
  return gateAct(connection, {
    server: target.server,
    tool: target.tool,
    toolLabel: `${identity.server}/${identity.toolName}`,
    args,
    lanePolicy: await lanePolicyFor(connection),
    mode: normalizeToolMode(connection.toolMode),
    defaults: WITNESS_DEFAULTS,
    observeExempt,
    emit: (event) => sendToolEvent(ws, connection.companion, event),
  });
};

// The lane's context-map read moved to witness-coding-tools.js; this re-export
// keeps its existing readers (context-map-node.test.js) standing unchanged.
export { handleContextTool };

/**
 * Build the exact reach this witness has during this turn — the tool catalog,
 * its sandbox, and the craft menu, every entry stamped with the tier the gate
 * will enforce (the skills menu returns from HERE: one read is one truth, so
 * the library shown can never disagree with the tool handed).
 *
 * THE LAZY WIRE (Design note, 2026-09-02 — the same economy the being seat holds):
 * on a tool-capable route (`nativeTools`) the catalog carries the read-only
 * search hand `system/tool_search`, and the per-turn disclosure set opens
 * empty. The loop (witness-tool-loop.js) wires only the search hand, the
 * always-wired fs hands, and what prior rounds disclosed — recomputed every
 * round from this stash, exactly as `disclosedNativeTools` reads it at the
 * being seat. A text-protocol route keeps the full prompt catalog and no
 * search hand, byte-identical to before.
 */
export const toolsForWitness = async (connection, sourceRoot, { nativeTools = false } = {}) => {
  const laneId = connection.companion?.neumaId;
  // Past grants come onto the connection BEFORE the catalog is stamped, so
  // the tiers shown are the tiers the witness actually meets.
  if (laneId) {
    await hydrateWitnessPathGrants(connection, await readExecutionToolPolicy(laneId));
  }
  await ensureFocusGroundReachable(connection);
  // LOAD ON DEMAND (ruling, 2026-10-04): the shell is prepared by the first
  // coding act (turn-sandbox.js), never swept before every message. A broken or
  // refused snapshot still costs the peer its shell, never its turn.
  noteTurnSandboxSource(connection, sourceRoot && laneId ? { laneId, sourceRoot } : null);
  const mcpTools = withFsPrimitives(mcpService.getToolsContext().available_tools || []);
  const { policy, operatorPolicy } = await policyFor(connection);
  const mode = normalizeToolMode(connection.toolMode);
  // THE PLATFORM SURFACE — assembled by the SAME builder the neuma runtime
  // uses; a hand-rolled subset here made shipped capabilities read as "missing".
  const { tools: platformTools, skills } = await platformToolsFor(connection, { seat: 'witness' })
    .catch((err) => {
      // A broken store must cost the peer its craft, not its whole turn.
      log.warn('platform surface unavailable — witness keeps its lane tools', { laneId, err: err.message });
      return { tools: [], skills: [] };
    });
  const catalog = [
    ...mcpTools,
    ACCESS_REQUEST_TOOL,
    ...(sourceRoot ? WITNESS_CODING_TOOLS : []),
    ...WITNESS_CONTEXT_TOOLS,
    ...platformTools,
    // The search hand rides LAST, and only when the wire can answer it: a
    // text-protocol route has no next-round schemas to activate, so teaching
    // the hand there would be a promise the seat cannot keep.
    ...(nativeTools ? TOOL_DOORS : []),
  ];
  const stamped = Object.freeze(catalog.map((tool) => Object.freeze({
    ...tool,
    access: effectiveAccess(policy, mode, tool.server, tool.name, operatorPolicy).effective,
  })));
  // The flight check reports the surface THIS turn is holding — the stamped
  // catalog, the sandbox, and the craft — so it reads them from here rather
  // than assembling a second set that could differ from the one in flight.
  connection._turnCatalog = stamped;
  connection._turnSkills = skills;
  // Disclosure is TURN state: every new turn opens with nothing disclosed,
  // so a stale schema from a previous sitting never rides this one's wire.
  connection._turnDisclosedToolIds = new Set();
  return { sandbox: null, shell: Boolean(sourceRoot && laneId), skills, tools: stamped };
};

/** Execute calls against the catalog advertised for this witness turn. */
export const processWitnessToolCalls = async (ws, connection, calls, catalog, sandbox) => {
  connection._turnCatalog ||= catalog;
  const results = [];
  const laneId = connection.companion?.neumaId;
  // The ground is declared to the filesystem server HERE, on the execution
  // path, not only in toolsForWitness: a caller that reaches this function
  // directly would otherwise clear every gate and still die at the server,
  // which enforces its own roots below all of them. Idempotent and cheap —
  // ensureFilesystemRoots is a no-op once the root is covered.
  await readExecutionToolPolicy(laneId);
  await ensureFocusGroundReachable(connection);
  const sandboxedCall = withFsRouting(createSandboxedCallTool(mcpService, connection, neumaWorkspace));
  for (const match of calls) {
    if (connection.activeTurn?.signal.aborted) break;
    if (match._argsError !== undefined) { results.push(unreadArgsResult(match.tool || match.toolName, match._argsError)); continue; }
    const identity = toolIdentity(match, connection._turnCatalog);
    if (!identity) {
      const tool = match.tool || match.toolName || 'unknown';
      const bare = String(tool).replace(/^[^/]+\//, '');
      const holders = (connection._turnCatalog || []).filter((t) => t?.name === bare);
      // a name two servers hold is ambiguous, not unknown — the plain refusal names that truth
      const hint = fsRetiredHint(bare) || retiredToolHint(tool)
        || (holders.length > 1 ? null : unknownToolHint(bare, connection._turnCatalog, match.server || null));
      sendToolEvent(ws, connection.companion, { tool, status: 'unavailable', ...(hint ? { detail: hint } : {}) });
      results.push({ tool, status: 'unavailable', error: hint || 'tool identity was not uniquely advertised for this witness' });
      continue;
    }
    const args = match.args || {};
    // WHAT WAS DONE, AGAINST WHAT IT WAS FOR — the same seam the neuma runtime
    // records at, and for the same reason: the crash this exists for happens
    // BETWEEN turns, so anything the peer had to remember to declare is exactly
    // what never gets written. This loop has several exits, so every one of them
    // lands here rather than each remembering to record for itself.
    //
    // Only an act that actually SUCCEEDED counts. A denied or failed call
    // produced nothing, and filing it as work would make a task's record claim
    // progress that never happened. Bookkeeping never costs the call: the
    // recorder is silent on failure by construction.
    const land = async (result) => {
      if (result?.status === 'ok' && result.tool !== 'record/retrieve_result') {
        result = { ...result, cap: result.cap || TOOL_RESULT_LIMIT };
        await persistOverCapResult(connection, result);
      }
      results.push(result);
      if (result?.status === 'ok') await recordWorkAgainstFocus(connection, identity.toolName, args);
      return result;
    };
    if (identity.server === 'coding' && CODING_NAMES.has(identity.toolName)) {
      // The shell is prepared HERE, at the first act that needs it (turn-sandbox.js).
      const active = await ensureTurnSandbox(connection)
        || (Object.hasOwn(connection, '_turnSandbox') ? connection._turnSandbox : sandbox);
      await land(await handleCodingTool(ws, connection, identity, args, active, gateWitnessAct));
      continue;
    }
    if (identity.server === 'context' && CONTEXT_NAMES.has(identity.toolName)) {
      // map_read is pure observation — observeExempt keeps it open in observe
      // mode, the same carve-out the catalog stamp carries.
      const gate = await gateWitnessAct(ws, connection, identity, args, true);
      if (!gate.ok) {
        results.push(gate.result);
      } else {
        await land(await handleContextTool(ws, connection, args));
      }
      continue;
    }
    // THE PLATFORM SURFACE — one shared chain, routed BEFORE the generic MCP
    // path because none of these reach an MCP server: they execute in-process
    // and carry their own gates (channel custody for a send, crew for a stage,
    // the ACTS policy for the rest). Only the CATALOG above decides what may
    // arrive here — a tool this seat was never offered can never be dispatched.
    const platformResult = await dispatchPlatformTool(match, {
      ws,
      connection,
      companion: connection.companion,
      policy: await readExecutionToolPolicy(laneId),
      toolMode: normalizeToolMode(connection.toolMode),
      args,
    });
    if (platformResult) {
      await land(platformResult);
      continue;
    }

    if (isAccessRequestTool(match)) {
      results.push(await handleAccessRequestTool(ws, connection,
        await readExecutionToolPolicy(laneId),
        normalizeToolMode(connection.toolMode), match, args, { sendToolEvent }));
      continue;
    }

    const gate = await gateWitnessAct(ws, connection, identity, args);
    if (!gate.ok) {
      results.push(gate.result);
      continue;
    }
    const argsCheck = checkToolArgs(identity.server, identity.toolName, args, {
      grantCovers: (rawArgs) => collectPathArgs(rawArgs)
        .some((p) => sensitiveGrantCovers(connection._sensitiveGrants, isWriteOperation(identity.toolName) ? 'edit' : 'read', p)),
    });
    if (!argsCheck.safe) {
      const tool = `${identity.server}/${identity.toolName}`;
      sendToolEvent(ws, connection.companion, { tool, status: 'unsafe_args', detail: argsCheck.reason });
      results.push({ tool, status: 'unsafe_args', error: argsCheck.reason });
      continue;
    }
    // Scope AFTER the tool tier, exactly as the neuma runtime orders it.
    if (!(await witnessPathScopeGate(ws, connection, identity, args))) {
      results.push({
        tool: `${identity.server}/${identity.toolName}`,
        status: 'denied',
        error: 'the operator did not open that path',
      });
      continue;
    }
    const tool = `${identity.server}/${identity.toolName}`;
    sendToolEvent(ws, connection.companion, { tool, status: 'executing' });
    try {
      const raw = await sandboxedCall(identity.server, identity.toolName, args);
      const content = extractMCPContent(raw);
      // An MCP server reports its own failures with `isError` — read it, or a
      // refused write reads as 'ok' and the being claims success (#272).
      if (raw?.isError) {
        sendToolEvent(ws, connection.companion, {
          tool, status: 'error', summary: `${identity.toolName} — refused`, detail: content.slice(0, 2000),
        });
        results.push({ tool, status: 'error', error: content });
        continue;
      }
      sendToolEvent(ws, connection.companion, {
        tool, status: 'ok', summary: identity.toolName, detail: content.slice(0, 2000),
        // Structured target, so the desk's FILES tree can re-list what changed.
        // A move/copy points at the NEW path — the file that stands there now.
        ...((() => { const p = (identity.toolName === 'edit' && typeof args?.destination === 'string' && args.destination) || collectPathArgs(args)[0]; return p ? { path: p } : {}; })()),
      });
      // `sight` RIDES THE RESULT. The sandbox stamps it when a read carried an
      // image (fs-sight.js), and this loop's own return leg reads it back with
      // sightForResults. Dropping it here would leave a peer told […] and then handed nothing — a promise
      // of a look is only worth making if the look arrives.
      await land({ tool, status: 'ok', content, ...(raw?.sight ? { sight: raw.sight } : {}) });
    } catch (error) {
      sendToolEvent(ws, connection.companion, { tool, status: 'error', summary: `${identity.toolName} — failed`, detail: error.message });
      results.push({ tool, status: 'error', error: error.message });
    }
  }

  // THE INTENT SWEEP (Stage 2): acts the peer FILED this batch settle here, receipts riding the same round.
  results.push(...await sweepBatchIntents(connection, (event) => sendToolEvent(ws, connection.companion, event)));
  return results;
};

/** One bounded result suitable for a native tool-result message. A result may
 *  carry its OWN cap — skill instructions need real room, and the flat 12000
 *  would cut a summoned protocol mid-step and hand the peer a truncated law.
 *  Everything without a cap stays on the default (tool-exchange.js's rule). */
export const formatWitnessToolResult = (result) => {
  // Prefer whichever field the result actually carries. Keying off `ok` alone
  // silently dropped the body of every non-ok status that explains itself in
  // `content` rather than `error` — a `held` repeat rendered as bare
  // "tool -> held" with no reason, which is worse than saying nothing.
  const content = typeof result.content === 'string' && result.content
    ? result.content
    : String(result.error || '');
  const cap = result.cap || TOOL_RESULT_LIMIT;
  const bounded = compressToolResult(content, { cap, ref: result.ref }).compressed;
  // The wrapper's own tags never close from inside a result, and no control
  // token opens a turn from inside one (tool-exchange.js).
  return neutraliseResultText(`${result.tool} -> ${result.status}${operationReceiptLabel(result)}${bounded ? `\n${bounded}` : ''}`);
};

/** Bounded text-protocol results for the witness's next model round. */
export const formatWitnessToolResults = (results) => {
  const body = results.map(formatWitnessToolResult).join('\n\n');
  return `<tool_response>\n${body}\n</tool_response>\n\nUse the evidence above. Continue with another tool only when necessary; otherwise report what was actually observed.`;
};
