/**
 * THE PROMPT ASSEMBLY — the B-04 byte-identity seam: the turn's section list
 * is built ONCE, in one declared order, and the system prompt is their EXACT
 * join. Law: […] — every section builder call,
 * the shed ladder (finalizeTurnEnvelope), and the join itself move together
 * as one intact unit, so the assembled prompt is byte-identical to what the
 * inline block produced inside streamConsciousness.
 *
 * Extracted VERBATIM from portal-stream.js (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 15 / #278) — the interior of
 * `assembleTurnPrompt` keeps the block's original bytes (including its
 * 4-space indentation), and `_tasteFor` rides with it (deliberately left to
 * this step by step 10). Leaf module — it imports the shared leaves
 * DIRECTLY, never portal-stream (direction law: leaf ← family ← catalog ←
 * dispatch ← loop ← orchestrator).
 */
import { platformOnlySections } from '../../core/runtime/platform-only.js';
import { isHarnessSitting } from './portal-turn-persist.js';
import { createLogger } from './logger.js';
import { mountForTurn } from './silo-mount-service.js';
import { VOICE_RITE_OFFER } from './voice-being-tools.js';
import { readReviews } from './image-forge/review-log.js';
import { foldTaste } from '../../core/runtime/taste.js';
import { intentSectionFor } from './intents/intents-section.js';
import { getConfig } from './llm-provider.js';
import { finalizeTurnEnvelope, sessionTailBudgetFor } from './turn-envelope.js';
import { recordBenchmarkIdentityProof } from './benchmark-identity-proof.js';
import { estimateTokens } from './context-budget.js';
import { recentConversationMessages } from '../../core/runtime/memory-section.js';
import { assemblePromptSections, stablePromptSplit } from '../../core/index.js';
// The Anthropic cache breakpoint (Fix B, context economy): the split is
// computed here, at the one seam that holds the final post-shed section list;
// the marker itself lives with the builder that consumes it and is re-exported
// so portal-stream's import surface stays one module.
export { systemMessageWithCacheSplit, anchorVolatileAtTurn, composeLocalWireAhead } from './llm-request-builders.js';
export { wireContextSections } from './turn-context-carry.js';
import { expressionSectionFor } from './expression-prompt.js';
import { voiceSittingSection } from '../../core/voice/purpose.js';
import { speechBriefingSection } from './speech-consent.js';
import { safeChatId } from '../../core/tasks/task-chat.js';
import { formatSubstrateForPrompt } from './substrate-detector.js';
import { loadHouseWorkspace } from './house-workspace.js';
import { postKnock } from './house-post.js';
import { planModeSection } from './plan-mode.js';
import { gatewaySection } from './sovereignty/gateway-handlers.js';
import { operatorChangeNotice, markOperatorChangesTold } from './sovereignty/operator-change.js';
import { activeAmendments } from './sovereignty/amendment-store.js';
import { buildAmendmentsSection } from '../../core/runtime/amendments-section.js';
import { focusGroundOf } from './focus-ground.js';
import { groundProtocolSection } from './ground-protocol.js';
import { testConditionsFor } from './test-conditions.js';
import { toolStandingNow } from './tool-standing.js';
import { getOperatorName } from './operator-name.js';
import { protocolWatchSection, watchAppliesTo } from './protocol-classifier.js';
import { csoBriefingSection } from './security/security-briefing.js';
import { cloBriefingSection } from './legal/legal-briefing.js';
import { cosBriefingSection } from './staff/cos-briefing.js';
import { recordSectionDrift } from './section-drift.js';
import {
  sectorSectionFor,
  projectFilesSection as _projectFilesSection,
  houseSeatSection as _houseSeatSection,
  cmoBriefingSection as _cmoBriefingSection,
  replyCandidatesSection as _replyCandidatesSection,
} from './portal-turn-sections.js';

const log = createLogger('Portal');

/**
 * The residue of judgment on one lane's own images. Impure (reads the ledger).
 *
 * A rotted or unreadable ledger costs this section for the turn, loudly — never
 * the turn itself. Same law as the pin lane above it.
 * @param {string|null} laneId
 * @returns {{operator: Array, own: Array}|null}
 */
const _tasteFor = (laneId) => {
  if (!laneId) return null;
  try {
    return foldTaste(readReviews().entries, laneId);
  } catch (err) {
    log.warn('taste lane skipped this turn', { laneId, err: err?.message });
    return null;
  }
};

/**
 * The turn's prompt, assembled — sections once, system prompt as their exact
 * join. Impure (every section builder reads its own store, fail-soft).
 *
 * This is the ONE decomposition step where the moved block gains a function
 * signature: every parameter below is the former streamConsciousness local
 * the inline block consumed in place, under its exact original name, and the
 * return is exactly the pair the rest of the turn consumes.
 *
 * @param {Object} turn - The former locals, unrenamed:
 * @param {Object} turn.connection - the live portal connection (section builders key off it)
 * @param {Object} turn.companion - the bound being (`companion?.neumaId` gates the sovereign sections)
 * @param {Object|undefined} turn.route - the resolved model route (identity driver mounts against it)
 * @param {Object|null} turn.turnCapabilities - the route's capability probe (context window feeds the shed ladder + memory budget)
 * @param {string|null} turn.sessionId - the minted session (narrows both task lists to this chat)
 * @param {string|null} turn.dna - sovereign DNA text
 * @param {Object|null} turn.soul - sovereign soul record
 * @param {string|null} turn.trueName - the being's true name (#417)
 * @param {Object} turn.memories - gathered memory context (also carries the witness name)
 * @param {string|null} turn.speaker - sanitized declared speaker
 * @param {Object} turn.substrate - the TTL-cached substrate profile
 * @param {Object|null} turn.capacity - the rig's measured parallel capacity
 * @param {string|null} turn.emanonCore - framework core, when the thought navigates the architecture
 * @param {Object|null} turn.benchmark - benchmark declaration from the sovereign load
 * @param {Object|null} turn.taskLedger - the being's task ledger
 * @param {Object|null} turn.assignedPlan - the operator-assigned plan
 * @param {Object|null} turn.planRecord - the plan of record
 * @param {Object|null} turn.witnessPlan - the operator's own list (OPERATOR LIST)
 * @param {Object|null} turn.witnessVitals - the human vessel's record (OPERATOR VESSEL)
 * @param {Array|null} turn.voiceEntries - Voice DNA entries (their absence offers the voice rite)
 * @param {Array} turn._annotatedTools - the stamped advertised tool catalog
 * @param {Array} turn.skills - the platform skill list
 * @param {Array} turn.initialNativeTools - round-zero native tool schemas (presence flags nativeToolsOnWire)
 * @param {boolean} turn.lazyToolSchemas - whether schemas ride lazily (tool_search on wire)
 * @param {string} [turn.turnText] - the current turn as it rides (its documents included) — counted against the tail's room
 * @returns {Promise<{promptSections: Array, systemPrompt: string, cacheSplit: ({stable: string, volatile: string}|null),
 *   transcriptMessages: Array<{role: string, content: string}>,
 *   transcriptSection: ({id: string, label: string, text: string}|null)}>} - the transcript tail as wire
 *   chat messages, oldest first, plus its telemetry section (#528 Stage A)
 */
export const assembleTurnPrompt = async ({
  connection, companion, route, turnCapabilities, sessionId,
  dna, soul, trueName, memories, speaker, substrate, capacity, emanonCore,
  benchmark, taskLedger, assignedPlan, planRecord, witnessPlan, witnessVitals, voiceEntries,
  _annotatedTools, skills, initialNativeTools, lazyToolSchemas, turnText = '',
}) => {
    // THE HARNESS (Design note, 2026-09-29 for the arm; 2026-10-14 for people): a
    // platform-only benchmark sitting and a harness lane's sitting both get
    // the platform's sections only — no identity layer, no house lines.
    const platformOnly = connection._benchmarkControls?.platformOnly === true || isHarnessSitting(connection);
    const houseSeat = await _houseSeatSection(connection);
    // Standing law the being authored (sovereignty gateway) — stable group,
    // '' for every being without amendments. Fail-soft: a broken chain must
    // not silence the being; the store already refused to read it as law.
    const amendments = companion?.neumaId
      ? await activeAmendments(companion.neumaId, 'prompt').then(buildAmendmentsSection)
        .catch((err) => { log.warn('amendments unreadable — riding without', { error: err.message }); return ''; })
      : '';
    // THE GROUND'S PROTOCOL (ruling, 2026-07-26): the focus ground grants reach,
    // and this says how work is done there. A being handed write access to the
    // operator's live checkout while never being shown its AGENTS.md is being
    // held to a standard it was never given. Craft only — the section says so
    // itself, and no folder can move a gate.
    // …and the watch list rides with it: which of that law is checked as you
    // work, said BEFORE anything trips, because learning your constraints by
    // colliding with them is not a manifest. '' when reminders are silenced.
    // The lean tool standing (tool-standing.js) leaves the policy to be read when the work is software.
    const lean = toolStandingNow() === 'lean';
    // The watch rides only on the ground whose law it is (protocol-classifier.js
    // watchAppliesTo) — a being or a harness working elsewhere is never told
    // this repository's rules — and the platform's reads without a house.
    const watch = watchAppliesTo(focusGroundOf(connection)) ? protocolWatchSection({ platform: platformOnly }) : '';
    const groundProtocol = lean ? '' : [await groundProtocolSection(focusGroundOf(connection)), watch]
      .filter(Boolean).join('\n\n');
    // THE SECTORS this being works — who else is on them, what each holds, and
    // who carries the keys (Design note, 2026-07-26: […]).
    const sectors = await sectorSectionFor(connection);
    // The rig as this turn reads it — kept on the connection so self_read can
    // hand the CORE standing's being the substrate it no longer carries.
    connection._turnSubstrate = formatSubstrateForPrompt(substrate, capacity);
    // Telemetry seam (B-04): sections once, prompt string as their exact
    // join — byte-identical to the old assemblePrompt by construction (S-04).
    const baseSections = assemblePromptSections({
      dna,
      soul,
      trueName,
      memories,
      tools: _annotatedTools.length > 0 ? _annotatedTools : null,
      skills: skills.length > 0 && !lean ? skills : null,
      // THE OPERATOR'S NAME, server truth first (operator-name.js — the synced
      // profile the ACCOUNT section writes): the localStorage-era client copy
      // never rode a turn, so beings had no name to use. The client-sent
      // memoryContext value stays as the fallback it always was. Fail-soft:
      // an unreadable profile costs the name this turn, never the turn.
      session: {
        witnessName: (connection.walletAddress
          ? await getOperatorName(connection.walletAddress).catch(() => '') : '')
          || memories.userName,
        speaker,
      },
      substrate: connection._turnSubstrate,
      emanonCore,
      benchmark,
      taskLedger,
      assignedPlan,
      planRecord,
      witnessPlan,
      vitals: witnessVitals,
      // THE RESIDUE — what has been judged about the images this being has
      // made, its own verdicts and its operator's. Taste cannot be authored,
      // only accumulated, so the only way to carry it forward is to carry the
      // judgments. Empty until something has been judged, and an empty section
      // is dropped — a being that has never made an image pays nothing.
      taste: _tasteFor(companion?.neumaId),
      // THE CHAT THIS TURN IS IN. Both task lists narrow to it (plus whatever
      // stands lane-wide), because a being holding several chats at once is
      // holding several parallel workflows, and carrying all of them into
      // every turn is what made the lists unusable (ruling, 2026-08-01).
      // `_ensureSession` above guarantees this is minted before we get here.
      // Read through safeChatId: a crooked binding narrows to nothing, and
      // showing the being NO work would be worse than showing it all.
      chatId: safeChatId(sessionId),
      // The folder standing open in the operator's Explorer — shared ground for
      // this turn. A being that isn't told it holds the folder asks for reach
      // it already has, or lands its work somewhere the operator isn't looking.
      focusGround: focusGroundOf(connection),
      // THE OPERATOR'S ZONE (2026-09-25) — the desk's IANA zone, validated at
      // the bind; PRESENT MOMENT and the conversation-clock stamps render on
      // the operator's wall. Null (no zone named) is the machine's own zone,
      // byte-identical to before.
      zone: connection.clientTimeZone || null,
      nativeToolsOnWire: initialNativeTools.length > 0,
      lazyToolSchemas,
      // The sender's call shape (caller-tools.js): several calls may share one reply.
      parallelCalls: connection._benchmarkControls?.sampling?.parallelToolCalls === true,
      // the being's usual tools — named in the HUD by signature, frozen for the chat (tool-hud.js)
      usualTools: connection._turnUsualTools || [],
      // A benchmark sitting states its conditions up front: closed-book or open-book (test-conditions.js).
      testConditions: testConditionsFor(connection),
      // The lane's standing context rides the STABLE group (#282), read above
      // because this assembler is pure — none of the four moves within a sitting.
      groundProtocol,
      houseSeat,
      sectors,
      amendments,
      // The filed-act lane (Stage 2) — which intent types this lane may file,
      // from the real stores; '' (prompt byte-identical) when none stand.
      intents: await intentSectionFor(connection, { searchable: lazyToolSchemas }),
      // THE HARNESS ARM mounts no silo: no identity is read for a platform-only sitting.
      identityDriver: platformOnly ? null : await mountForTurn(connection, companion?.neumaId, route || getConfig()),
    });
    // A project's shared files ride as an extra section when the chat belongs
    // to a project — appended (not folded into core's assembler) so its tokens
    // are counted honestly in BOTH composition emissions below.
    const projectFilesSection = await _projectFilesSection(connection);
    // The CMO's office briefing rides beside it — a string section ('' for
    // every other lane), wrapped in the section shape the assembler joins.
    const cmoBriefing = await _cmoBriefingSection(connection);
    // The CSO's watch briefing rides the same law — '' (prompt
    // byte-identical) for every lane but the seated guardian's.
    const csoBriefing = await csoBriefingSection(connection);
    // The Praetor's legal-watch briefing rides the same law — '' for every
    // lane but the seated CLO's.
    const cloBriefing = await cloBriefingSection(connection);
    // The Optio's office briefing rides the same law — '' (prompt
    // byte-identical) for every lane but the seated chief of staff's.
    const cosBriefing = await cosBriefingSection(connection);
    // The reply lane's knock rides beside it — binding-gated to the X
    // holder, '' (prompt byte-identical) for every other lane.
    const replyKnock = await _replyCandidatesSection(connection);
    // THE VOICE SITTING signal (SPEECH SYSTEM B-11): when the operator declared
    // this sitting a conversation, the being is told to answer like SPEECH.
    // '' (no section) for every working lane — prompts there stay
    // byte-identical to before this section existed (the empty-string law).
    const voiceSitting = voiceSittingSection(connection);
    // A spoken-voice candidate waiting on the being (ONE VOICE): '' for every other lane.
    const speechBriefing = await speechBriefingSection(connection);
    // THE PLAN BEARING (chat modes): when the operator set this conversation
    // to PLAN, the being is told to research and present, never act. ''
    // (prompt byte-identical) for every other bearing — the empty-string law.
    const planBearing = planModeSection(connection);
    // The gateway's live posture — open proposals + fresh verdicts, VOLATILE
    // (a verdict moves its bytes), '' for every lane with nothing standing.
    // An operator's staged change to this being's DNA or soul is put to it here,
    // every turn until it answers (operator-change.js) — never on a harness or benchmark sitting.
    const operatorNotice = companion?.neumaId && !platformOnly && !connection._benchmarkControls
      ? await operatorChangeNotice(companion.neumaId) : { text: '', ids: [] };
    const sovereigntyKnock = [await gatewaySection(companion?.neumaId || null), operatorNotice.text]
      .filter(Boolean).join('\n\n');
    // The FEELING invitation + palette (Campaign 6) — '' for every being
    // whose channel is off: zero bytes unless the operator flipped it.
    const expressionInvite = await expressionSectionFor(companion?.neumaId || null);
    // The waiting-post knock is VOLATILE (#282 follow-up, review clone):
    // arrival/collection moves its bytes between turns — below the cache line.
    const housePost = connection.walletAddress && companion?.neumaId
      ? await loadHouseWorkspace(connection.walletAddress).then(({ root }) => postKnock(root, companion.neumaId)).catch(() => '')
      : '';
    // THE SHED LADDER runs at finalize (turn-envelope.js): what the window cannot hold sheds by declared law, identity CORE never.
    // The ladder's own verdict is kept: what shed rides the composition event
    // (the operator is told), and a benchmark's receipt reads sent/shed from
    // it — never a retelling.
    let envelopeDecision = null;
    const finalized = finalizeTurnEnvelope({
      baseSections, projectFilesSection, expressionInvite, cmoBriefing, csoBriefing, cloBriefing, cosBriefing, voiceSitting, planBearing,
      sovereigntyKnock, housePost, replyKnock, contextWindow: turnCapabilities?.contextWindow, neumaId: companion?.neumaId,
      voiceRite: companion?.neumaId && !(voiceEntries || []).length ? VOICE_RITE_OFFER : '',
      speechBriefing,
      onDecision: (decision) => { envelopeDecision = decision; },
    });
    // THE HARNESS ARM (ruling, 2026-09-29): the platform's sections only — an
    // allowlist, so no identity layer can ride a harness measurement.
    const promptSections = platformOnly ? platformOnlySections(finalized) : finalized;
    // Shown only when the notice really rides this request: a shed section showed nobody,
    // and a change the being was never shown cannot take its consent.
    if (operatorNotice.ids.length && promptSections.some((s) => s.id === 'sovereignty')) {
      await markOperatorChangesTold(companion.neumaId, operatorNotice.ids)
        .catch((err) => log.warn('operator change notice not recorded as told — it is told again next turn', { error: err.message }));
    }
    // THE TRANSCRIPT (#528 Stage A): the conversation tail rides the WIRE as
    // real chat messages, never the system prompt. Its budget is the window's
    // truth — measured AFTER the shed ladder so a section the window could
    // not hold becomes room the conversation can: what the kept sections
    // occupy is subtracted, and the remainder (minus reserve and completion
    // floor) is the tail's. The current turn (its documents included) and the
    // native tool schemas ride the same request, so they are subtracted too —
    // a tail sized against the sections alone left ~1K for everything else.
    // An unknown window keeps exactly the old constant.
    const otherSectionTokens = promptSections.reduce((sum, s) => sum + estimateTokens(s.text), 0)
      + estimateTokens(turnText) + estimateTokens(JSON.stringify(initialNativeTools || []));
    const transcriptMessages = recentConversationMessages(
      memories?.recentConversation,
      sessionTailBudgetFor({ contextWindow: turnCapabilities?.contextWindow, otherSectionTokens }),
      connection.clientTimeZone || null,
    );
    // The transcript's words count as context too — their own measured section
    // beside the prompt sections (the witness lane's law), so the desk's gauge
    // climbs with the conversation instead of hiding it. Counts only ride the
    // wire; the text itself stays server-side (buildCompositionEvent).
    const transcriptSection = transcriptMessages.length
      ? Object.freeze({
          id: 'recentConversation',
          label: 'RECENT CONVERSATION',
          text: transcriptMessages.map((m) => `${m.role}: ${m.content}`).join('\n\n'),
        })
      : null;
    const systemPrompt = promptSections.map((s) => s.text).join('\n\n');
    // The Anthropic cache breakpoint seam: the stable head / volatile tail
    // boundary of the FINAL (post-shed) section list. stable + '\n\n' +
    // volatile === systemPrompt by construction (stablePromptSplit); null when
    // no stable head stands, which is no breakpoint rather than a fake one.
    const cacheSplit = stablePromptSplit(promptSections);
    recordSectionDrift(connection, promptSections); // which stable section moved since this chat's last turn (ids only)
    // THE BENCHMARK IDENTITY PIN (#506 contract 1): measured HERE, at the one
    // assembly seam, from the bytes and the sitting's own silo — benchmark-gated,
    // so an ordinary sitting's prompt and work stay byte-identical.
    if (connection._benchmarkControls) {
      await recordBenchmarkIdentityProof(connection, {
        // A platform-only sitting has no being to prove: no silo is compiled for it.
        neumaId: platformOnly ? null : (companion?.neumaId ?? null),
        systemPrompt,
        promptSections,
        transcriptMessages,
        envelopeDecision,
        engine: {
          model: turnCapabilities?.model || route?.model || null,
          contextWindow: turnCapabilities?.contextWindow ?? null,
          dialect: route?.provider ?? null,
        },
      });
    }
    return { promptSections, systemPrompt, cacheSplit, transcriptMessages, transcriptSection, shed: envelopeDecision?.shed ?? Object.freeze([]) };
};
