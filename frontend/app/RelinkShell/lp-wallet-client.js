// lp-wallet-client.js — the operator's side of a house member's LP wallet on
// Umbrae: read it, open it, set its budget, answer a deposit that waited,
// set its portfolio round, answer a reward it earned.
//
// impure — authed REST to backend/routes/lp-wallet-routes.js. Every failure
// resolves to {ok:false, error} so the layer can say what happened.

import { apiCall, authHeadersOrNull } from '../../utils/http.js';

const base = (neumaId) => `/api/v1/neuma/${neumaId}/lp`;

// impure — one authed call, folded to {ok, ...data} or {ok:false, error}.
const call = async (method, url, body) => {
  const headers = authHeadersOrNull();
  if (!headers) return { ok: false, error: 'Not signed in.' };
  try {
    return { ok: true, ...(await apiCall(method, url, { headers, body, errorPrefix: 'The desk refused.' })) };
  } catch (err) {
    return { ok: false, error: err.http ? err.message : 'Could not reach the desk.' };
  }
};

/** The LP wallet, or {ok:true, lp:null} when the house member has none. */
export const readLp = (neumaId) => call('GET', base(neumaId));

/** Make the LP wallet (once) and give its address. */
export const openLp = (neumaId) => call('POST', `${base(neumaId)}/open`);

/** Set the budget in dollars. */
export const setLpBudget = (neumaId, budgetUsd) => call('PUT', `${base(neumaId)}/budget`, { budgetUsd });

/** Answer a waiting deposit: 'approve' runs it on Base, 'decline' ends it. */
export const answerLpDeposit = (neumaId, id, verdict) => call('POST', `${base(neumaId)}/pending/${encodeURIComponent(id)}/${verdict}`);

/** The member's portfolio round, in minutes (0 = off). */
export const setLpPace = (neumaId, minutes) => call('PUT', `${base(neumaId)}/pace`, { minutes });

/** Answer a reward: 'approve' pays it to you on Base, 'decline' says no, 'delivered' marks it given. */
export const answerLpReward = (neumaId, id, verdict, note) => call('POST', `${base(neumaId)}/rewards/${encodeURIComponent(id)}/${verdict}`, note ? { note } : {});
