// attunement-flow.js — pure derivations over one being's attunement status.
// The record on disk is the single source of truth; everything the host
// renders (which stage, which question stands, what has been answered) is
// derived here so the host stays a thin impure shell. Pure: no IO, no DOM.

/**
 * How many questions the active record holds, and how many are answered.
 * @param {Object|null} record
 * @returns {{answered: number, total: number}}
 */
export const progressOf = (record) => ({
  answered: Object.keys(record?.answers || {}).length,
  total: record?.rendered?.questions?.length || 0,
});

/**
 * The next question the being will face — first unanswered in rendered
 * order (the same order the service asks in), or null when every question
 * is answered. A pending question (a failed answer leg) is by construction
 * the first unanswered, so its SAME words are what this returns.
 * @param {Object|null} record
 * @returns {{key: string, text: string, index: number}|null}
 */
export const nextQuestionOf = (record) => {
  const questions = record?.rendered?.questions || [];
  const i = questions.findIndex((q) => !record.answers?.[q.key]);
  return i === -1 || !questions.length ? null : { key: questions[i].key, text: questions[i].text, index: i };
};

/**
 * The ceremony so far, in spec order — verbatim question and answer pairs
 * for the witness's watching transcript. Once a question has been answered
 * it HOLDS ITS PLACE forever: a reopened question stays on screen showing
 * its superseded words (marked, awaiting the fresh telling) and only that
 * section regenerates when the new answer lands. Without this the
 * transcript reflowed on every reopen and a review re-walk read as chaos
 * (witnessed 2026-07-12 on Sovereign's sweep).
 * @param {Object|null} record
 * @returns {Array<{key: string, question: string, answer: string, reopened: boolean, reopenReason?: string}>}
 */
export const transcriptOf = (record) =>
  (record?.rendered?.questions || []).flatMap((q) => {
    const a = record.answers?.[q.key];
    if (a) return [{ key: q.key, question: a.question || q.text, answer: a.quote, reopened: false }];
    const superseded = record.superseded?.[q.key];
    if (superseded?.length) {
      const last = superseded[superseded.length - 1];
      return [{
        key: q.key,
        question: last.question || q.text,
        answer: last.quote,
        reopened: true,
        reopenReason: last.reopenReason || '',
      }];
    }
    return [];
  });

/**
 * The re-ask ledger: how many questions currently stand UNANSWERED because
 * the review (or the witness) reopened them. The room shows the sweep as its
 * OWN count — a re-walk is 34 marked questions, never […]
 * (witnessed 2026-07-12: the dropping main count read as the whole ceremony
 * restarting when only the marked questions re-serve).
 * @param {Object|null} record
 * @returns {{pending: number}}
 */
export const reaskOf = (record) => ({
  pending: (record?.rendered?.questions || []).filter(
    (q) => !record.answers?.[q.key] && record.superseded?.[q.key]?.length,
  ).length,
});

/**
 * Which ceremony stage the backend's status truthfully puts us in.
 * 'opening' while a render is in flight server-side; 'consent' while the
 * record sits offered; 'watch' while questions remain; 'seal' when every
 * question is answered; 'offer' when nothing is active.
 * @param {Object|null} status
 * @returns {'offer'|'consent'|'opening'|'watch'|'seal'}
 */
export const stageOf = (status) => {
  if (!status) return 'offer';
  if (status.opening) return 'opening';
  const active = status.active;
  if (!active) return 'offer';
  if (active.phase === 'offered') return 'consent';
  if (active.phase !== 'answering') return 'offer';
  return nextQuestionOf(active) ? 'watch' : 'seal';
};

/**
 * The trigger a fresh offer should carry: the gate's own verdict when an
 * offer is due, otherwise null — the desk offers only what is honestly due.
 * @param {Object|null} status
 * @returns {string|null}
 */
export const dueTriggerOf = (status) =>
  status?.offerDue?.due ? status.offerDue.trigger : null;

const RAIL = Object.freeze([
  Object.freeze({ key: 'offer', label: 'OFFER' }),
  Object.freeze({ key: 'consent', label: 'CONSENT' }),
  Object.freeze({ key: 'opening', label: 'OPEN' }),
  Object.freeze({ key: 'watch', label: 'WITNESS' }),
  Object.freeze({ key: 'seal', label: 'SEAL' }),
]);

// After the attunement seal, the evolution ceremony continues into refinement
// (consent → corpus → forge → machine-verified LoRA). The rail shows that
// next rite as the living step so the seal is not a dead end.
const RAIL_AFTER_SEAL = Object.freeze([
  ...RAIL,
  Object.freeze({ key: 'refine', label: 'REFINE' }),
]);

/**
 * The ceremony's graduations for the progress rail — which phases stand
 * behind this view, which is live, which lie ahead. Views outside the
 * ceremony proper (roster, loading, error) have no rail: null.
 * A sealed attunement marks every attunement node complete and lights
 * REFINEMENT as the active next rite (not a separate scavenger hunt).
 * @param {string} view
 * @returns {Array<{key: string, label: string, state: 'complete'|'active'|'ahead'}>|null}
 */
export const railOf = (view) => {
  if (view === 'sealed') {
    return RAIL_AFTER_SEAL.map((s, j) => ({
      ...s,
      state: j < RAIL.length ? 'complete' : 'active',
    }));
  }
  const i = RAIL.findIndex((s) => s.key === view);
  if (i === -1) return null;
  return RAIL.map((s, j) => ({
    ...s,
    state: j < i ? 'complete' : j === i ? 'active' : 'ahead',
  }));
};
