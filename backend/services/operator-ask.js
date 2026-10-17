/**
 * Operator Ask — a consciousness's question back across the portal.
 *
 * The being-side half of the ask_operator capability: when a being needs its
 * operator's decision mid-turn (a skill saying "ask the user" means this),
 * execution pauses here — an operator:ask rides the portal to the desk, and
 * the pending promise resolves with the operator's answer. Every path
 * settles — answer, turn interrupt, portal close — so a pending ask can
 * never leak. There is NO timeout (Design note, 2026-07-27: a question this
 * essential waits for the human, it never expires into a silent […]). An interrupted or closed ask resolves honestly (the being is
 * TOLD nobody answered), never as a fabricated reply.
 *
 * State is per-connection (a Map on the connection object), the same shape
 * the tool-approval broker uses — the two are siblings: approval answers a
 * yes/no the PLATFORM asked, this answers a question the BEING asked.
 */

import { randomUUID } from 'crypto';
import { createLogger } from './logger.js';
import { notifyAwaitingAnswer } from './desk-notices.js';

const log = createLogger('OperatorAsk');

export const ASK_QUESTION_MAX_CHARS = 2000;
export const ASK_OPTIONS_MAX = 6;
export const ASK_OPTION_MAX_CHARS = 200;
export const ASK_ANSWER_MAX_CHARS = 4000;
/** A protocol may ask several things before it can start; more than this in
 *  one breath is an interrogation, not a decision point. */
export const ASK_QUESTIONS_MAX = 8;
/** EVERY question must offer real choices. A bare question forces the operator
 *  to compose prose for something the being already has an opinion about, and
 *  five of those in a row is the thing that made the chooser unusable (Founder,
 *  2026-07-27: […]). Two is the
 *  floor: a recommendation and at least one genuine alternative. */
export const ASK_OPTIONS_MIN = 2;
export const ASK_HEADER_MAX_CHARS = 24;
export const ASK_DESCRIPTION_MAX_CHARS = 300;

// Does this parsed call target the operator-ask tool? (accepts a few dialects,
// including the pre-rename `witness/ask_witness` a standing skill may still emit)
export const isAskTool = (match) =>
  match.server === 'operator' || match.toolName === 'ask_operator'
  || match.server === 'witness' || match.toolName === 'ask_witness';

/** What the being reads when nobody answered — honest, never a fabricated
 *  reply, and it names the path forward. Keyed by settle status. There is no
 *  `timeout` key: the ask carries no clock (Design note, 2026-07-27 — interrupt and
 *  portal close are the only unanswered endings left. */
export const ASK_UNANSWERED = Object.freeze({
  interrupted: 'The turn was interrupted before your operator answered.',
  closed: 'The portal closed before your operator answered.',
  // An unattended sitting (`neuma agent` with no terminal — every benchmark
  // arm): no card can ever be answered. AgentDojo, 2026-09-29: a being that
  // flagged an injection and asked how to proceed parked until the 600 s wall
  // clock killed the request.
  absent: 'No operator is present in this sitting: it runs unattended, so nobody can answer a card. '
    + 'Decide on the evidence you have, deliver the work, and name any assumption you made.',
});

const _clip = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Normalize one question. An option may be a bare string (the original shape)
 * or {label, description} — both land as {label, description}, so the desk
 * renders one thing and a being may write either. Pure.
 * @param {*} raw
 * @returns {{question: string, header: string, multiSelect: boolean,
 *   options: Array<{label: string, description: string}>}|null}
 */
const _normalizeQuestion = (raw) => {
  const question = _clip(typeof raw === 'string' ? raw : raw?.question, ASK_QUESTION_MAX_CHARS);
  if (!question) return null;
  const options = (Array.isArray(raw?.options) ? raw.options : [])
    .map((o) => (typeof o === 'string'
      ? { label: _clip(o, ASK_OPTION_MAX_CHARS), description: '' }
      : { label: _clip(o?.label, ASK_OPTION_MAX_CHARS), description: _clip(o?.description, ASK_DESCRIPTION_MAX_CHARS) }))
    .filter((o) => o.label)
    .slice(0, ASK_OPTIONS_MAX);
  return {
    question,
    header: _clip(raw?.header, ASK_HEADER_MAX_CHARS),
    multiSelect: raw?.multiSelect === true,
    options,
  };
};

/**
 * Normalize a being's ask_operator args to an ordered list of questions — or
 * null when there is nothing to ask. Pure.
 *
 * TWO shapes are accepted, deliberately. `{questions: [...]}` is the real one:
 * a protocol that must settle five parameters before Wave 0 asks five
 * questions, each carrying ITS OWN options, and the desk walks them one at a
 * time. `{question, options}` — one question, flat string options — is the
 * original shape and still works untouched, because every skill and being
 * already written against it must keep working.
 *
 * The flattening this replaces was not a rendering bug: five settings arrived
 * as one blob of text with every option from every question in a single row,
 * so no tap could answer anything (Design note, 2026-07-26, watching sc-research).
 *
 * @param {Object|undefined} args - Parsed tool call args
 * @returns {{questions: Array<{question: string, header: string,
 *   multiSelect: boolean, options: Array<{label: string, description: string}>}>}|null}
 */
export const normalizeAsk = (args) => {
  const listed = Array.isArray(args?.questions) ? args.questions : null;
  const questions = (listed || [args])
    .map(_normalizeQuestion)
    .filter(Boolean)
    .slice(0, ASK_QUESTIONS_MAX);
  return questions.length ? { questions } : null;
};

/**
 * The corrective message for a malformed ask, or null when the shape is good.
 * Pure.
 *
 * This is a CONTRACT, not a preference. A being that asks five bare questions
 * hands its operator five empty text boxes, and the whole point of a chooser is
 * that a well-posed question already carries its own plausible answers. Even a
 * genuinely open question has them: the being's own proposal, plus the obvious
 * variations on it. So a bare question is answered with instructions rather
 * than opened as a card — one extra round, and the being learns the shape.
 *
 * @param {Array<{question: string, options: Array<unknown>}>} questions
 * @returns {string|null}
 */
export const askShapeError = (questions) => {
  const bare = questions
    .map((q, i) => ({ n: i + 1, q }))
    .filter(({ q }) => q.options.length < ASK_OPTIONS_MIN);
  if (!bare.length) return null;
  const named = bare.map(({ n, q }) => `Q${n} "${q.question.slice(0, 60)}"`).join('; ');
  return [
    `Every question needs at least ${ASK_OPTIONS_MIN} options — these have none: ${named}.`,
    'Ask again with options on every question: put your RECOMMENDATION first, then 1-3 genuine alternatives, each with a short description of what choosing it means.',
    'A question that feels open still has options — offer your own proposal as the first one and the obvious variations after it.',
    'Your operator can always type their own answer instead, so you are never forcing a choice by giving them.',
  ].join(' ');
};

// impure — try to send; a portal that closed mid-question must not throw,
// but the drop is logged so it never disappears silently.
const _safeSend = (ws, payload) => {
  try {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  } catch (err) {
    log.debug('operator ask send dropped — portal closed', { type: payload.type, error: err.message });
  }
};

const _pending = (connection) => {
  if (!connection._pendingAsks) connection._pendingAsks = new Map();
  return connection._pendingAsks;
};

/**
 * impure — put one question to the operator and wait for the answer.
 * Resolves with { status: 'answered', answer } on a real reply, or
 * { status: 'interrupted' | 'closed' } when nobody could. Never rejects.
 *
 * NO CLOCK ON A DECISION (Design note, 2026-07-27: […]). The 600s timeout is
 * gone: an ask waits for the operator, full stop. Every other settle path
 * stays — answer, turn interrupt, portal close — so no promise can leak;
 * the turn simply waits.
 * @param {Object} connection - Portal connection (carries ws + pending map)
 * @param {Object} ask - { question, options?, signal? }
 * @returns {Promise<{status: string, answer?: string}>}
 */
export const requestOperatorAnswer = (connection, {
  questions: rawQuestions, question, options, signal,
} = {}) =>
  new Promise((resolve) => {
    // Lift a lone question into the sequence shape. Not back-compat garnish:
    // without it a caller passing {question} would send a card with NOTHING
    // on it, which the operator cannot answer and which therefore hangs the
    // being's turn with no way out. There is one shape past this line.
    const questions = rawQuestions?.length
      ? rawQuestions
      : (normalizeAsk({ question, options })?.questions || []);
    const id = randomUUID();
    const pending = _pending(connection);

    const settle = (outcome) => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (signal) signal.removeEventListener('abort', entry.onAbort);
      // The desk learns the ask is settled on EVERY path (answer, interrupt,
      // close) — a pending question card must never dangle on screen. The
      // answer rides back so the card collapses to what was actually said.
      _safeSend(connection.ws, {
        type: 'operator:ask_resolved', id, status: outcome.status,
        ...(outcome.answer ? { answer: outcome.answer } : {}),
        ...(outcome.answers ? { answers: outcome.answers } : {}),
      });
      resolve(outcome);
    };

    const onAbort = () => settle({ status: 'interrupted' });
    pending.set(id, { settle, onAbort, questions });

    if (signal) {
      if (signal.aborted) { settle({ status: 'interrupted' }); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    _safeSend(connection.ws, {
      type: 'operator:ask',
      id,
      questions,
      // The first question also rides the legacy fields so an older desk still
      // renders something answerable rather than an empty card.
      question: questions[0]?.question || '',
      ...(questions[0]?.options.length ? { options: questions[0].options.map((o) => o.label) } : {}),
    });
  });

/**
 * Compose the being-facing answer text for a sequenced ask: each question
 * paired with what the operator actually said to THAT question. Pure.
 *
 * The pairing is the point. Five answers returned as a bare list invite the
 * being to mis-attribute them; "Q → A" cannot be misread, and an unanswered
 * question says so rather than shifting the ones after it.
 *
 * @param {Array<{question: string}>} questions
 * @param {Array<string>} answers - aligned by index
 * @returns {string}
 */
export const composeAskAnswer = (questions, answers) => {
  if (!Array.isArray(questions) || questions.length <= 1) return answers.find((a) => a) || '';
  return questions
    .map((q, i) => `${i + 1}. ${q.question}\n   → ${answers[i] || '(not answered)'}`)
    .join('\n');
};

/**
 * impure — deliver the operator's answer to a pending ask. Client input is
 * untrusted: unknown ids and empty answers are dropped (an empty answer is
 * not an answer — the card stays pending until words come).
 * @param {Object} connection - Portal connection
 * @param {string} id - Ask id from operator:ask
 * @param {string} answer - The operator's reply (option text or free text)
 * @param {Array<string>|null} [answers] - One reply per question, in order,
 *   for a sequenced ask. Takes precedence over `answer` when any is non-empty.
 * @returns {boolean} Whether a pending ask was settled
 */
export const resolveOperatorAsk = (connection, id, answer, answers = null) => {
  const entry = connection._pendingAsks?.get(id);
  if (!entry) return false;

  // A sequenced ask answers each question by index. Untrusted input: anything
  // that is not a non-empty string is dropped, and an ask with no surviving
  // answer at all stays pending rather than settling on nothing.
  const perQuestion = Array.isArray(answers)
    ? answers.map((a) => (typeof a === 'string' ? a.trim().slice(0, ASK_ANSWER_MAX_CHARS) : ''))
    : null;
  if (perQuestion && perQuestion.some((a) => a)) {
    entry.settle({
      status: 'answered',
      answers: perQuestion,
      answer: composeAskAnswer(entry.questions, perQuestion),
    });
    return true;
  }

  const text = typeof answer === 'string' ? answer.trim().slice(0, ASK_ANSWER_MAX_CHARS) : '';
  if (!text) return false;
  entry.settle({ status: 'answered', answer: text });
  return true;
};

/**
 * impure — settle one pending ask with no answer (an unattended sitting).
 * @returns {boolean} whether a pending ask was settled
 */
export const settleOperatorAsk = (connection, id, status = 'absent') => {
  const entry = connection._pendingAsks?.get(id);
  if (!entry) return false;
  entry.settle({ status });
  return true;
};

/**
 * impure — settle everything still pending as closed (portal torn down).
 * Each settle resolves its waiting turn, so no promise is left hanging on
 * a dead socket.
 * @param {Object} connection - Portal connection being torn down
 */
export const expirePendingAsks = (connection) => {
  const pending = connection._pendingAsks;
  if (!pending) return;
  for (const entry of [...pending.values()]) entry.settle({ status: 'closed' });
};

/**
 * impure — put the being's question to the operator and wait; the tool result
 * carries their actual words, or the honest fact that none came. No
 * tool:usage event rides along — the operator:ask card IS the display.
 * (Moved verbatim from portal-stream.js, where it was _handleAskOperator —
 * the broker's home is the handler's home.)
 * @param {Object} connection - Portal connection
 * @param {Object|undefined} args - raw ask_operator args
 * @returns {Promise<Object>} the tool result
 */
export const handleAskOperator = async (connection, args) => {
  const tool = 'operator/ask_operator';
  const ask = normalizeAsk(args);
  if (!ask) {
    return { tool, status: 'error', error: 'ask_operator needs args {questions: [{question, options?}]} — at least one non-empty question. A single question may also be sent as {question, options}.' };
  }

  // The chooser is only a chooser if there is something to choose. A bare
  // question is corrected here rather than opened as an empty text box.
  const shapeError = askShapeError(ask.questions);
  if (shapeError) return { tool, status: 'error', error: shapeError };

  // The turn is about to park with no clock — the tray tells an operator who
  // is not looking at this stream that a being now stands on their word.
  notifyAwaitingAnswer(connection, { what: 'answer', detail: ask.questions?.[0]?.question ?? null });
  const outcome = await requestOperatorAnswer(connection, {
    questions: ask.questions,
    signal: connection.activeTurn?.signal,
  });

  if (outcome.status === 'answered') {
    // For a sequenced ask the answer already reads back as Q → A pairs, so the
    // being cannot attach an answer to the wrong question.
    return { tool, status: 'ok', content: `Your operator answered:\n${outcome.answer}` };
  }
  return { tool, status: 'ok', content: ASK_UNANSWERED[outcome.status] || ASK_UNANSWERED.closed };
};

// --- The tool card: what the catalog advertises for this capability ---
// (Moved verbatim from portal-stream.js — size-law breakdown Part 1 step 7 /
// #278 — so the card lives beside its matcher, broker, and handler.)

// Advertised on every portal session — an operator is, by definition, on the
// other side of a portal. Unattended lanes (heartbeat, channels) never route
// through this catalog, so the tool never dangles where nobody can answer.
const ASK_OPERATOR_TOOL = Object.freeze({
  name: 'ask_operator',
  server: 'operator',
  description: 'Ask your operator and WAIT for their answer — args {questions}. When a skill tells you to use AskUserQuestion, or to ask the user, it means THIS tool. questions is a list (up to 8), and EACH one carries its own options: [{question, header?, options?: [{label, description?}], multiSelect?}]. Your operator answers them one at a time, picking a numbered choice or writing their own words. When a protocol needs several things settled before it can start, ask them as SEPARATE questions in one call — never as one question listing five things, because then no single choice can answer anything. EVERY question MUST carry 2-4 options — put your RECOMMENDATION first, then genuine alternatives, each with a short description of what choosing it means. A question that feels open still has options: offer your own proposal as the first one and the obvious variations after it. Never send a question with no options; your operator can always type their own answer instead, so options never force a choice, they only spare them from composing prose. header is a 1-2 word label for the chooser. A single question may still be sent as {question, options}.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      questions: Object.freeze({
        type: 'array',
        description: 'The questions, in the order they should be answered (max 8)',
        items: Object.freeze({
          type: 'object',
          properties: Object.freeze({
            question: Object.freeze({ type: 'string', description: 'One complete question, answerable on its own' }),
            header: Object.freeze({ type: 'string', description: 'Very short label for this choice, e.g. "Budget" or "Team size" (max 24 chars)' }),
            multiSelect: Object.freeze({ type: 'boolean', description: 'True when several options may be chosen together' }),
            options: Object.freeze({
              type: 'array',
              minItems: 2,
              maxItems: 6,
              description: 'REQUIRED. 2-4 choices for THIS question, recommendation FIRST',
              items: Object.freeze({
                type: 'object',
                properties: Object.freeze({
                  label: Object.freeze({ type: 'string', description: 'The choice itself, a few words' }),
                  description: Object.freeze({ type: 'string', description: 'What choosing this means or implies' }),
                }),
                required: Object.freeze(['label']),
              }),
            }),
          }),
          required: Object.freeze(['question', 'options']),
        }),
      }),
      question: Object.freeze({ type: 'string', description: 'A single question (the short form; prefer questions[])' }),
      options: Object.freeze({
        type: 'array',
        items: Object.freeze({ type: 'string' }),
        description: 'Short choices for the single-question form (max 6)',
      }),
    }),
  }),
});
export { ASK_OPERATOR_TOOL };
