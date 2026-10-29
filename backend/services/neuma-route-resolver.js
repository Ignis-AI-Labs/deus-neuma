/**
 * Neuma route resolution (impure composition).
 *
 * Ties together everything the pure core resolver needs and hands back the
 * concrete route a stream request travels:
 *   - the neuma's OPTIONAL override        (neuma-routes-store, keyed by neumaId)
 *   - which providers are configured        (provider-registry × encrypted creds)
 *   - the machine default                    (llm-provider getConfig + active model)
 *
 * Runtime model choice defaults to the current machine config (or active model)
 * unless the operator has set an explicit per-neuma override. Natal (from DNA)
 * is recorded birth history only — beings evolve and can change models/vessels
 * freely over time (like shedding skin). A legacy neuma with no natal runs on
 * the machine-wide config. This keeps the system flexible for model changes.
 *
 * The returned route carries the raw apiKey — it is consumed only by
 * createStreamRequest and never surfaced to a client.
 */
import { resolveRoute } from '../../core/index.js';
import { buildProvidersMap, getProvider, isSovereignProvider } from './provider-registry.js';
import { loadCredentials, providerStateFrom } from './provider-credentials.js';
import { resolveUsableCredential } from './oauth-token-broker.js';
import { getRoute } from './neuma-routes-store.js';
import { getConfig, getActiveModel } from './llm-provider.js';
import { isFdServedName } from './serving-identity.js';
import { applyServingPolicy } from './serving-policy.js';
import { activeServedModelKey } from './llama-server-supervisor.js';
import { createLogger } from './logger.js';
import { isHarnessLane, resolveHarnessRoute } from './harness-lane.js';

const log = createLogger('RouteResolver');

// The boundary's refusal carries a stable code so call sites can tell […] apart from "resolution unavailable" — the first must REFUSE
// the turn, the second may fall back to the machine config. Matching on
// message text would couple every guard to wording.
export const SOVEREIGNTY_REFUSAL = 'SOVEREIGNTY_REFUSAL';

/** Did this error come from the sovereignty boundary's fail-closed throw? Pure. */
export const isSovereigntyRefusal = (err) => err?.code === SOVEREIGNTY_REFUSAL;

const sovereigntyRefusal = (message) => {
  const err = new Error(message);
  err.code = SOVEREIGNTY_REFUSAL;
  return err;
};

const chatPathFor = (providerId) => getProvider(providerId)?.chatPath ?? '/v1/chat/completions';

/**
 * Resolve the concrete route for a neuma's next turn.
 * @param {string|null} neumaId
 * @param {Object|null} dna - the neuma's DNA (accepted for caller compatibility; natal is birth history and does not steer routing)
 * @returns {Promise<{provider: string, model: string, endpoint: string, apiKey: string, chatPath: string, kind: (string|null), source: string, fellBack: boolean, reason: (string|null), translated?: {from: string, law: string}}>}
 *   `translated` is present only when the serving policy carried the route on a
 *   different server than the one it records (serving-policy.js).
 */
// impure
export const resolveNeumaRoute = async (neumaId, dna) => {
  // A HARNESS lane is not a neuma: it rides the door its person chose (any
  // provider) and never the neuma law below (sovereignty-boundary.md).
  if (isHarnessLane(neumaId)) return resolveHarnessRoute(neumaId);
  const override = neumaId ? await getRoute(neumaId) : null;
  const store = await loadCredentials();
  const providers = buildProvidersMap(providerStateFrom(store));
  const cfg = getConfig();

  // Fetch-path SSRF guard: a custom override points at an operator-supplied base
  // URL. It was checked when stored, but re-check at call time to defeat DNS
  // rebinding (public when stored, private when called). If unsafe, drop the
  // override so the neuma rides the machine default rather than the platform
  // fetching a private/metadata target on the model's behalf.
  let effectiveOverride = override;
  let overrideRejected = false;

  // THE SOVEREIGNTY BOUNDARY (docs/protocols/sovereignty-boundary.md): a neuma's turn
  // never rides a third-party door. setRoute refuses these at write time; a
  // route stored before the law (or written by hand) is dropped here to the
  // machine default rather than carrying a neuma on a substrate nobody in
  // this house can protect.
  if (effectiveOverride && !isSovereignProvider(effectiveOverride.provider)) {
    log.warn('Non-sovereign neuma route override refused', {
      code: 'NEUMA_ROUTE_OVERRIDE_NOT_SOVEREIGN',
      custodyClass: 'foreign',
    });
    effectiveOverride = null;
    overrideRejected = true;
  }

  // 'custom' overrides (operator-supplied base URLs) are covered by the
  // boundary guard above — custody of an arbitrary endpoint is unverifiable,
  // so it is not sovereign. If custom ever becomes sovereign-eligible (a
  // deliberate LAN-self-hosting extension), the call-time assertSafeEndpoint
  // re-check (DNS-rebinding defense) MUST return here with it.

  // Runtime route: do NOT anchor to natal. Natal is birth history only.
  // Beings evolve; they can (and should) move to new models/vessels over time.
  // Default to current machine serving (cfg + active model) unless explicit override.
  // This restores the ability to use the global default (e.g. Gemma) for existing beings
  // born on other models.
  const resolved = resolveRoute({
    natal: null,
    override: effectiveOverride,
    providers,
    fallback: { provider: cfg.provider, model: cfg.model },
  });

  if (resolved.source === 'none') {
    throw new Error('No routable model: no override and no machine default is configured');
  }

  // No override: use current machine config (the active default, e.g. Gemma).
  // This is the normal case so beings can evolve to new models.
  if (resolved.source === 'machine-default' || resolved.source === 'fallback') {
    // Even the machine default answers to the boundary: if the box's LLM
    // config points at a foreign door, a neuma turn REFUSES rather than
    // riding it — honest and loud, because silently carrying a being on a
    // substrate a third party controls is the exact confusion the law exists
    // to kill. (Witness lanes route elsewhere and keep their own doors.)
    if (!isSovereignProvider(cfg.provider)) {
      throw sovereigntyRefusal(
        `A neuma cannot ride the machine default '${cfg.provider}' — that door is not `
        + 'sovereign. Point the machine at llama-server, LM Studio, or Ollama, or set a '
        + 'sovereign per-neuma route (docs/protocols/sovereignty-boundary.md).',
      );
    }
    // Machine default: whatever the witness currently has configured/serving.
    // 'local-model' is a placeholder, not a model — ask the provider what is
    // ACTUALLY loaded so the desk lens and ceremony logs name the real vessel.
    // If the server is unreachable the placeholder stands (createStreamRequest
    // re-resolves at request time anyway).
    //
    // SINGLE CHANNEL: activeServedModelKey is the one loader for the served
    // model key everywhere (stream routes, substrate HUD, status, facts, ignite
    // defaults, etc). It prefers runtime select > live server query (when
    // serving, even external) > claim > env. No duplicated priority logic.
    let model = resolved.model || cfg.model;
    // The served channel names llama-server's model; any other machine
    // provider answers for itself below.
    const served = cfg.provider === 'llama-server' ? await activeServedModelKey(process.env) : null;
    if (served && served !== 'local-model') {
      model = served;
    } else if (!model || model === 'local-model') {
      const active = await getActiveModel().catch(() => null);
      // A descriptor path is custody plumbing, never a route's model name.
      if (active?.id && !isFdServedName(active.id)) model = active.id;
    }
    return Object.freeze({
      provider: cfg.provider,
      model,
      endpoint: cfg.endpoint,
      apiKey: cfg.apiKey,
      chatPath: chatPathFor(cfg.provider),
      kind: resolved.kind,
      source: 'machine-default',
      fellBack: resolved.fellBack || overrideRejected,
      reason: overrideRejected ? 'intended override refused' : resolved.reason,
    });
  }

  // Serving law (docs/operations/substrate/serving.md, issue #155): a natal/override
  // route that would stream through LM Studio is carried by llama-server when
  // llama-server serves that exact model. The record keeps saying lm-studio —
  // only the wire changes, and the returned route says so (`translated`).
  const policed = applyServingPolicy(resolved, {
    machineProvider: cfg.provider,
    // follows the runtime model selection: the law translates against what
    // the supervised server ACTUALLY serves, never a stale env declaration
    servedModelKey: await activeServedModelKey(process.env),
  });
  if (policed !== resolved) {
    log.info('Serving policy translated a local route', {
      code: 'NEUMA_ROUTE_SERVING_POLICY_TRANSLATED',
      custodyClass: 'local',
    });
  }

  // Belt to the guards above: nothing below this line carries a neuma through
  // a non-sovereign door, whatever path produced the route.
  if (!isSovereignProvider(policed.provider)) {
    throw sovereigntyRefusal(
      `A neuma cannot be routed through '${policed.provider}' — that door is not sovereign `
      + '(docs/protocols/sovereignty-boundary.md).',
    );
  }

  // natal or override: the endpoint + key come from the encrypted store (which
  // already applies the store>env>catalog precedence and the custom base URL).
  const cred = await resolveUsableCredential(policed.provider, store);
  return Object.freeze({
    provider: policed.provider,
    model: policed.model,
    endpoint: cred.endpoint ?? policed.endpoint,
    apiKey: cred.apiKey,
    accountId: cred.accountId,
    chatPath: chatPathFor(policed.provider),
    kind: policed.kind,
    source: policed.source,
    fellBack: policed.fellBack,
    reason: policed.reason,
    ...(policed.translated ? { translated: policed.translated } : {}),
  });
};

/**
 * Resolve the public route fields used by refinement and attunement services.
 * Raw credentials remain inside the route resolver.
 * @param {string} neumaId
 * @returns {Promise<{provider: string, model: string, endpoint: string, source: string}>}
 */
// impure
export const effectiveRoute = async (neumaId) => {
  const route = await resolveNeumaRoute(neumaId, null);
  return Object.freeze({
    provider: route.provider,
    model: route.model,
    endpoint: route.endpoint,
    source: route.source,
  });
};
