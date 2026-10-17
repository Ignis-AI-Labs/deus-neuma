import { modelOptions } from '../../frontend/app/RelinkShell/model-options.js';

describe('modelOptions', () => {
  test('keeps the current custom id and exposes friendly catalog labels', () => {
    expect(modelOptions([{ id: 'glm-5.2', name: 'GLM-5.2' }], 'private-model')).toEqual([
      { value: 'glm-5.2', label: 'GLM-5.2 / glm-5.2' },
      { value: 'private-model', label: 'private-model' },
    ]);
  });
});
