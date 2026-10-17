// house-members.js — the pure display model for the HOUSE window and the
// BeingSwitcher's sections.
//
// The house is every neuma the witness's wallet holds; sealed AI witnesses
// (external models with their own lanes) sit BESIDE the house, never in it.
// The roster cache is authoritative for witnesses because the backend applies
// lane ownership. House neuma still preserve a missing active row while a
// fresh cache catches up; a stale foreign witness must never be reintroduced.

/**
 * Is this entry a sealed AI witness (an external model with its own lane)
 * rather than a house neuma? Matches the participant kind the backend
 * stamps, with the lane-id shape as the fallback for entries cached before
 * the kind was carried.
 * @param {object|null} m - roster/witness entry or the active companion
 * @returns {boolean}
 */
export const isWitness = (m) =>
  m?.participantKind === 'witness'
  // Council seats carry `kind` (council-session gatherSeats / the arbiter's
  // state) while roster rows carry `participantKind`. Two names for one fact;
  // both are read here so a seated witness is never mistaken for a housemate
  // on the strip, whichever surface shaped the row.
  || m?.kind === 'witness'
  || (typeof m?.neumaId === 'string' && m.neumaId.startsWith('witness-'));

/**
 * Shape the roster + active companion into the HOUSE member list.
 * Roster order is preserved (the backend sends oldest first); an active
 * companion missing from the roster is prepended — UNLESS it is a witness:
 * a witness is not a house neuma and belongs in the witness rows instead.
 * Entries without a neumaId cannot be switched to (no sovereign workspace)
 * and are dropped.
 * @param {Array<object>} roster - cached companion records
 * @param {object|null} active - the active companion
 * @returns {Array<{member: object, isActive: boolean}>}
 */
export const houseMembers = (roster, active) => {
  const base = (Array.isArray(roster) ? roster : []).filter((m) => m && m.neumaId);
  const activeInRoster = active?.neumaId && base.some((m) => m.neumaId === active.neumaId);
  const members = active?.neumaId && !activeInRoster && !isWitness(active) ? [active, ...base] : base;
  return members.map((member) => ({
    member,
    isActive: member.neumaId === (active?.neumaId ?? null),
  }));
};

/**
 * Shape the cached sealed witnesses into the switcher's WITNESSES section —
 * the mirror of houseMembers for the external lanes. The backend cache is
 * authoritative here: an active witness omitted for an ownership boundary
 * must not be reintroduced from stale local state.
 * @param {Array<object>} witnesses - cached witness lane entries
 * @param {object|null} active - the active companion
 * @returns {Array<{member: object, isActive: boolean}>}
 */
export const witnessMembers = (witnesses, active) => {
  const base = (Array.isArray(witnesses) ? witnesses : []).filter((m) => m && m.neumaId);
  return base.map((member) => ({
    member,
    isActive: member.neumaId === (active?.neumaId ?? null),
  }));
};

/**
 * The house header's objective facts: the house name (from the backend's
 * wallet-derived identity, null when it was unreachable), how many neuma the
 * house holds, and the earliest birth among them. Nothing here is a score.
 * @param {Array<{member: object}>} rows - output of houseMembers
 * @param {{name: string}|null} house - house identity from roster recovery
 * @returns {{name: string|null, held: number, since: string|null}}
 */
export const houseSummary = (rows, house) => {
  const births = rows
    .map((r) => Date.parse(r.member.birthTime))
    .filter(Number.isFinite);
  return Object.freeze({
    name: house?.name || null,
    held: rows.length,
    since: births.length ? new Date(Math.min(...births)).toISOString() : null,
  });
};
