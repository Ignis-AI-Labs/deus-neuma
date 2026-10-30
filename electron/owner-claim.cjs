// The install's owner claim, read for the desk's own first sign-in.
//
// The backend writes it on an install no one owns yet, readable only by the OS
// user that runs the app (backend/services/owner-claim.js — the path below is
// that module's, keep the two in step), and removes it once an owner stands.
// Main runs as that user, so it can read the claim and hand it to the desk's
// own top frame (ipc-handlers.cjs, `app:ownerClaim`, fromDesk-gated).

const fs = require('node:fs');
const path = require('node:path');

const SECRET = /^[a-f0-9]{64}$/;

/** Pure — where the claim lives under a data root. */
const ownerClaimFile = (dataRoot) => path.join(dataRoot, 'settings', 'owner-claim', 'claim.key');

/**
 * The claim, or null when none stands (an owned install) or it is unreadable.
 * impure (fs).
 * @param {string} dataRoot
 * @returns {string|null}
 */
const readOwnerClaim = (dataRoot) => {
  try {
    const text = fs.readFileSync(ownerClaimFile(dataRoot), 'utf8').trim();
    return SECRET.test(text) ? text : null;
  } catch {
    return null;
  }
};

module.exports = { ownerClaimFile, readOwnerClaim };
