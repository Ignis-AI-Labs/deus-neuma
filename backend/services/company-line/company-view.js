// THE LINE AS IT READS — one company's founding line, shaped once for every
// reader: the operator's desk (company-routes.js), the masters' turn briefing
// (company-briefing.js) and WAITING ON YOU (waiting-sources.js). Each stage
// says who masters it in this house, whether it is done, in hand, or ahead;
// the line says whose move it waits on.
// PURE.

import { FOUNDING_LINE } from './line-stages.js';
import { masterFor } from './inspection-chain.js';
import { whoIsUp } from './line-acts.js';

const holderWord = (who) => (!who ? null : who.by === 'operator' ? 'operator' : who.laneId);

/**
 * @param {object} company - the stored record
 * @param {object} line - foldLine's state (plus the store's `torn`)
 * @param {Record<string, string>} holders - seat title → lane id or 'operator'
 * @param {ReadonlyArray<object>} [hands] - the company's HANDS items (hands-store.js), oldest first
 */
export const lineView = (company, line, holders, hands = []) => Object.freeze({
  id: company.id,
  name: company.name,
  mode: company.mode,
  openedAt: company.openedAt,
  round: line.round,
  status: line.status,
  stage: line.stage ? line.stage.id : null,
  up: whoIsUp(line, holders),
  handed: line.handed,
  step: line.step,
  flaw: line.flaw,
  stopped: line.stopped,
  since: line.since ?? company.openedAt,
  torn: line.torn ?? 0,
  skipped: line.skipped ?? 0,
  hands,
  stages: FOUNDING_LINE.map((s, i) => ({
    id: s.id,
    name: s.name,
    master: s.master,
    holder: holderWord(masterFor(s, holders)),
    inspectors: s.inspectors,
    gate: s.gate,
    stoppable: s.stoppable,
    handsOn: s.handsOn,
    state: i < line.index ? 'done' : i === line.index && line.status !== 'standing' ? 'in-hand' : 'ahead',
  })),
});
