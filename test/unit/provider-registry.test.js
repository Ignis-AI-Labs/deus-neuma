// Provider registry (pure): the catalog of routable LLM providers and the pure
// helpers that turn […] into the map the route resolver
// consumes. Real inputs, real outputs, no mocks — the module holds no keys and
// does no IO; runtime state is injected as a pure function.
import { describe, test, expect } from 'vitest';
import {
  PROVIDER_CATALOG, getProvider, isLocalProvider, localProviders,
  isSovereignProvider, sovereignProviders,
  providerConfigured, buildProvidersMap, probeRefusalReason,
} from '../../backend/services/provider-registry.js';

describe('PROVIDER_CATALOG', () => {
  test('every entry is frozen and carries the required fields', () => {
    for (const e of PROVIDER_CATALOG) {
      expect(Object.isFrozen(e)).toBe(true);
      expect(typeof e.id).toBe('string');
      expect(['local', 'cloud']).toContain(e.kind);
      expect(['openai', 'openai-responses', 'anthropic', 'ollama']).toContain(e.dialect);
      expect(typeof e.requiresKey).toBe('boolean');
      expect(typeof e.chatPath).toBe('string');
    }
  });
  test('provider ids are unique', () => {
    const ids = PROVIDER_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  test('covers local substrates and the popular OpenAI-compatible clouds', () => {
    const ids = PROVIDER_CATALOG.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([
      'lm-studio', 'ollama', 'openai', 'anthropic', 'xai', 'z-ai', 'openrouter', 'deepseek', 'groq', 'custom',
      'openai-chatgpt',
    ]));
  });
  test('special providers declare their actual wire dialect', () => {
    expect(getProvider('ollama').dialect).toBe('ollama');
    expect(getProvider('anthropic').dialect).toBe('anthropic');
    expect(getProvider('z-ai').dialect).toBe('openai');
    expect(getProvider('openrouter').dialect).toBe('openai');
    expect(getProvider('openai-chatgpt').dialect).toBe('openai-responses');
  });
  test('custom is a keyless, endpoint-less universal escape hatch', () => {
    const c = getProvider('custom');
    expect(c).toMatchObject({ kind: 'cloud', dialect: 'openai', endpoint: null, requiresKey: false });
  });
});

describe('getProvider / isLocalProvider / localProviders', () => {
  test('getProvider returns the entry or null', () => {
    expect(getProvider('anthropic').name).toBe('Anthropic');
    expect(getProvider('nope')).toBeNull();
  });
  test('llama-server, lm-studio and ollama are local', () => {
    expect(isLocalProvider('llama-server')).toBe(true);
    expect(isLocalProvider('lm-studio')).toBe(true);
    expect(isLocalProvider('ollama')).toBe(true);
    expect(isLocalProvider('openai')).toBe(false);
    expect(isLocalProvider('nope')).toBe(false);
    // The core locals are always present; the models.dev snapshot may add
    // other genuinely-local servers (atomic-chat etc.) — all must be kind
    // 'local' with a loopback endpoint, and no generated id may duplicate a
    // core local under another spelling.
    const locals = localProviders();
    const localIds = locals.map((e) => e.id);
    expect(localIds).toEqual(expect.arrayContaining(['llama-server', 'lm-studio', 'ollama']));
    expect(localIds).not.toContain('lmstudio');
    expect(localIds).not.toContain('llama');
    for (const e of locals) {
      expect(e.kind).toBe('local');
      expect(e.endpoint).toMatch(/^https?:\/\/(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\])/i);
    }
  });
});

describe('the sovereignty axis — custody, not transport (docs/protocols/sovereignty-boundary.md)', () => {
  test('exactly the operator-custody substrates are sovereign', () => {
    expect(sovereignProviders().map((e) => e.id).sort())
      .toEqual(['llama-server', 'lm-studio', 'ollama']);
    expect(isSovereignProvider('llama-server')).toBe(true);
    expect(isSovereignProvider('lm-studio')).toBe(true);
    expect(isSovereignProvider('ollama')).toBe(true);
  });

  test('subscription routes are never sovereign, whatever their transport', () => {
    // The exact confusion the boundary exists to kill: a vendor model behind
    // a loopback bridge must never read as a door a neuma can exist through.
    expect(isLocalProvider('openai-chatgpt')).toBe(false);
    expect(isSovereignProvider('openai-chatgpt')).toBe(false);
  });

  test('fail-closed everywhere else: clouds, custom, generated entries, unknowns', () => {
    for (const id of ['anthropic', 'openai', 'xai', 'custom', 'nope', undefined]) {
      expect(isSovereignProvider(id)).toBe(false);
    }
    // Every generated catalog entry is non-sovereign by construction (the
    // sovereign flag is absent, never inherited).
    for (const e of PROVIDER_CATALOG) {
      if (!['llama-server', 'lm-studio', 'ollama'].includes(e.id)) {
        expect(e.sovereign === true).toBe(false);
      }
    }
  });
});

describe('providerConfigured', () => {
  test('a keyless local provider is configured on endpoint alone', () => {
    expect(providerConfigured(getProvider('ollama'), {})).toBe(true);
    expect(providerConfigured(getProvider('lm-studio'), {})).toBe(true);
  });
  test('a key-required cloud provider needs a key present', () => {
    expect(providerConfigured(getProvider('openai'), { keyPresent: false })).toBe(false);
    expect(providerConfigured(getProvider('openai'), { keyPresent: true })).toBe(true);
  });
  test('custom is unconfigured until the operator supplies an endpoint', () => {
    expect(providerConfigured(getProvider('custom'), {})).toBe(false);
    expect(providerConfigured(getProvider('custom'), { endpoint: 'https://api.z.ai/api/paas/v4' })).toBe(true);
  });
  test('null entry is never configured', () => {
    expect(providerConfigured(null, { keyPresent: true })).toBe(false);
  });
});

describe('buildProvidersMap', () => {
  test('projects injected state into the resolver-facing map', () => {
    // Only anthropic has a key; custom has an operator endpoint; locals keyless.
    const map = buildProvidersMap((entry) => {
      if (entry.id === 'anthropic') return { keyPresent: true };
      if (entry.id === 'custom') return { endpoint: 'https://my-llm.example/v1', keyPresent: false };
      return {};
    });
    expect(map['anthropic']).toEqual({ kind: 'cloud', endpoint: 'https://api.anthropic.com', configured: true });
    expect(map['openai']).toEqual({ kind: 'cloud', endpoint: 'https://api.openai.com', configured: false });
    expect(map['ollama']).toEqual({ kind: 'local', endpoint: 'http://localhost:11434', configured: true });
    expect(map['custom']).toEqual({ kind: 'cloud', endpoint: 'https://my-llm.example/v1', configured: true });
  });
  test('the returned map and its entries are frozen', () => {
    const map = buildProvidersMap(() => ({}));
    expect(Object.isFrozen(map)).toBe(true);
    expect(Object.isFrozen(map['openai'])).toBe(true);
  });
  test('has an entry for every catalog provider', () => {
    const map = buildProvidersMap(() => ({}));
    expect(Object.keys(map).sort()).toEqual(PROVIDER_CATALOG.map((e) => e.id).sort());
  });
});

// The guard that keeps a DIAGNOSTIC off a lane the operator cannot afford to
// lose. Design note, 2026-07-29: […] A probe is a loop
// of deliberately malformed requests; pointed at a personal subscription it is
// the shape of thing that ends an account, so the refusal is fail-closed BY NAME
// and every diagnostic asks this one list.
//
// The scripts' own refusals are proven by running them (see the ledger); this
// holds the pure decision underneath, which is where a regression would start.
describe('probeRefusalReason', () => {
  test('refuses the Claude Code subscription bridge, and says why', () => {
    const reason = probeRefusalReason('claude-code-local');
    expect(reason).toMatch(/subscription/i);
    // The message must send the caller somewhere real, not just say no.
    expect(reason).toMatch(/anthropic/i);
  });

  test('permits every lane the rule does not name', () => {
    // The permitted set is the point: this guard is one entry, not a mood.
    for (const id of ['anthropic', 'openai', 'openai-chatgpt', 'z-ai', 'xai', 'llama-server']) {
      expect(probeRefusalReason(id)).toBeNull();
    }
  });

  test('an unknown id is not a refusal — the caller reports it as unknown', () => {
    expect(probeRefusalReason('no-such-provider')).toBeNull();
    expect(probeRefusalReason('')).toBeNull();
    expect(probeRefusalReason(undefined)).toBeNull();
  });

  test('a legacy alias cannot slip past the list', () => {
    // canonicalProviderId runs first, so a retired id for a forbidden lane
    // still trips the guard rather than resolving to a free pass.
    expect(probeRefusalReason('claude-code-local')).not.toBeNull();
  });

  test('the removed bridge stays forbidden — the tombstone outlives the entry', () => {
    // `claude-code-local` was REMOVED from the catalog 2026-07-30, so it is no
    // longer a provider at all. The refusal must survive that: if the id ever
    // returns — a catalog sync, a revert, a well-meaning hand — the guard is
    // already standing rather than needing to be remembered.
    expect(getProvider('claude-code-local')).toBeNull();
    expect(probeRefusalReason('claude-code-local')).not.toBeNull();
  });
});
