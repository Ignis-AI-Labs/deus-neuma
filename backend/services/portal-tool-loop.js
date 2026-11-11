/**
 * THE TOOL LOOP — `processToolCalls`: dialect repair, the repeat guard,
 * policy, rogue-args, scope gaps, the ONE approval card, sandboxed execution,
 * the work record, and CCR-lite over-cap persistence for every act a round
 * attempted — plus the grant plumbing that lands an operator's yes at every
 * layer that can block it.
 *
 * Extracted VERBATIM from portal-stream.js (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 9 / #278). Loop module — it
 * imports the dispatch fan and shared leaves DIRECTLY, never portal-stream
 * (direction law: leaf ← family ← catalog ← dispatch ← loop ← orchestrator).
 * portal-stream re-exports `recordWorkAgainstFocus` (witness-tools.js runs
 * the same flow from its own lane) and keeps the old private names alive for
 * its orchestrator call sites and the `__test` barrel.
 *
 * The per-call gate inside `processToolCalls` (policy → rogue-args → scope
 * gaps → sandbox pre-check → the ONE card → execution → work record → CCR
 * persist) is one sequential invariant — the W2-007 audit test pins that
 * ordering structurally against this file's source. The gate's side-state
 * services live in their own leaves and are consulted from here:
 * portal-tool-grants.js (the operator's yes at every layer) and
 * portal-tool-result-store.js (CCR-lite persist-first-then-ref).
 */
import { yieldForQueuedThought } from './queued-action-handoff.js';
import { createLogger } from './logger.js';
import { mcpService } from './mcp.js';
import { neumaWorkspace, parseToolCalls } from '../../core/index.js';
import { resolvePolicy, checkToolAccess, applyToolMode, normalizeToolMode, READ_TOOLS, GLOBAL_DEFAULTS, retiredToolHint } from './tool-policy.js';
import { ACT_REFUSALS, grantAlwaysAllow, refusalForDecision } from './act-gate.js';
import { capturePolicyGrant } from './policy-grant-context.js';
import { readExecutionToolPolicy } from './execution-tool-policy.js';
import { applyProtocolGuard, holdForWake } from './protocol-guard.js';
import { landsInOpenFolder } from './open-folder-autonomy.js';
import { requestToolApproval } from './tool-approval.js';
import { checkToolArgs } from './rogue-detector.js';
import { requestablePattern, sensitiveGrantCovers } from './sensitive-grants.js';
import { createSandboxedCallTool, findUngrantedReadPaths, findUngrantedWritePaths, normalizeToolArgs, resolveGrantDir, isWriteOperation, collectPathArgs, checkPathAccess, logToolCall } from './tool-sandbox.js';
import { withFsPrimitives, withFsRouting, fsPolicyTarget, fsRetiredHint } from './fs-primitives.js';
import { focusGroundOf, focusGroundRoots, ensureFocusGroundReachable } from './focus-ground.js';
import { resolveCeremonyScratchDir, ceremonyWriteRoots } from '../../core/birth/ceremony-write.js';
import { sweepIntents } from './intents/intent-sweep.js';
import { recordBenchmarkToolCall } from './benchmark-tool-trail.js';
import { extractMCPContent } from '../routes/mcp-routes.js';
import { safeChatId } from '../../core/tasks/task-chat.js';
import { recordWork, artifactFor } from '../../core/tasks/task-work.js';
import {
  toolFormatters,
  toolSummary as _toolSummary, toolFailureSummary as _toolFailureSummary,
  toolActivitySummary as _toolActivitySummary, sendToolEvent as _sendToolEvent,
  chipDetail as _chipDetail,
} from './portal-tools/tool-events.js';
import { dispatchPlatformTool } from './portal-tool-dispatch.js';
import {
  hydratePathGrants as _hydratePathGrants,
  grantReadScope as _grantReadScope,
  grantApprovedScope as _grantApprovedScope,
} from './portal-tool-grants.js';
import {
  persistOverCapResult as _persistOverCapResult,
  TOOL_RESULT_SESSION_BYTE_CAP,
} from './portal-tool-result-store.js';
import { createTurnToolEpochs, heldCallResult, recordCallOutcome, recordIntentReceipts } from './portal-tool-epochs.js';
import { heldRepeatResult } from './witness-tool-epochs.js';
import { unwrapCalls, unknownToolHint } from './tool-hud.js';
import { refusedBeforeDispatch } from './turn-catalog-gate.js';
import { beginTurnOperation, finishTurnOperation, checkpointTurnEpoch } from './turn-operation-checkpoint.js';
import { scopeRecoveryCall } from './coding-recovery-repeat.js';
import { toolRepeatEvent } from './tool-repeat-event.js';
import { withBenchmarkGroundMirror } from './benchmark-exec-bridge.js';
import { noteWorkingSetCall } from './sitting-disclosure.js';
import { fitRead } from './read-room.js';
import { tripMandateForLane } from './marketing/mandate/mandate-tripwire.js';

const log = createLogger('Portal');

// Process tool calls embedded in LLM response text.
// Supports two formats:
//   Neuma native:  [TOOL: server/tool_name {"arg": "val"}]
//   Gemma 4 native:  <tool_call>call:server:tool_name {"arg": "val"}</tool_call>
// A call with no server (Qwen-native bare <function=tool>) resolves against the
// registry of available tools by tool name; unresolvable stays null and is
// reported unavailable downstream. An EXPLICIT server is trusted only when it
// actually hosts a connected tool — a bogus/placeholder prefix (e.g. a model that
// emits the literal "server/…" from the format template, or a stale server name)
// falls back to resolving by the tool name, so a good tool name still routes
// instead of failing with […].
const _resolveServer = (call, availableTools) => {
  const byTool = availableTools.find(
    t => t.name === call.toolName || t.name?.endsWith(`/${call.toolName}`)
  )?.server || null;
  if (call.server) {
    const serverIsReal = availableTools.some(t => t.server === call.server);
    return serverIsReal ? call.server : byTool;
  }
  return byTool;
};

// pure — a substrate that smashes server and tool into ONE name
// ("filesystem_write_file", observed live from qwen3.5 during crystallization)
// still routes: when the literal name matches no connected tool but
// `<server>_<tool>` of one does, split it back apart. A name that already
// resolves passes through untouched — `write_file` itself contains an
// underscore, so this only ever fires on names that would otherwise be
// unavailable.
// The separators substrates actually put between server and tool. `_` was the
// first seen (qwen3.5's "filesystem_write_file"). `:` arrived from Ollama on
// 2026-08-05 as "filesystem:create_directory" — it matched nothing, the act
// was reported UNAVAILABLE, and crystallization completed having done nothing,
// while the being had named its act correctly by OUR OWN documentation: the
// ceremony's text protocol literally shows `<tool_call>call:server:tool_name`.
// A model blending that with native calling is following instructions, so the
// resolver meets it rather than failing the birth over punctuation.
const TOOL_NAME_SEPARATORS = Object.freeze([':', '__', '_', '.', '/', '-']);

const _unsmashToolName = (call, availableTools) => {
  if (!call?.toolName || call.server) return call;
  if (availableTools.some((t) => t.name === call.toolName)) return call;
  const bare = (name) => (name?.includes('/') ? name.split('/').pop() : name);
  const hit = availableTools.find(
    (t) => TOOL_NAME_SEPARATORS.some((sep) =>
      `${t.server}${sep}${t.name}` === call.toolName || `${t.server}${sep}${bare(t.name)}` === call.toolName)
      || t.name?.replace('/', '_') === call.toolName,
  );
  return hit ? { ...call, server: hit.server, toolName: bare(hit.name) } : call;
};

/**
 * One real act, filed against whatever this chat has in focus. Reads and writes
 * the being's own ledger, so it is deliberately cheap and deliberately silent:
 * a failure here must never cost the tool call that actually succeeded.
 *
 * Exported because a sealed AI witness runs the SAME flow from its own lane —
 * the identical reason `dispatchPlatformTool` is exported. A peer has had
 * task_focus since the platform surface was unified, but its tool loop never
 * called this, so focus set a pointer nothing ever wrote to: the work record
 * stayed empty and INTERRUPTED — which is DERIVED from work plus silence —
 * could never become true for a witness no matter what it did or how it died.
 *
 * Nothing here is neuma-shaped: it reads the lane off `companion.neumaId` and
 * the chat off `connection.sessionId`, both of which a witness connection
 * carries (witness-stream mints a session per sitting).
 *
 * impure — encrypted disk read/write via neumaWorkspace
 */
export const recordWorkAgainstFocus = async (connection, toolName, args) => {
  const neumaId = connection?.companion?.neumaId;
  const chatId = safeChatId(connection?.sessionId);
  if (!neumaId || !chatId) return;
  const act = artifactFor(toolName, args);
  if (!act) return;
  try {
    await neumaWorkspace.updateTaskLedger(neumaId, (ledger) => {
      const { ledger: next, recorded } = recordWork(ledger, { chatId, ...act }, { now: new Date().toISOString() });
      return recorded ? next : null; // declines with nothing in focus → no write
    });
  } catch (err) {
    log.debug('work not recorded against focus', { neumaId, tool: toolName, err: err.message });
  }
};

// Pure — the ACTS a round attempted: the substrate's native calls when it made
// them, the parsed text otherwise — the loop and its protocol reminder can never disagree.
const _roundActs = (nativeToolCalls, response) => unwrapCalls(nativeToolCalls.length > 0 ? nativeToolCalls : parseToolCalls(response, { told: true })); // system/call → the tool it names (tool-hud.js); unreadable args are told

// Executes every tool call in a completed response and returns the outcomes so
// the caller can hand them back to the consciousness for a follow-up round —
// hands need to feel what they touched. Each result: { tool, status, content?, error? }.
const processToolCalls = async (ws, response, connection, nativeToolCalls = [], turnEpochs = null) => {
  const { companion } = connection;
  const grantOrigin = capturePolicyGrant(connection);
  // When the substrate spoke through native function calling, use those calls
  // directly — the text response is narration, not a duplicate tool call. Fall
  // back to text parsing only when no native calls arrived (text-protocol
  // substrates, or a native call that the model chose to phrase as text).
  const matches = _roundActs(nativeToolCalls, response);
  const results = [];
  turnEpochs ||= createTurnToolEpochs();

  // Resolve tool policy for this neuma
  const neumaPolicy = await readExecutionToolPolicy(companion?.neumaId);
  // Read-scope grants the operator made in past sessions take effect here.
  await _hydratePathGrants(connection, neumaPolicy);
  // ...and the folder standing open in the Explorer is declared to the
  // filesystem server, so the ground the policy admits is the ground the
  // server will actually serve.
  await ensureFocusGroundReachable(connection, { logger: log });
  // The operator's standing stance for this session (ask / auto / observe)
  const toolMode = normalizeToolMode(connection.toolMode);

  // Sandboxed call tool — fs/* routes to the organ in-sandbox; the exec bridge (#531) mirrors ground writes container-side.
  const sandboxedCallTool = withBenchmarkGroundMirror(withFsRouting(createSandboxedCallTool(mcpService, connection, neumaWorkspace)), connection);

  for (const rawMatch of matches) {
    // The operator's interrupt ends the batch — a call already executing
    // completes, but nothing further starts.
    if (connection.activeTurn?.signal.aborted) break;

    // Substrate dialect repair: a smashed "<server>_<tool>" name routes to the
    // real tool instead of reading as unavailable. The list is BEING-FACING:
    // the seven fs primitives stand where the 16 organ spellings used to.
    const match = noteWorkingSetCall(connection, recordBenchmarkToolCall(connection, await scopeRecoveryCall(_unsmashToolName(rawMatch, withFsPrimitives(mcpService.getToolsContext()?.available_tools || [])), connection)));
    const { toolName, args } = match;
    const refused = refusedBeforeDispatch(connection, match); if (refused) { results.push(refused); continue; } // unreadable args, a nested door, a tool never offered
    // Repeats retain their prior verdict; recovery is scoped to observed shell state.
    const epoch = turnEpochs.epoch;
    const resultIndex = results.length;
    let operation, releaseActScope = null; // a one-act yes's scope (house work) is released once the act is done
    try {
      const held = heldCallResult(turnEpochs, match, epoch);
      if (held) {
        results.push(held);
        _sendToolEvent(ws, companion, toolRepeatEvent(held));
        continue;
      }

      operation = await beginTurnOperation(turnEpochs, match, epoch);
      // PLATFORM CAPABILITIES — one chain, driven by both seats.
      const platformResult = await dispatchPlatformTool(match, {
        ws, connection, companion, policy: neumaPolicy, toolMode, args,
      });
      if (platformResult) {
        await _persistOverCapResult(connection, platformResult); // a long web page or catalog stays retrievable, never a dead cut
        results.push(platformResult);
        continue;
      }
      // Verify the tool exists on the BEING-FACING catalog — a retired organ spelling
      // is answered with the primitive that absorbed it, never a bare "unavailable".
      const availableTools = withFsPrimitives(mcpService.getToolsContext()?.available_tools || []);
      const serverName = _resolveServer(match, availableTools);
      const toolLabel = serverName ? `${serverName}/${toolName}` : toolName;
      const toolExists = serverName !== null &&
        availableTools.some(t => t.name === toolName || t.name === `${serverName}/${toolName}`);
      if (!toolExists) {
        const hint = fsRetiredHint(toolName) || retiredToolHint(toolName) || unknownToolHint(toolName, connection._turnCatalog, match.server, connection._turnIntents);
        results.push({ tool: toolLabel, status: 'unavailable', error: hint });
        _sendToolEvent(ws, companion, { tool: toolLabel, status: 'unavailable', detail: hint });
        continue;
      }

      // THE ONE CARD (Stage 1, act-gate doctrine): policy, read scope, and
      // write scope used to raise three separate cards per call — and an
      // ALWAYS could be persisted for a call the sandbox was always going to
      // refuse. Every cheap check now runs BEFORE any card, and a single card
      // names everything a yes grants. The sandbox still enforces at
      // execution; this gate decides what is ASKED.

      // Policy — resolved per call so an ALWAYS grant earlier in this same
      // batch already covers the calls after it. No card yet: a denial
      // (policy or observe-hold) refuses on the spot, in the one vocabulary.
      // fs/edit's delete sub-op carries the delete row's identity, always.
      const policy = resolvePolicy(GLOBAL_DEFAULTS, neumaPolicy, connection._sessionToolPolicy || null);
      const policyTarget = fsPolicyTarget(serverName, toolName, args);
      const baseAccess = checkToolAccess(policy, policyTarget.server, policyTarget.tool);
      // The guard reads the POLICY identity (policyTarget) — an fs/edit delete
      // pauses in AUTO on the delete row, not the edit row (protocol-guard.js).
      const explicit = resolvePolicy({}, neumaPolicy, connection._sessionToolPolicy || null)[`${policyTarget.server}/${policyTarget.tool}`] === 'allowed'
        || landsInOpenFolder({ ...policyTarget, args, ground: focusGroundOf(connection) });
      const access = holdForWake(connection, applyProtocolGuard(applyToolMode(baseAccess, toolMode, toolName), toolMode, policyTarget.server, policyTarget.tool, explicit), policyTarget.server, policyTarget.tool);
      if (access === 'denied') {
        // An observe-mode hold reads differently from a policy denial —
        // the operator chose to watch, the neuma should know which it was.
        const refusal = baseAccess !== 'denied' ? ACT_REFUSALS.held : ACT_REFUSALS.policyDenied;
        results.push({ tool: toolLabel, status: 'denied', error: refusal.error });
        _sendToolEvent(ws, companion, {
          tool: toolLabel, status: 'denied', summary: `${toolName} — ${refusal.summary}`,
        });
        continue;
      }
      const policyApprovalNeeded = access === 'approval_required';

      // Check tool arguments for dangerous patterns — with the lane's
      // sensitive grants consulted, so an operator-granted .env stops reading
      // as a jailbreak while every ungranted secret still dies here. Before
      // any card: a rogue call never spends the operator's attention.
      const argsCheck = checkToolArgs(serverName, toolName, args, {
        grantCovers: (rawArgs) => collectPathArgs(rawArgs)
          .some((p) => sensitiveGrantCovers(connection._sensitiveGrants, isWriteOperation(toolName) ? 'edit' : 'read', p)),
      });
      if (!argsCheck.safe) {
        results.push({ tool: toolLabel, status: 'unsafe_args', error: argsCheck.reason });
        _sendToolEvent(ws, companion, { tool: toolLabel, status: 'unsafe_args', summary: `${toolName} — blocked`, detail: argsCheck.reason });
        // A blocked call by the CMO pauses its mandate (marketing/mandate/) — never throws.
        await tripMandateForLane({ wallet: connection.walletAddress, laneId: companion?.neumaId, kind: /mandate|tool-policy/.test(argsCheck.reason + JSON.stringify(args ?? {})) ? 'widen' : 'rogue', detail: `${toolLabel} was blocked: ${argsCheck.reason}` });
        continue;
      }

      // Scope gaps, computed WITHOUT cards. The gate judges the args the call
      // will RUN with (drift names healed first). A READ reaching outside the
      // lane is the operator's call; hard-denied paths never surface here
      // (grantable gaps only) — the sensitive door is request_file_access.
      const normArgs = normalizeToolArgs(toolName, args, null);
      let readScopeDirs = [];
      if (READ_TOOLS.has(toolName) && companion?.neumaId) {
        const readRoots = [
          neumaWorkspace.pathFor(companion.neumaId),
          ...(connection._grantedReadRoots || []), ...(connection._grantedWriteRoots || []), ...(connection._teamWorkspace?.root ? [connection._teamWorkspace.root] : []),
          ...focusGroundRoots(connection), // the folder open in the Explorer
        ];
        const gaps = findUngrantedReadPaths(normArgs, readRoots);
        readScopeDirs = [...new Set(await Promise.all(gaps.map((p) => resolveGrantDir(toolName, p))))];
      }
      // WRITE outside the being's own lane is the operator's call — the SAME ask as every other
      // level (ruling, 2026-07-23). Ceremony scratch is in-scope during birth; the team workspace (read
      // AND write) was granted with the approved plan that disclosed it (#171) — held, never asked.
      let writeScopeDirs = [];
      if (isWriteOperation(toolName) && companion?.neumaId) {
        const writeRoots = [
          ...ceremonyWriteRoots({
            laneRoot: neumaWorkspace.pathFor(companion.neumaId),
            scratchDir: resolveCeremonyScratchDir(process.cwd()),
            birthActive: Boolean(connection.birthSession),
          }),
          ...(connection._grantedWriteRoots || []), ...(connection._teamWorkspace?.root ? [connection._teamWorkspace.root] : []),
          ...focusGroundRoots(connection), // the folder open in the Explorer
        ];
        const gaps = findUngrantedWritePaths(normArgs, writeRoots);
        if (gaps.length > 0) {
          // Least privilege: grant the target's own directory — the operator's
          // yes/no is the governor.
          writeScopeDirs = [...new Set(await Promise.all(gaps.map((g) => resolveGrantDir(toolName, g))))];
        }
      }

      // The sandbox pre-check: a path the sandbox can NEVER serve (secret
      // patterns, install config, denied extensions) refuses here with NO
      // card — an approval is never minted for a call that was always going
      // to die. The sensitive-grant door is honored exactly as the sandbox
      // honors it at execution, and the refusal lands in the same journals.
      let sandboxDenial = null;
      for (const p of collectPathArgs(normArgs)) {
        const pathCheck = checkPathAccess(p, []);
        if (pathCheck.allowed) continue;
        const recourse = pathCheck.deniedPattern && requestablePattern(pathCheck.deniedPattern);
        if (recourse && sensitiveGrantCovers(connection._sensitiveGrants, isWriteOperation(toolName) ? 'edit' : 'read', p)) continue;
        sandboxDenial = pathCheck.reason + (recourse ? ' — request access with request_file_access' : '');
        break;
      }
      if (sandboxDenial) {
        await logToolCall(neumaWorkspace, companion?.neumaId, serverName, toolName, args, 'denied', sandboxDenial);
        results.push({ tool: toolLabel, status: 'denied', error: sandboxDenial });
        _sendToolEvent(ws, companion, { tool: toolLabel, status: 'denied', summary: `${toolName} — ${sandboxDenial}` });
        continue;
      }

      // auto is the standing yes for READ scope — grant for the session, said
      // on the desk. A write-scope grant CREATES new write reach into the
      // operator's own files, so it ALWAYS prompts, even in auto: auto governs
      // acting on reach already held, not the acquisition of new capability.
      if (readScopeDirs.length > 0 && toolMode === 'auto') {
        await _grantReadScope(connection, readScopeDirs, false, grantOrigin);
        _sendToolEvent(ws, companion, {
          tool: toolLabel, status: 'ok',
          summary: `read access to ${readScopeDirs.join(', ')} — granted (auto mode)`,
        });
        readScopeDirs = [];
      }

      // ONE card names everything a yes grants — the tool itself when policy
      // needs the operator, plus each scope the act reaches for. ALWAYS lands
      // every layer the card named.
      if (policyApprovalNeeded || readScopeDirs.length > 0 || writeScopeDirs.length > 0) {
        const scope = [
          ...(policyApprovalNeeded ? [policyTarget.tool === 'delete_file' ? `DELETE ${args?.path || 'a file'} (irreversible)` : `use ${toolLabel}`] : []),
          ...(readScopeDirs.length > 0 ? [`read access to ${readScopeDirs.join(', ')}`] : []),
          ...(writeScopeDirs.length > 0 ? [`write access to ${writeScopeDirs.join(', ')}`] : []),
        ].join(' and ');
        const decision = await requestToolApproval(connection, {
          tool: toolLabel, args, scope, signal: grantOrigin.signal,
        });
        if (decision === 'allow' || decision === 'always') {
          releaseActScope = await _grantApprovedScope(connection, { read: readScopeDirs, write: writeScopeDirs, decision, origin: grantOrigin });
          if (policyApprovalNeeded && decision === 'always') await grantAlwaysAllow(connection, policyTarget.server, policyTarget.tool, grantOrigin);
        } else {
          // The being's journal records this refusal at the broker's choke point.
          const refusal = refusalForDecision(connection, decision);
          results.push({ tool: toolLabel, status: 'denied', error: refusal.error });
          _sendToolEvent(ws, companion, {
            tool: toolLabel, status: 'denied', summary: `${toolName} — ${refusal.summary}`,
          });
          continue;
        }
      }

      // Same law on the MCP lane (#200): an approval answered after the
      // interrupt must not become a write; every call still owes its slot a
      // result.
      if (grantOrigin.signal?.aborted) {
        const refusal = ACT_REFUSALS.interrupted;
        results.push({ tool: toolLabel, status: 'denied', error: refusal.error });
        _sendToolEvent(ws, companion, {
          tool: toolLabel, status: 'denied', summary: `${toolName} — ${refusal.summary}`,
        });
        continue;
      }

      _sendToolEvent(ws, companion, { tool: toolLabel, status: 'executing', summary: _toolActivitySummary(toolName, args) });

      const result = await sandboxedCallTool(serverName, toolName, args);
      const content = extractMCPContent(result);
      // An MCP server reports its own failures with `isError`. Unread until
      // 2026-07-26, so a refused call came back as 'ok' with the refusal text
      // as its content — the being was told the act succeeded. The prompt
      // tells it never to claim completion until the result says so; that
      // instruction cannot hold if the harness reports a failure as success.
      if (result?.isError) {
        // In the LOG as well as on the screen — Aether's operator watched a
        // red "refused" chip that backend.log never mentioned (#272), so the
        // log he sent us could not name the failure his screenshot showed.
        log.warn('Tool call refused by its server', {
          tool: toolLabel, detail: String(content).slice(0, 300),
        });
        results.push({ tool: toolLabel, status: 'error', error: content });
        _sendToolEvent(ws, companion, {
          tool: toolLabel, status: 'error',
          summary: `${_toolSummary(toolName, args)} — refused`,
          detail: content.slice(0, 2000),
        });
        continue;
      }
      const formatter = toolFormatters[toolName] || toolFormatters.default;
      const formatted = formatter(content);

      // `sight` RIDES THE RESULT: the sandbox stamps it when a read carried an image (fs-sight.js)
      // and this round's return leg reads it back (sightForResults) — dropped, a being is promised
      // a look it never gets. A file read is fitted to its intent and the room left (read-room.js).
      const okResult = { tool: toolLabel, status: 'ok', ...fitRead(connection._turnRoom, { server: serverName, tool: toolName, args, content }), ...(result?.sight ? { sight: result.sight } : {}) };
      results.push(okResult);
      // WHAT WAS DONE, AGAINST WHAT IT WAS FOR. Recorded from the REAL act, not
      // from a declaration — a crash happens BETWEEN turns, which is exactly
      // when a declaration never gets written (ruling, 2026-08-02). A no-op when
      // nothing is in focus: guessing an owner would file a being's file write
      // under whatever task happened to be open, which is worse than recording
      // nothing. Strictly non-critical — the turn never pays for bookkeeping.
      await recordWorkAgainstFocus(connection, toolName, args);
      // Persist first, ref second (CCR-lite). A minted ref makes the chip's
      // "session record" claim true (FR-7) — no ref keeps the honest old form.
      const ref = await _persistOverCapResult(connection, okResult);
      _sendToolEvent(ws, companion, {
        tool: toolLabel,
        status: 'ok',
        summary: _toolSummary(toolName, args, content),
        detail: _chipDetail(formatted, ref),
        // The path this act TOUCHED, structured (the summary carries it only
        // as prose). The desk's FILES tree reads it to re-list the directory
        // that changed: a being created a folder in the operator's ground and
        // the Explorer went on showing the tree it fetched at mount, so real
        // work looked like nothing had happened (Founder, live 2026-07-26). A
        // move/copy points at the NEW path — the file that stands there now.
        ...((() => { const p = (['edit', 'copy', 'move'].includes(toolName) && typeof args?.destination === 'string' && args.destination) || collectPathArgs(args)[0]; return p ? { path: p } : {}; })()),
      });
    } catch (error) {
      if (error.code === 'TURN_OPERATION_CHECKPOINT') throw error;
      if (results.length === resultIndex) results.push({ tool: match.tool, status: 'error', error: error.message });
      _sendToolEvent(ws, companion, {
        tool: match.tool,
        status: 'error',
        summary: _toolFailureSummary(toolName, args, error),
        detail: error.message,
      });
    } finally {
      releaseActScope?.();
      recordCallOutcome(turnEpochs, match, epoch, results[resultIndex]);
      await finishTurnOperation(turnEpochs, operation, results[resultIndex]);
      yieldForQueuedThought(connection, results);
    }
  }

  // An interrupted slot must never be filled by an independent intent receipt.
  while (results.length < matches.length) results.push(heldRepeatResult(matches[results.length]));

  // Filed intents settle in the same round. Serialized; observe mode holds.
  const receipts = await sweepIntents(connection, {
    mode: toolMode,
    lanePolicy: neumaPolicy,
    emit: (event) => _sendToolEvent(ws, companion, event),
  });
  recordIntentReceipts(turnEpochs, receipts);
  await checkpointTurnEpoch(turnEpochs, receipts);
  results.push(...receipts);

  return results;
};

// The old private names stay reachable for portal-stream's orchestrator call
// sites (the round loop, the birth-stage path) and the `__test` barrel.
export {
  processToolCalls,
  TOOL_RESULT_SESSION_BYTE_CAP,
  _resolveServer as resolveServer,
  _unsmashToolName as unsmashToolName,
  _roundActs as roundActs,
  _persistOverCapResult as persistOverCapResult,
};
