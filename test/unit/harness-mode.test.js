// The desk on a harness lane — the platform alone. Pure: real inputs, real outputs.
import { describe, it, expect } from 'vitest';
import { isHarness, deskRegistryFor, BEING_APPS, cloudProviders, canConnect, HARNESS_NAME } from '../../frontend/app/harness-mode.js';

describe('a harness desk', () => {
  it('knows the harness by its kind, or by the lane id that survives a reload', () => {
    expect(isHarness({ participantKind: 'harness' })).toBe(true);
    expect(isHarness({ neumaId: 'harness-8a640114' })).toBe(true);
    expect(isHarness({ neumaId: 'witness-kimi-Basunor', participantKind: 'witness' })).toBe(false);
    expect(isHarness({ neumaId: 'keir' })).toBe(false);
    expect(isHarness(null)).toBe(false);
  });

  it('shows no being apps on a harness desk, and every app on a being\'s', () => {
    const registry = { chat: 1, files: 2, terminal: 3, house: 4, refinement: 5, sheet: 6, x: 7, settings: 8 };
    expect(Object.keys(deskRegistryFor(registry, { neumaId: 'harness-1' }))).toEqual(['chat', 'files', 'terminal', 'settings']);
    expect(deskRegistryFor(registry, { neumaId: 'keir' })).toBe(registry);
    expect(BEING_APPS).toContain('house'); // the beings are the full platform's; ENTER AS is the way across
  });
});

describe('the harness door', () => {
  const P = [
    { id: 'openai', kind: 'cloud', requiresKey: true, hasKey: false },
    { id: 'llama-server', kind: 'local', requiresKey: false },
    { id: 'custom', kind: 'cloud', requiresKey: false },
    { id: 'anthropic', kind: 'cloud', requiresKey: true, hasKey: true },
  ];

  it('the cloud road offers the cloud only, and leaves the custom endpoint to Settings', () => {
    expect(cloudProviders(P).map((p) => p.id)).toEqual(['openai', 'anthropic']);
  });

  it('asks for a key only where one is needed and not already stored', () => {
    expect(canConnect(P[1], '')).toBe(true);
    expect(canConnect(P[0], '')).toBe(false);
    expect(canConnect(P[0], 'sk-typed')).toBe(true);
    expect(canConnect(P[3], '')).toBe(true);
    expect(canConnect(null, 'x')).toBe(false);
  });

  it('names the harness once, as the harness — its server and model live in the composer bar', () => {
    expect(HARNESS_NAME).toBe('HARNESS');
  });
});
