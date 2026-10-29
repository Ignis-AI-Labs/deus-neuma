// WHO HOLDS EACH SEAT, for the company line — canonical seat title → the
// lane that answers for it, or 'operator' when the operator holds the seat
// themselves (in many houses the operator is the Rector).
//
// The order (docs/planning/proposals/governance/house-company-line.md §2):
// a seat's OFFICE designation wins where the seat has one (the operator seats
// an office deliberately, for the work); otherwise the house's founding
// record — the operator's own seats, then each being's sealed seat. A
// founder's own label maps to no canonical seat and answers for none. A seat
// nobody holds is absent: the line says "no master", never guesses one.
// impure (reads the office seats and the founding records; no chain, no keys).

import { TITLE_LEGEND } from '../founding-titles-legend.js';
import { houseTitlesByNeumaId, operatorSeatTitles } from '../house-titles.js';
import { cosDesignation } from '../staff/cos-designation.js';
import { cfoDesignation } from '../treasury/cfo-designation.js';
import { csoDesignation } from '../security/cso-designation.js';
import { cloDesignation } from '../legal/clo-designation.js';
import { cmoDesignation } from '../marketing/cmo-designation.js';
import { croDesignation } from '../revenue/cro-designation.js';

const OFFICES = Object.freeze([
  ['Optio', cosDesignation],
  ['Quaestor', cfoDesignation],
  ['Praefectus', csoDesignation],
  ['Praetor', cloDesignation],
  ['Legatus', cmoDesignation],
  ['Mercator', croDesignation],
]);

// pure — the canonical spelling of a title, or null for a founder's own word.
const canonical = (title) => TITLE_LEGEND
  .find((r) => r.title.toLowerCase() === String(title ?? '').trim().toLowerCase())?.title ?? null;

// pure — seat → holder from [holder, title] pairs; the first claim on a seat stands.
const bySeat = (pairs) => pairs.reduce((acc, [holder, title]) => {
  const seat = canonical(title);
  return seat && !Object.hasOwn(acc, seat) ? { ...acc, [seat]: holder } : acc;
}, {});

/**
 * @param {string} wallet - the house
 * @returns {Promise<Readonly<Record<string, string>>>} seat title → lane id or 'operator'
 */
export const seatHolders = async (wallet) => {
  const [operatorTitles, laneTitles, officers] = await Promise.all([
    operatorSeatTitles(wallet),
    houseTitlesByNeumaId(wallet),
    Promise.all(OFFICES.map(async ([seat, office]) => [seat, (await office.getOfficer(wallet).catch(() => null))?.laneId ?? null])),
  ]);
  const founded = bySeat([...operatorTitles.map((t) => ['operator', t]), ...Object.entries(laneTitles)]);
  const seated = Object.fromEntries(officers.filter(([, laneId]) => laneId));
  return Object.freeze({ ...founded, ...seated });
};
