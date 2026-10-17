/**
 * Provider probe — the live […] check.
 *
 * Extracted from routing-routes.js so every surface that verifies a provider
 * route (the routing settings, the witnesses management API) travels the SAME
 * real code path — one probe, one SSRF guard, one honest verdict.
 *
 * A raw key passes through here server-side only, straight into the provider
 * request; nothing in this module returns it.
 */
import { getProvider } from './provider-registry.js';
import { assertSafeEndpoint } from './endpoint-guard.js';
import { openAIChatGPTClientVersion, openAIChatGPTHeaders } from './openai-chatgpt-wire.js';
import { refreshOpenAIClientVersion } from './openai-client-version.js';
import { lmStudioCatalog } from './local-server-models.js';

// Curated fallbacks — documented defaults shown when a provider's live /models
// list is unavailable (no key yet, offline, or the provider lists nothing). The
// override endpoint accepts any model string, so this is a convenience, not a limit.
export const CURATED = Object.freeze({
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  anthropic: ['claude-opus-4-6', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'],
  xai: ['grok-3', 'grok-3-mini'],
  'z-ai': [
    'glm-5.2', 'glm-5v-turbo', 'glm-5', 'glm-5.1',
    'glm-4.7', 'glm-4.7-flash', 'glm-4.7-flashx', 'glm-4.6', 'glm-4.6v',
    'glm-4.5', 'glm-4.5-air', 'glm-4.5-flash', 'glm-4.5v',
  ],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  groq: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
});

const asModelList = (ids) => ids.map((id) => ({ id, name: id }));
const MODEL_LIST_TIMEOUT_MS = 5000;

// pure - combine every trustworthy discovery source without hiding catalog
// breadth when a provider's live endpoint returns only a partial list.
/**
 * Merge provider model discovery sources in confidence order.
 * @param {object} entry Provider registry entry.
 * @param {Array<{id: string, name?: string}>} live Models returned by the provider.
 * @returns {Array<{id: string, name: string}>} Deduplicated model suggestions.
 */
export const modelSuggestionsFor = (entry, live = []) => {
  const merged = new Map();
  const add = (model) => {
    const id = model?.id || model?.name;
    if (!id) return;
    const name = model?.name || id;
    const existing = merged.get(id);
    if (!existing || (existing.name === id && name !== id)) merged.set(id, { id, name });
  };
  live.forEach(add);
  (entry?.models || []).forEach(add);
  asModelList(CURATED[entry?.id] || []).forEach(add);
  if (entry?.defaultModel) add({ id: entry.defaultModel, name: entry.defaultModel });
  return [...merged.values()];
};

// impure — query a provider's live model list, falling back to curated ids.
// The models path is derived from the provider's chatPath so a non-/v1 provider
// (z.ai at /v4, groq at /openai/v1) still resolves correctly.
export const liveModels = async (entry, endpoint, apiKey, { accountId = null } = {}) => {
  const curated = asModelList(CURATED[entry.id] || []);
  if (!endpoint) return curated;
  const base = endpoint.replace(/\/$/, '');
  try {
    if (entry.dialect === 'ollama') {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS) });
      if (!res.ok) return curated;
      const data = await res.json();
      const models = (data.models || []).map((m) => ({ id: m.name, name: m.name, _live: true }));
      return models.length ? models : curated;
    }
    // LM Studio's /v1/models lists LOADED models only — its own REST list
    // names every downloaded one, and it loads a model on first use.
    if (entry.id === 'lm-studio') {
      const catalog = await lmStudioCatalog(base);
      if (catalog) return catalog.map(({ id, name }) => ({ id, name, _live: true }));
    }
    if (entry.dialect === 'openai-responses') {
      if (!apiKey || !accountId) return curated;
      await refreshOpenAIClientVersion();
      const version = openAIChatGPTClientVersion();
      const res = await fetch(`${base}/models?client_version=${encodeURIComponent(version)}`, {
        headers: openAIChatGPTHeaders(apiKey, accountId),
        signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
      });
      if (!res.ok) return curated;
      const data = await res.json();
      const models = (data.models || []).filter((model) => model.visibility !== 'hide').map((model) => ({
        id: model.slug,
        name: model.display_name || model.slug,
        ...(Number.isFinite(model.context_window)
          ? { contextWindow: model.context_window }
          : Number.isFinite(model.max_context_window)
            ? { contextWindow: model.max_context_window }
            : {}),
        _live: true,
      })).filter((model) => model.id);
      return models.length ? models : curated;
    }
    const modelsPath = entry.chatPath.includes('/chat/completions')
      ? entry.chatPath.replace('/chat/completions', '/models')
      : entry.chatPath.endsWith('/messages')
        // Anthropic-dialect entries: /messages → /models against the same base.
        // kimi-for-coding keeps its catalog at /coding/v1, so the /v1/models
        // fallback double-appends (/coding/v1/v1/models → 404) and the provider
        // could never probe live — which made it unconnectable and unsummonable.
        ? entry.chatPath.replace(/\/messages$/, '/models')
        : '/v1/models';
    const headers = apiKey
      ? (entry.dialect === 'anthropic'
        ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
        : { Authorization: `Bearer ${apiKey}` })
      : {};
    const res = await fetch(`${base}${modelsPath}`, {
      headers,
      signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
    });
    if (!res.ok) return curated;
    const data = await res.json();
    const models = (data.data || data.models || []).map((m) => ({
      id: m.id || m.name,
      name: m.id || m.name,
      ...(Number.isFinite(m.context_window)
        ? { contextWindow: m.context_window }
        : Number.isFinite(m.context_length)
          ? { contextWindow: m.context_length }
          : {}),
      _live: true,
    }));
    return models.length ? models : curated;
  } catch {
    return curated;
  }
};

/**
 * impure — SSRF-guard then probe a provider route. The verdict is honest:
 * `live: true` only when the provider answered with a real model list; a
 * curated fallback is reported as `live: false` so a unreachable provider is
 * never dressed up as connected.
 * @param {string} providerId
 * @param {{endpoint: (string|null), apiKey?: string}} route
 * @returns {Promise<{ok: boolean, live: boolean, models: Array, error?: string}>}
 */
export const probeProvider = async (providerId, { endpoint, apiKey = '', accountId = null } = {}) => {
  const entry = getProvider(providerId);
  if (!entry) return { ok: false, live: false, models: [], error: `Unknown provider: ${providerId}` };
  if (!endpoint) return { ok: false, live: false, models: [], error: 'No endpoint to test' };
  const guard = await assertSafeEndpoint(endpoint);
  if (!guard.ok) return { ok: false, live: false, models: [], error: `Endpoint refused: ${guard.reason}` };
  const models = await liveModels(entry, endpoint, apiKey, { accountId });
  const live = models.some((model) => model._live === true);
  return {
    ok: true,
    live,
    models: models.map(({ _live, ...model }) => model),
  };
};
