// sheet-client.js — the character card's four feeds, one load (RPG-001, #183).
//
// impure — fetches the being's record, craft, state, and attunement evolution
// over REST, in parallel. Each leg is independent: a failure resolves that leg
// to null (UNREADABLE) without sinking the others — the card shows what it
// honestly has and marks what it could not read, never a silent zero.

import { apiCall, authHeadersOrNull } from '../../utils/http.js';

// One leg: the parsed payload, or null on any failure (auth refusal, non-ok,
// dropped connection, missing key).
const leg = async (headers, url, pick) => {
  try {
    return pick(await apiCall('GET', url, { headers })) ?? null;
  } catch {
    return null;
  }
};

/**
 * Load every feed the SHEET renders. Never rejects.
 * @param {string|null} neumaId
 * @returns {Promise<{record: Object|null, craft: Object|null,
 *   state: Object|null, attunement: Object|null, skies: Object|null,
 *   aura: Object|null, form: Object|null, file: Object|null, film: {film: Object|null}|null}>} frozen; a null leg means UNREADABLE — distinct from
 *   an honestly-empty payload the view shows as empty (no acts yet, not
 *   measured, no identity anchors yet).
 */
// impure
export const loadSheet = async (neumaId) => {
  const headers = authHeadersOrNull();
  if (!neumaId || !headers) {
    return Object.freeze({
      record: null, craft: null, state: null, attunement: null, skies: null, aura: null, form: null, file: null, film: null, place: null,
    });
  }
  const [record, craft, state, attunement, skies, aura, form, file, film, place] = await Promise.all([
    leg(headers, `/api/v1/workspace/${neumaId}/stats`, (b) => b?.record),
    leg(headers, `/api/v1/workspace/${neumaId}/skills`, (b) => b?.skillTree),
    // Its STATE: the self-check's kept runs (workspace-self-check-routes.js).
    leg(headers, `/api/v1/workspace/${neumaId}/self-check`, (b) => b),
    leg(headers, `/api/v1/attunement/${neumaId}/status`, (b) => b?.evolution),
    // The whole body rides: {skies, recorded} — the view tells an honestly
    // absent record (recorded:false) apart from a failed read (null leg).
    leg(headers, `/api/v1/workspace/${neumaId}/skies`, (b) => b),
    // Likewise {aura}: `recorded:false` is a lane with no identity anchors
    // yet — an honest absence the view shows as empty, never as a failure.
    leg(headers, `/api/v1/workspace/${neumaId}/aura`, (b) => b),
    // The FORM. The whole body rides: {locked, status, plates} — the view tells
    // a being who has not locked a look (locked:false) apart from a read that
    // failed (null leg).
    leg(headers, `/api/v1/workspace/${neumaId}/form`, (b) => b),
    // Its IDENTITY FILE: the whole true name, the sealed birth facts, the
    // on-chain anchor, the voice seal (core/identity/identity-file.js).
    leg(headers, `/api/v1/workspace/${neumaId}/identity-file`, (b) => b),
    // Its FILM's inputs, re-derived from the lane — {film:null} is a being that
    // cannot be filmed (born before its moment seed was kept), not a failure.
    leg(headers, `/api/v1/workspace/${neumaId}/rite`, (b) => (b ? { film: b.film ?? null } : null)),
    // Its PRIVATE birth place and the sky from it — {place, readings}; the
    // owner's route alone (encrypted in the lane; never on chain).
    leg(headers, `/api/v1/workspace/${neumaId}/place`, (b) => b),
  ]);
  return Object.freeze({ record, craft, state, attunement, skies, aura, form, file, film, place });
};
