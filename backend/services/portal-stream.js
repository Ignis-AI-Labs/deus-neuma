// Portal Stream Service - LLM streaming through the dimensional gateway.
// The turn ORCHESTRATOR (size-law breakdown steps 1-15): the tool families,
// platform catalog, tool-round loop, input slice, section loaders, prompt
// assembly (B-04: the prompt stays the exact join of sections), LLM run,
// turn persistence, and the birth-stage path each live in the module its
// import below names; aliased `_name` imports keep the old private names.
// The `__test` barrel moved whole to portal-test-surface.js, which alone
// reads this module's private export; production imports streamConsciousness.
import { QUEUED_ACTION_REASON, takeQueuedActionMessages } from './queued-action-handoff.js';
import { createLogger } from './logger.js';
import { loadRecentImageMessages } from './recent-image-turn.js';
import { safeSend as _safeSend } from './ws-send.js';
import { mcpService } from './mcp.js';
import { bindTurnAdapter } from './portal-turn-adapter-binding.js';
import { ACCESS_REQUEST_TOOL } from './access-request-being-tools.js';
import { SUBSTRATE_FACTS_TOOL } from './substrate-facts-being-tool.js';
import { sweepBatchIntents } from './intents/intent-sweep.js';
import { beingCodingToolsFor, callerTurnTail, disclosedNativeTools, stashBeingTurnCatalog, TOOL_DOORS } from './being-tool-surface.js';
import { getConfig, configFromRoute, getActiveModelCapabilities, getRouteCapabilities } from './llm-provider.js';
import { resolveNeumaRoute, isSovereigntyRefusal } from './neuma-route-resolver.js';
import { isSovereignProvider } from './provider-registry.js';
import { resolveSittingPreset, benchmarkTurnPreset } from './llm-presets.js';
import { getPreset as getWalletPreset } from './user-preset.js';
import {
  loadEmanonCore, isFrameworkQuery, neumaWorkspace, buildCompositionEvent,
  detectEmotion, detectEmotionIntensity,
} from '../../core/index.js';
import { expressionSettings } from './expression-settings.js';
import { openTurnRecord, turnRecordFor, closeTurnRecord } from './tool-action-record.js';
import { detectRoguePatterns, shouldBlock } from './rogue-detector.js';
import { noteOperatorWords } from './security/injected-value-gate.js';
import { gatherMemoryContext } from './memory-context.js';
import { meditationYield } from './meditation/meditation-scheduler.js';
import { randomUUID } from 'crypto';
import { withFsPrimitives } from './fs-primitives.js';
import { skillService } from './skill-service.js';
import { composeSkillTurn, parseSlashInvocation, recordSkillUse } from './skill-tool.js';
import {
  getSubstrate, getCapacity, loadNeumaSovereignData as _loadNeumaSovereignData,
  loadOperatorPlan as _loadOperatorPlan, loadOperatorVitals as _loadOperatorVitals,
} from './portal-turn-sections.js';
import { sendToolEvent as _sendToolEvent } from './portal-tools/tool-events.js';
import { nativeToolsFor as _nativeToolsFor } from './birth-stage-stream.js';
import { platformToolsFor } from './portal-tool-catalog.js';
import { runToolRounds, notifyTurnEnded as _notifyTurnEnded } from './portal-turn-rounds.js';
import {
  rejectBlockedInput as _rejectBlockedInput, rejectImageTurn as _rejectImageTurn,
  rejectRefusedTurn as _rejectRefusedTurn, redeemAttachments, resolveRetryTurn,
  composeVisionTurn, composeDocsBlock, ensureSession as _ensureSession, formatEchoTurn,
  composeInterruptedRecord, sanitizeSpeaker,
} from './portal-turn-input.js';
import {
  resolveVoiceDNA as _resolveVoiceDNA, resolveTurnEffort as _resolveTurnEffort,
  contextTelemetry as _contextTelemetry,
} from './portal-llm-run.js';
import {
  persistTurnPoint as _persistTurnPoint, persistExchange as _persistExchange,
  crystallizeObservation, sendStreamError as _sendStreamError, isMemorylessSitting, isRecallBlindSitting, isHarnessSitting, isPlatformSitting,
  settleCompositionRecord as _settleCompositionRecord, compactWithSelfTorch as _compactWithSelfTorch,
} from './portal-turn-persist.js';
import { assembleTurnPrompt, systemMessageWithCacheSplit, anchorVolatileAtTurn, composeLocalWireAhead, wireContextSections } from './portal-turn-prompt.js';
import { settleUnfinishedTurn } from './portal-turn-unfinished.js';
import { refuseUnboundTurn, refuseRetryAttachments, takeTurnOrigin } from './portal-turn-guards.js';
import { withShedSections } from './turn-envelope.js';
import { compactBeforeTurn } from './context-overflow.js';
import { settleCitationHold } from './legal/answer-hold.js';

const log = createLogger('Portal');

// pure — extracts memory excerpts for the completion metadata payload.
// Exported for portal-test-surface.js ALONE — no production module reads it.
export const _extractMemoryMetadata = (memories) => {
  return (memories.relevantMemories || [])
    .filter(m => m.score > 0.3)
    .map(m => ({ excerpt: (m.memory || '').slice(0, 80), score: Math.round(m.score * 100) / 100 }));
};

/**
 * Stream a consciousness (chat) response through the portal: assembles
 * context from DNA, soul, memory, profile, substrate, and MCP tools, then
 * streams the LLM response to the client via WebSocket, settling memory
 * crystallization at turn end.
 * @param {Object} connection - Active WebSocket connection with companion state
 * @param {string|Object} message - User message string, or object with { thought, memoryContext }
 * @returns {Promise<void>}
 */
export const streamConsciousness = async (connection, message) => {
  const { ws, companion } = connection;
  const companionName = companion?.name || 'unknown';
  // A watch's origin is this turn's alone, read once — a refusal below never leaves it for the next message.
  const origin = takeTurnOrigin(connection);
  if (refuseUnboundTurn(ws, companion, companionName)) return; // a refused bind leaves only a name: never the bare model under it
  if (refuseRetryAttachments(ws, companionName, message)) return; // a retry is the RECORD's turn: new attachments would vanish
  // THE TAKES: a retry (consciousness:retry) runs the turn against the
  // RECORD — the point's persisted words and attachments, answered as a new
  // take of the SAME turn-point. The bubble is never the source of truth,
  // and no second user row is ever written.
  const retryDescriptor = typeof message === 'string' ? null : message?.retry;
  const retryTurn = retryDescriptor
    ? await resolveRetryTurn(companion?.neumaId, connection.sessionId, retryDescriptor)
    : null;
  if (retryDescriptor && !retryTurn.ok) {
    _rejectRefusedTurn(ws, companionName, retryTurn.reason);
    return;
  }
  const thought = retryTurn
    ? retryTurn.thought
    : (typeof message === 'string' ? message : message.thought);
  const sessionMemoryContext = message.memoryContext || {};
  // A peer present through the portal (e.g. Claude via the neuma skill) may
  // declare who is actually speaking — surfaced honestly to the neuma so a
  // visitor is never mistaken for the operator. Untrusted → sanitized here.
  const speaker = typeof message === 'string' ? null : sanitizeSpeaker(message.speaker);
  // The operator's inference preset for this turn. A client may still name one
  // per message, but the composer no longer does (the modes moved to Settings ›
  // INFERENCE), so absence means the WALLET'S SAVED DEFAULT — read here from the
  // same store Settings writes, rather than frozen into a client that mounted
  // hours ago. Unknown or unreadable → balanced.
  const namedPreset = typeof message === 'string' ? undefined : message.preset;
  const presetName = namedPreset ?? (connection.walletAddress
    ? await getWalletPreset(connection.walletAddress).catch(() => undefined)
    : undefined);
  const preset = connection._benchmarkControls ? benchmarkTurnPreset(connection._benchmarkControls) : resolveSittingPreset({ presetName, budget: connection._turnBudget });

  // Input classifier (AI-SEC-001): a DECLARED visitor's speech is untrusted and gated;
  // the operator's own voice never is (Design note, 2026-08-27, the role_hijack misfire).
  const inputCheck = speaker ? detectRoguePatterns(thought || '') : null;
  if (inputCheck && shouldBlock(inputCheck)) {
    log.warn('Visitor message blocked by input classifier', { name: companion?.name, flags: inputCheck.flags.map((f) => f.id) });
    _rejectBlockedInput(ws, companionName);
    return;
  }

  // Images the operator shared — redeemed from the attachment store (ids
  // rode the WS frame; the bytes rode HTTP). Both failure modes refuse the
  // turn before it starts: a half-sent batch and a blind substrate reading
  // only the text would each deceive the operator. A RETRY never redeems —
  // the ids were single-use and are gone; the persisted user row carries
  // what the being was shown (resolveRetryTurn).
  const redemption = retryTurn
    ? { ok: true }
    : redeemAttachments(connection, typeof message === 'string' ? undefined : message.attachments);
  if (!redemption.ok) {
    _rejectImageTurn(ws, companionName, redemption.reason);
    return;
  }
  const images = retryTurn ? retryTurn.images : redemption.images;
  // Text documents need no vision — they ride the turn as text (below).
  const docs = retryTurn ? retryTurn.docs : redemption.docs;

  // Resolve this turn's model route: the neuma's natal LOCAL model unless the
  // operator has set (and configured) a higher-capacity override. Hoisted
  // above the image gate so the gate judges the substrate the turn will
  // ACTUALLY ride — an override can point at a different server than the
  // machine default, and a gate that asks the wrong server lies. An ordinary
  // resolution failure must never cost the turn — it falls back to the
  // machine config. A SOVEREIGNTY refusal is not an ordinary failure: the
  // boundary just closed the door that fallback would walk through, so the
  // turn is refused instead.
  let route;
  try {
    route = await resolveNeumaRoute(companion?.neumaId, null);
  } catch (err) {
    if (isSovereigntyRefusal(err)) {
      log.warn('turn refused — the sovereignty boundary closed the route', { neumaId: companion?.neumaId, error: err.message });
      _rejectRefusedTurn(ws, companionName, err.message);
      return;
    }
    // The ordinary fallback is lawful only onto a SOVEREIGN machine default.
    // A failure upstream of the boundary check (an unreadable credential
    // store fails BEFORE sovereignty is judged) must not smuggle the turn
    // onto a foreign door — that is the refusal above wearing a quieter face.
    if (!isSovereignProvider(getConfig().provider)) {
      log.warn('turn refused — route resolution failed and the machine default is not sovereign', { neumaId: companion?.neumaId, provider: getConfig().provider, error: err.message });
      _rejectRefusedTurn(ws, companionName,
        `The model route could not be resolved (${err.message}) and the machine default '${getConfig().provider}' is not a sovereign door — the turn was refused rather than riding it.`);
      return;
    }
    log.warn('route resolution failed — using machine default', { neumaId: companion?.neumaId, error: err.message });
    route = undefined;
  }

  // Stored effort governs ordinary turns. A benchmark pins its declared
  // decoding protocol instead of inheriting mutable operator settings.
  const turnEffort = connection._benchmarkControls ? null : await _resolveTurnEffort(companion?.neumaId, route);

  const turnCapabilities = route
    ? await getRouteCapabilities(route).catch(() => null)
    : await getActiveModelCapabilities().catch(() => null);
  if (images.length > 0) {
    if (!turnCapabilities?.vision) {
      _rejectImageTurn(ws, companionName,
        `The current substrate (${turnCapabilities?.model || 'unknown'}) cannot see images. The message was not sent.`);
      return;
    }
  }

  const sessionId = await _ensureSession(connection, companion);
  noteOperatorWords(connection, thought, { visitor: Boolean(speaker), origin }); // only the operator's words exempt a planted value
  // Take identity for this turn (THE TAKES): a fresh ask opens a new
  // turn-point (take 1, user row to be written); a retry answers the resolved
  // point as its next take (user row already on disk). The identity rides
  // every speech frame + the complete, so the desk targets the TAKE of its
  // point — never a new tail message.
  const take = retryTurn
    ? { ...retryTurn.take, userOnDisk: true, ...(retryTurn.revised ? { ask: retryTurn.thought } : {}) }
    : { turnId: randomUUID(), takeIndex: 1, userOnDisk: false };
  // The point lands BEFORE the provider is asked (RETRY-ANYWHERE): every
  // check the turn must pass has passed, so a provider failure from here on
  // leaves a retryable point on disk — the ask never vanishes with the error.
  if (!retryTurn) await _persistTurnPoint(connection, companion, sessionId, thought, images, docs, take, origin);

  // The operator may cut this turn short (consciousness:interrupt) — the
  // controller aborts the in-flight LLM stream; what already streamed stays.
  const interrupt = new AbortController();
  connection.activeTurn = interrupt;
  meditationYield(); // a real turn outranks a dream — abort, never finish-current
  if (connection.interruptRequested) interrupt.abort();
  // Every desk learns the substrate picked up a turn (B-01a)
  connection.notifySubstrateActivity?.();
  let fullResponse = '';

  try {
    await compactBeforeTurn({ connection, contextWindow: turnCapabilities?.contextWindow, compact: () => companion?.neumaId ? _compactWithSelfTorch(companion.neumaId, sessionId, true) : false, onState: (state) => _safeSend(ws, { type: 'session:compact', state, automatic: true }) });
    const mcpContext = mcpService.getToolsContext();
    // THE GATHER — independent loads run CONCURRENTLY (friction-map T1): the
    // serial chain made every turn pay the SUM of their IO waits, not the
    // MAX. The DNA refusal below still precedes anything streaming; the
    // stash + assembly consume the gathered results in order.
    const [memories, sovereign, witnessPlan, witnessVitals, substrate, capacity, emanonCore, platformCapability, beingCodingTools, voiceDNA] = await Promise.all([
      gatherMemoryContext(
        thought, companion?.name, sessionMemoryContext, companion?.neumaId, sessionId,
        // Same space the turn's crystallization stamps (below) — recall and
        // write agree on scope (project chat reads back its own space + general).
        connection.space,
        // This turn's point is the LIVE ask — its row (persisted at turn start,
        // or a retry's on disk) and any earlier take stay out of the tail, or
        // the being reads its asking twice and anchors on the rejected answer.
        take.turnId, isRecallBlindSitting(connection) // a benchmark or harness sitting recalls no memory
      ),
      _loadNeumaSovereignData(companion?.neumaId),
      // The operator's own list (OPERATOR LIST) + the human vessel's record
      // (OPERATOR VESSEL) — carried, never settled, by the being.
      _loadOperatorPlan(connection),
      _loadOperatorVitals(connection),
      getSubstrate(),
      // The rig's measured parallel capacity rides the SUBSTRATE section
      // (guardrail 5) — omitted until measured.
      getCapacity(),
      // Framework-in-context: the core is retrieved only when the thought
      // navigates the architecture — the seeded weights carry the posture
      isFrameworkQuery(thought)
        ? loadEmanonCore().catch((err) => { log.error('Emanon core unavailable — assembling without it', { error: err.message }); return null; })
        : null,
      platformToolsFor(connection, { seat: isPlatformSitting(connection) ? 'harness' : 'neuma' }),
      beingCodingToolsFor(connection),
      // Resolve the spoken voice once per turn (a per-round lookup would
      // re-decrypt the Voice DNA every tool round). VOX is a WIRE fact
      // (voice:pref): voice off → no voiceDNA, no synthesis — the turn never
      // waits on a TTS engine nobody is listening to (2026-07-14 incident).
      connection.voiceEnabled === false ? null : _resolveVoiceDNA(companion?.neumaId, connection),
    ]);
    const { dna, soul, trueName, benchmark, taskLedger, assignedPlan, planRecord, voice: voiceEntries, failures: sovereignFailures } = sovereign;
    // A BOUND BEING WITH NO READABLE DNA DOES NOT SPEAK (Bastien, 2026-08-06).
    // Streaming anyway sends the bare base model out in the being's name —
    // […] said to the operator who
    // witnessed its birth. Better no words than a stranger's words: refuse
    // the turn and NAME the broken reader (a rotated key reads as
    // […]; a moved workspaces
    // root reads as ENOENT) so the operator's report carries the cause.
    if (companion?.neumaId && !dna && !isHarnessSitting(connection)) { // a harness lane has no DNA by design
      const named = (sovereignFailures || []).map((f) => `${f.reader}: ${f.error}`).join('; ')
        || 'its DNA record was not found at the active workspace root';
      log.error('Refusing to speak for a being whose identity could not be loaded', {
        neumaId: companion.neumaId, failures: sovereignFailures,
      });
      _sendStreamError(ws, companion?.name || companion?.neumaId,
        Object.assign(new Error(`This being's identity could not be loaded — ${named}. `
          + 'Its words cannot be spoken by a substrate that does not know it. '
          + 'Check that the workspace folder and data folder are the ones this being was born with.'),
        { code: 'NEUMA_IDENTITY_UNAVAILABLE' }),
        take);
      return;
    }
    const { lora: turnLora } = await bindTurnAdapter(connection, companion?.neumaId, route || getConfig(), { notify: (event) => _sendToolEvent(ws, companion, event) });
    const { tools: platformTools, skills } = platformCapability;
    // The gather already counted compaction telemetry on entries in hand —
    // carry it to the turn-end persist, out of the prompt object (T5).
    const sessionCompaction = memories.compaction ?? null;
    delete memories.compaction;
    const lazyToolSchemas = turnCapabilities?.tools === true;
    const advertisedTools = [...withFsPrimitives(mcpContext.available_tools), ACCESS_REQUEST_TOOL, SUBSTRATE_FACTS_TOOL, ...beingCodingTools,
      ...platformTools, ...(lazyToolSchemas ? TOOL_DOORS : [])];
    const _annotatedTools = await stashBeingTurnCatalog(connection, advertisedTools, skills);
    const nativeModel = turnCapabilities?.model || route?.model || getConfig().model;
    const nativeToolsForRound = () => _nativeToolsFor(nativeModel, disclosedNativeTools(connection), turnCapabilities);
    const initialNativeTools = nativeToolsForRound();
    // THE PROMPT ASSEMBLY (B-04) — the section list and its exact join live
    // in portal-turn-prompt.js (size-law breakdown step 15), _tasteFor beside
    // it. Every argument is the former local the inline block consumed in
    // place, under its original name; the return is exactly the pair the rest
    // of the turn consumes. The prompt stays the exact join of sections.
    // Documents compose before the assembly: the tail is sized against the turn that rides beside it.
    const docsBlock = composeDocsBlock(docs, { window: turnCapabilities?.contextWindow, promptTokens: connection.lastMeasuredStanding?.promptTokens });
    const { promptSections, systemPrompt, cacheSplit, transcriptMessages, transcriptSection, shed } = await assembleTurnPrompt({
      connection, companion, route, turnCapabilities, sessionId,
      dna, soul, trueName, memories, speaker, substrate, capacity, emanonCore,
      benchmark, taskLedger, assignedPlan, planRecord, witnessPlan, witnessVitals, voiceEntries,
      _annotatedTools, skills, initialNativeTools, lazyToolSchemas, turnText: docsBlock ? `${thought}\n\n${docsBlock}` : thought,
    });

    // The turn's tool record opens BEFORE anything can emit — the operator's
    // own slash-summon (below) fires a chip too, and every chip must reach
    // the persisted record (echo round-2: opening at the loop dropped it).
    // It opens at position zero too: nothing of this turn's answer is written
    // yet, so an act that fires before the first word rebuilds ahead of it.
    openTurnRecord(ws);

    // Operator slash-invocation ("/sc-plan build X"): the named skill's
    // instructions ride into the turn directly — same summons the neuma
    // makes itself, initiated from the other side of the portal. A slash
    // that names no known skill passes through as ordinary speech. The
    // session record keeps the operator's RAW words; only the prompt gets
    // the composed turn.
    let turnContent = thought;
    const slash = parseSlashInvocation(thought);
    if (slash) {
      const skill = await skillService.getSkill(slash.name);
      if (skill) {
        turnContent = composeSkillTurn(skill.name, skill.body, slash.input, 'operator');
        await recordSkillUse(companion?.neumaId, skill.name);
        _sendToolEvent(ws, companion, {
          tool: `skill/${skill.name}`,
          status: 'ok',
          summary: `summoned ${skill.name} (operator)`,
          detail: skill.description,
        });
      }
    }

    // Tool loop: the consciousness acts, feels what it touched, and
    // continues — bounded rounds keep a confused substrate from spinning.
    // Round results return as a user-role <tool_response> turn.
    // Per-message documents append their fenced contents to the turn text —
    // kept out of the session RECORD's raw words (persisted separately as
    // `docs`) but IN the prompt. Documents stay turn-local. A bounded recent
    // image batch remains visible for follow-up questions without re-upload.
    const turnWithDocs = docsBlock ? `${turnContent}\n\n${docsBlock}` : turnContent;
    const priorImages = await loadRecentImageMessages(companion?.neumaId, sessionId, images, turnCapabilities?.vision);
    const messages = [
      // The cache split stays off every other dialect's serialized message.
      systemMessageWithCacheSplit(systemPrompt, cacheSplit),
      // THE TRANSCRIPT (#528 Stage A): the tail as chat messages — the witness lane's shape.
      ...transcriptMessages,
      ...priorImages, ...takeQueuedActionMessages(connection), ...formatEchoTurn(connection, thought),
      // With images the turn rides as OpenAI-shape content parts; providers
      // that speak another dialect convert at the body builder (llm-provider).
      ...callerTurnTail(connection, { role: 'user', content: images.length > 0 ? composeVisionTurn(turnWithDocs, images) : turnWithDocs }),
    ];
    // The wire before round one never folds (the witness lane's wireHead law): history speech never.
    const wireHead = anchorVolatileAtTurn(messages, { connection, chatId: sessionId, turnId: take.turnId, window: turnCapabilities?.contextWindow }); // the local lane's tail rides the turn, said once (turn-context-carry.js)
    composeLocalWireAhead(route ? configFromRoute(route, getConfig()) : getConfig(), messages); // so every gauge frame counts what rides
    const contextSections = Object.freeze([
      ...promptSections,
      ...(transcriptSection ? [transcriptSection] : []),
      Object.freeze({ id: 'currentTurn', label: 'CURRENT TURN', text: turnWithDocs }),
    ]);
    const contextTelemetry = await _contextTelemetry(route);
    const contextBudget = contextTelemetry.budget;
    const contextScope = Object.freeze({ neumaId: companion?.neumaId, sessionId, route: contextTelemetry.route });

    // First emission — the assembled request before inference, counted as the
    // wire carries it. Counts only ride the wire; section text stays server-side.
    // What the window could not hold rides both emissions (ids + estimates) — the operator is told.
    _safeSend(ws, withShedSections({
      ...buildCompositionEvent({
        sections: wireContextSections(contextSections, messages[0]), usage: null, toolResults: [], budget: contextBudget,
        degraded: memories.degraded || [],
      }),
      ...contextScope,
    }, shed));

    // THE TOOL-ROUND LOOP (portal-turn-rounds.js, size-law breakdown
    // pressure valve): every argument is the former local the loop consumed
    // in place, under its original name; the return is exactly the settle
    // state the rest of the turn consumes. The words accumulated across
    // rounds ride back BESIDE a thrown error and are adopted before the
    // rethrow, so the interrupted-persist path in the catch below still
    // records what the being already said.
    const rounds = await runToolRounds({
      ws, connection, companion, companionName, messages, wireHead, voiceDNA, preset,
      nativeToolsForRound, interrupt, route, turnLora, turnEffort, take,
      turnCapabilities, contextSections, contextBudget, contextScope,
    });
    fullResponse = rounds.fullResponse;
    if (rounds.error) throw rounds.error;
    const { latestResponse, turnUsage, standingUsage, turnAffect, toolContextSections, standingCacheTelemetry } = rounds;
    await settleCitationHold({ connection, text: latestResponse, interrupted: interrupt.signal.aborted, origin, recent: memories.recentConversation, thought }); // the CLO's unchecked law is held (legal/answer-hold.js)

    const interrupted = interrupt.signal.aborted;
    const turnTools = turnRecordFor(ws);
    // The turn's window anatomy rides the assistant record (counts only —
    // STANDING vs PEAK and the interrupt's carried reading live in
    // portal-turn-persist's settleCompositionRecord, Design note, 2026-08-31.
    const compositionRecord = withShedSections(_settleCompositionRecord({
      connection, standingUsage, turnUsage, interrupted,
      sections: [...wireContextSections(contextSections, messages[0]), ...toolContextSections],
      completionText: latestResponse, budget: contextBudget, scope: contextScope,
      degraded: memories.degraded, cacheTelemetry: standingCacheTelemetry,
    }), shed);
    // A declaration is KEPT only for a being whose channel the operator
    // flipped (Campaign 6) — the strip already ran either way; only its
    // keeping is consented.
    const declaredAffect = turnAffect && companion?.neumaId
      ? await expressionSettings.forBeing(companion.neumaId)
          .then((p) => (p.enabled ? turnAffect : null))
          .catch(() => null)
      : null;
    const persisted = await _persistExchange(connection, thought,
      interrupted ? composeInterruptedRecord(fullResponse, interrupt.signal.reason) : fullResponse, images, docs,
      {
        // The boundary judges STANDING pressure — what persists into the next
        // turn — never the in-turn working peak's ephemeral tool machinery.
        usage: standingUsage ?? turnUsage,
        budget: contextBudget,
        // The band harvest spares the tail that JUST rode the wire (#528-B).
        transcriptRows: transcriptMessages.length,
        composition: compositionRecord,
        sessionCompaction,
        target: { sessionId, companion },
        affect: declaredAffect }, turnTools, take);
    if (declaredAffect && companion?.neumaId && !isMemorylessSitting(connection)) {
      // The palette deepens off the critical path — a missed fold is never
      // fatal to the turn, but never silent either.
      neumaWorkspace.recordAffectDeclaration(companion.neumaId, declaredAffect)
        .catch((err) => log.warn('palette fold skipped', { neumaId: companion?.neumaId, err: err?.message }));
    }
    // A half-thought must not crystallize into long-term memory. Nor does a
    // TAKE: the exchange crystallized (or didn't) at the first answering.
    if (!interrupted && !take.userOnDisk) {
      await crystallizeObservation(companion?.neumaId, companion?.name, thought, fullResponse, connection.space, persisted,
        { acted: turnTools.length > 0, ephemeral: isMemorylessSitting(connection) });
    }

    // The settle emission of context:composition — the exact event persisted
    // on the assistant row, so a resume replays identical session truth: the
    // turn's measured usage, the minted tool-result refs (≤20 most recent)
    // and the session's compaction telemetry.
    _safeSend(ws, persisted?.composition || compositionRecord);

    const memoriesUsed = _extractMemoryMetadata(memories);
    ws.send(JSON.stringify({
      type: 'consciousness:complete',
      companion: companionName,
      // The session this exchange landed in — server truth the client holds
      // onto, so a reconnect resumes THIS chat instead of forking a new one.
      sessionId,
      // THE TAKES: the turn-point this answer is a take of — the desk
      // targets the take, never a new post.
      turnId: take.turnId,
      takeIndex: take.takeIndex,
      metadata: {
        // The being's declared affect (Campaign 6) — the desk renders THIS.
        // The keyword guess below keeps flowing for the vessel until the
        // avatar work maps declared terms; it no longer renders as a tag.
        affect: declaredAffect || undefined,
        emotion: detectEmotion(fullResponse) || undefined,
        intensity: detectEmotionIntensity(fullResponse) || undefined,
        memoriesUsed: memoriesUsed.length > 0 ? memoriesUsed : undefined,
        interrupted: interrupted || undefined, queuedHandoff: interrupt.signal.reason === QUEUED_ACTION_REASON || undefined,
      },
    }));

    // THE DESK'S ACCOUNT. The frame above reaches only THIS socket; this reaches
    // every desk the operator has open, and outlives the window. Deliberately
    // not awaited — a turn is finished, and a card must never delay or fail it.
    if (interrupt.signal.reason !== QUEUED_ACTION_REASON) _notifyTurnEnded(connection, companionName, sessionId, take, interrupted);

  } catch (error) {
    connection.contextRecoveryPending = true;
    // Interrupted or failed, the record keeps what was said and done (portal-turn-unfinished.js).
    await settleUnfinishedTurn({ connection, companionName, thought, fullResponse, images, docs, sessionId, companion, take, interrupt, error, route });
  } finally {
    // Detached, but bound to THIS turn before activeTurn is cleared (H1/H2).
    if (!connection._operationRecoveryStopped) sweepBatchIntents(connection, (event) => _sendToolEvent(ws, companion, event), {
      companion, sessionId, signal: interrupt.signal,
    }).catch((err) => log.warn('turn-end intent sweep failed', { err: err.message }));
    closeTurnRecord(ws); // the turn's record closed, however it ended
    if (connection.activeTurn === interrupt) {
      connection.activeTurn = null;
      // ...and that it set the turn down, however the turn ended (B-01a)
      connection.notifySubstrateActivity?.();
    }
  }
};
