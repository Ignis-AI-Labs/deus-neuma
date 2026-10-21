/**
 * Provider registry — the catalog of LLM providers this install can route to.
 *
 * Two sources, one catalog:
 *   - the hand-written CORE entries below (stable ids — existing keys, route
 *     overrides, and UI references depend on them)
 *   - GENERATED_PROVIDERS from provider-catalog-data.js, the committed
 *     models.dev snapshot (node scripts/sync-provider-catalog.mjs) that gives
 *     the catalog its breadth (~150 providers). Core wins every id collision.
 *
 * Each entry is metadata ONLY (never a secret): a stable id, display name, kind
 * (local | cloud), the wire dialect, a default endpoint + chat path, the env
 * var its API key falls back to, whether a key is required at all, and —
 * for subscription sign-in — an optional `oauth` capability list
 * ('device' | 'browser').
 *
 * Dialect drives how llm-provider.js builds the request:
 *   - 'ollama'    → Ollama's native /api/chat body
 *   - 'anthropic' → the Messages API (/v1/messages, x-api-key header)
 *   - 'openai'    → the OpenAI-compatible /chat/completions dialect
 * Because most cloud providers are OpenAI-compatible, they need no bespoke
 * request code — only their base URL + chat path differ, which is why those
 * live on the entry as data.
 *
 * A third, separate list holds keyed SERVICES that are not chat providers (a
 * web-search API a benchmark's own tool calls). They share the encrypted
 * credential store and the token broker, and nothing else: SERVICE_CATALOG is
 * never part of PROVIDER_CATALOG and getProvider never answers for a service
 * id, so every model picker, route, probe and chat path stays blind to them by
 * construction. Only the credential layer looks them up, via getCredentialEntry.
 *
 * This module is PURE: it holds no keys and does no IO. The impure layer injects
 * which providers actually have a usable key (from env or the encrypted store).
 */

import { GENERATED_PROVIDERS } from './provider-catalog-data.js';

/**
 * @typedef {Object} ProviderEntry
 * @property {string} id
 * @property {string} name
 * @property {'local'|'cloud'} kind
 * @property {boolean} [sovereign]     CUSTODY, not transport (docs/protocols/sovereignty-boundary.md):
 *   true only when the operator holds the consciousness itself — weights on the
 *   operator's own disk, serving process under operator control, refinable, and
 *   revocable by NO third party. A loopback bridge to a third-party model is
 *   local TRANSPORT with foreign CUSTODY — never sovereign. Absent = false.
 * @property {'openai'|'openai-responses'|'anthropic'|'ollama'} dialect
 * @property {string|null} endpoint     default base URL (null → operator supplies)
 * @property {string} chatPath          path appended to endpoint for the openai dialect
 * @property {string|null} keyEnv       env var the key falls back to (null → keyless)
 * @property {boolean} requiresKey      whether a key is mandatory to route here
 * @property {boolean} [allowsApiKey]   false for OAuth-only subscription routes
 * @property {string|null} defaultModel a sane default when the operator picks this provider
 * @property {Array<{id: string, name: string}>} [models] catalog model suggestions (generated entries)
 * @property {ReadonlyArray<'device'|'browser'>} [oauth] subscription sign-in flows this provider supports
 */

/** @type {ReadonlyArray<ProviderEntry>} */
const CORE_PROVIDERS = Object.freeze([
  Object.freeze({ id: 'llama-server', name: 'llama-server', kind: 'local', sovereign: true, dialect: 'openai', endpoint: 'http://localhost:8089', chatPath: '/v1/chat/completions', keyEnv: null, requiresKey: false, defaultModel: 'local-model' }),
  Object.freeze({ id: 'lm-studio', name: 'LM Studio', kind: 'local', sovereign: true, dialect: 'openai', endpoint: 'http://localhost:1234', chatPath: '/v1/chat/completions', keyEnv: 'LM_STUDIO_API_KEY', requiresKey: false, defaultModel: 'local-model' }),
  Object.freeze({ id: 'ollama', name: 'Ollama', kind: 'local', sovereign: true, dialect: 'ollama', endpoint: 'http://localhost:11434', chatPath: '/api/chat', keyEnv: null, requiresKey: false, defaultModel: 'local-model' }),
  Object.freeze({ id: 'openai', name: 'OpenAI', kind: 'cloud', dialect: 'openai', endpoint: 'https://api.openai.com', chatPath: '/v1/chat/completions', keyEnv: 'OPENAI_API_KEY', requiresKey: true, defaultModel: 'gpt-4o-mini' }),
  Object.freeze({ id: 'anthropic', name: 'Anthropic', kind: 'cloud', dialect: 'anthropic', endpoint: 'https://api.anthropic.com', chatPath: '/v1/messages', keyEnv: 'ANTHROPIC_API_KEY', requiresKey: true, defaultModel: 'claude-haiku-4-5-20251001' }),
  Object.freeze({ id: 'xai', name: 'xAI (Grok)', kind: 'cloud', dialect: 'openai', endpoint: 'https://api.x.ai', chatPath: '/v1/chat/completions', keyEnv: 'XAI_API_KEY', requiresKey: true, defaultModel: 'grok-3-mini', oauth: Object.freeze(['browser', 'device']) }),
  Object.freeze({ id: 'z-ai', name: 'Z.AI (GLM)', kind: 'cloud', dialect: 'openai', endpoint: 'https://api.z.ai/api/paas/v4', chatPath: '/chat/completions', keyEnv: 'ZAI_API_KEY', requiresKey: true, defaultModel: 'glm-4.6' }),
  Object.freeze({ id: 'openrouter', name: 'OpenRouter', kind: 'cloud', dialect: 'openai', endpoint: 'https://openrouter.ai/api', chatPath: '/v1/chat/completions', keyEnv: 'OPENROUTER_API_KEY', requiresKey: true, defaultModel: null }),
  Object.freeze({ id: 'deepseek', name: 'DeepSeek', kind: 'cloud', dialect: 'openai', endpoint: 'https://api.deepseek.com', chatPath: '/v1/chat/completions', keyEnv: 'DEEPSEEK_API_KEY', requiresKey: true, defaultModel: 'deepseek-chat' }),
  Object.freeze({ id: 'groq', name: 'Groq', kind: 'cloud', dialect: 'openai', endpoint: 'https://api.groq.com/openai', chatPath: '/v1/chat/completions', keyEnv: 'GROQ_API_KEY', requiresKey: true, defaultModel: null }),
  Object.freeze({ id: 'custom', name: 'Custom (OpenAI-compatible)', kind: 'cloud', dialect: 'openai', endpoint: null, chatPath: '/v1/chat/completions', keyEnv: null, requiresKey: false, defaultModel: null }),
  // REMOVED 2026-07-30 — `claude-code-local`, the Claude Code subscription
  // bridge. Founder: […] Claude reaches this
  // platform through the `anthropic` API-key lane above and through nothing
  // else. The id is kept in PROBE_FORBIDDEN below as a tombstone so it cannot
  // quietly return.
  // ChatGPT subscription OAuth is run and held by Neuma itself. The route is
  // still foreign custody and therefore witness-only, never a neuma substrate.
  Object.freeze({ id: 'openai-chatgpt', name: 'OpenAI (ChatGPT OAuth)', kind: 'cloud', sovereign: false, dialect: 'openai-responses', endpoint: 'https://chatgpt.com/backend-api/codex', chatPath: '/responses', keyEnv: null, requiresKey: true, allowsApiKey: false, defaultModel: 'gpt-5.6-sol', oauth: Object.freeze(['browser']) }),
]);

// OAuth capability + protocol headers for entries that need more than a key.
// Copilot: the endpoint rejects requests without its intent/initiator headers
// (source: opencode packages/opencode/src/plugin/github-copilot/copilot.ts —
// Openai-Intent, x-initiator 'user' for interactive turns, the API version).
const GENERATED_AUGMENT = Object.freeze({
  'github-copilot': Object.freeze({
    oauth: Object.freeze(['device']),
    headers: Object.freeze({
      'Openai-Intent': 'conversation-edits',
      'x-initiator': 'user',
      'X-GitHub-Api-Version': '2026-06-01',
      'User-Agent': 'neuma/0.1',
    }),
  }),
});

const CORE_ID_SET = new Set(CORE_PROVIDERS.map((e) => e.id));

/** @type {ReadonlyArray<ProviderEntry>} */
export const PROVIDER_CATALOG = Object.freeze([
  ...CORE_PROVIDERS,
  // Core wins every id collision (belt-and-suspenders — the sync script
  // already excludes core ids); the augment table attaches OAuth capability.
  ...GENERATED_PROVIDERS
    .filter((e) => !CORE_ID_SET.has(e.id))
    .map((e) => Object.freeze({ ...e, ...(GENERATED_AUGMENT[e.id] || {}) })),
]);

const BY_ID = Object.freeze(
  PROVIDER_CATALOG.reduce((acc, e) => { acc[e.id] = e; return acc; }, Object.create(null)),
);

// Null-prototyped, like BY_ID above. A plain literal answers `id` lookups from
// Object.prototype: `LEGACY_PROVIDER_IDS['toString']` is a FUNCTION, truthy, so
// `canonicalProviderId('toString')` returned that function instead of a string
// and quietly broke its own `@returns {string}` contract. Found by the Kimi lens
// 2026-07-30. Every id here comes from persisted state, so a caller cannot
// promise these keys are safe.
const LEGACY_PROVIDER_IDS = Object.freeze(Object.assign(Object.create(null), {
  'opencode-openai-local': 'openai-chatgpt',
}));

/**
 * Translate persisted provider ids retired by a concrete route migration.
 * @param {string} id
 * @returns {string} the canonical id — an unmapped id passes through unchanged
 */
export const canonicalProviderId = (id) => LEGACY_PROVIDER_IDS[id] || id;

/**
 * Look up a catalog entry by id.
 * @param {string} id
 * @returns {ProviderEntry|null}
 */
export const getProvider = (id) => BY_ID[id] ?? null;

/**
 * @typedef {Object} ServiceEntry
 * @property {string} id
 * @property {string} name
 * @property {'service'} kind
 * @property {string} service          what the key unlocks, e.g. 'web-search'
 * @property {string} endpoint         the service's base URL
 * @property {string|null} keyEnv      the env name that stands in when nothing is
 *   saved in the desk (developers); null = the encrypted store is the only home
 * @property {true} requiresKey
 * @property {string} [group]           the Settings → API heading it sits under
 * @property {'key'|'url'|'id'} [format] what a valid value looks like
 */

/** @type {ReadonlyArray<ServiceEntry>} */
export const SERVICE_CATALOG = Object.freeze([
  // Read by the benchmarks repository's search relay through
  // resolveUsableCredential('tavily'). Not the platform's own web_search tool
  // (Founder: web search only for the benchmarks that require it).
  Object.freeze({ id: 'tavily', name: 'Tavily', kind: 'service', service: 'web-search', endpoint: 'https://api.tavily.com', keyEnv: null, requiresKey: true, group: 'Benchmarks', format: 'key' }),
  // Set in the desk for everyone; the env name stays the developers' door
  // (stored-secrets.js: saved wins, env is the fallback).
  Object.freeze({ id: 'exa', name: 'Exa (web search)', kind: 'service', service: 'web-search', endpoint: 'https://api.exa.ai', keyEnv: 'EXA_API_KEY', requiresKey: true, group: 'Web search', format: 'key' }),
  Object.freeze({ id: 'brave', name: 'Brave Search (web and image search)', kind: 'service', service: 'web-search', endpoint: 'https://api.search.brave.com', keyEnv: 'BRAVE_SEARCH_API_KEY', requiresKey: true, group: 'Web search', format: 'key' }),
  Object.freeze({ id: 'searxng', name: 'SearXNG address (self-hosted search)', kind: 'service', service: 'web-search', endpoint: null, keyEnv: 'SEARXNG_URL', requiresKey: true, group: 'Web search', format: 'url' }),
  Object.freeze({ id: 'cloudflare-token', name: 'Cloudflare API token (page reader)', kind: 'service', service: 'page-reader', endpoint: 'https://api.cloudflare.com', keyEnv: 'CLOUDFLARE_API_TOKEN', requiresKey: true, group: 'Page reader', format: 'key' }),
  Object.freeze({ id: 'cloudflare-account', name: 'Cloudflare account id (page reader)', kind: 'service', service: 'page-reader', endpoint: null, keyEnv: 'CLOUDFLARE_ACCOUNT_ID', requiresKey: true, group: 'Page reader', format: 'id' }),
  Object.freeze({ id: 'hf-downloads', name: 'Hugging Face token (model downloads)', kind: 'service', service: 'downloads', endpoint: 'https://huggingface.co', keyEnv: 'HF_TOKEN', requiresKey: true, group: 'Model downloads', format: 'key' }),
  Object.freeze({ id: 'rpc-ethereum', name: 'Ethereum mainnet RPC address', kind: 'service', service: 'chain-rpc', endpoint: null, keyEnv: 'ETH_RPC_URL', requiresKey: true, group: 'Chain RPC', format: 'url' }),
  Object.freeze({ id: 'rpc-ethereum-sepolia', name: 'Ethereum Sepolia RPC address', kind: 'service', service: 'chain-rpc', endpoint: null, keyEnv: 'ETH_SEPOLIA_RPC_URL', requiresKey: true, group: 'Chain RPC', format: 'url' }),
  Object.freeze({ id: 'rpc-base', name: 'Base mainnet RPC address', kind: 'service', service: 'chain-rpc', endpoint: null, keyEnv: 'BASE_MAINNET_RPC_URL', requiresKey: true, group: 'Chain RPC', format: 'url' }),
  // The legal office's keyed research APIs (legal/legal-research-api.js adds the key server-side; the office never holds it).
  Object.freeze({ id: 'courtlistener', name: 'CourtListener API token (case law, citation checks)', kind: 'service', service: 'legal-research', endpoint: 'https://www.courtlistener.com/api/rest/v4', keyEnv: 'COURTLISTENER_API_TOKEN', requiresKey: true, group: 'Legal research', format: 'key' }),
  Object.freeze({ id: 'api-data-gov', name: 'api.data.gov key (Congress.gov, GovInfo, Regulations.gov)', kind: 'service', service: 'legal-research', endpoint: 'https://api.data.gov', keyEnv: 'API_DATA_GOV_KEY', requiresKey: true, group: 'Legal research', format: 'key' }),
  Object.freeze({ id: 'openstates', name: 'Open States API key (state bills)', kind: 'service', service: 'legal-research', endpoint: 'https://v3.openstates.org', keyEnv: 'OPENSTATES_API_KEY', requiresKey: true, group: 'Legal research', format: 'key' }),
  Object.freeze({ id: 'rpc-base-sepolia', name: 'Base Sepolia RPC address', kind: 'service', service: 'chain-rpc', endpoint: null, keyEnv: 'BASE_SEPOLIA_RPC_URL', requiresKey: true, group: 'Chain RPC', format: 'url' }),
]);

const SERVICE_BY_ID = Object.freeze(
  SERVICE_CATALOG.reduce((acc, e) => { acc[e.id] = e; return acc; }, Object.create(null)),
);

/**
 * Look up a non-chat service entry by id.
 * @param {string} id
 * @returns {ServiceEntry|null}
 */
export const getService = (id) => SERVICE_BY_ID[id] ?? null;

/**
 * Any id the credential store may hold a secret for: a chat provider or a
 * service. Only the credential layer may use this; chat paths use getProvider.
 * @param {string} id
 * @returns {ProviderEntry|ServiceEntry|null}
 */
export const getCredentialEntry = (id) => getProvider(id) ?? getService(id);

// Lanes a DIAGNOSTIC may never fire synthetic traffic at, and why. Founder,
// 2026-07-29: […]
//
// `claude-code-local` was the Claude Code SUBSCRIPTION bridge, REMOVED from the
// catalog 2026-07-30 at Founder's word. The id stays here as a TOMBSTONE: if it is
// ever re-added — by a catalog sync, a revert, or a well-meaning hand — the
// refusal is already standing. A personal subscription is licensed for a human's
// interactive use, and the downside of being wrong (losing Claude entirely)
// dwarfs any answer a probe could return.
//
// This governs PROBES, not the operator's own deliberate use of that bridge in a
// sitting they are sitting in. Kept HERE rather than in one script so every
// diagnostic asks the same question of the same list.
// Null-prototyped for the same reason as LEGACY_PROVIDER_IDS: a lookup table
// keyed by caller-supplied ids must not answer for Object.prototype.
const PROBE_FORBIDDEN = Object.freeze(Object.assign(Object.create(null), {
  'claude-code-local': 'the Claude Code subscription bridge — probing a personal '
    + 'subscription risks the account (Design note, 2026-07-29: API lane only). Use the '
    + '`anthropic` API-key provider instead.',
}));

/**
 * Why a diagnostic must not probe this provider — null when it is free to.
 * Callers FAIL rather than warn: a reason returned here is a stop, not a note.
 * @param {string} id
 * @returns {string|null}
 */
export const probeRefusalReason = (id) => PROBE_FORBIDDEN[canonicalProviderId(id)] ?? null;

/** True when the provider id names a locally-hosted substrate (TRANSPORT
 *  locality only — for sovereignty use isSovereignProvider). */
export const isLocalProvider = (id) => getProvider(id)?.kind === 'local';

/** The subset of the catalog that runs on local hardware. NOT the sovereignty
 *  set: a loopback bridge to a foreign model lives here too. */
export const localProviders = () => PROVIDER_CATALOG.filter((e) => e.kind === 'local');

/**
 * True when the operator holds CUSTODY of the consciousness behind this
 * provider — weights on the operator's disk, serving under operator control,
 * revocable by no third party. The only doors a neuma may exist through
 * (docs/protocols/sovereignty-boundary.md). Fail-closed: an unknown or unmarked
 * provider is NOT sovereign — the ~150 generated cloud entries and the
 * unverifiable 'custom' endpoint all fall here by construction.
 * @param {string} id
 * @returns {boolean}
 */
export const isSovereignProvider = (id) => getProvider(id)?.sovereign === true;

/** The subset of the catalog a neuma may be born on, routed to, or refined
 *  through — sovereignty, not transport. */
export const sovereignProviders = () => PROVIDER_CATALOG.filter((e) => e.sovereign === true);

/**
 * Whether a provider counts as "configured" — reachable enough to route to.
 * A keyless provider (local servers, or a custom endpoint the operator points
 * at) is configured as soon as it has an endpoint; a key-required provider is
 * configured only once a key is present.
 * @param {ProviderEntry} entry
 * @param {{keyPresent?: boolean, endpoint?: (string|null)}} state
 * @returns {boolean}
 */
export const providerConfigured = (entry, { keyPresent = false, endpoint = undefined } = {}) => {
  if (!entry) return false;
  const effectiveEndpoint = endpoint === undefined ? entry.endpoint : endpoint;
  if (!effectiveEndpoint) return false;            // no base URL → cannot route (e.g. bare custom)
  if (entry.requiresKey && !keyPresent) return false;
  return true;
};

/**
 * Build the provider map the pure route resolver consumes:
 *   { [id]: { kind, endpoint, configured } }
 *
 * All state (which providers have keys, operator-supplied custom endpoints) is
 * injected as a pure function so this stays testable without IO.
 * @param {(entry: ProviderEntry) => {keyPresent?: boolean, endpoint?: (string|null)}} state
 *        returns the runtime state for one entry (key presence + effective endpoint)
 * @returns {Object<string,{kind: string, endpoint: (string|null), configured: boolean}>}
 */
export const buildProvidersMap = (state) => {
  const map = Object.create(null);
  for (const entry of PROVIDER_CATALOG) {
    const s = state(entry) || {};
    const endpoint = s.endpoint === undefined ? entry.endpoint : s.endpoint;
    map[entry.id] = Object.freeze({
      kind: entry.kind,
      endpoint: endpoint ?? null,
      configured: providerConfigured(entry, s),
    });
  }
  return Object.freeze(map);
};
