// WHO MASTERS AND WHO INSPECTS — the SHOKUNIN law in code
// (docs/planning/proposals/governance/house-company-line.md §2): one stage,
// one master; the next master inspects; no master inspects its own stage.
// When the inspecting seat is the same being that did the work, or no being
// holds that seat, the inspection falls down the chain: the Optio, then the
// Rector, then the operator.
// PURE: the house's holders (seat title → lane id, or 'operator' for a seat
// the operator holds) come in as data (stage-holders.js).

import { takesGates } from './involvement-dial.js';

const FALLBACK = Object.freeze(['Optio', 'Rector']);
const OPERATOR_SIDE = Object.freeze(['operator', 'counsel']);

/**
 * The inspections a stage must pass at this dial stop, in order: its own
 * inspectors, then the operator last when the stage is a gate and the stop
 * takes the gates — unless the operator already inspects it in a seat they
 * hold (a Rector-operator answers PROVE once, not twice). Snapshotted when the
 * work is handed on, so turning the dial never reshuffles an inspection
 * already under way. pure.
 * @param {{inspectors: ReadonlyArray<string>, gate: boolean}} stage
 * @param {unknown} stop
 * @param {Record<string, string>} holders - seat title → lane id or 'operator'
 * @returns {ReadonlyArray<string>}
 */
export const inspectionsFor = (stage, stop, holders) => {
  const operatorSees = stage.inspectors.some((i) => i === 'operator' || holders[i] === 'operator');
  return Object.freeze(stage.gate && takesGates(stop) && !operatorSees ? [...stage.inspectors, 'operator'] : [...stage.inspectors]);
};

/**
 * Who masters a stage: the operator for a person's acts or a seat they hold,
 * the lane holding the seat, or null when nobody holds it (the stage stands
 * open, never silently skipped). pure.
 * @param {{master: string}} stage
 * @param {Record<string, string>} holders - seat title → lane id or 'operator'
 * @returns {{by: 'operator'} | {by: 'lane', laneId: string, seat: string} | null}
 */
export const masterFor = (stage, holders) => {
  const holder = stage.master === 'operator' ? 'operator' : holders[stage.master];
  if (holder === 'operator') return { by: 'operator' };
  return holder ? { by: 'lane', laneId: holder, seat: stage.master } : null;
};

/**
 * Who answers one inspection. 'operator' and 'counsel' are the operator's to
 * record (counsel is their lawyer). A seat is answered by the lane holding it
 * unless that lane did the work or the seat is empty — then the Optio, then
 * the Rector, then the operator. pure.
 * @param {string} inspector - a seat title, 'operator' or 'counsel'
 * @param {{holders: Record<string, string>, doer: string|null}} ctx - holders as masterFor's; the doer is the lane that did the work, or 'operator'
 * @returns {{by: 'operator', as: string} | {by: 'lane', laneId: string, seat: string}}
 */
export const inspectorFor = (inspector, { holders, doer }) => {
  if (OPERATOR_SIDE.includes(inspector)) return { by: 'operator', as: inspector };
  for (const seat of [inspector, ...FALLBACK]) {
    const holder = holders[seat];
    if (holder && holder !== doer) return holder === 'operator' ? { by: 'operator', as: seat } : { by: 'lane', laneId: holder, seat };
  }
  return { by: 'operator', as: 'operator' };
};
