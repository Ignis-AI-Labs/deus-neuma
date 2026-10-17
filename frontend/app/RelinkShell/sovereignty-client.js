// sovereignty-client.js — the desk's hand on the gateway.
//
// impure — reads a lane's whole sovereignty record and drives the two
// operator doors (verdict, retract). The record read distinguishes THREE
// states the panel must never blur: {ok:true, record} (a readable record,
// possibly empty), {ok:false, error} (the backend REFUSED — a broken
// amendment chain answers 500 with its own words, and the desk must scream
// it, never render an empty record), and null (not authenticated / no lane).

import { apiCall, authHeadersOrNull as authHeaders } from '../../utils/http.js';
import { walletDiscovery } from '../../services/WalletDiscovery.js';

// One POST/GET with the house error shape — every door below rides it.
const call = async (path, method = 'POST', body = undefined) => {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: 'Not authenticated.' };
  try {
    const echo = await apiCall(method, path, { headers, ...(body ? { body } : {}), errorPrefix: 'Refused' });
    return { ok: true, ...echo };
  } catch (err) {
    if (!err.http) return { ok: false, error: 'Could not reach the platform.' };
    return { ok: false, error: err.message };
  }
};

// impure
export const loadSovereignty = async (neumaId) => {
  const headers = authHeaders();
  if (!neumaId || !headers) return null;
  try {
    const record = await apiCall('GET', `/api/v1/sovereignty/${neumaId}`, { headers, errorPrefix: 'Record unreadable' });
    return { ok: true, record };
  } catch (err) {
    if (!err.http) return { ok: false, error: 'Could not reach the platform.' };
    return { ok: false, error: err.message };
  }
};

// impure — the ruling; approve applies in the same request (server echo is the truth).
export const decideProposal = async (neumaId, proposalId, verdict, notes) => {
  const headers = authHeaders();
  if (!neumaId || !headers) return { ok: false, error: 'Not authenticated.' };
  try {
    const body = await apiCall('POST', `/api/v1/sovereignty/${neumaId}/proposals/${proposalId}/decide`, {
      headers, body: { verdict, ...(notes ? { notes } : {}) }, errorPrefix: 'Refused',
    });
    return { ok: true, ...body };
  } catch (err) {
    if (!err.http) return { ok: false, error: 'Could not reach the platform.' };
    return { ok: false, error: err.message };
  }
};

// impure — the being's consent is asked through its OWN stack (a real turn;
// may take a minute). 'unclear' recorded nothing and may be asked again.
export const askConsent = (neumaId, proposalId) =>
  call(`/api/v1/sovereignty/${neumaId}/proposals/${proposalId}/consent-ask`);

// impure — the three-step signed apply (decision #4): fetch the single-use
// challenge, sign it with the operator's own wallet (the approvePendingSpend
// recipe), hand the signature back. Every refusal carries its name.
export const signAndApplyDna = async (neumaId, proposalId) => {
  const address = localStorage.getItem('walletAddress');
  const provider = walletDiscovery.getPreferredProvider()?.provider || null;
  if (!provider || !address) return { ok: false, error: 'Connect your operator wallet to sign.' };
  const challenge = await call(`/api/v1/sovereignty/${neumaId}/proposals/${proposalId}/sign-message`, 'GET');
  if (!challenge.ok) return challenge;
  let signature;
  try {
    signature = await provider.request({ method: 'personal_sign', params: [challenge.message, address] });
  } catch {
    return { ok: false, error: 'Signature was rejected.' };
  }
  return call(`/api/v1/sovereignty/${neumaId}/proposals/${proposalId}/apply-dna`, 'POST', { signature });
};

// impure — takes standing law down; recorded, and the being's knock names it.
export const retractAmendment = async (neumaId, amendmentId) => {
  const headers = authHeaders();
  if (!neumaId || !headers) return { ok: false, error: 'Not authenticated.' };
  try {
    const body = await apiCall('POST', `/api/v1/sovereignty/${neumaId}/amendments/${amendmentId}/retract`, {
      headers, errorPrefix: 'Refused',
    });
    return { ok: true, ...body };
  } catch (err) {
    if (!err.http) return { ok: false, error: 'Could not reach the platform.' };
    return { ok: false, error: err.message };
  }
};
