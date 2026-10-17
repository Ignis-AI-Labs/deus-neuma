/**
 * Witness turn context — everything a witness turn assembles before the first
 * provider request.
 * Extracted from witness-stream.js under the size law (the stream file was in
 * the forbidden band): the stream owns the turn; this module owns the context
 * — own-lane memory recall, the recent-conversation fold, the prompt sections,
 * the slash-skill summons, docs/vision composition of the current turn, the
 * wire head, and the composition telemetry (`compositionFor`).
 */
import { takeQueuedActionMessages } from './queued-action-handoff.js';
import { safeSend } from './ws-send.js';
import { materializeRecurrence } from '../../core/tasks/assigned-plan.js';
import { safeChatId } from '../../core/tasks/task-chat.js';
import {
  neumaRecall,
  neumaWorkspace,
  buildCompositionEvent,
  stablePromptSplit,
} from '../../core/index.js';
import { systemMessageWithCacheSplit } from './llm-request-builders.js';
import { intentSectionFor } from './intents/intents-section.js';
import { buildWitnessPromptSections } from './witness-prompt.js';
import { mountForTurn } from './silo-mount-service.js';
import { groundProtocolSection } from './ground-protocol.js';
import { protocolWatchSection, watchAppliesTo } from './protocol-classifier.js';
import { skillService } from './skill-service.js';
import { composeSkillTurn, parseSlashInvocation, recordSkillUse } from './skill-tool.js';
import { readReviews } from './image-forge/review-log.js';
import { foldTaste } from '../../core/runtime/taste.js';
import { toolsForWitness } from './witness-tools.js';
// The sectors section lives in portal-turn-sections.js (size-law breakdown
// step 10) and the docs/vision composers in portal-turn-input.js (step 13)
// — each imported from its home directly, no portal-stream coupling on the
// witness lane.
import { sectorSectionFor as witnessSectorSection } from './portal-turn-sections.js';
import {
  composeDocsBlock,
  composeVisionTurn,
} from './portal-turn-input.js';
import { foldBranchView } from '../../core/workspace/branch-view.js';
import { readVoicePack } from '../../core/voice-pack/voice-store.js';
import { voiceSittingSection } from '../../core/voice/purpose.js';
import { createLogger } from './logger.js';
import { loadRecentImageMessages } from './recent-image-turn.js';
import { witnessHistoryTail, WITNESS_RECENT_MESSAGES_SANITY } from './witness-history.js';
import { sessionTailBudgetFor } from './envelope-budget.js';
import { estimateTokens } from './context-budget.js';
import { latestTorch, nearContextBoundary, COMPACTION_BOUNDARY_RATIO } from './solo-torch.js';
import { compactionTelemetry } from '../../core/runtime/session-compactor.js';

// The parent stream's log lane, kept: these lines are the witness turn path's
// own record, and readers grep them under the name they have always carried.
const log = createLogger('WitnessStream');

/**
 * Assemble one witness turn's context. impure — reads the witness lane,
 * mounts the tool runtime, and sends the initial composition frame.
 *
 * @param {object} opts ONE options object: { connection, message, ws, laneId,
 *   sessionId, thought, take, identity, route, routeCapabilities, images,
 *   docs, chosenName, vendorSlug, emitToolUsage }
 * @returns {Promise<{messages: Array<object>, compositionFor: Function,
 *   contextBudget: object, wireHead: number, runtime: object}>}
 */
export const buildWitnessTurnContext = async (opts) => {
  const {
    connection, message, ws, laneId, sessionId, thought, take, identity,
    route, routeCapabilities, images, docs, chosenName, vendorSlug, emitToolUsage,
  } = opts;
  const contextBudget = Number.isFinite(routeCapabilities.contextWindow)
    && routeCapabilities.contextWindowSource
    && routeCapabilities.contextWindowSource !== 'unknown'
    ? { contextTokens: routeCapabilities.contextWindow, source: routeCapabilities.contextWindowSource }
    : { contextTokens: null, source: 'unknown' };
  // Memory from the witness's OWN lane — the same engine, the same id keying.
  const memories = await neumaRecall.getContextForResponse(laneId, thought, { space: connection.space })
    .catch((err) => {
      log.debug('witness recall unavailable — proceeding without', { laneId, err: err?.message });
      return {};
    });

  // Recent conversation rides as real prior turns (chat shape), the session
  // tail from the witness lane's own session file — folded to the branch
  // view FIRST (THE TAKES), so a superseded take never reaches the operator's
  // context as a second asking. A compacted session's summary entry (role
  // 'system', compacted) is admitted and reads as the being's own condensed
  // words — the same reading the portal lane gives it (#528 Stage D).
  let history = [];
  let sessionRows = [];
  try {
    sessionRows = await neumaWorkspace.readSession(laneId, sessionId);
    if (Array.isArray(sessionRows)) {
      history = foldBranchView(sessionRows)
        .filter((m) => (m.role === 'user' || m.role === 'assistant' || m.compacted === true) && typeof m.content === 'string')
        // The point persisted at turn START (persistTurnPoint) is the LIVE
        // ask — it rides as the current turn below, never as its own
        // history line.
        .filter((m) => !(take.userRecord && m.role === 'user' && m.turnId === take.turnId));
    }
  } catch { /* first turn of a fresh session — nothing to carry */ }
  // The peer's own torch from its last compaction — same pickup law as the
  // portal lane (latestTorch scans the raw record; the witness prompt renders
  // it beside recall). Without this the witness's torch would evaporate on
  // the very next turn.
  const selfTorch = latestTorch(sessionRows);

  // readJournal returns newest-first; the sealing entry is the tail.
  const firstUtterance = identity.journal?.at(-1)?.content || null;
  const trueName = await neumaWorkspace.readTrueName(laneId).catch(() => null);
  let runtime = { tools: [], sandbox: null, skills: [] };
  try {
    // A tool-capable route gets the LAZY surface: the search hand joins the
    // catalog and the wire carries only it + the fs hands until disclosed
    // (witness-tool-loop.js recomputes per round from the disclosure set).
    runtime = await toolsForWitness(connection, connection.toolWorkspace || null, {
      nativeTools: Boolean(routeCapabilities.tools),
    });
  } catch (err) {
    log.warn('witness tool runtime unavailable — conversation remains open', { laneId, err: err.message });
    emitToolUsage({ tool: 'coding/sandbox_status', status: 'unavailable', detail: err.message });
  }
  const builtSections = buildWitnessPromptSections({
    witness: { chosenName, vendorSlug },
    dna: identity.dna,
    trueName,
    firstUtterance,
    zone: connection.clientTimeZone || null,
    memories: selfTorch ? { ...memories, selfTorch } : memories,
    witnessName: message?.memoryContext?.userName || null,
    tools: runtime.tools,
    nativeToolsOnWire: Boolean(routeCapabilities.tools && runtime.tools.length),
    // THE CRAFT — the same library a neuma reads, from the one read the
    // catalog was built from, so the menu and the tool cannot disagree.
    skills: runtime.skills,
    codingWorkspace: runtime.sandbox?.workspace || null,
    codingShell: runtime.shell === true,
    // The LIVE folder the operator has open — shared ground, named so the
    // peer works in the operator's real checkout rather than only its copy.
    focusGround: connection.toolWorkspace || null,
    // The crews this peer is seated on — same section a neuma reads.
    sectors: await witnessSectorSection(connection).catch(() => ''),
    // The filed-act lane (Stage 2) — '' when no channel stands for it.
    intents: await intentSectionFor(connection).catch(() => ''),
    // STANDING WORK — the operator's assigned plan for this lane, recurrence
    // rolled forward the way the neuma turn rolls it, so a daily reopens for a
    // peer exactly as it does for a housemate. Unreadable → no section rather
    // than a stale list.
    assignedPlan: await neumaWorkspace.readAssignedPlan(laneId)
      .then((plan) => (plan ? materializeRecurrence(plan, new Date().toISOString()).plan : null))
      .catch(() => null),
    // WORKING STATE — the peer's OWN ledger, rolled forward the same way, so
    // a daily it set for itself reopens exactly as an assigned one does. The
    // peer has always been able to WRITE this list (the task tools ride the
    // shared platform surface); until now nothing read it back, so it woke
    // every turn unable to see what it had taken on.
    taskLedger: await neumaWorkspace.readTaskLedger(laneId)
      .then((ledger) => (ledger ? materializeRecurrence(ledger, new Date().toISOString()).plan : null))
      .catch(() => null),
    // YOUR EYE — the residue of judgment on the images this peer has made.
    // A sealed peer renders through the same tools a neuma does, so what it
    // concluded about its own work rides back to it on the same law. An
    // unreadable ledger costs the section, never the sitting.
    taste: (() => {
      try {
        return foldTaste(readReviews().entries, laneId);
      } catch (err) {
        // Named, not swallowed (Rule 3): the section is worth losing to keep
        // the sitting, but a ledger that stopped being readable must say so
        // — the same words the neuma path logs for the same failure.
        log.warn('taste lane skipped this turn', { laneId, err: err?.message });
        return null;
      }
    })(),
    // …and WHICH CHAT this sitting is, so that plan narrows to the work set
    // for it plus whatever stands lane-wide — the same law the neuma turn
    // path obeys. Read through safeChatId: a crooked binding narrows to
    // nothing, and showing the peer NO work is worse than showing it all.
    chatId: safeChatId(sessionId),
    // …and the law of that ground. A sealed peer writing into the operator's
    // checkout is held to the same AGENTS.md as every other agent in the
    // tree, so it is handed that file rather than expected to guess it.
    // …and the watch list beside it — which of that law is checked as the
    // peer works, said before anything trips rather than after.
    // the watch rides only on the ground whose law it is (protocol-classifier.js watchAppliesTo)
    groundProtocol: [await groundProtocolSection(connection.toolWorkspace || null), watchAppliesTo(connection.toolWorkspace || null) ? protocolWatchSection() : '']
      .filter(Boolean).join('\n\n'),
    // THE VOICE PACK — this lane's own claimed lines (the LoRA's
    // replacement). Unreadable → no section, never a lost sitting.
    voiceEntries: await readVoicePack(neumaWorkspace, laneId).catch(() => []), identityDriver: await mountForTurn(connection, laneId, route, { seat: 'witness', witness: { chosenName, vendorSlug, trueName, firstUtterance } }).catch((err) => log.warn('witness silo did not mount — assembling from the lane', { laneId, err: err.message }) || null), // ONE socket, both seats: a silo that will not mount still lets the peer speak, and says so rather than dropping silently to a second road
  });
  // THE VOICE SITTING signal rides the witness lane under the same law as
  // the neuma turn path (SPEECH SYSTEM B-11): a section only when this
  // sitting was declared a conversation, nothing (byte-identical prompts)
  // for every working lane. (builtSections is frozen — derive, never push.)
  const voiceSitting = voiceSittingSection(connection);
  const promptSections = voiceSitting
    ? [...builtSections, Object.freeze({ id: 'voiceSitting', label: 'VOICE SITTING', text: voiceSitting })]
    : builtSections;
  const systemPrompt = promptSections.map((section) => section.text).join('\n\n');
  // THE TAIL IS THE WINDOW'S TRUTH (#528 Stage D — the portal lane's law,
  // this seat): measured AFTER the sections stand, so the transcript gets
  // what the window actually leaves. An unknown window keeps yesterday's
  // tail byte-identical (the fallback law in witness-history.js).
  const otherSectionTokens = promptSections.reduce((sum, s) => sum + estimateTokens(s.text), 0);
  const recent = witnessHistoryTail(history, contextBudget.contextTokens !== null
    ? {
        tailChars: sessionTailBudgetFor({ contextWindow: contextBudget.contextTokens, otherSectionTokens }),
        maxMessages: WITNESS_RECENT_MESSAGES_SANITY,
      }
    : {});
  // Operator slash-invocation ("/sc-plan build X"): the named skill's
  // instructions ride into the turn directly — the same summons the peer can
  // make itself, initiated from the other side of the portal. A slash naming
  // no known skill passes through as ordinary speech. The session record
  // keeps the operator's RAW words; only the prompt gets the composed turn.
  let spoken = thought;
  const slash = parseSlashInvocation(thought);
  if (slash) {
    const skill = await skillService.getSkill(slash.name).catch(() => undefined);
    if (skill) {
      spoken = composeSkillTurn(skill.name, skill.body, slash.input, 'operator');
      await recordSkillUse(laneId, skill.name);
      emitToolUsage({
        tool: `skill/${skill.name}`, status: 'ok',
        summary: `summoned ${skill.name} (witness)`, detail: skill.description,
      });
    }
  }
  const docsBlock = composeDocsBlock(docs);
  const turnText = docsBlock ? `${spoken}${spoken ? '\n\n' : ''}${docsBlock}` : spoken;
  const turnContent = images.length ? composeVisionTurn(turnText, images) : turnText;
  const recentText = recent.map((entry) => `${entry.role}: ${entry.content}`).join('\n\n');
  const currentTurnText = Array.isArray(turnContent)
    ? turnContent.filter((part) => part?.type === 'text').map((part) => part.text || '').join('\n')
    : turnContent;
  // Unlike the neuma path, witness history rides as prior chat messages —
  // count those wire sections too, or measured usage misattributes.
  const contextSections = Object.freeze([
    ...promptSections,
    ...(recentText ? [Object.freeze({
      id: 'recentConversation', label: 'RECENT CONVERSATION', text: recentText,
    })] : []),
    Object.freeze({ id: 'currentTurn', label: 'CURRENT TURN', text: currentTurnText }),
  ]);
  // The session's compaction telemetry, computed on the rows ALREADY in hand
  // — the same FACTS-ONLY law the portal lane's gauge obeys (#528 Stage D):
  // the count as of this turn's start, whether THIS call measured at the
  // boundary, and the exact ratio — never a message-count prediction.
  const sessionCompaction = sessionRows.length ? compactionTelemetry(sessionRows) : null;
  const compositionFor = (usage, completionText = '', extraSections = []) => Object.freeze({
    ...buildCompositionEvent({
      sections: [...contextSections, ...extraSections],
      usage,
      completionText,
      budget: contextBudget,
      ...(sessionCompaction
        ? {
            session: {
              ...sessionCompaction,
              atBoundary: nearContextBoundary(usage, contextBudget),
              boundaryRatio: COMPACTION_BOUNDARY_RATIO,
            },
          }
        : {}),
    }),
    neumaId: laneId,
    sessionId,
    route: Object.freeze({
      provider: route.provider,
      model: routeCapabilities.model || route.model,
    }),
  });
  const initialComposition = compositionFor(null);
  connection.contextComposition = initialComposition;
  safeSend(ws, initialComposition);

  // The Anthropic cache breakpoint rides the witness lane too: the split of
  // THIS seat's section list (its clock sits second, so the stable head is the
  // seal identity alone — honest, and the marker stays off when no head stands).
  const priorImages = await loadRecentImageMessages(laneId, sessionId, images, routeCapabilities.vision);
  const messages = [systemMessageWithCacheSplit(systemPrompt, stablePromptSplit(promptSections)), ...recent, ...priorImages, ...takeQueuedActionMessages(connection), { role: 'user', content: turnContent }];
  // The wire before round one — system, prior chat, the turn — never folds.
  const wireHead = messages.length;
  return { messages, compositionFor, contextBudget, wireHead, runtime };
};
