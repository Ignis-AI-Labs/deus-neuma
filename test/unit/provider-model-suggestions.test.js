// Provider model suggestions are pure: live discovery stays first while the
// broader committed and curated catalogs remain available.

import { modelSuggestionsFor } from '../../backend/services/provider-probe.js';

describe('modelSuggestionsFor', () => {
  test('does not let one live Z.AI model hide the full curated set', () => {
    const models = modelSuggestionsFor(
      { id: 'z-ai', defaultModel: 'glm-4.6', models: [] },
      [{ id: 'glm-4.6', name: 'glm-4.6' }],
    );
    expect(models[0].id).toBe('glm-4.6');
    expect(models.map((model) => model.id)).toEqual(expect.arrayContaining([
      'glm-5.2', 'glm-5.1', 'glm-5', 'glm-4.7', 'glm-4.6', 'glm-4.5-air',
    ]));
    expect(models.length).toBeGreaterThan(10);
  });

  test('deduplicates ids and enriches raw live names from catalog metadata', () => {
    const models = modelSuggestionsFor(
      {
        id: 'catalog-provider',
        defaultModel: 'model-a',
        models: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }],
      },
      [{ id: 'model-a', name: 'model-a' }],
    );
    expect(models).toEqual([
      { id: 'model-a', name: 'Model A' },
      { id: 'model-b', name: 'Model B' },
    ]);
  });
});
