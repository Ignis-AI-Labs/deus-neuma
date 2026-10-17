// Model route resolver (pure core). A neuma's natal LOCAL model is the anchor
// and fallback; an operator override layers a higher-capacity provider on top,
// but drops back to natal when unconfigured/unknown. Real inputs, real outputs,
// no mocks — the resolver reads nothing and does no IO.
import { describe, test, expect } from 'vitest';
import {
  parseRouteId, formatRouteId, natalRoute, isLocalKind, resolveRoute,
} from '../../core/runtime/model-route.js';

const PROVIDERS = Object.freeze({
  'lm-studio': { kind: 'local', endpoint: 'http://localhost:1234', configured: true },
  ollama:      { kind: 'local', endpoint: 'http://localhost:11434', configured: true },
  anthropic:   { kind: 'cloud', endpoint: 'https://api.anthropic.com', configured: true },
  openai:      { kind: 'cloud', endpoint: 'https://api.openai.com', configured: false }, // no key
});

const NATAL = Object.freeze({ provider: 'lm-studio', model: 'qwen3.5-122b-a10b' });

describe('parseRouteId', () => {
  test('splits provider from model on the first slash', () => {
    expect(parseRouteId('anthropic/claude-haiku-4-5')).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5' });
  });
  test('keeps later slashes inside the model (OpenRouter-style ids)', () => {
    expect(parseRouteId('openrouter/anthropic/claude-3.5'))
      .toEqual({ provider: 'openrouter', model: 'anthropic/claude-3.5' });
  });
  test('rejects malformed ids', () => {
    expect(parseRouteId('bare-model')).toBeNull();
    expect(parseRouteId('/leading')).toBeNull();
    expect(parseRouteId('trailing/')).toBeNull();
    expect(parseRouteId('')).toBeNull();
    expect(parseRouteId(null)).toBeNull();
  });
});

describe('formatRouteId', () => {
  test('round-trips with parseRouteId', () => {
    const id = 'openrouter/anthropic/claude-3.5';
    expect(formatRouteId(parseRouteId(id))).toBe(id);
  });
  test('returns null when a half is missing', () => {
    expect(formatRouteId({ provider: 'openai', model: '' })).toBeNull();
    expect(formatRouteId({ provider: '', model: 'x' })).toBeNull();
    expect(formatRouteId(null)).toBeNull();
  });
});

describe('natalRoute', () => {
  test('reads substrate.llm.{provider,model}', () => {
    expect(natalRoute({ substrate: { llm: { provider: 'ollama', model: 'llama3' } } }))
      .toEqual({ provider: 'ollama', model: 'llama3' });
  });
  test('reads the legacy birth.substrate.llm shape symmetrically (provider AND model)', () => {
    expect(natalRoute({ birth: { substrate: { llm: { provider: 'ollama', model: 'llama3' } } } }))
      .toEqual({ provider: 'ollama', model: 'llama3' });
  });
  test('returns null when provider is not recorded (incomplete legacy DNA)', () => {
    expect(natalRoute({ substrate: { llm: { model: 'llama3' } } })).toBeNull();
    expect(natalRoute({ substrate: { model: 'llama3' } })).toBeNull();
  });
  test('returns null for absent substrate', () => {
    expect(natalRoute({})).toBeNull();
    expect(natalRoute(null)).toBeNull();
  });
});

describe('isLocalKind', () => {
  test('only "local" is local', () => {
    expect(isLocalKind('local')).toBe(true);
    expect(isLocalKind('cloud')).toBe(false);
    expect(isLocalKind(null)).toBe(false);
  });
});

describe('resolveRoute', () => {
  test('uses a configured override, carrying its endpoint + kind', () => {
    const r = resolveRoute({
      natal: NATAL,
      override: { provider: 'anthropic', model: 'claude-haiku-4-5' },
      providers: PROVIDERS,
    });
    expect(r).toMatchObject({
      provider: 'anthropic', model: 'claude-haiku-4-5',
      endpoint: 'https://api.anthropic.com', kind: 'cloud',
      source: 'override', fellBack: false, reason: null,
    });
  });

  test('drops an unconfigured override and lands on the machine default, reporting why', () => {
    const r = resolveRoute({
      natal: NATAL,
      override: { provider: 'openai', model: 'gpt-4o' },
      providers: PROVIDERS,
      fallback: { provider: 'lm-studio', model: 'local-model' },
    });
    expect(r).toMatchObject({
      provider: 'lm-studio', model: 'local-model',
      source: 'machine-default', fellBack: true, reason: 'override-provider-not-configured',
    });
  });

  test('drops an unknown override provider, reporting why', () => {
    const r = resolveRoute({
      natal: NATAL,
      override: { provider: 'z-ai', model: 'glm-4.6' },
      providers: PROVIDERS,
      fallback: { provider: 'lm-studio', model: 'local-model' },
    });
    expect(r.source).toBe('machine-default');
    expect(r.fellBack).toBe(true);
    expect(r.reason).toBe('override-provider-unknown');
  });

  test('drops an incomplete override, reporting why', () => {
    const r = resolveRoute({
      natal: NATAL,
      override: { provider: 'anthropic' }, // no model
      providers: PROVIDERS,
      fallback: { provider: 'lm-studio', model: 'local-model' },
    });
    expect(r.source).toBe('machine-default');
    expect(r.reason).toBe('override-incomplete');
  });

  test('natal does NOT steer routing — birth history only (models are fluid)', () => {
    const r = resolveRoute({
      natal: NATAL,
      providers: PROVIDERS,
      fallback: { provider: 'lm-studio', model: 'local-model' },
    });
    expect(r).toMatchObject({
      provider: 'lm-studio', model: 'local-model',
      source: 'machine-default', fellBack: false, reason: null,
    });
  });

  test('uses the machine default when there is no override (legacy or not)', () => {
    const r = resolveRoute({
      natal: null,
      override: null,
      providers: PROVIDERS,
      fallback: { provider: 'lm-studio', model: 'local-model' },
    });
    expect(r).toMatchObject({ source: 'machine-default', provider: 'lm-studio', model: 'local-model' });
  });

  test('yields a "none" route when nothing is resolvable', () => {
    const r = resolveRoute({ providers: PROVIDERS });
    expect(r).toMatchObject({ source: 'none', provider: null, reason: 'no-route' });
  });

  test('the resolved route is frozen', () => {
    const r = resolveRoute({ natal: NATAL, providers: PROVIDERS });
    expect(Object.isFrozen(r)).toBe(true);
  });
});
