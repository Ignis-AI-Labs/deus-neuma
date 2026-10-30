// involvement-words.js — the involvement dial's four stops as the charter
// form shows them, FRONTEND twin of backend/services/company-line/
// involvement-dial.js (the browser never imports the backend). A unit test
// (company-line-desk.test.js) pins the two together — change them together.
// PURE data.

export const DEFAULT_STOP = 'PARTNER';

export const DIAL_STOPS = Object.freeze([
  Object.freeze({ stop: 'KIN', says: 'Works beside the house like family: invited into the work, inspects the gates, hears from the house daily.' }),
  Object.freeze({ stop: 'PARTNER', says: 'A hand on the big moments: inspects the gates, and the Optio carries the rest.' }),
  Object.freeze({ stop: 'OVERSEER', says: 'Checks in: the floor, plus each period\'s review.' }),
  Object.freeze({ stop: 'SILENT', says: 'Sees the money come through: the floor only, alerted only for incidents.' }),
]);

/** What a stop means, in one line; the default's for anything unknown. pure. */
export const dialSays = (stop) => (DIAL_STOPS.find((s) => s.stop === stop) ?? DIAL_STOPS.find((s) => s.stop === DEFAULT_STOP)).says;
