// intent-owners.js — which TEAM MEMBER filed an intent.
//
// A being's lane has one intents/ folder, and every sitting of that being
// sweeps it. A team member works in the background beside its being's own
// chat (Design note, 2026-10-10: the team works while […]), so two
// sittings sweep one folder at once. Two wrongs follow from that, and this
// record prevents both:
//   - the member refuses every act that needs the operator's approval, so a
//     member sweeping its being's PENDING chat act (its card still waiting on
//     the operator) would settle it denied — an act the operator never got
//     to answer;
//   - the chat, sweeping the member's filing first, would judge it against
//     the chat's session (no team workspace there) instead of the member's.
// So the member's sandbox records each intent it files here; the member's
// sweep settles exactly those, every other sweep leaves them be, and the
// claim lifts when the member's turn ends — a filing it left pending returns
// to the being's own sittings.
//
// impure — module state.

import path from 'path';

const owners = new Map(); // absolute intent path -> owner token

/**
 * @param {string} filePath - the intent file the member is writing
 * @param {string} owner - the member turn's token
 */
export const claimFiledIntent = (filePath, owner) => { owners.set(path.resolve(filePath), owner); };

/** @returns {?string} the member token that filed this intent, if a member did */
const intentOwner = (filePath) => owners.get(path.resolve(filePath)) ?? null;

/** The member's turn ended — what it filed is its being's again. */
export const releaseIntentOwner = (owner) => {
  for (const [filePath, held] of owners) if (held === owner) owners.delete(filePath);
};

/**
 * Whether this sitting may settle this intent: a member settles only its own
 * filings; any other sitting settles everything a member does not hold. Pure
 * over the record.
 *
 * @param {Object} connection - the sweeping sitting (`_intentOwner` on a member)
 * @param {string} filePath
 * @returns {boolean}
 */
export const maySettle = (connection, filePath) => {
  const owner = intentOwner(filePath);
  return connection?._intentOwner ? owner === connection._intentOwner : owner == null;
};
