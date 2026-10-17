/**
 * The shared substrate catalog view — what stream and the HUD both sit on.
 * Matching and the authorized-or-loaded filter are pure; the live walk is
 * proven by the inference + substrate-models HTTP tests.
 */
import { describe, expect, test } from 'vitest';
import {
  matchCatalogModel, offerableModels,
} from '../../backend/services/substrate-model-view.js';

const CATALOG = Object.freeze([
  { id: 'neuma/gemma-4-31b-q8/gemma-4-31B-it-Q8_0', name: 'gemma-4-31B-it-Q8_0', path: '/mnt/data/neuma/gemma-4-31b-q8/gemma-4-31B-it-Q8_0.gguf', servingModel: 'gemma-4-31b', authorized: true },
  { id: 'pub/qwen/qwen3', name: 'qwen3', path: '/mnt/data/pub/qwen/qwen3.gguf', authorized: false },
  { id: 'pub/yi/yi', name: 'yi', path: '/mnt/data/pub/yi/yi.gguf', authorized: false },
]);

describe('matchCatalogModel', () => {
  test('an exact path wins over an earlier basename collision', () => {
    const twins = [
      { id: 'ai-gemma', name: 'gemma-4-31b-Q8_0', path: '/models/gemma-4-31b-Q8_0.gguf' },
      { id: 'neuma-gemma', name: 'gemma-4-31b-Q8_0', path: '/mnt/external/models/gemma-4-31b-Q8_0.gguf' },
    ];
    expect(matchCatalogModel(twins, '/mnt/external/models/gemma-4-31b-Q8_0.gguf').id).toBe('neuma-gemma');
  });

  test('matches catalog id, path, servingModel, and basename', () => {
    const row = CATALOG[0];
    expect(matchCatalogModel(CATALOG, row.id)).toBe(row);
    expect(matchCatalogModel(CATALOG, row.path)).toBe(row);
    expect(matchCatalogModel(CATALOG, row.servingModel)).toBe(row);
    expect(matchCatalogModel(CATALOG, 'gemma-4-31B-it-Q8_0')).toBe(row);
    expect(matchCatalogModel(CATALOG, '/other/gemma-4-31B-it-Q8_0.gguf')).toBe(row);
  });

  test('an FD name matches nothing — it is not an identity', () => {
    expect(matchCatalogModel(CATALOG, '/proc/self/fd/4')).toBeNull();
    expect(matchCatalogModel(CATALOG, '/dev/fd/4')).toBeNull();
  });

  test('unknown or empty served keys match nothing', () => {
    expect(matchCatalogModel(CATALOG, 'no-such-model')).toBeNull();
    expect(matchCatalogModel(CATALOG, null)).toBeNull();
    expect(matchCatalogModel(null, 'x')).toBeNull();
  });
});

describe('offerableModels', () => {
  test('authorized rows plus the loaded row, even when the gate would refuse it', () => {
    const offered = offerableModels(CATALOG, 'pub/qwen/qwen3');
    expect(offered.map((m) => m.id)).toEqual([
      'neuma/gemma-4-31b-q8/gemma-4-31B-it-Q8_0',
      'pub/qwen/qwen3',
    ]);
  });

  test('a loaded authorized row is not duplicated', () => {
    expect(offerableModels(CATALOG, CATALOG[0].id)).toHaveLength(1);
  });

  test('nothing loaded → only authorized rows', () => {
    expect(offerableModels(CATALOG, null).map((m) => m.id))
      .toEqual(['neuma/gemma-4-31b-q8/gemma-4-31B-it-Q8_0']);
  });
});
