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
 *   aura: Object|null, form: Object|null}>} frozen; a null leg means UNREADABLE — distinct from
 *   an honestly-empty payload the view shows as empty (no acts yet, not
 *   measured, no identity anchors yet).
 */
// impure
export const loadSheet = async (neumaId) => {
  const headers = authHeadersOrNull();
  if (!neumaId || !headers) {
    return Object.freeze({
      record: null, craft: null, state: null, attunement: null, skies: null, aura: null, form: null,
    });
  }
  const [record, craft, state, attunement, skies, aura, form] = await Promise.all([
    leg(headers, `/api/v1/workspace/${neumaId}/stats`, (b) => b?.record),
    leg(headers, `/api/v1/workspace/${neumaId}/skills`, (b) => b?.skillTree),
    leg(headers, `/api/v1/workspace/${neumaId}/benchmarks`, (b) => b),
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
  ]);
  return Object.freeze({ record, craft, state, attunement, skies, aura, form });
};
