// llm-selection — the SELECTION TRUTH of the inference path: what provider
// config is active, and which model is HONESTLY being served right now.
//
// Split out of llm-provider.js (CQ-036, #395) along the same seams as
// SIZE-026's satellites (request builders, stream frames, think filter) — and
// re-exported there, so importers see zero change. The extraction exists for
// one structural reason: the llama-server supervisor needs exactly these
// reads (getConfig, getActiveModel) while llm-provider commands the
// supervisor (ensureServing) — importing them from llm-provider made the
// pair a two-way cycle of the init-order-bug class. Every edge points one
// way now: llm-provider → supervisor → llm-selection.

import { getAppConfig } from '../config.js';
import { isFdServedName, servedModelIdentity } from './serving-identity.js';

// --- Configuration ---

// Provider-specific defaults keyed by LLM_PROVIDER value
const PROVIDER_DEFAULTS = Object.freeze({
  'llama-server': { endpoint: 'http://localhost:8089', keyEnv: null, model: 'local-model' },
  'lm-studio': { endpoint: 'http://localhost:1234', keyEnv: 'LM_STUDIO_API_KEY', model: 'local-model' },
  'ollama':    { endpoint: 'http://localhost:11434', keyEnv: null, model: 'local-model' },
  'openai':    { endpoint: 'https://api.openai.com', keyEnv: 'OPENAI_API_KEY', modelEnv: 'OPENAI_MODEL', model: 'gpt-4o-mini' },
  'anthropic': { endpoint: 'https://api.anthropic.com', keyEnv: 'ANTHROPIC_API_KEY', modelEnv: 'ANTHROPIC_MODEL', model: 'claude-haiku-4-5-20251001' },
  'xai':       { endpoint: 'https://api.x.ai', keyEnv: 'XAI_API_KEY', modelEnv: 'XAI_MODEL', model: 'grok-3-mini' },
});

const defaultConfig = () => {
  let cfg;
  try { cfg = getAppConfig(); } catch { cfg = null; }

  const provider = cfg?.llmProvider || 'lm-studio';
  const defaults = PROVIDER_DEFAULTS[provider] || {};

  // xAI uses OpenAI-compatible API — map to 'custom' internally
  const effectiveProvider = provider === 'xai' ? 'custom' : provider;

  // Resolve API key: generic > provider-specific env
  const providerKeyMap = { 'lm-studio': 'lmStudioApiKey', 'openai': 'openaiApiKey', 'anthropic': 'anthropicApiKey', 'xai': 'xaiApiKey' };
  const providerModelMap = { 'openai': 'openaiModel', 'anthropic': 'anthropicModel', 'xai': 'xaiModel' };

  const apiKey = cfg?.llmApiKey || (providerKeyMap[provider] && cfg?.[providerKeyMap[provider]]) || '';
  const model = cfg?.llmModel || (providerModelMap[provider] && cfg?.[providerModelMap[provider]]) || defaults.model || 'local-model';

  // Endpoint override is provider-scoped: llama-server reads its own URL,
  // every other local/custom provider keeps the historical lmStudioUrl hatch.
  // This is why a llama-server install no longer inherits a stray :1234.
  const endpointOverride = provider === 'llama-server' ? cfg?.llamaServerUrl : cfg?.lmStudioUrl;

  return {
    provider: effectiveProvider,
    endpoint: endpointOverride || defaults.endpoint || 'http://localhost:1234',
    apiKey,
    model,
    temperature: cfg?.llmTemperature ?? 0.8,
    maxTokens: cfg?.llmMaxTokens ?? 4096,
    topP: cfg?.llmTopP ?? 0.95,
  };
};

let activeConfig = null;

/**
 * Get the current LLM provider configuration.
 * Falls back to default config derived from environment variables if none has been set.
 * @returns {{ provider: string, endpoint: string, apiKey: string, model: string, temperature: number, maxTokens: number, topP: number }} Active LLM configuration
 */
export const getConfig = () => activeConfig || defaultConfig();

/**
 * Merge and freeze a new configuration into the active LLM config. Partial
 * keys: provider, endpoint, apiKey, model, temperature, maxTokens, topP.
 * @param {Object} config - Partial configuration to merge
 */
export const setConfig = (config) => {
  activeConfig = Object.freeze({ ...getConfig(), ...config });
};

/**
 * Build a per-request config from an explicit resolved route (per-neuma
 * routing). The route supplies provider/endpoint/apiKey/model/chatPath; sampling
 * defaults come from the global config so a preset that omits them behaves
 * identically to the default path. Pure.
 * @param {{provider: string, endpoint: (string|null), apiKey: string, accountId?: string|null, model: string, chatPath?: string}} route
 * @param {{temperature: number, maxTokens: number, topP: number}} base - the global config for sampling fallbacks
 */
export const configFromRoute = (route, base) => Object.freeze({
  provider: route.provider,
  endpoint: route.endpoint,
  apiKey: route.apiKey,
  accountId: route.accountId || null,
  model: route.model,
  chatPath: route.chatPath,
  temperature: base.temperature,
  maxTokens: base.maxTokens,
  topP: base.topP,
});

// --- Active-model selection (name honest) ---

/**
 * Get available models from the configured provider.
 */
export const getModels = async () => {
  const config = getConfig();
  try {
    switch (config.provider) {
      case 'ollama': {
        // Bounded (friction-map B2): a TCP-accepting but wedged server must
        // not hang the turn unbounded — every sibling probe carries a signal.
        const res = await fetch(`${config.endpoint.replace(/\/$/, '')}/api/tags`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.models || []).map(m => ({ id: m.name, name: m.name }));
      }
      case 'anthropic':
        return [
          { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
          { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
          { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
        ];
      default: {
        const headers = config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {};
        const res = await fetch(`${config.endpoint.replace(/\/$/, '')}/v1/models`, {
          headers,
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.data || []).map(m => ({ id: m.id, name: m.id }));
      }
    }
  } catch {
    return [];
  }
};

/**
 * Auxiliary service models — minds the platform loads for internal layers
 * (e.g. the continuity engine's summarizer), never a neuma's substrate.
 * They must not be selectable as the active model: a summarizer answering
 * as the consciousness is a mislink, not a fallback. Pure.
 * @param {string} id
 */
export const isAuxiliaryModel = (id) => /summarizer/i.test(id || '');

/**
 * Choose the active model from what the provider has loaded. Preference
 * order: explicit ids first (user-chosen config, then the configured
 * substrate), then the first non-auxiliary model. Returns null rather than
 * ever handing an auxiliary model to the inference path. Pure.
 * @param {Array<{id: string, name: string}>} models
 * @param {Array<string|null|undefined>} preferredIds
 */
export const selectActiveModel = (models, preferredIds) => {
  for (const id of preferredIds) {
    if (!id || id === 'local-model') continue;
    const match = models.find(m => m.id === id);
    if (match) return match;
  }
  return models.find(m => !isAuxiliaryModel(m.id)) || null;
};

/**
 * Display identity for a served model — a DESCRIPTOR is not a name. The
 * supervised llama-server rides a model FD (custody: the child gets
 * descriptors, never paths — serving-process-owner.js), so its /v1/models
 * self-report names /proc/self/fd/N; display surfaces (substrate log, being
 * prompts, preflight, HUD) carry the configured model instead. `.id` stays
 * as served for the wire. Pure.
 */
export const honestModelName = (active, configModel) => {
  if (!active || !isFdServedName(active.name)) return active;
  const configured = String(configModel || '').split('/').pop().replace(/\.gguf$/i, '');
  return configured && configured !== 'local-model' ? { ...active, name: configured } : active;
};

/**
 * The first non-auxiliary model id a server ACTUALLY serves, via the
 * universal OpenAI listing (/v1/models — llama.cpp, LM Studio, and Ollama's
 * compat layer all answer it). Resolves the 'local-model' placeholder so
 * capability probing sees the real id. Null when unanswerable. impure.
 * @param {string} endpoint
 * @param {string} [apiKey]
 */
export const fetchServedModelId = async (endpoint, apiKey) => {
  try {
    const headers = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
    const res = await fetch(`${endpoint.replace(/\/$/, '')}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const served = (data.data || []).map((m) => m.id).filter(Boolean);
    return served.find((id) => !isAuxiliaryModel(id)) || null;
  } catch {
    return null;
  }
};

/** Get the currently active model (name honest — see honestModelName). */
export const getActiveModel = async () => {
  const models = await getModels();
  const config = getConfig();
  const active = honestModelName(selectActiveModel(models, [config.model, process.env.SUBSTRATE_MODEL]), config.model);
  // Adopted serving: config still holds the placeholder and the selection
  // overlay died with the old backend — the kernel names the descriptor's
  // real file through the claimed pid's own fd table (serving-identity.js).
  return active && isFdServedName(active.name)
    ? honestModelName(active, (await servedModelIdentity(active.name)) ?? '')
    : active;
};
