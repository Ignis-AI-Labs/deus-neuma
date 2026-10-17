// Pure model-list shaping shared by every global model Select.

/**
 * Convert provider models into global Select options.
 * @param {Array<{id: string, name?: string}>} models Provider model records.
 * @param {string} current Current model id, including custom ids.
 * @returns {Array<{value: string, label: string}>} Select options.
 */
export const modelOptions = (models, current = '') => {
  const byId = new Map();
  for (const model of models || []) {
    if (!model?.id) continue;
    byId.set(model.id, model);
  }
  if (current && !byId.has(current)) byId.set(current, { id: current, name: current });
  return [...byId.values()].map((model) => ({
    value: model.id,
    label: model.name && model.name !== model.id ? `${model.name} / ${model.id}` : model.id,
  }));
};
