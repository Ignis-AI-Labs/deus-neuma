// model-route-view — pure view helpers for the Models settings section.
// The interactive surface (fetch/select/set) is e2e-covered; these are the
// pure state-derivations that decide what the operator actually sees.
import { describe, expect, it } from 'vitest';
import { providerState, routeLabel, filterProviders } from '../../frontend/app/RelinkShell/model-route-view.js';

describe('providerState', () => {
  it('a stored/env key reads as KEY SET (ok)', () => {
    expect(providerState({ hasKey: true, requiresKey: true })).toEqual({ tag: 'KEY SET', cls: 'settings-tag-ok' });
    // a key present on a keyless provider still reads as set
    expect(providerState({ hasKey: true, requiresKey: false }).tag).toBe('KEY SET');
  });

  it('a keyless provider with no key reads as KEYLESS (dim), not a warning', () => {
    // local engines + custom endpoints require no key — never nag for one
    expect(providerState({ hasKey: false, requiresKey: false })).toEqual({ tag: 'KEYLESS', cls: 'settings-tag-dim' });
  });

  it('a key-requiring provider with no key reads as NEEDS KEY (warn)', () => {
    expect(providerState({ hasKey: false, requiresKey: true })).toEqual({ tag: 'NEEDS KEY', cls: 'settings-tag-warn' });
  });
});

describe('routeLabel', () => {
  it('joins a complete route as "provider / model"', () => {
    expect(routeLabel({ provider: 'anthropic', model: 'claude-opus-4-6' })).toBe('anthropic / claude-opus-4-6');
  });

  it('is null for an absent or half-filled route (never "x / undefined")', () => {
    expect(routeLabel(null)).toBeNull();
    expect(routeLabel(undefined)).toBeNull();
    expect(routeLabel({ provider: 'anthropic' })).toBeNull();
    expect(routeLabel({ model: 'claude-opus-4-6' })).toBeNull();
    expect(routeLabel({})).toBeNull();
  });
});

describe('filterProviders', () => {
  const catalog = [
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'github-copilot', name: 'GitHub Copilot' },
    { id: 'xai', name: 'xAI' },
    { id: 'lmstudio', name: 'LM Studio' },
  ];

  it('a blank query keeps the whole catalog (same array back)', () => {
    expect(filterProviders(catalog, '')).toBe(catalog);
    expect(filterProviders(catalog, '   ')).toBe(catalog);
    expect(filterProviders(catalog, null)).toBe(catalog);
  });

  it('matches id and name, case-insensitive substring', () => {
    expect(filterProviders(catalog, 'GIT').map((p) => p.id)).toEqual(['github-copilot']);
    expect(filterProviders(catalog, 'studio').map((p) => p.id)).toEqual(['lmstudio']);
    expect(filterProviders(catalog, 'ai').map((p) => p.id)).toEqual(['xai']);
  });

  it('no match narrows to empty, and a non-array yields nothing', () => {
    expect(filterProviders(catalog, 'zzz')).toEqual([]);
    expect(filterProviders(null, 'ai')).toEqual([]);
    expect(filterProviders(undefined, '')).toEqual([]);
  });
});
