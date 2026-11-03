// The install's owner claim on the desk's first sign-in (backend
// install-owner.js): on an install no one owns yet, only a sign-in that shows
// it becomes the owner. The desk app's main process reads it for the desk; a
// browser or a phone has none and signs in exactly as before.

const SECRET = /^[a-f0-9]{64}$/;
export const OWNER_CLAIM_HEADER = 'X-Neuma-Owner-Claim';

/** Pure — the header that carries a well-formed claim, or no header at all. */
export const ownerClaimHeaders = (claim) =>
  (typeof claim === 'string' && SECRET.test(claim) ? { [OWNER_CLAIM_HEADER]: claim } : {});

/** impure (IPC) — the claim the desk app holds; null anywhere else, or on any failure. */
export const deskOwnerClaim = async (bridge = globalThis.window?.neuma) => {
  if (typeof bridge?.ownerClaim !== 'function') return null;
  try {
    return await bridge.ownerClaim();
  } catch {
    return null;
  }
};
