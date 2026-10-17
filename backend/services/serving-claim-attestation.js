/**
 * THE CLAIMED-SERVER ATTESTATION (neuma #506 contract 3) — how a process that
 * did NOT spawn the serving substrate proves what is answering, without taking
 * ownership and without bypassing base-weight verification.
 *
 * The spawning process is the only witness of its own boot, so it PUBLISHES
 * the path-free serving authority (the same projection the supervised
 * attestation uses) onto its claim once health is proven. A sibling then
 * attests from that claim: the claimed pid must be alive, the route must name
 * the same port and model, the published authority must re-validate AND hash
 * to its pinned digest, the caller's expectations must match, and the server
 * must actually answer — then the whole thing is re-read once, because a claim
 * that moved mid-check is no longer the claim that was checked.
 *
 * Trust boundary, said plainly: the claim file lives in the operator's own
 * machine root and is written only by Neuma processes — the same channel the
 * cross-process stop law already trusts. A pre-contract boot's claim carries
 * no authority and attests AUTHORITY_UNAVAILABLE, never a guess.
 */
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import {
  expectedMatches,
  SERVING_LAUNCH_REFUSAL,
  servingLaunchAuthority,
  servingRouteIdentitySha256,
} from './serving-launch-attestation.js';
import { readClaim, writeClaimAuthority } from './substrate-claim-registry.js';
import { isServing } from './served-model-truth.js';
import { createLogger } from './logger.js';

const log = createLogger('ServingClaim');

const refusal = (code) => Object.freeze({ ok: false, code });

// The claimed contract's route needs only where to look; the served NAME is
// optional because a base-only serving's identity is its artifact hash, not
// an alias (#506 — benchmark base-weight servings carry no lineage id).
const LOOPBACK_ENDPOINT = /^http:\/\/(?:localhost|127\.0\.0\.1):([1-9]\d{0,4})\/?$/u;
const claimedRoutePort = (route) => {
  if (route?.provider !== 'llama-server') throw new Error('claimed route provider is invalid');
  const port = Number(LOOPBACK_ENDPOINT.exec(route.endpoint)?.[1]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('claimed route endpoint is invalid');
  return port;
};

// The spawner's own route identity: it launched ON 127.0.0.1:<port> serving
// servingModel, so its route form is fixed by the launch. Pure.
const launchRoute = (launch) => ({
  provider: 'llama-server',
  endpoint: `http://127.0.0.1:${launch.port}`,
  model: launch.servingModel,
});

/**
 * The authority a healthy spawner can publish for its own process generation.
 * Pure projection over the owner-witnessed launch facts; throws on malformed
 * facts (the publisher catches — a boot must never fail over its proof).
 */
export const claimAuthorityForLaunch = (launch, launchFacts) => {
  const authority = servingLaunchAuthority({
    ...launchFacts,
    routeIdentitySha256: launchFacts.servingModel === null
      ? null
      : servingRouteIdentitySha256(launchRoute(launch)),
  });
  return Object.freeze({ authority, authoritySha256: refinementSha256(authority) });
};

/** Pin this generation's authority onto its claim. impure, best-effort. */
export const publishServingClaimAuthority = ({ pid, port, launch, launchFacts }) => {
  try {
    const { authority, authoritySha256 } = claimAuthorityForLaunch(launch, launchFacts);
    const written = writeClaimAuthority(pid, port, { servingAuthority: authority, servingAuthoritySha256: authoritySha256 });
    if (!written) log.warn('serving authority was not pinned — claimed attestation stays unavailable', { pid, port });
  } catch (error) {
    log.warn('serving authority could not be projected — claimed attestation stays unavailable', { err: error.message });
  }
};

/**
 * Attest a server ANOTHER Neuma process spawned, from the claim it left.
 * @param {Object} route - the caller's llama-server route (provider/endpoint/model)
 * @param {Object|null} [expected] - same expectation shape as the supervised contract
 * @returns {Promise<{ok: boolean, code?: string, authority?: Object, authoritySha256?: string}>}
 */
export const attestClaimedServing = async (route, expected = null) => {
  const claim = readClaim();
  if (!claim) return refusal(SERVING_LAUNCH_REFUSAL.NO_ACTIVE_LAUNCH);
  let port;
  try { port = claimedRoutePort(route); } catch {
    return refusal(SERVING_LAUNCH_REFUSAL.IDENTITY_MISMATCH);
  }
  if (claim.port !== port) return refusal(SERVING_LAUNCH_REFUSAL.ROUTE_MISMATCH);
  // The served-name check binds only when BOTH sides carry one — a base-only
  // claim's identity is its artifact hash, pinned through `expected`.
  if (claim.servingModel && route?.model && claim.servingModel !== route.model) {
    return refusal(SERVING_LAUNCH_REFUSAL.ROUTE_MISMATCH);
  }
  if (!claim.servingAuthority || typeof claim.servingAuthoritySha256 !== 'string') {
    return refusal(SERVING_LAUNCH_REFUSAL.AUTHORITY_UNAVAILABLE);
  }
  // The file is untrusted until it re-validates AND hashes to its pinned digest.
  let projected;
  try { projected = servingLaunchAuthority(claim.servingAuthority); } catch {
    return refusal(SERVING_LAUNCH_REFUSAL.IDENTITY_MISMATCH);
  }
  if (refinementSha256(projected) !== claim.servingAuthoritySha256) {
    return refusal(SERVING_LAUNCH_REFUSAL.IDENTITY_MISMATCH);
  }
  // A refined serving pinned its route identity at publish; the caller's route
  // must reproduce it (a route that cannot form an identity at all refuses the
  // same way). A base-only serving carries no route pin by law.
  if (projected.routeIdentitySha256 !== null) {
    let callerRouteSha = null;
    try { callerRouteSha = servingRouteIdentitySha256(route); } catch { /* invalid route */ }
    if (callerRouteSha === null) return refusal(SERVING_LAUNCH_REFUSAL.IDENTITY_MISMATCH);
    if (projected.routeIdentitySha256 !== callerRouteSha) {
      return refusal(SERVING_LAUNCH_REFUSAL.ROUTE_MISMATCH);
    }
  }
  if (!expectedMatches(projected, expected)) {
    return refusal(SERVING_LAUNCH_REFUSAL.INVALID_EXPECTED);
  }
  let reachable;
  try { reachable = await isServing(claim.port, '127.0.0.1'); } catch { reachable = false; }
  if (!reachable) return refusal(SERVING_LAUNCH_REFUSAL.UNREACHABLE);
  const reread = readClaim();
  if (!reread || reread.pid !== claim.pid
    || reread.servingAuthoritySha256 !== claim.servingAuthoritySha256) {
    return refusal(SERVING_LAUNCH_REFUSAL.CHANGED);
  }
  return Object.freeze({
    ok: true,
    authority: projected,
    authoritySha256: claim.servingAuthoritySha256,
  });
};
