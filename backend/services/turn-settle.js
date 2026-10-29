/**
 * THE TURN SETTLE — the end-game leaf: the budget closes, the settle gates,
 * and the refinement journals.
 *
 * Extracted from portal-turn-rounds.js under the size law as the ARC-HARNESS
 * layers (#531) landed — the round loop keeps the rounds; everything that
 * happens when the rounds are DONE lives here. Leaf module (direction law:
 * it imports portal-llm-run and the core leaves DIRECTLY, never
 * portal-turn-rounds).
 *
 * Three pieces, all end-of-turn:
 * - THE BUDGET CLOSES — the composers for the two output-budget recoveries:
 *   the speechless close (#506: the budget died before any answer arrived)
 *   and the budget-cut close (N1, this epic: the budget died mid-answer).
 *   Both carry the being's own tail so exact sampling continues instead of
 *   restarting. Re-exported through portal-turn-rounds for the pins.
 * - THE SETTLE GATES (`runSettleGates`) — the once-per-turn post-loop
 *   recoveries: the budget-cut rescue (ungoverned: the wire's own
 *   finish_reason is the only trigger) and the verify gate (ARC-HARNESS L2,
 *   declared-only via `connection._answerVerify`). The loop hands the turn
 *   in and adopts exactly what comes back — no hidden mutation.
 * - THE REFINEMENT JOURNALS — the supervisor redirect and verify verdict
 *   records (protocol-reminder precedent: a record in the lane's journal the
 *   operator reads too, never a scolding only the being sees). Fire-and-
 *   forget: a record must never cost the turn it describes.
 */
import { recordBenchmarkExtraCall } from './benchmark-extra-calls.js';
import { createLogger } from './logger.js';
import {
  runLLMStream as _runLLMStream,
  handleResponseSafety as _handleResponseSafety,
} from './portal-llm-run.js';
import { markTurnText } from './tool-action-record.js';
import { yieldForQueuedThought, QUEUED_ACTION_REASON } from './queued-action-handoff.js';
import { neumaWorkspace } from '../../core/index.js';
import { currentTurnText, turnOwesFinalAnswer, verifyBrief, verifyEngaged } from '../../core/runtime/answer-verify.js';
import { scoreCandidates } from './candidate-scorer.js';
import { UNSETTLED_ALLOWANCE } from './thought-governor.js';
import { selectCandidate } from './candidate-select.js';

const log = createLogger('Portal');

/** The closing instruction the candidate pass rides — the house register. Pure. */
export const CANDIDATE_ASK = 'Give the final answer now, in exactly the form the task requires — brief is right.';

// ── THE BUDGET CLOSES ────────────────────────────────────────────────────────

/** How much of the round's reasoning tail the speechless close carries back. Pure. */
export const SPEECHLESS_ROUND_TAIL_CHARS = 2000;

/**
 * The closing user message after a speechless round. Pure. Mid-work (acting)
 * the next step may be an act rather than the answer, so the close says so.
 */
export const speechlessRoundClose = (reasoning, { acting = false } = {}) => {
  const tail = typeof reasoning === 'string' ? reasoning.trim() : '';
  return [
    'Your reply never arrived — the output budget was spent before any answer reached me.',
    tail.length > 0
      ? `Your reasoning up to the cut ended here:\n"""\n${tail.slice(-SPEECHLESS_ROUND_TAIL_CHARS)}\n"""\nContinue from where you were, briefly.`
      : null,
    acting
      ? 'Do not deliberate further. Take your next action now, or give the final answer in exactly the form the task requires — brief is right.'
      : `Do not deliberate further. Give the final answer now, in exactly the form the task requires — brief is right. ${UNSETTLED_ALLOWANCE}`,
  ].filter((part) => part !== null).join('\n\n');
};

/** How much of the cut reply the budget-cut close carries back. Pure. */
export const BUDGET_CUT_TAIL_CHARS = 2000;

/** The closing user message after a budget-cut round. Pure. */
export const budgetCutClose = (partialReply) => {
  const tail = typeof partialReply === 'string' ? partialReply.trim() : '';
  return [
    'Your reply was cut by the output budget before it finished.',
    tail.length > 0
      ? `It ended here:\n"""\n${tail.slice(-BUDGET_CUT_TAIL_CHARS)}\n"""\nContinue from exactly where it stopped.`
      : null,
    `Do not restart the work or reason at length again. Give the final answer now, in exactly the form the task requires — brief is right. ${UNSETTLED_ALLOWANCE}`,
  ].filter((part) => part !== null).join('\n\n');
};

// ── THE REFINEMENT JOURNALS ──────────────────────────────────────────────────

/**
 * impure, fire-and-forget — the supervisor's redirect belongs in the lane's
 * journal beside the rounds that earned it. Never awaited.
 */
export const recordSupervisorRedirect = (neumaId, signal, round) => {
  if (!neumaId) return;
  neumaWorkspace.addJournalEntry(neumaId, {
    type: 'supervisor_redirect',
    content: `redirect (${signal.kind}) after ${signal.rounds} stagnant round(s), tool round ${round + 1}`,
    significance: 0.5,
    metadata: { kind: signal.kind, rounds: signal.rounds, toolRound: round + 1, layer: 'arc-harness-l1' },
  }).catch((err) => log.warn('supervisor redirect not journaled', { neumaId, error: err.message }));
};

/** impure, fire-and-forget — the verify gate's verdict lands in the same journal. */
const _recordVerifySettle = (neumaId, verdict) => {
  if (!neumaId || !verdict) return;
  neumaWorkspace.addJournalEntry(neumaId, {
    type: 'answer_verify',
    content: `verify gate: ${verdict}`,
    significance: 0.4,
    metadata: { verdict, layer: 'arc-harness-l2' },
  }).catch((err) => log.warn('verify verdict not journaled', { neumaId, error: err.message }));
};

// ── THE SETTLE GATES ─────────────────────────────────────────────────────────

/**
 * The once-per-turn post-loop gates. Impure (streams the provider, journals,
 * marks the turn record). Every parameter is the loop's own live local under
 * its original name; the return carries back exactly the two values the
 * settle may change, and the loop adopts them explicitly (the same no-hidden-
 * mutation contract as runToolRounds itself).
 *
 * @param {Object} turn - the settle context:
 * @param {Object} turn.ws - the live socket
 * @param {Object} turn.connection - the portal connection (engagement flags, journal lane)
 * @param {string} turn.companionName - the being's display name for logs
 * @param {Array} turn.messages - the live request (gates push their closes onto it)
 * @param {number} turn.wireHead - everything before round one (the current turn sits just before it)
 * @param {Object|null} turn.voiceDNA - the turn's spoken voice (null = no synthesis)
 * @param {Object} turn.preset - the operator's inference preset for this turn
 * @param {AbortController} turn.interrupt - the operator's turn cut
 * @param {Object|undefined} turn.route - the resolved model route
 * @param {Object|null} turn.turnLora - the turn-bound adapter
 * @param {Object|null} turn.turnEffort - the stored effort rung
 * @param {Object} turn.take - the turn-point/take identity
 * @param {Function} [turn.nativeToolsForRound] - the round's tools — a close keeps them on
 *   llama.cpp, held from calling, so the chat's cached prompt holds (close-prefix.js)
 * @param {string|null} turn.finishReason - the wire's verdict on the final round
 * @param {boolean} turn.speechlessRecovered - did the speechless close already recover this turn
 * @param {boolean} turn.blockedThisTurn - did the safety gate block a round (a blocked turn is not verified or rescued)
 * @param {string} turn.latestResponse - the drafted answer as the loop left it
 * @param {string} turn.fullResponse - the turn's accumulated words
 * @param {Function} turn.captureUsage - the loop's per-round usage sink
 * @param {Function} turn.onAffect - the turn's first-declared-affect sink
 * @param {Function} turn.recordThought - the thought-trail sink
 * @returns {Promise<{latestResponse: string, fullResponse: string}>}
 */
export const runSettleGates = async ({
  ws, connection, companionName, messages, wireHead, voiceDNA, preset,
  interrupt, route, turnLora, turnEffort, take, nativeToolsForRound = null,
  finishReason, speechlessRecovered, blockedThisTurn, latestResponse, fullResponse,
  captureUsage, onAffect, recordThought,
}) => {
  const notInterrupted = () => !interrupt.signal.aborted
    || interrupt.signal.reason === QUEUED_ACTION_REASON;
  const streamClose = (content, roundOpts) => _runLLMStream(
    ws, messages, companionName, voiceDNA, preset, [], interrupt.signal, captureUsage,
    route, turnLora, turnEffort, take, onAffect, recordThought,
    () => yieldForQueuedThought(connection), undefined,
    { ...roundOpts, closeTools: nativeToolsForRound?.() ?? null },
  );

  // THE BUDGET-CUT RESCUE (N1, ARC-HARNESS L7 slice): the FINAL round ended on
  // the provider's output-budget cut with words already on the wire — the
  // other half of the budget family the speechless close recovers when
  // nothing was spoken. One continuation close rides the partial text so
  // exact sampling finishes the answer instead of the turn settling
  // truncated. Ungoverned turns are unaffected: without the wire's length
  // verdict there is no rescue, and the speechless close counts as this
  // turn's one recovery when it fired.
  if (finishReason === 'length' && !speechlessRecovered && !blockedThisTurn
    && latestResponse.trim() !== '' && notInterrupted()) {
    log.warn('final round cut by the output budget — closing for the completed answer', {
      name: companionName, chars: latestResponse.length,
    });
    messages.push({ role: 'user', content: budgetCutClose(latestResponse) });
    const { content: rescueResponse } = await streamClose(undefined, { noThink: true });
    recordBenchmarkExtraCall(connection, 'budget-cut', rescueResponse);
    const { blocked: rescueBlocked } = await _handleResponseSafety(ws, rescueResponse, connection);
    if (!rescueBlocked && !interrupt.signal.aborted && rescueResponse.trim() !== '') {
      latestResponse = rescueResponse;
      fullResponse += (fullResponse ? '\n\n' : '') + rescueResponse;
      markTurnText(ws, fullResponse.length);
    }
  }

  // THE CANDIDATE SELECTION GATE (HARNESS-POE phase 2, #533): declared-only
  // (`--candidates K>1`). The final answer is re-asked K times through the
  // scoring pass — non-streaming and tool-free, the only shape under which
  // the substrate serves logprobs — deduped by answer hash, and the
  // argmax-by-likelihood winner (majority when a route cannot score)
  // replaces the streamed draft BEFORE the verify gate re-reads it. A
  // selector failure never fails the turn: the streamed draft stands and
  // the receipt says why. Undeclared runs never enter this branch.
  if ((connection?._candidateCount ?? 1) > 1 && !blockedThisTurn && notInterrupted()
    && latestResponse.trim() !== ''
    && typeof route?.endpoint === 'string' && typeof route?.chatPath === 'string'
    && route.chatPath.includes('/chat/completions')) {
    const sampling = connection._benchmarkControls?.sampling ?? null;
    try {
      const scored = await scoreCandidates({
        url: `${String(route.endpoint).replace(/\/+$/, '')}${route.chatPath}`,
        model: route.model,
        apiKey: route.apiKey || null,
        messages: [...messages, { role: 'user', content: CANDIDATE_ASK }],
        count: Math.min(connection._candidateCount, 8),
        seed: sampling?.seed ?? 0,
        temperature: sampling?.temperature ?? 0.7,
        maxTokens: sampling?.maxTokens,
        signal: interrupt.signal,
      });
      const selection = selectCandidate(scored);
      connection._candidateSelection = {
        count: scored.length,
        selector: selection.selector,
        ranked: selection.ranked,
        usage: {
          inputTokens: scored.reduce((sum, c) => sum + (c.promptTokens ?? 0), 0),
          outputTokens: scored.reduce((sum, c) => sum + (c.completionTokens ?? c.tokens ?? 0), 0),
        },
      };
      if (selection.winner?.text?.trim() !== '') {
        latestResponse = selection.winner.text;
        fullResponse += (fullResponse ? '\n\n' : '') + selection.winner.text;
        markTurnText(ws, fullResponse.length);
        log.info('candidate selection adopted the argmax answer', {
          name: companionName, selector: selection.selector, candidates: scored.length,
        });
      }
    } catch (error) {
      connection._candidateSelection = {
        count: connection._candidateCount, selector: 'none', error: error.message,
      };
      log.warn('candidate selection failed — the streamed draft stands', {
        name: companionName, err: error.message,
      });
    }
  }

  // THE VERIFY GATE (ARC-HARNESS L2): once, at settle, on a turn that
  // demonstrably owes a checkable answer — the drafted answer is re-read
  // against the task's actual ask, and the verified (or corrected) answer is
  // what stands. The draft stays in history as experience either way.
  // Declared-only (`--verify-answer`); the verdict rides the connection for
  // the run receipt and the lane journal, so benchmark attribution is honest.
  const verifyTask = verifyEngaged(connection) && !blockedThisTurn
    ? currentTurnText(messages, wireHead) : null;
  if (verifyTask !== null && turnOwesFinalAnswer(verifyTask)
    && latestResponse.trim() !== '' && notInterrupted()) {
    log.info('verify gate engaged — re-reading the task against the draft', {
      name: companionName, draftChars: latestResponse.length,
    });
    messages.push({ role: 'user', content: verifyBrief(verifyTask, latestResponse) });
    const { content: verifyResponse } = await streamClose(undefined, { noThink: true });
    const { blocked: verifyBlocked } = await _handleResponseSafety(ws, verifyResponse, connection);
    if (!verifyBlocked && !interrupt.signal.aborted && verifyResponse.trim() !== '') {
      const corrected = verifyResponse.trim() !== latestResponse.trim();
      latestResponse = verifyResponse;
      fullResponse += (fullResponse ? '\n\n' : '') + verifyResponse;
      markTurnText(ws, fullResponse.length);
      connection._answerVerifyVerdict = corrected ? 'answerCorrected' : 'answerStood';
    } else {
      connection._answerVerifyVerdict = 'answerUnverified';
    }
    _recordVerifySettle(connection?.companion?.neumaId, connection._answerVerifyVerdict);
  }

  return { latestResponse, fullResponse };
};
