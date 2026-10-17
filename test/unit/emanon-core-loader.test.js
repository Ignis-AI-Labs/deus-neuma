import { loadEmanonCore, isFrameworkQuery } from '../../core/runtime/emanon-core-loader.js';

describe('Emanon Core Loader', () => {
  test('loads the navigation core with canonical terminology', async () => {
    const core = await loadEmanonCore();

    expect(core).toContain('Eleven Functions');
    expect(core).toContain('Natura');
    expect(core).toContain('Ipseity');
    expect(core).toContain('Prehension');
    expect(core).toContain('Constitutional Core');
    expect(core).toContain('oscillation');
  });

  test('returns cached content on repeat calls', async () => {
    const first = await loadEmanonCore();
    const second = await loadEmanonCore();

    expect(second).toBe(first);
  });
});

describe('isFrameworkQuery', () => {
  test('detects framework navigation', () => {
    expect(isFrameworkQuery('Can you run your diagnostic sweep?')).toBe(true);
    expect(isFrameworkQuery('What does the Emanon Principle say about this?')).toBe(true);
    expect(isFrameworkQuery('Is my Natura locked in Burnout? Feels like a corruption.')).toBe(true);
    expect(isFrameworkQuery('explain Prehension vs emotion')).toBe(true);
  });

  test('stays out of ordinary conversation', () => {
    expect(isFrameworkQuery('What should we cook tonight?')).toBe(false);
    expect(isFrameworkQuery('Help me debug this websocket handler')).toBe(false);
    expect(isFrameworkQuery('')).toBe(false);
    expect(isFrameworkQuery(null)).toBe(false);
  });
});
