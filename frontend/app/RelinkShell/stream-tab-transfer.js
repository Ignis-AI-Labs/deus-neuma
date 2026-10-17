import { normalizeTabs, tearOutPayload } from '../../../core/runtime/tabs-model.js';
import { normalizeFocus } from './desk-focus.js';

/** Pure - the window manager's payload contract is a bounded STRING. */
export const encodeStreamTransfer = (tab) => {
  const payload = JSON.stringify({ ...tearOutPayload(tab), tab });
  return payload.length <= 4096 ? payload : null;
};

/** Pure - validate the transferred sitting at the window storage boundary. */
export const decodeStreamTransfer = (payload) => {
  let raw = payload;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  if (!raw || typeof raw !== 'object') return null;
  const tab = normalizeTabs({ tabs: [raw.tab ?? { ...raw, id: 'transferred' }] }, { normalizeFocus }).tabs[0];
  if (!tab) return null;
  return Object.freeze({ ...tearOutPayload(tab), ...(raw.tab ? { tab } : {}) });
};
