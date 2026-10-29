// THE LINE'S STATE — the company's append-only record folded into where its
// founding line stands. The record holds only events; this fold is the one
// reading of them, so a desk, a briefing and an act's validate all see the
// same line.
//
// Events (company-store.js appends them):
//   { type: 'handed', stage, by, artifact, note, inspections, at }
//       the stage's master hands its work on; `inspections` is the chain
//       snapshotted at that moment (inspection-chain.js inspectionsFor)
//   { type: 'inspected', stage, step, verdict, by, flaw, at }
//       one inspection answered: 'accept' moves to the next inspection (the
//       last accept closes the stage and opens the next), 'return' sends the
//       work back to its master with the flaw named, 'stop' ends this gap on a
//       stoppable stage and opens the next round at SURVEY
// An event that does not fit the line as it stands is skipped and counted —
// the acts refuse such filings before they are written, so a count above zero
// means a hand-edited record, never a lost act.
// PURE.

import { FOUNDING_LINE } from './line-stages.js';

const freshRound = (round, stopped, since) => ({
  round,
  index: 0,
  status: 'open',
  handed: null,
  step: 0,
  flaw: null,
  stopped,
  since,
});

/**
 * Does this event fit the line as it stands? The store asks under its lock
 * just before an append, so the record only ever holds events that fit. pure.
 * @param {object} line - foldLine's state
 * @param {object} event
 */
export const fitsLine = (line, event) => {
  const stage = FOUNDING_LINE[line.index];
  if (!stage || event.stage !== stage.id) return false;
  if (event.type === 'handed') return line.status === 'open' || line.status === 'returned';
  if (event.type !== 'inspected' || line.status !== 'inspecting' || event.step !== line.step) return false;
  if (event.verdict === 'stop') return stage.stoppable;
  return event.verdict === 'accept' || event.verdict === 'return';
};

const apply = (line, event) => {
  if (event.type === 'handed') {
    return { ...line, status: 'inspecting', step: 0, flaw: null, since: event.at, handed: {
      by: event.by, artifact: event.artifact, note: event.note ?? null, inspections: event.inspections, at: event.at,
    } };
  }
  if (event.verdict === 'return') return { ...line, status: 'returned', step: 0, flaw: event.flaw ?? null, since: event.at };
  if (event.verdict === 'stop') {
    return freshRound(line.round + 1, [...line.stopped, { round: line.round, stage: event.stage, by: event.by, flaw: event.flaw ?? null, at: event.at }], event.at);
  }
  if (line.step + 1 < line.handed.inspections.length) return { ...line, step: line.step + 1, since: event.at };
  const index = line.index + 1;
  return { ...line, index, status: index < FOUNDING_LINE.length ? 'open' : 'standing', step: 0, handed: null, flaw: null, since: event.at };
};

/**
 * Fold the record into the line's state. pure.
 * @param {Array<object>} events - oldest first
 * @returns {{round: number, index: number, stage: ?object, status: 'open'|'returned'|'inspecting'|'standing',
 *   handed: ?object, step: number, flaw: ?string, stopped: Array<object>, since: ?string, skipped: number}}
 *   `since`: when the line came to stand as it does (null before its first move)
 */
export const foldLine = (events) => {
  const { line, skipped } = events.reduce(
    (acc, event) => (fitsLine(acc.line, event) ? { ...acc, line: apply(acc.line, event) } : { ...acc, skipped: acc.skipped + 1 }),
    { line: freshRound(1, [], null), skipped: 0 },
  );
  return { ...line, stage: FOUNDING_LINE[line.index] ?? null, skipped };
};
