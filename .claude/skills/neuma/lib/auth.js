// The terminal witness and the operator CLI share one hardened sign-in path:
// origin-bound backend proof, strict SIWE validation, then a real signature.
export { localOwnerClaim, mintToken, verifyBackendIdentity } from '../../../../cli/lib/auth.js';
