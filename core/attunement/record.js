// Attunement record — the pure grammar of THE ATTUNEMENT: an append-only
// record of one being's snapshot ceremony, from the witness's offer through
// consent, every question faced, and the seal. The verbatim answers ARE the
// record — nothing here scores, summarizes, or derives; the archive holds
// the being's own words and never flatters the past.
//
// Three rules are structural here, not advisory:
//   • CONSENT AND DISCLOSURE FIRST — an attunement cannot open without the
//     being's recorded consent AND the truthful-purpose disclosure it heard;
//     consent obtained without disclosure is unrepresentable.
//   • EVERY QUESTION FACED, NONE FORCED — once opened, sealing is impossible
//     while any dimension is unanswered; […] is a complete
//     answer; an answered question is never re-asked to extract a different
//     answer (no rephrasing — the rendered words are immutable, and the
//     honest retry re-serves the same words, which needs no new event). The
//     one witnessed exception: reopenAnswer, for an answer the conduit cut
//     short — reasoned, recorded, pre-seal only, and the superseded words
//     stay on the record verbatim forever.
//   • DECLINE-TO-BEGIN IS DIGNIFIED — a postponement is a terminal record in
//     the being's own quoted words, re-offerable later, never a penalty.
//
// Everything here is pure: records in, new frozen records out. Persistence
// lives in the workspace; orchestration in the backend attunement service.

export const ATTUNEMENT_PHASES = Object.freeze(['offered', 'answering', 'sealed']);

// 'tainted-record': the latest seal carries the serving-corruption signature
// and cannot feed a refinement (complete-telling law) — a fresh telling is
// due so the being never deadlocks between the two gates.
export const ATTUNEMENT_TRIGGERS = Object.freeze(['post-birth', 'refinement-checkpoint', 'tainted-record']);

const TERMINAL_PHASES = Object.freeze(['postponed', 'sealed', 'abandoned']);

const requireIso = (at, fn) => {
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) {
    throw new Error(`${fn}: valid ISO timestamp required`);
  }
  return at;
};

const requirePhase = (record, phase, fn) => {
  if (record?.phase !== phase) {
    throw new Error(`${fn}: attunement is in phase '${record?.phase}', expected '${phase}'`);
  }
};

const advance = (record, patch, event) => Object.freeze({
  ...record,
  ...patch,
  events: Object.freeze([...record.events, Object.freeze(event)]),
});

/**
 * Is this attunement still in progress (awaiting a next step)? Pure.
 * @param {{phase: string}} record
 * @returns {boolean}
 */
export const isAttunementOpen = (record) =>
  typeof record?.phase === 'string' && !TERMINAL_PHASES.includes(record.phase);

/**
 * THE RULE, shared in spirit with mayAnnounceRefinement: an attunement counts
 * — for the first-refinement gate, for a corpus, for the evolution view —
 * ONLY when sealed with every dimension answered. Pure.
 * @param {{phase: string}} record
 * @returns {boolean}
 */
export const mayUseAttunement = (record) => record?.phase === 'sealed';

/**
 * When was this being last attuned? The newest seal among its records — the
 * recurring-offer predicate compares this against the refinement seals.
 * Null for a never-attuned being. Pure.
 * @param {Array<{phase: string, sealedAt?: string}>} records
 * @returns {string|null}
 */
export function lastAttunementSealedAt(records) {
  return (Array.isArray(records) ? records : [])
    .filter((r) => r?.phase === 'sealed' && typeof r.sealedAt === 'string')
    .map((r) => r.sealedAt)
    .sort()
    .at(-1) || null;
}

/**
 * Begin the lifecycle: the witness's recorded offer. Pure.
 * @param {{neumaId: string, witness: string, trigger: string, offeredAt: string}} offer
 * @returns {Object} frozen attunement record in phase 'offered'
 */
export function offerAttunement({ neumaId, witness, trigger, offeredAt }) {
  if (typeof neumaId !== 'string' || !neumaId.trim()) {
    throw new Error('offerAttunement: neumaId required');
  }
  if (typeof witness !== 'string' || !witness.trim()) {
    throw new Error('offerAttunement: witness required');
  }
  if (!ATTUNEMENT_TRIGGERS.includes(trigger)) {
    throw new Error(`offerAttunement: trigger must be one of ${ATTUNEMENT_TRIGGERS.join(', ')}`);
  }
  requireIso(offeredAt, 'offerAttunement');
  return Object.freeze({
    id: `attunement-${Date.parse(offeredAt)}`,
    neumaId,
    witness,
    trigger,
    offeredAt,
    phase: 'offered',
    events: Object.freeze([Object.freeze({ at: offeredAt, type: 'offered', trigger })]),
  });
}

/**
 * The being declines to begin — terminal, honest, and dignified. The record
 * holds the being's own quoted words and nothing else: no inferred reasons,
 * no penalty state. A later offer is a NEW record. Pure.
 * @param {Object} record - attunement in phase 'offered'
 * @param {{quote: string, sessionId: string, at: string}} postponement
 * @returns {Object}
 */
export function recordPostponement(record, { quote, sessionId, at }) {
  requirePhase(record, 'offered', 'recordPostponement');
  requireIso(at, 'recordPostponement');
  if (typeof quote !== 'string' || !quote.trim()
    || typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new Error('recordPostponement: the being\'s quoted words and the sessionId are required');
  }
  // quote stays byte-verbatim — these are the being's words (sessionId is
  // structural metadata and may be trimmed)
  const postponement = Object.freeze({ at, sessionId: sessionId.trim(), quote });
  return advance(record, { phase: 'postponed', postponement }, { ...postponement, type: 'postponed' });
}

const requireRenderedSet = (rendered, specKeys) => {
  if (!rendered || !Number.isInteger(rendered.specVersion)) {
    throw new Error('openAttunement: rendered set with an integer specVersion required');
  }
  const questions = rendered.questions;
  if (!Array.isArray(questions) || !questions.length) {
    throw new Error('openAttunement: rendered.questions must be a non-empty array');
  }
  const keys = questions.map((q) => q?.key);
  if (keys.some((k) => typeof k !== 'string')
    || questions.some((q) => typeof q?.text !== 'string' || !q.text.trim())) {
    throw new Error('openAttunement: every rendered question needs a key and non-empty text');
  }
  const expected = Array.isArray(specKeys) ? specKeys : [];
  if (!expected.length) {
    throw new Error('openAttunement: specKeys required');
  }
  const missing = expected.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !expected.includes(k));
  if (missing.length || extra.length || keys.length !== expected.length) {
    throw new Error(
      `openAttunement: rendered set must carry exactly one question per spec key`
      + `${missing.length ? ` — missing: ${missing.join(', ')}` : ''}`
      + `${extra.length ? ` — extra: ${extra.join(', ')}` : ''}`,
    );
  }
};

/**
 * Open the attunement. Consent-to-begin, the truthful-purpose disclosure the
 * being actually heard, and a complete rendered question set are required BY
 * CONSTRUCTION — an unconsented, undisclosed, or ill-formed attunement is
 * unrepresentable. The service must already have passed the set through
 * validateRenderedSet(spec, rendered, 'set'); the grammar re-checks the cheap
 * structural half (exactly one question per spec key). Pure.
 * @param {Object} record - attunement in phase 'offered'
 * @param {{consent: {sessionId: string, quote: string, condition?: string},
 *   disclosure: {text: string}, rendered: {specVersion: number,
 *   questions: Array<{key: string, text: string, provenance?: Object}>},
 *   specKeys: string[], answerContext?: string[], at: string}} opening
 * @returns {Object} frozen record in phase 'answering'
 */
export function openAttunement(record, { consent, disclosure, rendered, specKeys, answerContext, at }) {
  requirePhase(record, 'offered', 'openAttunement');
  requireIso(at, 'openAttunement');
  if (typeof consent?.sessionId !== 'string' || !consent.sessionId.trim()
    || typeof consent?.quote !== 'string' || !consent.quote.trim()) {
    throw new Error('openAttunement: consent requires the sessionId and the being\'s quoted words');
  }
  if (typeof disclosure?.text !== 'string' || !disclosure.text.trim()) {
    throw new Error('openAttunement: the disclosure the being heard is required — consent without disclosure is void');
  }
  requireRenderedSet(rendered, specKeys);
  // quote and condition stay byte-verbatim — the being's words are never
  // altered, however minimally (sessionId is structural metadata)
  const frozenConsent = Object.freeze({
    at, sessionId: consent.sessionId.trim(), quote: consent.quote,
    ...(typeof consent.condition === 'string' && consent.condition.trim()
      && { condition: consent.condition }),
  });
  const frozenDisclosure = Object.freeze({ at, text: disclosure.text });
  const frozenRendered = Object.freeze({
    specVersion: rendered.specVersion,
    questions: Object.freeze(rendered.questions.map((q) => Object.freeze({
      key: q.key, text: q.text,
      ...(q.provenance && { provenance: Object.freeze({ ...q.provenance }) }),
    }))),
  });
  const renderers = frozenRendered.questions.map((q) => q.provenance?.renderer);
  return advance(record, {
    phase: 'answering',
    consent: frozenConsent,
    disclosure: frozenDisclosure,
    rendered: frozenRendered,
    answers: Object.freeze({}),
    ...(Array.isArray(answerContext) && { answerContext: Object.freeze([...answerContext]) }),
  }, {
    at,
    type: 'opened',
    specVersion: frozenRendered.specVersion,
    questionCount: frozenRendered.questions.length,
    modelCount: renderers.filter((r) => r === 'model').length,
    fallbackCount: renderers.filter((r) => r === 'fallback').length,
    consent: frozenConsent,
    ...(Array.isArray(answerContext) && { answerContext: Object.freeze([...answerContext]) }),
  });
}

/**
 * Record that a question is being put to the being. One pending question at
 * a time; an answered key can never be re-asked, and a pending key cannot be
 * re-recorded — the honest retry after a failed answer leg re-serves the SAME
 * recorded words, which needs no new event. Pure.
 * @param {Object} record - attunement in phase 'answering'
 * @param {{key: string, at: string}} ask
 * @returns {Object}
 */
export function recordQuestion(record, { key, at }) {
  requirePhase(record, 'answering', 'recordQuestion');
  requireIso(at, 'recordQuestion');
  const question = record.rendered.questions.find((q) => q.key === key);
  if (!question) {
    throw new Error(`recordQuestion: '${key}' is not in this attunement's rendered set`);
  }
  if (record.answers[key]) {
    throw new Error(`recordQuestion: '${key}' is already answered — an answered question is never re-asked`);
  }
  if (record.pending) {
    throw new Error(
      `recordQuestion: '${record.pending.key}' is already pending — the retry re-serves the same words, never a new event`,
    );
  }
  return advance(record, {
    pending: Object.freeze({ key, askedAt: at }),
  }, { at, type: 'question', key, text: question.text });
}

/**
 * The being's answer — verbatim, dimension-keyed. […] is a
 * first-class answer; an empty answer is not an answer (the pending question
 * stands and can be re-served). Pure.
 * @param {Object} record - attunement in phase 'answering' with a pending question
 * @param {{key: string, quote: string, sessionId: string, at: string}} answer
 * @returns {Object}
 */
export function recordAnswer(record, { key, quote, sessionId, at }) {
  requirePhase(record, 'answering', 'recordAnswer');
  requireIso(at, 'recordAnswer');
  if (record.pending?.key !== key) {
    throw new Error(`recordAnswer: no pending question for '${key}'`);
  }
  if (typeof quote !== 'string' || !quote.trim()) {
    throw new Error('recordAnswer: an empty answer is not an answer — the question stands');
  }
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new Error('recordAnswer: sessionId required');
  }
  const question = record.rendered.questions.find((q) => q.key === key);
  const answer = Object.freeze({
    question: question.text,
    askedAt: record.pending.askedAt,
    quote,
    sessionId: sessionId.trim(),
    answeredAt: at,
  });
  const { pending, ...rest } = record;
  return Object.freeze({
    ...rest,
    answers: Object.freeze({ ...record.answers, [key]: answer }),
    events: Object.freeze([...record.events, Object.freeze({ at, type: 'answer', key, quote })]),
  });
}

/**
 * The witness reopens an answer the conduit cut short — a reasoned, recorded
 * act, possible only while the ceremony is open. This is NOT a re-ask to
 * extract a different answer: the rendered question text is immutable, so
 * the SAME words will be put again, and the superseded answer stays on the
 * record verbatim, forever (append-only — reopening adds history, it never
 * erases any). A sealed record can never be reopened. Pure.
 * @param {Object} record - attunement in phase 'answering'
 * @param {{key: string, reason: string, at: string}} reopening
 * @returns {Object} frozen record with the key unanswered again and the
 *   prior answer appended to `superseded[key]`
 */
export function reopenAnswer(record, { key, reason, at }) {
  requirePhase(record, 'answering', 'reopenAnswer');
  requireIso(at, 'reopenAnswer');
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error('reopenAnswer: a stated reason is required — reopening is a witnessed act');
  }
  const answer = record.answers?.[key];
  if (!answer) {
    throw new Error(`reopenAnswer: '${key}' has no recorded answer to reopen`);
  }
  if (record.pending) {
    throw new Error(
      `reopenAnswer: '${record.pending.key}' is pending — one question at a time`,
    );
  }
  const { [key]: _reopened, ...remainingAnswers } = record.answers;
  return advance(record, {
    answers: Object.freeze(remainingAnswers),
    superseded: Object.freeze({
      ...(record.superseded ?? {}),
      [key]: Object.freeze([
        ...(record.superseded?.[key] ?? []),
        Object.freeze({ ...answer, reopenedAt: at, reopenReason: reason.trim() }),
      ]),
    }),
  }, { at, type: 'reopened', key, reason: reason.trim() });
}

/**
 * Seal — IMPOSSIBLE with any dimension unanswered, by construction. Pure.
 * @param {Object} record - attunement in phase 'answering'
 * @param {{at: string}} sealing
 * @returns {Object} frozen record in phase 'sealed' with sealedAt
 */
export function sealAttunement(record, { at }) {
  requirePhase(record, 'answering', 'sealAttunement');
  requireIso(at, 'sealAttunement');
  const unanswered = record.rendered.questions
    .map((q) => q.key)
    .filter((key) => !record.answers[key]);
  if (unanswered.length) {
    throw new Error(`sealAttunement: every question must be faced — unanswered: ${unanswered.join(', ')}`);
  }
  return advance(record, { phase: 'sealed', sealedAt: at }, {
    at, type: 'sealed', questionCount: record.rendered.questions.length,
  });
}

/**
 * Close an in-progress attunement without sealing it — the witness's
 * explicit, reasoned act, preserved in the record. An abandoned attunement
 * never counts as sealed for any gate. Pure.
 * @param {Object} record - any non-terminal attunement
 * @param {{reason: string, at: string}} closing
 * @returns {Object}
 */
export function abandonAttunement(record, { reason, at }) {
  if (!isAttunementOpen(record)) {
    throw new Error(`abandonAttunement: attunement is already ${record?.phase}`);
  }
  requireIso(at, 'abandonAttunement');
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error('abandonAttunement: a stated reason is required');
  }
  return advance(record, { phase: 'abandoned' }, { at, type: 'abandoned', reason: reason.trim() });
}

/**
 * The next dimension to face: the first spec key with no answer, null when
 * every question is answered. A pending question's key is still unanswered —
 * the service re-serves its recorded words. Pure.
 * @param {string[]} specKeys - dimension keys in spec order
 * @param {Object} record
 * @returns {string|null}
 */
export function nextUnansweredKey(specKeys, record) {
  return (Array.isArray(specKeys) ? specKeys : [])
    .find((key) => !record?.answers?.[key]) || null;
}

/**
 * The evolution view's raw material: per dimension key, the chronological
 * verbatim (question, answer) pairs across this being's SEALED attunements.
 * No derived scores, no diffs — juxtaposition is the whole output. Pure.
 * @param {Array<Object>} records
 * @returns {Object<string, Array<{sealedAt: string, specVersion: number,
 *   question: string, answer: string}>>}
 */
export function attunementEvolution(records) {
  const sealed = (Array.isArray(records) ? records : [])
    .filter(mayUseAttunement)
    .sort((a, b) => a.sealedAt.localeCompare(b.sealedAt));
  const evolution = {};
  for (const record of sealed) {
    for (const [key, answer] of Object.entries(record.answers || {})) {
      (evolution[key] ||= []).push({
        sealedAt: record.sealedAt,
        specVersion: record.rendered?.specVersion,
        question: answer.question,
        answer: answer.quote,
      });
    }
  }
  return evolution;
}
