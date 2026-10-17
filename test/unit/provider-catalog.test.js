/**
 * Provider catalog snapshot — invariant tests over the REAL generated data
 * (backend/services/provider-catalog-data.js, produced by actually running
 * scripts/sync-provider-catalog.mjs against the real models.dev feed).
 * No mocks: the file under test IS the shipped artifact.
 */
import { describe, it, expect } from 'vitest';
import { GENERATED_PROVIDERS } from '../../backend/services/provider-catalog-data.js';
import { PROVIDER_CATALOG, getProvider, isLocalProvider } from '../../backend/services/provider-registry.js';

const CORE_IDS = [
  'llama-server', 'lm-studio', 'ollama', 'openai', 'anthropic', 'xai',
  'z-ai', 'openrouter', 'deepseek', 'groq', 'custom',
];
// 'openai-responses' joined when the ChatGPT OAuth route landed: llm-provider
// wires it end to end (account header, /responses URL, request body, stream
// parse, native tools) and provider-probe speaks it — not a catalog-only label.
const SPEAKABLE_DIALECTS = new Set(['openai', 'openai-responses', 'anthropic', 'ollama']);
const HTTPS_OR_LOOPBACK = /^https:\/\/|^https?:\/\/(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\])(:|\/|$)/i;

describe('provider catalog (models.dev snapshot)', () => {
  it('keeps the hand-written core entries byte-identical in id and route', () => {
    for (const id of CORE_IDS) {
      const entry = getProvider(id);
      expect(entry, id).toBeTruthy();
    }
    // The core ids whose routes existing keys/overrides depend on
    expect(getProvider('anthropic').endpoint).toBe('https://api.anthropic.com');
    expect(getProvider('z-ai').endpoint).toBe('https://api.z.ai/api/paas/v4');
    expect(getProvider('lm-studio').endpoint).toBe('http://localhost:1234');
  });

  it('has no duplicate ids across core + generated', () => {
    const ids = PROVIDER_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry speaks a dialect the platform can actually wire', () => {
    for (const e of PROVIDER_CATALOG) {
      expect(SPEAKABLE_DIALECTS.has(e.dialect), `${e.id} → ${e.dialect}`).toBe(true);
    }
  });

  it('every endpoint is https or loopback, and chatPath is absolute', () => {
    for (const e of GENERATED_PROVIDERS) {
      expect(HTTPS_OR_LOOPBACK.test(e.endpoint), `${e.id} → ${e.endpoint}`).toBe(true);
      expect(e.chatPath.startsWith('/'), `${e.id} chatPath`).toBe(true);
      expect(e.endpoint.endsWith('/')).toBe(false);
    }
  });

  it('generated breadth actually arrived (OpenCode-class coverage)', () => {
    expect(GENERATED_PROVIDERS.length).toBeGreaterThanOrEqual(100);
  });

  it('key providers resolved with the right wire', () => {
    const kimi = getProvider('kimi-for-coding');
    expect(kimi).toMatchObject({
      dialect: 'anthropic',
      endpoint: 'https://api.kimi.com/coding/v1',
      chatPath: '/messages',
      keyEnv: 'KIMI_API_KEY',
    });
    expect(kimi.models.map((m) => m.id)).toContain('k3');

    // The limits rung (2026-07-27): the sync carries models.dev's published
    // windows, so third-party models read a sourced limit instead of
    // LIMIT UNKNOWN. k3's 1M is pinned from the live models.dev payload.
    expect(kimi.models.find((m) => m.id === 'k3')).toMatchObject({ contextWindow: 1048576 });
    for (const e of GENERATED_PROVIDERS) {
      for (const m of e.models) {
        if ('contextWindow' in m) expect(Number.isFinite(m.contextWindow) && m.contextWindow > 0, `${e.id}/${m.id}`).toBe(true);
        if ('maxOutput' in m) expect(Number.isFinite(m.maxOutput) && m.maxOutput > 0, `${e.id}/${m.id}`).toBe(true);
      }
    }

    expect(getProvider('github-copilot')).toMatchObject({
      dialect: 'openai',
      endpoint: 'https://api.githubcopilot.com',
      chatPath: '/chat/completions',
      oauth: ['device'],
    });
    expect(getProvider('github-copilot').headers['Openai-Intent']).toBeTruthy();

    expect(getProvider('xai').oauth).toEqual(['browser', 'device']);
    expect(getProvider('moonshotai').endpoint).toBe('https://api.moonshot.ai/v1');
  });

  it('signing-based clouds stay excluded (dialect honesty)', () => {
    for (const id of ['amazon-bedrock', 'google-vertex', 'azure', 'azure-cognitive-services']) {
      expect(getProvider(id), id).toBe(null);
    }
  });

  it('local providers classify as local; cloud as cloud', () => {
    expect(isLocalProvider('lm-studio')).toBe(true);
    expect(isLocalProvider('github-copilot')).toBe(false);
    for (const e of GENERATED_PROVIDERS) {
      if (e.kind === 'local') expect(e.requiresKey).toBe(false);
    }
  });
});
