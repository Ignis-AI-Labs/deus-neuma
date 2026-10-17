// CLI routing lib — pure formatters + parseModelId. Real inputs, real outputs.
import { describe, test, expect } from 'vitest';
import { parseModelId, formatProviders, formatModels, formatRouteView } from '../../cli/lib/routing.js';

describe('parseModelId', () => {
  test('splits on the first slash, keeps later slashes in the model', () => {
    expect(parseModelId('anthropic/claude-opus-4-6')).toEqual({ provider: 'anthropic', model: 'claude-opus-4-6' });
    expect(parseModelId('openrouter/anthropic/claude')).toEqual({ provider: 'openrouter', model: 'anthropic/claude' });
  });
  test('rejects malformed ids', () => {
    for (const bad of ['bare', '/leading', 'trailing/', '', null, undefined]) {
      expect(parseModelId(bad)).toBeNull();
    }
  });
});

describe('formatProviders', () => {
  test('marks configured providers with * and labels key state', () => {
    const out = formatProviders([
      { id: 'lm-studio', kind: 'local', requiresKey: false, hasKey: false, endpoint: 'http://localhost:1234' },
      { id: 'anthropic', kind: 'cloud', requiresKey: true, hasKey: true, endpoint: 'https://api.anthropic.com' },
      { id: 'openai', kind: 'cloud', requiresKey: true, hasKey: false, endpoint: 'https://api.openai.com' },
    ]);
    expect(out).toMatch(/\* lm-studio\s+local\s+keyless/);   // keyless local → configured
    expect(out).toMatch(/\* anthropic\s+cloud\s+key set/);   // key set → configured
    expect(out).toMatch(/\n {2}openai\s+cloud\s+needs key/); // needs key → unmarked
  });
  test('empty list', () => {
    expect(formatProviders([])).toBe('(no providers)\n');
  });
});

describe('formatModels', () => {
  test('one provider/model per line', () => {
    expect(formatModels('anthropic', [{ id: 'claude-opus-4-6' }, { id: 'claude-haiku-4-5' }]))
      .toBe('anthropic/claude-opus-4-6\nanthropic/claude-haiku-4-5\n');
  });
  test('empty list', () => {
    expect(formatModels('custom', [])).toBe('(no models)\n');
  });
});

describe('formatRouteView', () => {
  const natal = { provider: 'lm-studio', model: 'qwen3.5-122b-a10b' };
  test('override active', () => {
    const out = formatRouteView('fenna', {
      natal, override: { provider: 'anthropic', model: 'claude-opus-4-6' },
      effective: { provider: 'anthropic', model: 'claude-opus-4-6', source: 'override' },
    });
    expect(out).toMatch(/natal: {5}lm-studio\/qwen3\.5-122b-a10b/);
    expect(out).toMatch(/override: {2}anthropic\/claude-opus-4-6/);
    expect(out).toMatch(/effective: anthropic\/claude-opus-4-6 \[override\]/);
  });
  test('override dropped → riding the machine default, with the reason', () => {
    const out = formatRouteView('fenna', {
      natal, override: { provider: 'openai', model: 'gpt-4o' },
      effective: { provider: 'lm-studio', model: 'gemma-4-31b', source: 'machine-default', fellBack: true, reason: 'override-provider-not-configured' },
    });
    expect(out).toMatch(/override dropped: override-provider-not-configured/);
  });
  test('no override → riding the machine default; natal shown as history', () => {
    const out = formatRouteView('fenna', { natal, override: null, effective: { provider: 'lm-studio', model: 'gemma-4-31b', source: 'machine-default' } });
    expect(out).toMatch(/override: {2}\(none - riding the machine default\)/);
    expect(out).toMatch(/natal: {5}lm-studio\/qwen3\.5-122b-a10b \(birth history\)/);
    expect(out).toMatch(/effective: lm-studio\/gemma-4-31b \[machine-default\]/);
  });
});
