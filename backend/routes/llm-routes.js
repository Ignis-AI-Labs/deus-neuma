import { Router } from 'express';
import { LMStudioClient } from '../utils/lm-studio-client.mjs';
import {
  getConfig, setConfig, testConnection as providerTestConnection,
  isAuxiliaryModel, getActiveModelCapabilities, getRouteCapabilities
} from '../services/llm-provider.js';
import { resolveNeumaRoute } from '../services/neuma-route-resolver.js';
import { providerStatusSnapshot } from '../services/provider-status-snapshot.js';
import { saveProviderChoice } from '../services/provider-choice.js';
import { isWitnessLaneId } from '../services/witness-lane.js';
import { resolveWitnessRoute } from '../services/witness-route-resolver.js';
import { getSubstrateProfile } from '../services/substrate-detector.js';
import { isValidModelKey } from '../services/substrate-ignition.js';
import { activeLaunchConfig } from '../services/llama-server-supervisor.js';
import { ignitionStatus, igniteConfigured } from '../services/substrate-lifecycle.js';
import { deliberateStandby } from '../services/substrate-idle.js';
import { resolveAuthorizedIgnition } from '../services/model-folder-authority.js';
import { substrateModelView } from '../services/substrate-model-view.js';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { getAppConfig } from '../config.js';
import { getCapabilities } from '../services/model-capabilities.js';
import { assertSafeEndpoint } from '../services/endpoint-guard.js';
import { requireInstallOwner } from '../services/install-owner.js';
import { createLogger } from '../services/logger.js';
const log = createLogger('LLM');

const router = Router();
const lmStudioClient = new LMStudioClient();

// --- LM Studio configuration (auth required — exposes endpoint details) ---

router.get('/lm-studio/config', requireAuth, async (req, res) => {
  try {
    const activeModel = await lmStudioClient.getActiveModel();
    const isConnected = await lmStudioClient.testConnection();

    if (isConnected && activeModel) {
      const capabilities = lmStudioClient.getModelCapabilities(activeModel.id);
      res.json({
        endpoint: `${lmStudioClient.baseUrl}/v1/chat/completions`,
        model: activeModel.id,
        status: 'connected',
        contextLength: capabilities.contextLength || activeModel.context_length || 4096,
        temperature: getAppConfig().llmTemperature,
        maxTokens: getAppConfig().llmMaxTokens,
        topP: getAppConfig().llmTopP,
        modelDetails: activeModel,
        capabilities
      });
    } else {
      res.json({
        endpoint: `${lmStudioClient.baseUrl}/v1/chat/completions`,
        model: 'Not Connected',
        status: 'disconnected',
        contextLength: 'Unknown',
        temperature: getAppConfig().llmTemperature,
        error: 'LM Studio is not running or not accessible',
        instructions: 'Ensure LM Studio is running on port 1234 with a loaded model'
      });
    }
  } catch (error) {
    log.error('Failed to fetch LM Studio config', { error: error.message });
    res.json({
      status: 'error',
      error: 'Failed to connect to LM Studio',
      instructions: 'Check LM Studio connection and ensure it is running'
    });
  }
});

// --- LLM test connection (auth required — fetches from user-supplied URLs) ---

// SSRF protection: only allow known LLM provider hostnames
const ALLOWED_ENDPOINT_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/\[::1\](:\d+)?$/,
  /^https?:\/\/api\.openai\.com$/,
  /^https?:\/\/api\.anthropic\.com$/,
  /^https?:\/\/generativelanguage\.googleapis\.com$/,
];

const isPrivateIP = (ip) =>
  ip.startsWith('169.254.') || ip.startsWith('10.') ||
  ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
  ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0';

const isAllowedEndpoint = async (endpoint) => {
  if (!endpoint) return false;
  try {
    const url = new URL(endpoint);
    const host = url.hostname;

    // Block private IP ranges in hostname
    if (isPrivateIP(host)) {
      // Allow localhost patterns explicitly (for local LLM servers)
      const base = `${url.protocol}//${url.host}`;
      return ALLOWED_ENDPOINT_PATTERNS.some(p => p.test(base));
    }

    // For non-IP hostnames, resolve DNS and check resolved IP against private ranges
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(host) && host !== 'localhost') {
      const { promises: dns } = await import('dns');
      try {
        const addresses = await dns.resolve4(host);
        if (addresses.some(ip => isPrivateIP(ip))) {
          return false; // DNS rebinding: domain resolves to private IP
        }
      } catch { /* DNS resolution failed — let allowlist check handle it */ }
    }

    const base = `${url.protocol}//${url.host}`;
    return ALLOWED_ENDPOINT_PATTERNS.some(p => p.test(base));
  } catch {
    return false;
  }
};

router.post('/llm/test', requireAuth, async (req, res) => {
  try {
    const { provider, endpoint, apiKey } = req.body;
    let testResult = false;
    let providerInfo = provider;
    let model = null;

    // Validate endpoint against allowlist for providers that fetch URLs
    if (['lm-studio', 'ollama', 'openai', 'custom'].includes(provider)) {
      if (!(await isAllowedEndpoint(endpoint))) {
        return res.status(400).json({
          success: false,
          error: 'Endpoint not allowed. Use localhost, OpenAI, or Anthropic URLs.'
        });
      }
    }

    switch (provider) {
      case 'lm-studio': {
        const client = new LMStudioClient();
        client.baseUrl = endpoint || 'http://localhost:1234';
        testResult = await client.testConnection();
        if (testResult) {
          const activeModel = await client.getActiveModel();
          model = activeModel?.id || null;
        }
        break;
      }
      case 'ollama':
        try {
          const response = await fetch(`${endpoint}/api/tags`);
          testResult = response.ok;
          if (testResult) {
            const data = await response.json();
            model = data.models?.[0]?.name || null;
          }
        } catch {
          testResult = false;
        }
        break;

      case 'openai':
        try {
          const response = await fetch(`${endpoint}/models`, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
          });
          testResult = response.ok;
          if (!testResult && response.status === 401) throw new Error('Invalid API key');
        } catch (error) {
          testResult = false;
          providerInfo = error.message || 'Connection failed';
        }
        break;

      case 'anthropic':
        testResult = !!(apiKey && apiKey.startsWith('sk-ant-'));
        if (!testResult) providerInfo = 'Invalid Anthropic API key format';
        break;

      case 'custom':
        try {
          const headers = { 'Content-Type': 'application/json' };
          if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
          const response = await fetch(`${endpoint}/models`, { headers });
          testResult = response.ok;
        } catch {
          testResult = false;
        }
        break;
    }

    res.json({
      success: testResult,
      provider: providerInfo,
      model,
      error: testResult ? null : (providerInfo || 'Failed to connect to LLM provider')
    });
  } catch (error) {
    log.error('LLM test error', { error: error.message });
    res.json({ success: false, error: 'LLM connection test failed' });
  }
});

// --- LLM models listing ---

// Static model catalogs for cloud providers
const OPENAI_MODELS = [
  { id: 'gpt-4-turbo-preview', name: 'GPT-4 Turbo', context_length: 128000 },
  { id: 'gpt-4', name: 'GPT-4', context_length: 8192 },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', context_length: 16384 },
  { id: 'gpt-3.5-turbo-16k', name: 'GPT-3.5 Turbo 16K', context_length: 16384 }
];

const ANTHROPIC_MODELS = [
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', context_length: 200000 },
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', context_length: 200000 },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', context_length: 200000 }
];

router.post('/llm/models', requireAuth, async (req, res) => {
  try {
    const { provider, endpoint } = req.body;
    let models = [];

    // SEC-AUDIT-007 / #166: same SSRF gate as /llm/test for any client-supplied fetch target
    if (['lm-studio', 'ollama', 'custom'].includes(provider) && endpoint) {
      const safe = await assertSafeEndpoint(endpoint);
      if (!safe.ok) {
        return res.status(400).json({
          success: false,
          models: [],
          error: 'Endpoint not allowed',
        });
      }
    }

    switch (provider) {
      case 'lm-studio': {
        const client = new LMStudioClient();
        client.baseUrl = endpoint || 'http://localhost:1234';
        const lmModelsResponse = await client.getModels();
        if (lmModelsResponse?.data) {
          models = lmModelsResponse.data.map(m => ({
            id: m.id,
            name: m.id,
            context_length: m.context_length || 4096,
            capabilities: client.getModelCapabilities(m.id),
            // memory-layer service models — listed honestly, never a substrate
            auxiliary: isAuxiliaryModel(m.id)
          }));
        }
        break;
      }
      case 'ollama':
        try {
          if (!endpoint) {
            return res.status(400).json({ success: false, models: [], error: 'endpoint required for ollama' });
          }
          const response = await fetch(`${endpoint}/api/tags`);
          if (response.ok) {
            const data = await response.json();
            models = data.models?.map(m => ({
              id: m.name, name: m.name, context_length: 4096
            })) || [];
          }
        } catch (error) {
          log.error('Ollama fetch error', { error: error.message });
        }
        break;

      case 'openai':
        models = OPENAI_MODELS;
        break;

      case 'anthropic':
        models = ANTHROPIC_MODELS;
        break;

      case 'custom':
        models = [];
        break;
    }

    res.json({ success: true, models });
  } catch (error) {
    log.error('LLM models fetch error', { error: error.message });
    res.json({ success: false, models: [], error: 'Failed to fetch models' });
  }
});

// --- Active provider management ---
// The memoized answer lives in provider-status-snapshot.js (friction-map D1):
// N status lights share one probe pair per 5s.

router.get('/llm/provider', requireAuth, async (req, res) => {
  try {
    const { config, connected, activeModel } = await providerStatusSnapshot();

    // Deliberate rest is not a failure. Only the backend-supervised substrate
    // is ever reaped by the idle monitor, so only it can be in standby; every
    // other unreachable-when-it-should-serve keeps OFFLINE's honest meaning.
    const rest = !connected && config.provider === 'llama-server'
      ? deliberateStandby()
      : { standby: false, since: null };

    res.json({
      ...config,
      apiKey: config.apiKey ? '***' : '', // Never expose API keys
      status: connected ? 'connected' : 'disconnected',
      activeModel: activeModel?.id || null,
      standby: rest.standby,
      standbySince: rest.since,
      // The honest wake story: any local summon reloads via ensureServing.
      ...(rest.standby ? { wakeOn: 'next local turn' } : {}),
    });
  } catch (error) {
    log.error('Provider status error', { error: error.message });
    res.json({ status: 'error', error: 'Failed to get provider status' });
  }
});

router.put('/llm/provider', requireAuth, requireInstallOwner, async (req, res) => {
  try {
    const { provider, endpoint, apiKey, model, temperature, maxTokens, topP } = req.body;
    // SEC-AUDIT-007 residual: do not persist a private/metadata endpoint for later server-side fetch
    if (endpoint !== undefined && endpoint !== null && endpoint !== '') {
      const safe = await assertSafeEndpoint(String(endpoint));
      if (!safe.ok) {
        return res.status(400).json({ success: false, error: 'Endpoint not allowed' });
      }
    }
    const update = {};
    if (provider !== undefined) update.provider = provider;
    if (endpoint !== undefined) update.endpoint = endpoint;
    if (apiKey !== undefined) update.apiKey = apiKey;
    if (model !== undefined) update.model = model;
    if (temperature !== undefined) update.temperature = temperature;
    if (maxTokens !== undefined) update.maxTokens = maxTokens;
    if (topP !== undefined) update.topP = topP;

    setConfig(update);
    // THE CHOICE SURVIVES THE RESTART (Bastien, 2026-08-08): setConfig is
    // in-memory, so every packaged boot woke up back on the hard-coded
    // default until the operator re-clicked. Persist which mind was chosen
    // (never the apiKey — that stays in the encrypted credential store);
    // boot restores it before anything speaks.
    if (provider !== undefined) {
      await saveProviderChoice(
        { provider, endpoint, model },
        { chosenBy: 'operator' },
      );
    }

    const config = getConfig();
    const connected = await providerTestConnection();

    res.json({
      success: true,
      provider: config.provider,
      endpoint: config.endpoint,
      status: connected ? 'connected' : 'disconnected',
    });
  } catch (error) {
    log.error('Provider update error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to update provider' });
  }
});

// --- Substrate detection ---

router.get('/substrate', requireAuth, async (req, res) => {
  try {
    const substrate = await getSubstrateProfile();
    res.json({ success: true, substrate });
  } catch (error) {
    log.error('Detection error', { error: error.message });
    res.status(500).json({ success: false, error: 'Substrate detection failed' });
  }
});

// --- Substrate ignition (auth required — starts a local model load) ---

// The configured substrate model this install considers "the mind" — what
// ignition loads when the witness relights a downed substrate from the desk.
const substrateTarget = () => ({
  modelKey: getConfig().model || process.env.SUBSTRATE_MODEL || null, // the operator's latest choice first; env only before any
  contextLength: parseInt(process.env.SUBSTRATE_CONTEXT_LENGTH, 10) || 32768,
});

router.get('/llm/substrate/ignition', requireAuth, async (req, res) => {
  try {
    const cfg = getConfig();
    const launchCfg = activeLaunchConfig(process.env);
    res.json(await ignitionStatus(cfg, launchCfg, substrateTarget().modelKey));
  } catch (error) {
    log.error('Ignition status error', { error: error.message });
    res.status(500).json({ error: 'Failed to read ignition status' });
  }
});

// Every base model tied to this rig — what the global ignite control offers.
router.get('/llm/substrate/models', requireAuth, async (req, res) => {
  try {
    res.json(await substrateModelView(process.env));
  } catch (error) {
    log.error('Substrate models error', { error: error.message });
    res.status(500).json({ error: 'Failed to read the model catalog' });
  }
});

// Refusals the desk must distinguish: a busy substrate re-offers later; an unowned one names the operator's move;
// a house on another provider asks before it moves (resend with { confirmSwitch: true }).
const IGNITE_REFUSAL_STATUS = { busy: 409, unowned: 409, 'switch-unconfirmed': 409 };

router.post('/llm/substrate/ignite', requireAuth, requireInstallOwner, async (req, res) => {
  try {
    const cfg = getConfig();
    const launchCfg = activeLaunchConfig(process.env);
    const target = substrateTarget();
    const modelKey = req.body?.model || target.modelKey;
    let selection = null;
    if (cfg.provider === 'llama-server') {
      // llama-server ignites the env-configured base + adapters by default; a
      // per-request model must come out of the rig's own catalog — ignition
      // never spawns a caller-invented path.
      if (req.body?.model) {
        // THE FOLDER LAW (ruling, 2026-08-28): the chosen folder IS the authorization — model AND engine.
        const gate = await resolveAuthorizedIgnition(process.env, req.body.model, cfg.provider);
        if (gate.error) return res.status(gate.status).json({ error: gate.error });
        const entry = gate.entry;
        // The selection key is the model's declared SERVING IDENTITY (its
        // lineage sidecar) when it carries one — the sovereign gate matches
        // that identity, never the catalog path (2026-08-18: a path-keyed
        // selection could never pass the lineage check, so every desk switch
        // died at the gate).
        selection = { path: entry.path, key: entry.servingModel ?? entry.id };
      }
    } else if (cfg.provider === 'lm-studio') {
      // The lms path loads a user-nameable model key.
      if (!modelKey) {
        return res.status(400).json({
          error: 'No substrate model configured — set SUBSTRATE_MODEL in .env or pass { model }',
        });
      }
      if (!isValidModelKey(modelKey)) {
        return res.status(400).json({ error: 'Invalid model key' });
      }
    }
    const result = await igniteConfigured(cfg, launchCfg, { modelKey, contextLength: target.contextLength }, selection, { confirmSwitch: req.body?.confirmSwitch === true });
    log.info('Substrate ignition requested', { provider: cfg.provider, status: result.status, model: selection?.key || modelKey });
    // An accepted ignite IS the operator's provider choice: persisted durably,
    // so the next boot restores this lane and relights the persisted selection.
    // An empty-body ignite stamps no name — identity comes from the server.
    if (result.status === 'igniting' || result.status === 'already-loaded') {
      const after = getConfig();
      const persistedKey = after.provider === 'lm-studio' ? modelKey : (selection?.key ?? null);
      if (persistedKey) setConfig({ model: persistedKey });
      const choice = { provider: after.provider, endpoint: after.endpoint, ...(persistedKey ? { model: persistedKey } : {}) };
      await saveProviderChoice(choice, { chosenBy: 'operator' });
    }
    const status = IGNITE_REFUSAL_STATUS[result.status] || (result.status === 'igniting' ? 202 : 200);
    res.status(status).json(result);
  } catch (error) {
    log.error('Ignition error', { error: error.message });
    res.status(500).json({ error: 'Failed to ignite the substrate' });
  }
});

// --- Model Capabilities ---

router.get('/llm/capabilities', requireAuth, async (req, res) => {
  try {
    // No explicit model asked for → runtime-merged truth. With ?neumaId the
    // answer judges the route THAT being will ride (a per-neuma override can
    // point at a different server than the machine default — the composer's
    // attach affordance keys off this, and a wrong-server answer lies).
    // Which model a being rides is its own house's to ask. Without it, the
    // active model's machine-config route stands; an explicit ?model= stays static.
    if (!req.query.model) {
      const neumaId = req.query.neumaId;
      if (typeof neumaId === 'string' && /^[a-zA-Z0-9_-]+$/.test(neumaId)) {
        if (!(await assertNeumaOwner(req, res, neumaId))) return;
        try {
          const route = isWitnessLaneId(neumaId)
            ? await resolveWitnessRoute(neumaId)
            : await resolveNeumaRoute(neumaId, null);
          res.json(await getRouteCapabilities(route));
          return;
        } catch { /* unroutable being → the machine answer stands */ }
      }
      res.json(await getActiveModelCapabilities());
      return;
    }
    res.json({ model: req.query.model, ...getCapabilities(req.query.model) });
  } catch (error) {
    log.error('Capabilities error', { error: error.message });
    res.status(500).json({ error: 'Failed to get model capabilities' });
  }
});

export default router;
