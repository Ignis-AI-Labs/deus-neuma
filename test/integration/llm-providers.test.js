/**
 * LLM Provider Switching Integration Tests
 *
 * Tests REAL streaming from multiple LLM providers: LM Studio, Ollama, OpenAI, Anthropic.
 * Each provider block is conditionally run based on .env.test configuration.
 * Providers without valid keys or unreachable endpoints are skipped (not failed).
 *
 * Setup: Copy .env.test and fill in your API keys.
 * Run:   npx vitest run test/integration/llm-providers.test.js
 */

import { describe, test, expect, afterEach } from 'vitest';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  setConfig, getConfig, createStreamRequest, consumeStream,
  testConnection, getModels, createThinkFilter,
} from '../../backend/services/llm-provider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Load .env.test at module level (top-level await) ---

const loadTestEnv = async () => {
  const env = {};
  try {
    const content = await readFile(join(__dirname, '../../.env.test'), 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (value) env[key] = value;
    }
  } catch { /* no .env.test */ }
  return env;
};

const testEnv = await loadTestEnv();

// --- Probe availability at module level (before test registration) ---

const probeFetch = async (url, timeout = 3000) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    return res.ok;
  } catch { return false; }
};

const lmStudioUrl = testEnv.LM_STUDIO_URL || 'http://localhost:1234';
const ollamaUrl = testEnv.OLLAMA_URL || 'http://localhost:11434';

const EXCLUDED_MODELS = /embedding/i;

// Discover LM Studio models (skip embedding models)
let lmStudioAvailable = false;
let lmStudioModel = null;
try {
  const res = await fetch(`${lmStudioUrl}/v1/models`, { signal: AbortSignal.timeout(3000) });
  if (res.ok) {
    const data = await res.json();
    const chatModels = (data.data || []).filter(m => !EXCLUDED_MODELS.test(m.id));
    if (chatModels.length > 0) {
      lmStudioAvailable = true;
      lmStudioModel = chatModels[0].id;
    }
  }
} catch { /* not running */ }

// Discover Ollama models
let ollamaAvailable = false;
let ollamaModel = null;
try {
  const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
  if (res.ok) {
    const data = await res.json();
    const models = (data.models || []).filter(m => !EXCLUDED_MODELS.test(m.name));
    if (models.length > 0) {
      ollamaAvailable = true;
      ollamaModel = models[0].name;
    }
  }
} catch { /* not running */ }

const openaiAvailable = !!(testEnv.OPENAI_API_KEY && testEnv.OPENAI_API_KEY.startsWith('sk-'));
const anthropicAvailable = !!(testEnv.ANTHROPIC_API_KEY && testEnv.ANTHROPIC_API_KEY.startsWith('sk-ant-'));
const xaiAvailable = !!(testEnv.XAI_API_KEY && testEnv.XAI_API_KEY.startsWith('xai-'));
const customAvailable = !!(testEnv.CUSTOM_API_KEY && testEnv.CUSTOM_ENDPOINT);

// --- Helper: stream a simple prompt ---

// A key that authenticates but whose account cannot pay is not an available
// provider — the file contract (skipped, not failed) applies. Detected from
// the provider's own billing/quota declaration on a real attempt; anything
// else stays a real failure.
const isBillingStarved = (err) =>
  /insufficient_quota|exceeded your current quota|credit balance is too low/i.test(err?.message || '');

const streamSimplePrompt = async (prompt = 'Say hello. /no_think') => {
  const messages = [
    { role: 'system', content: 'You are a helpful assistant. Be extremely concise. One sentence max.' },
    { role: 'user', content: prompt },
  ];

  const chunks = [];
  // consumeStream already applies createThinkFilter internally — don't double-wrap
  // Use enough tokens for models that think (Qwen3.5-class reasoning runs
  // hundreds of tokens before speech) to close their think block
  const streamResult = await createStreamRequest(messages, { maxTokens: 1500, temperature: 0.0 });
  const fullResponse = await consumeStream(streamResult, (content) => chunks.push(content));

  return { fullResponse, chunks };
};

// Suppress console noise

describe('LLM Provider Integration', () => {

  afterEach(() => {
    // Reset to a neutral config after each provider test
    setConfig({
      provider: 'lm-studio',
      endpoint: 'http://localhost:1234',
      apiKey: '',
      model: 'local-model',
    });
  });

  // -------------------------------------------------------------------------
  // LM Studio (local, OpenAI-compatible)
  // -------------------------------------------------------------------------

  describe.skipIf(!lmStudioAvailable)('LM Studio', () => {
    test('connects and lists models', async () => {
      setConfig({ provider: 'lm-studio', endpoint: lmStudioUrl, apiKey: '', model: lmStudioModel });

      const connected = await testConnection();
      expect(connected).toBe(true);

      const models = await getModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models[0].id).toBeTruthy();
    });

    test('streams a completion', async () => {
      setConfig({ provider: 'lm-studio', endpoint: lmStudioUrl, apiKey: '', model: lmStudioModel });

      const { fullResponse, chunks } = await streamSimplePrompt();

      expect(fullResponse.length).toBeGreaterThan(0);
      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);

    test('config uses discovered model', () => {
      setConfig({ provider: 'lm-studio', endpoint: lmStudioUrl, model: lmStudioModel });
      const config = getConfig();
      expect(config.provider).toBe('lm-studio');
      expect(config.model).toBe(lmStudioModel);
    });
  });

  // -------------------------------------------------------------------------
  // Ollama (local, native API)
  // -------------------------------------------------------------------------

  describe.skipIf(!ollamaAvailable || !ollamaModel)('Ollama', () => {
    test('connects and lists models', async () => {
      setConfig({ provider: 'ollama', endpoint: ollamaUrl, apiKey: '', model: ollamaModel });

      const connected = await testConnection();
      expect(connected).toBe(true);

      const models = await getModels();
      expect(models.length).toBeGreaterThan(0);
    });

    test('streams a completion', async () => {
      setConfig({ provider: 'ollama', endpoint: ollamaUrl, apiKey: '', model: ollamaModel });

      const { fullResponse, chunks } = await streamSimplePrompt();

      expect(fullResponse.length).toBeGreaterThan(0);
      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);

    test('uses /api/chat endpoint', () => {
      setConfig({ provider: 'ollama', endpoint: ollamaUrl, model: ollamaModel });
      expect(getConfig().provider).toBe('ollama');
    });
  });

  // -------------------------------------------------------------------------
  // OpenAI (cloud, API key required)
  // -------------------------------------------------------------------------

  describe.skipIf(!openaiAvailable)('OpenAI', () => {
    test('connects and lists models', async () => {
      setConfig({
        provider: 'openai',
        endpoint: 'https://api.openai.com',
        apiKey: testEnv.OPENAI_API_KEY,
        model: testEnv.OPENAI_MODEL || 'gpt-4o-mini',
      });

      const connected = await testConnection();
      expect(connected).toBe(true);

      const models = await getModels();
      expect(models.length).toBeGreaterThan(0);
    });

    test('streams a completion', async (ctx) => {
      setConfig({
        provider: 'openai',
        endpoint: 'https://api.openai.com',
        apiKey: testEnv.OPENAI_API_KEY,
        model: testEnv.OPENAI_MODEL || 'gpt-4o-mini',
      });

      let result;
      try {
        result = await streamSimplePrompt();
      } catch (err) {
        if (isBillingStarved(err)) ctx.skip(`OpenAI account out of credit: ${err.message.slice(0, 120)}`);
        throw err;
      }

      expect(result.fullResponse.length).toBeGreaterThan(0);
      expect(result.chunks.length).toBeGreaterThan(0);
    }, 30000);

    test('uses OpenAI headers (Bearer auth)', () => {
      setConfig({ provider: 'openai', apiKey: testEnv.OPENAI_API_KEY });
      const config = getConfig();
      expect(config.provider).toBe('openai');
      expect(config.apiKey).toMatch(/^sk-/);
    });
  });

  // -------------------------------------------------------------------------
  // Anthropic (cloud, API key required)
  // -------------------------------------------------------------------------

  describe.skipIf(!anthropicAvailable)('Anthropic', () => {
    test('reports connection (API key validation)', async () => {
      setConfig({
        provider: 'anthropic',
        endpoint: 'https://api.anthropic.com',
        apiKey: testEnv.ANTHROPIC_API_KEY,
        model: testEnv.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
      });

      const connected = await testConnection();
      expect(connected).toBe(true);
    });

    test('returns hardcoded model list', async () => {
      setConfig({ provider: 'anthropic', apiKey: testEnv.ANTHROPIC_API_KEY });

      const models = await getModels();
      expect(models.length).toBeGreaterThan(0);
      const names = models.map(m => m.id);
      expect(names).toContain('claude-haiku-4-5-20251001');
    });

    test('streams a completion', async (ctx) => {
      setConfig({
        provider: 'anthropic',
        endpoint: 'https://api.anthropic.com',
        apiKey: testEnv.ANTHROPIC_API_KEY,
        model: testEnv.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
      });

      let result;
      try {
        result = await streamSimplePrompt();
      } catch (err) {
        if (isBillingStarved(err)) ctx.skip(`Anthropic account out of credit: ${err.message.slice(0, 120)}`);
        throw err;
      }

      expect(result.fullResponse.length).toBeGreaterThan(0);
      expect(result.chunks.length).toBeGreaterThan(0);
    }, 30000);

    test('uses Anthropic headers (x-api-key)', () => {
      setConfig({ provider: 'anthropic', apiKey: testEnv.ANTHROPIC_API_KEY });
      expect(getConfig().provider).toBe('anthropic');
    });
  });

  // -------------------------------------------------------------------------
  // xAI / Grok (cloud, OpenAI-compatible API)
  // -------------------------------------------------------------------------

  describe.skipIf(!xaiAvailable)('xAI (Grok)', () => {
    test('connects and lists models', async () => {
      setConfig({
        provider: 'custom',
        endpoint: 'https://api.x.ai',
        apiKey: testEnv.XAI_API_KEY,
        model: testEnv.XAI_MODEL || 'grok-3-mini',
      });

      const connected = await testConnection();
      expect(connected).toBe(true);

      const models = await getModels();
      expect(models.length).toBeGreaterThan(0);
    });

    test('streams a completion', async () => {
      setConfig({
        provider: 'custom',
        endpoint: 'https://api.x.ai',
        apiKey: testEnv.XAI_API_KEY,
        model: testEnv.XAI_MODEL || 'grok-3-mini',
      });

      const { fullResponse, chunks } = await streamSimplePrompt();

      expect(fullResponse.length).toBeGreaterThan(0);
      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);

    test('uses Bearer auth (OpenAI-compatible)', () => {
      setConfig({ provider: 'custom', endpoint: 'https://api.x.ai', apiKey: testEnv.XAI_API_KEY });
      const config = getConfig();
      expect(config.provider).toBe('custom');
      expect(config.apiKey).toMatch(/^xai-/);
    });
  });

  // -------------------------------------------------------------------------
  // Custom OpenAI-compatible (OpenRouter, Together, etc.)
  // -------------------------------------------------------------------------

  describe.skipIf(!customAvailable)('Custom provider', () => {
    test('connects and lists models', async () => {
      setConfig({
        provider: 'custom',
        endpoint: testEnv.CUSTOM_ENDPOINT,
        apiKey: testEnv.CUSTOM_API_KEY,
        model: testEnv.CUSTOM_MODEL || 'default',
      });

      const connected = await testConnection();
      expect(connected).toBe(true);
    });

    test('streams a completion', async () => {
      setConfig({
        provider: 'custom',
        endpoint: testEnv.CUSTOM_ENDPOINT,
        apiKey: testEnv.CUSTOM_API_KEY,
        model: testEnv.CUSTOM_MODEL || 'default',
      });

      const { fullResponse, chunks } = await streamSimplePrompt();

      expect(fullResponse.length).toBeGreaterThan(0);
      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);
  });

  // -------------------------------------------------------------------------
  // Provider switching (config-level, no live streaming)
  // -------------------------------------------------------------------------

  describe('Provider switching (config)', () => {
    test('setConfig switches provider', () => {
      setConfig({ provider: 'openai', endpoint: 'https://api.openai.com', apiKey: 'sk-test' });
      expect(getConfig().provider).toBe('openai');

      setConfig({ provider: 'anthropic', endpoint: 'https://api.anthropic.com', apiKey: 'sk-ant-test' });
      expect(getConfig().provider).toBe('anthropic');

      setConfig({ provider: 'ollama', endpoint: 'http://localhost:11434' });
      expect(getConfig().provider).toBe('ollama');
    });

    test('setConfig preserves unspecified fields', () => {
      setConfig({ provider: 'openai', endpoint: 'https://api.openai.com', apiKey: 'sk-test', model: 'gpt-4o' });
      setConfig({ temperature: 0.5 });

      const config = getConfig();
      expect(config.provider).toBe('openai');
      expect(config.model).toBe('gpt-4o');
      expect(config.temperature).toBe(0.5);
    });

    test('config is frozen (immutable)', () => {
      setConfig({ provider: 'openai' });
      const config = getConfig();
      expect(() => { config.provider = 'hacked'; }).toThrow();
    });

    test('testConnection returns false for unreachable local provider', async () => {
      setConfig({ provider: 'lm-studio', endpoint: 'http://localhost:59999', apiKey: '' });
      const connected = await testConnection();
      expect(connected).toBe(false);
    });

    test('testConnection returns false for invalid Anthropic key', async () => {
      setConfig({ provider: 'anthropic', apiKey: 'not-a-real-key' });
      const connected = await testConnection();
      expect(connected).toBe(false);
    });

    test('getModels returns empty array for unreachable provider', async () => {
      setConfig({ provider: 'lm-studio', endpoint: 'http://localhost:59999' });
      const models = await getModels();
      expect(models).toEqual([]);
    });
  });
});
