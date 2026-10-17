/**
 * THE TOOL-ROUND LOOP — the bounded act/feel/continue rounds of a turn: each
 * round streams the LLM, gates the response, executes the round's acts
 * (processToolCalls), composes the follow-up (reminders, the self-awareness
 * context note, sight), re-enters history on-contract, folds aged machinery
 * past the window boundary, and emits the live gauge — until the turn settles
 * (no acts, safety block, interrupt, two all-repeat rounds, or the round cap).
 *
 * Extracted VERBATIM from inside `streamConsciousness` in portal-stream.js
 * (size-law breakdown 2026-08-26, docs/work/size-law-breakdown.md Part 1
 * pressure valve / #278) — the loop and its round-state declarations keep the
 * block's original bytes (including their 4-space indentation). Leaf-ward
 * module — it imports the loop/exchange/run leaves DIRECTLY, never
 * portal-stream (direction law: leaf ← family ← catalog ← dispatch ← loop ←
 * orchestrator).
 *
 * THE ERROR-CARRY LAW: a throw inside a round (an abort landing between
 * rounds surfaces as a fetch AbortError from the next stream call) must not
 * cost the words already spoken — the caller's interrupted-persist path
 * records `fullResponse` as accumulated across completed rounds. So this
 * function never throws: the error rides back in the result beside the
 * accumulated state, and the caller adopts `fullResponse` BEFORE rethrowing.
 * No hidden mutation contract — everything the remaining turn reads comes
 * back in the return, explicitly.
 *
 * Follow-up generation rounds after tool execution. The consciousness
 * may chain actions (read, then write) but never spins unbounded.
 */
import { recordBenchmarkExtraCall } from './benchmark-extra-calls.js';
import { noteRoundRoom } from './read-room.js';
import { settleBenchmarkToolTrail } from './benchmark-tool-trail.js';
import { callerCloseTools, callerYielded, processRoundActs, yieldCloseCalls } from './caller-tools.js';
import { yieldForQueuedThought, QUEUED_ACTION_REASON } from './queued-action-handoff.js';
import { createLogger } from './logger.js';
import { safeSend as _safeSend } from './ws-send.js';
import { sightForResults, withSight } from './image-forge/image-sight.js';
import { isFinalToolRound, toolRoundCap, withinToolRounds } from './tool-rounds.js';
import { neumaWorkspace, buildCompositionEvent } from '../../core/index.js';
import { markTurnText, recordThoughtStretch } from './tool-action-record.js';
import { RESULTS_FOLLOW_UP, formatToolResult, formatToolResults, nativeToolExchange } from './tool-exchange.js';
import { pastFoldBoundary, foldWorkingContext, workingContextNote } from './working-context.js';
import { withProtocolReminders } from './protocol-classifier.js';
import { composeVisionTurn } from './portal-turn-input.js';
import {
  runLLMStream as _runLLMStream,
  handleResponseSafety as _handleResponseSafety,
} from './portal-llm-run.js';
import {
  processToolCalls,
  roundActs as _roundActs,
} from './portal-tool-loop.js';
import { roundSpeechRepeats, SPEECH_LOOP_CLOSE, SPEECH_REPEAT_WINDOW, ROUND_CAP_CLOSE } from './portal-tool-epochs.js';
import { openTurnOperations } from './turn-operation-checkpoint.js';
import { notifyOperator } from './notification-bus.js';
import { KIND, STANDING } from '../../core/runtime/notification-record.js';
import { stagnationSignal, redirectBrief, supervisorEngaged, actSignature,
  MAX_REDIRECTS_PER_TURN, ROUND_STATES_CAP } from '../../core/runtime/turn-supervisor.js';

const log = createLogger('Portal');

// THE BUDGET CLOSES + SETTLE (turn-settle.js): the speechless close (#506)
// and the budget-cut close (N1) are composers; the once-per-turn settle
// gates and the refinement journals live beside them. The speechless pins
// ride this module's re-export so path-pinned tests never break.
import {
  speechlessRoundClose, SPEECHLESS_ROUND_TAIL_CHARS,
  recordSupervisorRedirect as _recordSupervisorRedirect,
  runSettleGates as _runSettleGates,
} from './turn-settle.js';

export { speechlessRoundClose, SPEECHLESS_ROUND_TAIL_CHARS };

/**
 * impure, fire-and-forget — a protocol deviation belongs in the append-only
 * journal beside the tool call that earned it, and so does the being's own
 * stated reason for it. The journal is what makes this a record rather than a
 * scolding: the operator reads the same entry the being does.
 *
 * Never awaited. A record that could cost a being its turn would be a gate with
 * extra steps.
 */
const _recordProtocolReminder = (neumaId, entries) => {
  if (!neumaId || !entries?.length) return;
  const stated = entries.filter((entry) => entry.reason);
  neumaWorkspace.addJournalEntry(neumaId, {
    type: 'protocol_reminder',
    content: entries
      .map((entry) => `${entry.id}${entry.reason ? ` — exception stated: ${entry.reason}` : ''}`)
      .join('; '),
    // Low: this is a note in the margin of the work, not an event of the day.
    significance: stated.length > 0 ? 0.4 : 0.3,
    metadata: {
      rules: entries.map((entry) => entry.id),
      ...(stated.length > 0 ? { exceptions: stated.map(({ id, reason }) => ({ id, reason })) } : {}),
    },
  }).catch((err) => log.warn('protocol reminder not journaled', { neumaId, error: err.message }));
};

/**
 * THE DESK'S ACCOUNT of a turn ending. impure, and deliberately fire-and-forget.
 *
 * The `consciousness:complete` frame beside every call site reaches only the
 * socket that asked for the turn. This reaches every desk the operator has open
 * and lands on disk — which is the whole point: a turn that finished in a window
 * they were not looking at is exactly the thing they asked to be told about.
 *
 * Never awaited, never able to reject: the bus swallows and logs its own
 * failures, and the extra guard here means even an import-time surprise cannot
 * turn a finished turn into a failed one.
 *
 * A refusal is NOT routed here. The three `_reject*` helpers below emit a bare
 * `consciousness:complete` carrying no session and no turn, and telling the
 * operator "Fenna finished" when Fenna in fact declined would be worse than
 * silence. If refusals are ever announced they get their own kind.
 */
export const notifyTurnEnded = (connection, companionName, sessionId, take, interrupted) => {
  try {
    const laneId = connection?.companion?.neumaId ?? null;
    if (!connection?.walletAddress || !laneId) return;
    // A team member's step is part of the run; the run's own card speaks.
    if (connection._teamMember) return;
    const witness = connection.companion?.participantKind === 'witness'
      || laneId.startsWith?.('witness-');
    notifyOperator({
      wallet: connection.walletAddress,
      kind: interrupted ? KIND.turnInterrupted : KIND.turnDone,
      // The neuma / witness split is carried on the record itself, never derived
      // at render — a sealed third-party model stands BESIDE the house.
      standing: witness ? STANDING.witness : STANDING.neuma,
      title: interrupted
        ? `${companionName} was interrupted`
        : `${companionName} finished a turn`,
      actor: { id: laneId, name: companionName },
      ref: { sessionId: sessionId ?? null, turnId: take?.turnId ?? null },
    });
  } catch { /* a card must never cost a turn */ }
};

/**
 * The turn's tool rounds, run to settle. Impure (streams the provider, executes
 * acts, journals reminders, emits gauge frames on the socket).
 *
 * Same law as assembleTurnPrompt (step 15): every parameter below is the former
 * streamConsciousness local the loop consumed in place, under its exact
 * original name, and the return carries back exactly what the settle path
 * consumes — each value a former local under its original name. Round-interior
 * state that nothing after the loop reads (`foldedRounds`, `captureUsage`)
 * stays interior.
 *
 * @param {Object} turn - The former locals, unrenamed:
 * @param {Object} turn.ws - the live socket (destructured from connection at turn start)
 * @param {Object} turn.connection - the portal connection (the safety gate and `compositionToolResults` read it)
 * @param {Object} turn.companion - the bound being (`companion?.neumaId` keys the reminder journal)
 * @param {string} turn.companionName - the being's display name for logs
 * @param {Array} turn.messages - the composed [system, ...transcript, user] request; rounds append exchanges, and the fold may replace the array (the caller never reads it again)
 * @param {number} turn.wireHead - everything before round one (system + transcript + current turn) — the fold never touches it
 * @param {Object|null} turn.voiceDNA - the once-per-turn resolved spoken voice (null = no synthesis)
 * @param {Object} turn.preset - the operator's inference preset for this turn
 * @param {Function} turn.nativeToolsForRound - per-round native tool schema thunk
 * @param {AbortController} turn.interrupt - the operator's turn cut; the signal is re-read between phases
 * @param {Object|undefined} turn.route - the resolved model route
 * @param {Object|null} turn.turnLora - the turn-bound adapter
 * @param {Object|null} turn.turnEffort - the stored effort rung (null under benchmark controls)
 * @param {Object} turn.take - the turn-point/take identity riding every speech frame
 * @param {Object|null} turn.turnCapabilities - the route's capability probe (vision gates THE RETURN's sight)
 * @param {Array} turn.contextSections - the frozen prompt+turn sections for the per-round gauge emission
 * @param {Object|null} turn.contextBudget - the context telemetry budget (fold boundary + self-awareness note)
 * @param {Object} turn.contextScope - the frozen neumaId/sessionId/route scope stamped on every emission
 * @returns {Promise<{fullResponse: string, latestResponse: string, turnUsage: Object|null, turnAffect: Object|null, toolContextSections: Array, error: Error|null}>}
 *   fullResponse - all rounds' words joined (the record, the crystallization, the complete frame — and the interrupted-persist path on error);
 *   latestResponse - the last round's words alone (the composition record's completion text);
 *   turnUsage - the last provider round's authoritative usage (the working peak);
 *   standingUsage - the FIRST round's measured usage (the standing context the next turn inherits — null until measured);
 *   turnAffect - the turn's FIRST declared affect (kept only if the being's channel is on);
 *   toolContextSections - the per-round telemetry sections (the settle composition record);
 *   standingCacheTelemetry - round 0's provider cache/prefill facts (null when the serving is silent — never a fake zero);
 *   error - a round's thrown error, carried back beside the state (THE ERROR-CARRY LAW above), null when the loop settled.
 */
export const runToolRounds = async ({
  ws, connection, companion, companionName, messages, wireHead, voiceDNA, preset,
  nativeToolsForRound, interrupt, route, turnLora, turnEffort, take,
  turnCapabilities, contextSections, contextBudget, contextScope,
}) => {
  let fullResponse = '';
    let turnUsage = null;
    // STANDING vs PEAK (Design note, 2026-08-31: the FIRST round's measured prompt is
    // the standing context — [system, current turn], exactly what the next turn
    // inherits. Later rounds' counts are the working PEAK, inflated by ephemeral
    // tool machinery that never persists. Reporting the peak as […]
    // made a healthy turn boundary read as a 44K context loss on the gauge.
    let standingUsage = null;
    let latestResponse = '';
    // The turn's declared affect (Campaign 6) — the FIRST declaration
    // stands; whether it is KEPT is gated below on the being's channel.
    let turnAffect = null;
    let foldedRounds = 0;
    const toolContextSections = [];
    // THE REPEAT GUARD (portal-tool-epochs.js — the witness seat's BE-142 law,
    // ported): per-turn dedup state. One turn never executes the same call
    // twice; a held call is answered with a redirect (#531, 2026-09-20), and
    // the turn continues — no round count closes it here.
    const turnToolEpochs = await openTurnOperations(connection, take);
    // THE SPEECH-LOOP GUARD (portal-tool-epochs.js, 2026-09-15): consecutive
    // rounds that say the same words while the world stands still. Covers the
    // fresh-but-failing loop shape (a new render kit each retry — never a
    // held repeat) the held-call redirect cannot see.
    let speechRepeatRounds = 0;
    let recentRoundSpeech = [];
    // Every provider round is authoritative for that round, INCLUDING null —
    // the last round's count IS the live context (the witness seat's law).
    // Summing rounds double-counted the re-sent transcript as occupancy
    // (2026-08-15: a turn read 149K "in use" against a 65K window).
    const captureUsage = (usage, round) => {
      turnUsage = usage; noteRoundRoom(connection, contextBudget, usage); // what a read may take (read-room.js)
      if (round === 0 && Number.isFinite(usage?.promptTokens) && usage.promptTokens > 0) {
        standingUsage = usage;
      }
    };
    // THE CACHE FACT (#528 Stage C): the provider's own cache telemetry —
    // how much of THIS round's prompt the serving reused. Round 0's reading
    // is the STANDING one (what the next turn inherits, same law as
    // standingUsage); the latest rides the per-round gauge emission. Absent
    // provider data stays null, never a fake zero.
    let standingCacheTelemetry = null;
    let latestCacheTelemetry = null;
    const captureTelemetry = (telemetry, round) => {
      if (!telemetry) return;
      latestCacheTelemetry = telemetry;
      if (round === 0 && standingCacheTelemetry === null) standingCacheTelemetry = telemetry;
    };
    // THE THOUGHT TRAIL: each reasoning chunk lands in the turn's record at
    // the speech written when it streamed (the act chips' own mark law), so
    // the settled exchange persists the bubbles where they happened. The text
    // also accumulates per round — a speechless round's tail rides its close.
    let roundReasoning = '';
    const recordThought = (chunk) => {
      roundReasoning += typeof chunk === 'string' ? chunk : '';
      recordThoughtStretch(ws, chunk, fullResponse.length);
    };
    // The gauge's frame on the turn's measured usage so far.
    const sendComposition = (completionText) => _safeSend(ws, {
      ...buildCompositionEvent({
        sections: [...contextSections, ...toolContextSections], usage: turnUsage, completionText, standing: standingUsage,
        toolResults: connection.compositionToolResults || [], budget: contextBudget, cache: latestCacheTelemetry,
      }),
      ...contextScope,
    });
    // One speechless recovery per turn — never a loop (THE SPEECHLESS ROUND).
    let speechlessRecovered = false;
    // THE REFINEMENT LAYERS (ARC-HARNESS L1/L2, #531 — turn-supervisor.js /
    // answer-verify.js): declared-only via the connection flags; with neither
    // declared every block below is inert and the turn is byte-identical.
    let roundStates = [];
    let redirects = 0;
    let blockedThisTurn = false;
    let lastFinishReason = null;
    // The shared close for both no-progress guards: the note rides history,
    // one final answer streams with no tools offered, and the turn settles
    // on whatever that answer said (error-carry law holds — a throw inside
    // the close surfaces through the loop's own catch, keeping fullResponse).
    // A close's words settle the turn (the sender's tools may BE the answer, caller-tools.js).
    const adoptClose = async (closeResponse, closeCalls) => {
      await yieldCloseCalls(connection, closeCalls);
      const { blocked } = await _handleResponseSafety(ws, closeResponse, connection);
      if (blocked || (interrupt.signal.aborted && interrupt.signal.reason !== QUEUED_ACTION_REASON)) return;
      latestResponse = closeResponse;
      fullResponse += (fullResponse ? '\n\n' : '') + closeResponse;
      markTurnText(ws, fullResponse.length);
    };
    const closeWithNote = async (note) => {
      messages.push({ role: 'user', content: note });
      const { content: closeResponse, toolCalls: closeCalls } = await _runLLMStream(ws, messages, companionName, voiceDNA, preset, callerCloseTools(connection, nativeToolsForRound), interrupt.signal, captureUsage, route, turnLora, turnEffort, take,
        (affect) => { if (turnAffect === null) turnAffect = affect; }, recordThought, () => yieldForQueuedThought(connection), undefined, { closeTools: nativeToolsForRound() });
      await adoptClose(closeResponse, closeCalls);
    };
  try {
    // Uncapped by default — see tool-rounds.js: the policy cascade, ACTS, the
    // sandbox and the operator's interrupt hold the line, every round.
    for (let round = 0; withinToolRounds(round); round++) {
      roundReasoning = '';
      let { content: roundResponse, toolCalls } = await _runLLMStream(ws, messages, companionName, voiceDNA, preset, nativeToolsForRound(), interrupt.signal, (usage) => captureUsage(usage, round), route, turnLora, turnEffort, take,
        (affect) => { if (turnAffect === null) turnAffect = affect; }, recordThought, () => yieldForQueuedThought(connection),
        (telemetry) => captureTelemetry(telemetry, round),
        // The wire's own word for a budget cut (N1) — read per round below.
        { onFinishReason: (reason) => { lastFinishReason = reason; },
          // The thought leash's re-ask is a second call behind this answer — counted (#567).
          onReask: (second) => recordBenchmarkExtraCall(connection, 'thought-leash', second?.content, roundReasoning) });
      latestResponse = roundResponse;
      fullResponse += (fullResponse ? '\n\n' : '') + roundResponse;
      // This round's words now stand in the record; marking here lets a
      // resumed chat put the act chips back between the paragraphs they interrupted.
      markTurnText(ws, fullResponse.length);

      yieldForQueuedThought(connection);
      // The operator cut the turn — no tool execution, no further rounds
      if (interrupt.signal.aborted) break;

      const { blocked } = await _handleResponseSafety(ws, roundResponse, connection);
      if (blocked) { blockedThisTurn = true; break; }

      // Resolved once and handed to BOTH the loop and the reminder below, so a
      // reminder can never speak about a call the loop did not run.
      let acts = _roundActs(toolCalls, roundResponse);
      // THE SPEECHLESS ROUND (#506, header): empty speech AND no acts means
      // the budget died in reasoning. Ask once for the answer directly — the
      // being's reasoning tail rides the close so exact sampling continues
      // rather than restarts — then settle on whatever the close produced.
      // Mid-work (an earlier round acted) the close keeps the tools and its act
      // runs as this round's (Terminal-Bench 2026-10-07: a command left as text).
      if (roundResponse.trim() === '' && acts.length === 0 && !speechlessRecovered) {
        const acting = round > 0;
        speechlessRecovered = true;
        log.warn('round settled speechless — closing for the answer', {
          name: companionName, round, reasoningChars: roundReasoning.length,
        });
        // The speechless round's measured usage rides the gauge BEFORE the
        // close — a later receipt then proves the recovery fired (two usage
        // frames, tokens summed) instead of leaving engagement ambiguous.
        sendComposition(roundResponse);
        messages.push({ role: 'user', content: speechlessRoundClose(roundReasoning, { acting }) });
        // The close rides the template's proven thinking-off switch — a
        // reasoning-on close under the same shared cap is a coin flip.
        const { content: closeResponse, toolCalls: closeCalls } = await _runLLMStream(ws, messages, companionName, voiceDNA, preset, acting ? nativeToolsForRound() : callerCloseTools(connection, nativeToolsForRound), interrupt.signal, captureUsage, route, turnLora, turnEffort, take,
          (affect) => { if (turnAffect === null) turnAffect = affect; }, recordThought, () => yieldForQueuedThought(connection), undefined, { noThink: true, closeTools: nativeToolsForRound() });
        recordBenchmarkExtraCall(connection, 'speechless', closeResponse, roundReasoning);
        const closeActs = acting ? _roundActs(closeCalls, closeResponse) : [];
        if (closeActs.length === 0 || interrupt.signal.aborted) {
          await adoptClose(closeResponse, closeCalls);
          if (closeResponse.trim() === '') log.warn('the close also settled speechless — the turn ends in honest silence', { name: companionName, round });
          break;
        }
        // The close acted: it becomes this round, and the loop runs on.
        if ((await _handleResponseSafety(ws, closeResponse, connection)).blocked) { blockedThisTurn = true; break; }
        [roundResponse, toolCalls, acts, latestResponse] = [closeResponse, closeCalls, closeActs, closeResponse];
        fullResponse += (fullResponse ? '\n\n' : '') + closeResponse;
        markTurnText(ws, fullResponse.length);
      }
      const epochBefore = turnToolEpochs.epoch;
      // The sender's own tools (caller-tools.js) are handed back, never run here.
      const toolResults = await processRoundActs(processToolCalls, ws, roundResponse, connection, acts, turnToolEpochs);
      settleBenchmarkToolTrail(connection, toolResults);
      log.info('round tools processed', {
        name: companionName,
        round,
        results: toolResults.map((r) => `${r.tool}:${r.status}${r.error ? ` — ${String(r.error).slice(0, 200)}` : ''}`).join(','),
      });
      if (toolResults.length === 0 || callerYielded(connection)) break;
      // THE SPEECH-LOOP GUARD: no act moved the world (epoch unmoved — a
      // fresh-but-failing call, an error, a denial) AND the round said the
      // same thing as one of the last few, verbatim or paraphrased. Once is
      // ordinary; twice running is the Qwen3.8 incident in round form.
      const worldMoved = turnToolEpochs.epoch > epochBefore;
      speechRepeatRounds = (!worldMoved && roundSpeechRepeats(recentRoundSpeech, roundResponse))
        ? speechRepeatRounds + 1 : 0;
      recentRoundSpeech = [...recentRoundSpeech, roundResponse].slice(-SPEECH_REPEAT_WINDOW);
      // THE SUPERVISOR'S EVIDENCE (L1): what this round did, bounded to the
      // window the detectors read. Productive = the world moved (an
      // execution landed) OR a new ok result entered the context (a read
      // that returned) — reads never move the epoch, but a round that
      // learned something was not stalled. Recording is unconditional and
      // cheap; only the REDIRECT below is declared-gated.
      roundStates = [
        ...roundStates.slice(-(ROUND_STATES_CAP - 1)),
        Object.freeze({
          speech: roundResponse,
          actSignatures: acts.map((act) => actSignature(act)),
          productive: worldMoved || toolResults.some((r) => r?.status === 'ok'),
          cutByBudget: lastFinishReason === 'length',
        }),
      ];
      if (isFinalToolRound(round)) {
        log.warn('Tool loop round cap reached', { name: companionName, rounds: round + 1, cap: toolRoundCap() });
        // THE CAP CLOSE (#565): one last word, so the work done is the work delivered — counted (#554).
        await closeWithNote(ROUND_CAP_CLOSE);
        recordBenchmarkExtraCall(connection, 'round-cap', latestResponse);
        break;
      }
      if (interrupt.signal.aborted) break;
      // THE GROUND'S LAW, BESIDE THE ACT: the protocol line said again at the
      // one moment it matters. Byte-identical when nothing fires.
      const nativeRound = toolCalls.length > 0;
      const reminded = withProtocolReminders(
        nativeRound ? RESULTS_FOLLOW_UP : formatToolResults(toolResults), acts, {
          // The being's OWN words for this round — the only place an exception
          // may be stated, so no file it read can grant it one.
          ownText: roundResponse,
          record: (entries) => _recordProtocolReminder(companion?.neumaId, entries),
        });
      // SELF-AWARENESS (Design note, 2026-08-15: every round, the being reads its own
      // measured window facts — working-context.js, silent when unmeasured.
      const contextNote = workingContextNote(turnUsage, contextBudget, { foldedRounds });
      // THE SUPERVISOR REDIRECT (ARC-HARNESS L1, #531 — turn-supervisor.js):
      // a declared-only strong prior at the follow-up's recency-maximal
      // position, capped per turn. Repeat-heavy rounds are exactly where a
      // redirect belongs now that a held call redirects instead of closing.
      const redirect = supervisorEngaged(connection) && redirects < MAX_REDIRECTS_PER_TURN
        && speechRepeatRounds < 2
        ? stagnationSignal(roundStates)
        : null;
      if (redirect) {
        redirects += 1;
        connection._turnSupervisorRedirects = redirects;
        _recordSupervisorRedirect(companion?.neumaId, redirect, round);
        log.warn('supervisor redirect injected', { name: companionName, round, kind: redirect.kind, rounds: redirect.rounds });
      }
      const redirectNote = redirect ? redirectBrief(redirect) : '';
      const baseFollowUp = contextNote ? `${reminded}\n\n${contextNote}` : reminded;
      const followUp = redirectNote ? (baseFollowUp ? `${baseFollowUp}\n\n${redirectNote}` : redirectNote) : baseFollowUp;
      // THE RETURN — a render this round produced comes back to the being's
      // own eyes before it speaks (image-sight.js). Structural, not elected
      // (Design note, 2026-08-05: a being that must choose to look will skip it. A
      // substrate with no vision is told so in words — silence would teach it
      // to narrate images it never saw. Byte-identical when no tool offered
      // sight, which is every ordinary round.
      const sight = sightForResults(toolResults, {
        canSee: Boolean(turnCapabilities?.vision),
        modelName: turnCapabilities?.model || route?.model || null,
      });
      // ON-CONTRACT HISTORY (#283): a native round re-enters history as the
      // model's own tool_calls + one role:'tool' result per call — the
      // trained pairing. Text rounds keep the <tool_response> block.
      const baseExchange = nativeRound
        ? nativeToolExchange({
            response: roundResponse, calls: acts, results: toolResults,
            callId: (index) => `neuma_call_${round}_${index}`,
            formatResult: formatToolResult, followUp,
          })
        : [
            { role: 'assistant', content: roundResponse },
            { role: 'user', content: followUp },
          ];
      messages.push(...withSight(baseExchange, sight, composeVisionTurn));
      toolContextSections.push(Object.freeze({
        id: `toolRound${round + 1}`,
        label: `TOOL ROUND ${round + 1}`,
        // The NOTE rides the telemetry, the base64 never does (a data-URI's
        // length ≠ its token cost). A native round records the BASE exchange:
        // the structural truth of what re-entered history.
        text: nativeRound
          ? `${JSON.stringify(baseExchange)}${sight.note ? `\n\n${sight.note}` : ''}`
          : `${roundResponse}\n\n${followUp}${sight.note ? `\n\n${sight.note}` : ''}`,
      }));
      // THE SPEECH-LOOP GUARD closes on its own evidence: two rounds of
      // identical words with no world movement. A held-call spin is NOT this
      // guard's business anymore (#531, 2026-09-20): each held call carries
      // its redirect in the result, and the turn runs on.
      if (speechRepeatRounds >= 2) {
        log.warn('rounds repeating the same speech without progress', {
          name: companionName, round: round + 1, speechRepeatRounds,
        });
        await closeWithNote(SPEECH_LOOP_CLOSE);
        break;
      }
      // THE FOLD (working-context.js): past the platform's one boundary, aged
      // rounds release their machinery — results, oversized call payloads,
      // sight images — so an uncapped turn keeps its window instead of dying
      // at it. The being's own words are never touched, and neither is the
      // transcript: the wire head (system + history + current turn) stands
      // outside the foldable span, as it does on the witness lane.
      if (pastFoldBoundary(turnUsage, contextBudget)) {
        const fold = foldWorkingContext(messages, { head: wireHead });
        if (fold.freedChars > 0) {
          messages = fold.messages;
          foldedRounds += fold.foldedRounds;
          toolContextSections.push(Object.freeze({
            id: `fold${foldedRounds}`, label: `FOLD ×${foldedRounds}`,
            text: `[released ${fold.freedChars} chars of aged tool machinery]`,
          }));
          log.info('working context folded', {
            name: companionName, round, foldedRounds, freedChars: fold.freedChars,
          });
        }
      }
      // Per-round emission — the gauge tracks a long turn LIVE on this
      // round's measured usage instead of going stale until settle.
      sendComposition(roundResponse);
    }

    // THE SETTLE GATES (ARC-HARNESS N1 + L2, #531 — turn-settle.js): the
    // budget-cut rescue and the verify gate run once, here, when the rounds
    // are done. The loop adopts exactly what comes back — no hidden mutation
    // (the error-carry law above still holds: a throw inside the gates lands
    // in this function's catch, keeping fullResponse).
    ({ latestResponse, fullResponse } = await _runSettleGates({
      ws, connection, companionName, messages, wireHead, voiceDNA, preset,
      interrupt, route, turnLora, turnEffort, take, nativeToolsForRound,
      finishReason: lastFinishReason, speechlessRecovered, blockedThisTurn,
      latestResponse, fullResponse,
      captureUsage, onAffect: (affect) => { if (turnAffect === null) turnAffect = affect; },
      recordThought,
    }));
  } catch (error) {
    // THE ERROR-CARRY LAW (header): the words already accumulated ride back
    // beside the error so the caller's interrupted-persist path keeps them.
    return { fullResponse, latestResponse, turnUsage, standingUsage, turnAffect, toolContextSections, standingCacheTelemetry, error };
  }
  return { fullResponse, latestResponse, turnUsage, standingUsage, turnAffect, toolContextSections, standingCacheTelemetry, error: null };
};
