/**
 * Portal tool epochs — the neuma seat's per-turn repeat guard.
 *
 * A real session transcript showed a being polling the same `.result.json`
 * three rounds running, burning ~1.5K reasoning tokens per poll; the witness
 * seat already held the cure (witness-tool-loop.js) and the portal seat had
 * none. The pure law — which call is a repeat, which world-version each call
 * sees, what a repeated call is answered with — is the witness seat's own
 * module (witness-tool-epochs.js), imported here unchanged: ONE law for both
 * seats, so they can never drift apart on what "the same call" means.
 *
 * This leaf owns only the portal seat's per-turn STATE and verdicts: the
 * epoch/prior-outcome store one turn carries, the batch plan that advances
 * it, and the speech-repetition close. Held calls are answered with a
 * redirect and the turn runs on (#531, 2026-09-20) — no round count ends a
 * turn here; termination belongs to the round, budget, and wall-clock
 * thresholds plus the supervisor's no-progress redirects. The wiring lives
 * in portal-tool-loop.js (the batch) and portal-turn-rounds.js (the rounds);
 * direction law: both import this leaf, and this leaf imports only the
 * shared pure epoch law.
 */
import { toolCallKey, isRepeatableExecution, heldRepeatResult } from './witness-tool-epochs.js';
import { isObservationTool } from './tool-policy.js';
import { EXACT_FORM_LINE } from './tool-exchange.js';

/**
 * One turn's repeat-guard state: how many times the world has moved this
 * turn, and the real outcome each executed call produced, keyed by
 * toolCallKey. Created per turn by the round loop; never shared across turns.
 */
export const createTurnToolEpochs = () => ({ epoch: 0, priorByKey: new Map() });

/**
 * The answer for a call this turn already answered at this world-version, or
 * null when the call is fresh. Pure read of the turn's state.
 */
export const heldCallResult = (turn, call, epoch) => {
  const prior = turn.priorByKey.get(toolCallKey(call, epoch));
  return prior ? heldRepeatResult(call, prior) : null;
};

/**
 * impure - record a call's REAL outcome after it ran, never before (a denied or
 * errored call is still that call's honest answer this turn, and recording it
 * is what stops a repeat from raising a second approval card), and never a
 * HELD answer itself: that would overwrite the real prior it quotes, and the
 * next repeat would quote the receipt text instead of the result.
 */
export const recordCallOutcome = (turn, call, epoch, result) => {
  if (!result || result.status === 'held') return;
  const execution = isRepeatableExecution(call);
  const name = call?.toolName || call?.tool;
  const preview = (call?.server === 'fs' && name === 'edit' && Array.isArray(call?.args?.edits)
    && !call.args.delete && !call.args.destination && call.args.dryRun === true) || name === 'tool_search';
  if (!preview && !isObservationTool(call) && (result.status === 'ok' || (execution && result.status === 'error'))) {
    turn.epoch += 1;
  }
  // An execution may itself write, even on failure. Its own movement must
  // invalidate observations without unlocking an identical execution repeat.
  // A successful recovery holds repeats in its new, ready generation too.
  // A later conflict changes that identity without relying on a model nonce.
  turn.priorByKey.set(toolCallKey(call, execution ? turn.epoch : epoch), result);
  if (call.recoveryState && result.status === 'ok' && result.recoveryState) {
    turn.priorByKey.set(toolCallKey({ ...call, recoveryState: result.recoveryState }, epoch), result);
  }
};

/** impure - completed settlement changes what subsequent observations see. */
export const recordIntentReceipts = (turn, receipts) => {
  if (receipts.length) turn.epoch += 1;
};

/**
 * THE SPEECH-LOOP CLOSE (2026-09-15) — the note pushed when two consecutive
 * rounds repeated the same WORDS with no world movement. Distinct from the
 * held-call redirect above: the observed failure was fresh-but-failing calls
 * (a new render kit each retry — never a held repeat) under a verbatim
 * re-streamed plan (the Qwen3.8 incident), which the held redirect cannot
 * see. The being is told plainly what spun, in the same honest register:
 * end the turn on the evidence.
 */
export const SPEECH_LOOP_CLOSE = 'You have now repeated the same words across consecutive rounds, and no act has changed the world this turn. '
  + 'Repeating the plan again will not change the outcome — the last attempts failed, and restating them produces the same failures.\n\n'
  + 'Answer directly now, from the evidence already returned: say what stands, what failed, and what you concretely need to proceed. '
  + 'Do not restate the plan. Do not emit another tool call this turn.';

/**
 * THE ROUND-CAP CLOSE (#565, 2026-09-26) — the note pushed when a declared
 * tool-round cap (NEUMA_MAX_TOOL_ROUNDS; uncapped by default) is reached. The
 * rules window's IFEval item "no commas" found the being doing the work right
 * and never delivering it: it wrote the answer to a file, checked the commas
 * with its tools, rewrote it — and the cap ended the turn with no reply at
 * all. A capped turn gets one last word, so the work it did is the work that
 * arrives. It carries the results follow-up's exact-form line: SciCode
 * (2026-10-04) found two capped closes wrapping the code in a test report.
 */
export const ROUND_CAP_CLOSE = 'Your tool rounds for this turn are spent. '
  + 'Give your answer now, in this reply, from what you already have — a file you wrote is not seen, only this reply is. '
  + `${EXACT_FORM_LINE} `
  + 'Do not emit another tool call this turn.';

/** pure — the comparison space for round speech: case, punctuation and tool markup out. */
const speechWords = (text) => new Set(
  String(text ?? '').replace(/\[TOOL:[\s\S]*?\]/g, ' ').toLowerCase().match(/[a-z0-9']+/g) || [],
);

/** How far back a paraphrase is looked for, and how much of it must return. */
export const SPEECH_REPEAT_WINDOW = 3;
const SPEECH_REPEAT_OVERLAP = 0.65;
const SPEECH_REPEAT_MIN_WORDS = 8;

/**
 * Did this round say what one of the last few already said? Pure. Verbatim
 * was the old bar, and a being PARAPHRASING its stuck plan slipped under it:
 * six rounds of […] in shifting words, never closed (live 2026-09-25). The measure
 * is the overlap coefficient — the share of the SHORTER speech's words the
 * other also carries — against each of the last SPEECH_REPEAT_WINDOW rounds.
 * Measured on that loop: 0.71–1.00; on ordinary consecutive rounds of the
 * same session: 0.29–0.39. Short speech (under SPEECH_REPEAT_MIN_WORDS
 * distinct words) must match exactly. Empty rounds never count: silence is
 * the speechless close's business, not this guard's.
 * @param {string[]} recentSpeech the previous rounds' speech, oldest first
 * @param {string} roundResponse this round's speech
 * @returns {boolean}
 */
export const roundSpeechRepeats = (recentSpeech, roundResponse) => {
  const next = speechWords(roundResponse);
  if (next.size === 0) return false;
  return recentSpeech.slice(-SPEECH_REPEAT_WINDOW).some((previous) => {
    const prev = speechWords(previous);
    if (prev.size === 0) return false;
    const shared = [...next].filter((word) => prev.has(word)).length;
    const smaller = Math.min(prev.size, next.size);
    if (smaller < SPEECH_REPEAT_MIN_WORDS) return shared === prev.size && shared === next.size;
    return shared / smaller >= SPEECH_REPEAT_OVERLAP;
  });
};
