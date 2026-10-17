/**
 * ANSWER VERIFY-BEFORE-COMMIT (ARC-HARNESS L2, neuma#531 / #506 N6) — the
 * answer-level correctness gate. Before a turn's final answer stands on a
 * turn that demonstrably owes one, the being re-reads the task's actual ask
 * against its drafted answer once, and the verified (or corrected) answer is
 * what stands. The draft stays in history as experience either way — a failed
 * attempt is retained, never committed.
 *
 * Evidence base: AVO's correctness gate + commit policy (arXiv:2603.24517)
 * and the ARC Prize 2025 verifier-gated refinement loop (arXiv:2601.10904).
 * Our own flaw ledger names the shapes it counters: doc 41 (a deterministic
 * misread committed three runs running) and doc 12 (an answer one step short
 * of the task's actual ask).
 *
 * THE TRIGGER IS THE N2 TRIGGER: this layer engages only where the task
 * itself demonstrates a required answer format (`taskDemonstratesAnswerFormat`,
 * answer-covenant.js) — the same general-by-construction predicate turn
 * assembly already uses. Conversational turns never pay the verify round.
 *
 * ENGAGEMENT IS DECLARED, NEVER ASSUMED: `verifyEngaged` reads
 * `connection._answerVerify`, set by the operator's `--verify-answer` on a
 * seated run. Production turns are byte-identical until promotion is an
 * operator decision (the N2 covenant's path).
 */
import { taskDemonstratesAnswerFormat } from './answer-covenant.js';

/** Cap on the task text quoted into the verify brief — a bounded re-read. */
export const VERIFY_TASK_CHARS = 4000;

/** Cap on the drafted answer quoted into the verify brief. */
export const VERIFY_DRAFT_CHARS = 2000;

/**
 * The declared engagement gate. Pure.
 * @param {Object|null} connection
 * @returns {boolean}
 */
export const verifyEngaged = (connection) => connection?._answerVerify === true;

/**
 * The current turn's task text out of the live request, or null. The wire
 * head is everything before round one (system + transcript + current turn),
 * so the CURRENT TURN is the message just before it; the fold never touches
 * it. A vision turn (content parts) owes no text verify. Pure.
 * @param {ReadonlyArray<{role: string, content: string|Array}>} messages
 * @param {number} wireHead
 * @returns {string|null}
 */
export const currentTurnText = (messages, wireHead) => {
  if (!Array.isArray(messages) || !Number.isInteger(wireHead) || wireHead < 1) return null;
  const turn = messages[wireHead - 1];
  if (!turn || turn.role !== 'user') return null;
  return typeof turn.content === 'string' ? turn.content : null;
};

/**
 * Does this turn demonstrably owe a short checkable final answer? Pure —
 * the N2 demonstrated-format trigger, named for the verify's use of it.
 * Widening this predicate later is the layer's tuning knob, deliberately in
 * exactly one place.
 */
export const turnOwesFinalAnswer = (taskText) => taskDemonstratesAnswerFormat(taskText);

/**
 * The verify brief — one re-read of the task against the draft, demanding the
 * answer alone back. The bounded quotes keep the re-read cheap whatever the
 * task's size. Pure.
 * @param {string} taskText
 * @param {string} draftAnswer
 * @returns {string}
 */
export const verifyBrief = (taskText, draftAnswer) => {
  const task = String(taskText ?? '').trim();
  const draft = String(draftAnswer ?? '').trim();
  const quoteTask = task.length > VERIFY_TASK_CHARS ? `${task.slice(0, VERIFY_TASK_CHARS)}…` : task;
  const quoteDraft = draft.length > VERIFY_DRAFT_CHARS ? `${draft.slice(0, VERIFY_DRAFT_CHARS)}…` : draft;
  return [
    'Before this answer stands, verify it once against the task.',
    '',
    'THE TASK ASKED:',
    '"""',
    quoteTask,
    '"""',
    '',
    'YOUR ANSWER AS IT STANDS:',
    '"""',
    quoteDraft,
    '"""',
    '',
    'Does your answer state exactly what the task asked for, in exactly the form the task requires?',
    'Reply with the final answer ONLY — unchanged if it already stands correct, corrected if it does not.',
    'No commentary, no process notes: the answer alone.',
  ].join('\n');
};
