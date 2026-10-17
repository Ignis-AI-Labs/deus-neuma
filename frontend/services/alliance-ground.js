// alliance-ground.js — the CROSS-HOUSE grounds (per wallet).
//
// A house's own ground belongs to that house. When a house works with someone
// outside it — a sealed witness, or a neuma of another house — the work goes in
// a third ground named from BOTH houses, standing outside either of them.
//
// Nothing here raises a ground on its own, and as of 2026-07-27 nothing here
// raises one at all. The council's […] button was the only
// caller of `raiseAllianceGround`, and it is gone: Founder's call, […] — the folder the operator opens in the Explorer IS the act of
// consent, so a second door asking for the same permission is the double
// approval this platform rules against. The client function went with the
// button rather than lingering as a capability with no way to invoke it.
//
// The server route (POST .../raise) still stands and is still the operator's
// own command; if a deliberate surface for it returns, it is one function call
// away. What must NOT return is an automatic raise — that was never allowed
// (Design note, 2026-07-26: […]).
//
// impure — Bearer from the session.

import { apiCall } from '../utils/http.js';

const BASE = '/api/v1/user/realm/alliance-ground';

// impure — { root, suggestion, alliances } ; any failure reads as unset, so a
// dark endpoint closes the ground rather than implying one stands.
export const getAllianceGrounds = async () => {
  try {
    return await apiCall('GET', BASE, { strictJson: true });
  } catch {
    return { root: null, suggestion: null, alliances: [] };
  }
};

// impure — choose where cross-house grounds stand → { root, suggestion,
// alliances }. Throws with the server's refusal (it will not accept a path
// inside the house ground, in either direction).
export const setAllianceRoot = async (root) =>
  apiCall('PUT', BASE, { body: { root }, errorPrefix: 'Could not set the alliances root' });
