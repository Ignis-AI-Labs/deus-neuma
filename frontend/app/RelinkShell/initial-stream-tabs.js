import { emptyTabs, openTab } from '../../../core/runtime/tabs-model.js';

/** Pure - a transferred sitting is initial state, not a later identity seed. */
export const initialStreamTabs = (restored, payload, fallbackId) => {
  if (!payload?.neumaId) return restored;
  // Older persisted window payloads carry the sitting but not its strip id.
  const tab = payload.tab ?? { ...payload, id: fallbackId };
  return openTab(emptyTabs(), tab);
};
