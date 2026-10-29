// THE FOUNDING LINE — the seven stages a house walks once per company
// (docs/planning/proposals/governance/house-company-line.md §6). Founder,
// 2026-10-29: […]
//
// Each stage names its ONE master — a canonical seat, or the operator for the
// acts only a person can do — the inspections it must pass in order, and what
// it hands on. An inspector is a canonical seat, 'operator', or 'counsel' (the
// operator's lawyer; the operator records the answer). `gate`: the operator
// inspects too, last, at the dial stops that take the gates
// (involvement-dial.js). `stoppable`: the gap may die here, and the line opens
// its next round at SURVEY.
// PURE data.

const stage = (s) => Object.freeze({ gate: false, stoppable: false, ...s, inspectors: Object.freeze([...s.inspectors]) });

export const FOUNDING_LINE = Object.freeze([
  stage({
    id: 'survey', name: 'SURVEY', master: 'Speculator', inspectors: ['Numerarius'],
    handsOn: 'gap candidates: the six paths walked (other industries, other groups, the buyer chain, add-ons, functional vs emotional appeal, trends) and the three tiers of noncustomers, every claim sourced',
  }),
  stage({
    id: 'measure', name: 'MEASURE', master: 'Numerarius', inspectors: ['Architectus'],
    handsOn: 'a strategy canvas per candidate: the factors the field competes on and each player\'s level on each, every level sourced; the red-ocean reading',
  }),
  stage({
    id: 'shape', name: 'SHAPE', master: 'Architectus', inspectors: ['Rector'],
    handsOn: 'the offer: the ERRC grid (eliminate, reduce, raise, create), the buyer utility map\'s pain points, the offer brief, the price band, the one-line tagline',
  }),
  stage({
    id: 'choose', name: 'CHOOSE', master: 'Rector', inspectors: ['operator'], stoppable: true,
    handsOn: 'the chosen gap, why it is ours, and its kill criteria ("we stop if …")',
  }),
  stage({
    id: 'prove', name: 'PROVE', master: 'Mercator', inspectors: ['Numerarius', 'Rector'], gate: true, stoppable: true,
    handsOn: 'field results from real buyers: SPIN interviews, a test page, replies, sign-ups, each a real response with its source',
  }),
  stage({
    id: 'charter', name: 'CHARTER', master: 'Praetor', inspectors: ['counsel'], gate: true,
    handsOn: 'the formation checklist: entity type, where, each act\'s cost, what needs counsel, and every act only the operator can do',
  }),
  stage({
    id: 'form', name: 'FORM', master: 'operator', inspectors: ['Praetor'],
    handsOn: 'the company standing: entity filed, tax ID, bank, payment account, signed agreement, each handed back as a record',
  }),
]);

/**
 * The stage with this id, or null. pure.
 * @param {string} id
 */
export const stageById = (id) => FOUNDING_LINE.find((s) => s.id === id) ?? null;
