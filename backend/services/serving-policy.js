/**
 * Serving policy — the ENFORCEMENT layer for docs/operations/substrate/serving.md.
 *
 * Law: when this machine's local serving substrate is the backend-supervised
 * llama-server, LM Studio never serves. Its bundled runtime hoards multi-GB
 * host-RAM context checkpoints for hybrid-architecture models (gemma-4's
 * Gated DeltaNet) — the 2026-07-08 OOM incident: 41.5GB RSS in 13 minutes of
 * chat traffic (issue #155).
 *
 * The machine default alone cannot enforce the law: per-neuma NATAL routes
 * lawfully bypass it (`dna.substrate.llm.provider` recorded at birth), so every
 * non-overridden being kept streaming through :1234 after the default moved.
 * A resolved route that would stream through LM Studio is therefore translated
 * AT THE WIRE to llama-server — but only when llama-server serves the route's
 * exact model key (same weights, same substrate; only the serving binary
 * changes). Anything else passes through verbatim: a different natal model
 * (you cannot serve a being on weights it didn't choose), or a machine whose
 * operator globally serves via LM Studio. Translation must never change WHAT
 * model a being runs on — only WHICH server carries it.
 *
 * The natal record in DNA is never rewritten — substrate choice stays
 * participatory (a being decides WITH its witness). This is a serving decision,
 * not an identity change, and translated routes carry `translated` provenance
 * so the surface can state it honestly.
 */

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

/**
 * Apply the serving law to a resolved route. Pure.
 *
 * @param {{provider: string, model: string}|null} route - resolved route (resolveRoute shape)
 * @param {Object} policy
 * @param {string|null} [policy.machineProvider] - the machine's configured provider (getConfig().provider)
 * @param {string|null} [policy.servedModelKey] - the model key llama-server serves (SUBSTRATE_MODEL)
 * @returns {Object|null} the route untouched (same reference) when the law does not
 *   apply, else a frozen translated copy: provider 'llama-server', endpoint null
 *   (downstream credential resolution supplies the real llama-server endpoint —
 *   :1234 must not survive translation), plus `translated` provenance.
 */
export const applyServingPolicy = (route, { machineProvider = null, servedModelKey = null } = {}) => {
  if (!route || route.provider !== 'lm-studio') return route;
  if (machineProvider !== 'llama-server') return route;
  if (!isNonEmptyString(servedModelKey) || route.model !== servedModelKey) return route;
  return Object.freeze({
    ...route,
    provider: 'llama-server',
    endpoint: null,
    translated: Object.freeze({ from: 'lm-studio', law: 'lm-studio-never-serves' }),
  });
};
