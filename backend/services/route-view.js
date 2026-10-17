/**
 * The safe, complete view of a resolved route — one derivation, every reader.
 *
 * A resolved route is the RESOLVER's output, and the two resolvers do not carry
 * the same fields: the witness resolver stamps `configured`, the neuma resolver
 * does not, and neither stamps `sovereign` (custody lives in the provider
 * catalog, not in a route). A reader that trusts those raw fields therefore says
 * different things about the same being depending on which door it came through.
 *
 * That is not hypothetical. On 2026-07-30 the flight check read them raw and
 * told every neuma on the machine's own llama-server that its substrate was
 * […] and its weights were in "third-party
 * custody" — while the model bar, deriving the same two facts from the catalog,
 * showed the route live and sovereign. Two answers, one truth, and the wrong one
 * was the one a being would have handed its operator.
 *
 * So the derivation lives here and both read it:
 *   • CUSTODY is the provider catalog's `sovereign` axis, never the transport —
 *     a loopback bridge to a vendor model is local transport, foreign custody
 *     (docs/protocols/sovereignty-boundary.md).
 *   • CONFIGURED is `!== false`: a resolver that never spoke has said nothing
 *     against the route, and a route that resolved at all is usable until some
 *     resolver states otherwise. Absence must not read as refusal.
 *   • The apiKey never survives the crossing.
 */
import { getProvider } from './provider-registry.js';

/**
 * The safe half of a route, plus the wire dialect its provider speaks and the
 * custody its weights sit under. Pure.
 * @param {{provider?: string, model?: string, endpoint?: string, kind?: string, source?: string, configured?: boolean, reason?: string}} route
 * @returns {{provider: string, model: string, endpoint: string|null, kind: string|null, dialect: string|null, sovereign: boolean, source: string, configured: boolean, reason: string|null}}
 */
export const maskRoute = (route) => Object.freeze({
  provider: route.provider,
  model: route.model,
  // The endpoint is not a secret (Settings shows it) and it is load-bearing:
  // a 'custom' provider on loopback IS a local engine for effort purposes.
  endpoint: route.endpoint ?? null,
  kind: route.kind ?? getProvider(route.provider)?.kind ?? null,
  dialect: getProvider(route.provider)?.dialect ?? null,
  sovereign: getProvider(route.provider)?.sovereign === true,
  source: route.source,
  configured: route.configured !== false,
  // Why a route is unusable, when a resolver said so — a refusal with no reason
  // reads as a broken platform rather than a route the operator can fix.
  reason: route.reason ?? null,
});
