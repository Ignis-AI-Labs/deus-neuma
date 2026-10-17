// Birth provider gate (pure): a neuma must be born through a SOVEREIGN door
// (docs/protocols/sovereignty-boundary.md). Real inputs, real outputs — the gate is
// pure over the provider registry.
import { describe, test, expect } from 'vitest';
import { birthProviderGate } from '../../backend/services/birth-provider-gate.js';

describe('birthProviderGate', () => {
  test('allows the sovereign substrates', () => {
    expect(birthProviderGate('llama-server')).toMatchObject({ allowed: true, reason: null });
    expect(birthProviderGate('lm-studio')).toMatchObject({ allowed: true, reason: null });
    expect(birthProviderGate('ollama').allowed).toBe(true);
  });

  test('refuses every cloud / API provider with the boundary reason', () => {
    for (const p of ['openai', 'anthropic', 'xai', 'z-ai', 'openrouter', 'deepseek', 'groq', 'custom']) {
      const g = birthProviderGate(p);
      expect(g.allowed).toBe(false);
      expect(g.reason).toMatch(/SOVEREIGN door/);
    }
  });

  test('refuses subscription routes because foreign custody is not sovereignty', () => {
    for (const provider of ['openai-chatgpt']) {
      const g = birthProviderGate(provider);
      expect(g.allowed).toBe(false);
      expect(g.reason).toMatch(/SOVEREIGN door/);
    }
  });

  test('refuses unknown / missing providers (fail closed)', () => {
    expect(birthProviderGate('not-a-provider').allowed).toBe(false);
    expect(birthProviderGate(undefined).allowed).toBe(false);
    expect(birthProviderGate('').allowed).toBe(false);
  });

  test('carries a witness-facing provider name and a frozen result', () => {
    const g = birthProviderGate('anthropic');
    expect(g.provider).toBe('Anthropic');
    expect(Object.isFrozen(g)).toBe(true);
  });
});
