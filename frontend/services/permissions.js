// permissions.js — what the operator has PERMANENTLY granted, over REST.
//
// impure. Two reads and ONE verb, mirroring the route exactly. The verb can
// only ever take a grant away (Design note, 2026-08-30: […]) — there is nothing here that widens
// a being's standing, and there must never be.

import { apiCall } from '../utils/http.js';

const BASE = '/api/v1/permissions';

/** Every lane this wallet owns, with its standing grants and house totals. */
export const getHousePermissions = async () => apiCall('GET', BASE);


/**
 * Take ONE standing grant back.
 *
 * The grant row itself is the descriptor — the panel sends back the same shape
 * the ledger handed it, so there is no second vocabulary to keep in step and no
 * chance of naming a row that was never shown.
 *
 * Answers `{ ok, held, record }`: `held: false` means it was already gone, which
 * is a success. `record` is the lane re-read AFTER the write, so the panel
 * redraws from the server's truth rather than from its own optimism.
 */
export const revokeGrant = async (neumaId, grant) =>
  apiCall('POST', `${BASE}/${encodeURIComponent(neumaId)}/revoke`, { body: grant });
