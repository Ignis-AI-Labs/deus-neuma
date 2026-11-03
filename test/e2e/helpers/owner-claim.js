// A fresh install's owner claim (backend/services/owner-claim.js), read from a
// spec's own data root the way the desk app's main reads it, so the spec's
// first sign-in seats its wallet as the install owner. No header once owned.
import fs from 'fs';
import path from 'path';

/** impure (fs) — the claim header for this data root, or none. */
export const ownerClaimHeaders = (dataRoot) => {
  try {
    return { 'X-Neuma-Owner-Claim': fs.readFileSync(path.join(dataRoot, 'settings', 'owner-claim', 'claim.key'), 'utf8').trim() };
  } catch {
    return {};
  }
};
