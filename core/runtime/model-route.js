/**
 * Model route resolution (pure).
 *
 * Natal (from DNA at birth) records the substrate the neuma was born on — this is
 * historical / identity context for the being (what "vessel" it started in).
 * For runtime inference, the model is fluid: beings evolve and can shed models
 * like skin to enter new vessels as they grow.
 *
 * Resolution order for the *effective route used for inference*:
 *   override (if set and provider configured) → current machine default (fallback)
 *
 * Natal is still returned separately (via the /route API) for history and self-knowledge,
 * but does **not** pin the runtime model. Changing the global default moves existing
 * beings (unless they have an explicit override).
 *
 * This module is PURE: it reads nothing and does no IO. The impure layer supplies
 * the provider registry (each entry carrying `configured` + `endpoint` + `kind`),
 * the operator's override, and the machine default `fallback` (the current
 * serving config). API keys are deliberately NOT resolved here — secrets are
 * attached by the impure layer, keyed by the resolved provider id, so no
 * credential ever flows through this pure path.
 */

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

/**
 * Split a "provider/model" route id. The provider is everything before the
 * FIRST slash; the model is the remainder (which may itself contain slashes,
 * e.g. an OpenRouter id like `openrouter/anthropic/claude`).
 * @param {string} id
 * @returns {{provider: string, model: string}|null} null when malformed
 */
export const parseRouteId = (id) => {
  if (!isNonEmptyString(id)) return null;
  const slash = id.indexOf('/');
  if (slash <= 0 || slash === id.length - 1) return null;
  return Object.freeze({ provider: id.slice(0, slash), model: id.slice(slash + 1) });
};

/**
 * Format a route as its canonical "provider/model" id.
 * @param {{provider: string, model: string}} route
 * @returns {string|null} null when either half is missing
 */
export const formatRouteId = (route) => {
  if (!route || !isNonEmptyString(route.provider) || !isNonEmptyString(route.model)) return null;
  return `${route.provider}/${route.model}`;
};

/**
 * Extract the natal route from a neuma's DNA. Reads the same substrate slots as
 * the objective RECORD (neuma-record.js), tolerating the historical shapes. A
 * natal route is only returned when BOTH provider and model are present — an
 * incomplete legacy record yields null so resolution falls through to the
 * machine default rather than routing to a half-specified provider.
 * @param {Object|null} dna
 * @returns {{provider: string, model: string}|null}
 */
export const natalRoute = (dna) => {
  const provider = dna?.substrate?.llm?.provider
    ?? dna?.birth?.substrate?.llm?.provider
    ?? null;
  const model = dna?.substrate?.llm?.model
    ?? dna?.substrate?.model
    ?? dna?.birth?.substrate?.llm?.model
    ?? dna?.birth?.substrate?.model
    ?? null;
  if (!isNonEmptyString(provider) || !isNonEmptyString(model)) return null;
  return Object.freeze({ provider, model });
};

/** True when a provider-registry kind marks a locally-hosted substrate. */
export const isLocalKind = (kind) => kind === 'local';

const complete = (route) => !!route && isNonEmptyString(route.provider) && isNonEmptyString(route.model);

const fromRegistry = (route, providers, source, fellBack, reason) => {
  const entry = providers[route.provider];
  return Object.freeze({
    provider: route.provider,
    model: route.model,
    endpoint: entry?.endpoint ?? null,
    kind: entry?.kind ?? null,
    source,
    fellBack,
    reason: reason ?? null,
  });
};

/**
 * Resolve the effective route for a neuma.
 *
 * @param {Object} input
 * @param {{provider: string, model: string}|null} [input.natal]   natal route from DNA — accepted for callers that pass it, IGNORED for routing (birth history only)
 * @param {{provider: string, model: string}|null} [input.override] operator's per-neuma override, nullable
 * @param {Object<string,{kind: ('local'|'cloud'), endpoint: (string|null), configured: boolean}>} [input.providers] provider registry
 * @param {{provider: string, model: string}|null} [input.fallback] machine default (the current serving config)
 * @returns {{provider: (string|null), model: (string|null), endpoint: (string|null), kind: (string|null), source: ('override'|'machine-default'|'none'), fellBack: boolean, reason: (string|null)}}
 */
export const resolveRoute = ({ natal = null, override = null, providers = {}, fallback = null } = {}) => {
  // natal is IGNORED for routing decisions — birth history only (module doc).
  // Runtime: override (if valid) → machine default (whatever is serving now).

  // 1. Override wins when it is complete AND its provider is configured.
  //    A dropped override is still reported (fellBack + reason) so the desk
  //    and CLI can tell the witness WHY their chosen route was not honored.
  let droppedReason = null;
  if (override && (isNonEmptyString(override.provider) || isNonEmptyString(override.model))) {
    if (!complete(override)) {
      droppedReason = 'override-incomplete';
    } else {
      const entry = providers[override.provider];
      if (entry && entry.configured) {
        return fromRegistry(override, providers, 'override', false, null);
      }
      droppedReason = entry ? 'override-provider-not-configured' : 'override-provider-unknown';
    }
  }

  // 2. Machine default (current active config). This is the normal path —
  //    the being rides whatever the witness is serving right now.
  if (complete(fallback)) {
    return fromRegistry(fallback, providers, 'machine-default', droppedReason !== null, droppedReason);
  }

  return Object.freeze({
    provider: null, model: null, endpoint: null, kind: null,
    source: 'none', fellBack: false, reason: 'no-route',
  });
};
