// THE INVOLVEMENT DIAL — how close the operator stands to the house's company
// work (docs/planning/proposals/governance/house-company-line.md §4). Founder,
// 2026-10-29: […]
//
// One stop per house, set on its charter. The dial changes what is ASKED of
// the operator, never what they can SEE or STOP: the floor below holds at
// every stop, and the record and the pause switch never dim.
// PURE data.

export const STOPS = Object.freeze(['KIN', 'PARTNER', 'OVERSEER', 'SILENT']);

// A house whose charter names no stop stands at PARTNER: the operator keeps a
// hand on the big moments until they choose otherwise.
export const DEFAULT_STOP = 'PARTNER';

const DIAL = Object.freeze({
  KIN: Object.freeze({ gates: true, says: 'Works beside the house like family: invited into the work, inspects the gates, hears from the house daily.' }),
  PARTNER: Object.freeze({ gates: true, says: 'A hand on the big moments: inspects the gates, and the Optio carries the rest.' }),
  OVERSEER: Object.freeze({ gates: false, says: 'Checks in: the floor, plus each period\'s review.' }),
  SILENT: Object.freeze({ gates: false, says: 'Sees the money come through: the floor only, alerted only for incidents.' }),
});

// What no stop removes — law, money, or the operator's own name.
export const FLOOR = Object.freeze([
  'Money out: the operator approves every spend.',
  'Acts only a person can do: signing, identity checks, filings.',
  'Choosing the company the operator will legally own.',
  'A raise\'s mandate, and every close.',
  'Counsel where the law needs a lawyer; a licensed CPA where the books need one.',
  'Incidents: any hard-line breach, critical legal matter or security alert.',
]);

/**
 * The stop a stored value names, or the default for anything else. pure.
 * @param {unknown} value
 * @returns {string}
 */
export const stopOf = (value) => (STOPS.includes(value) ? value : DEFAULT_STOP);

/**
 * Does the operator inspect the gate stages at this stop? pure.
 * @param {unknown} stop
 */
export const takesGates = (stop) => DIAL[stopOf(stop)].gates;

/**
 * The one line that tells an operator what a stop means. pure.
 * @param {unknown} stop
 */
export const stopSays = (stop) => DIAL[stopOf(stop)].says;
