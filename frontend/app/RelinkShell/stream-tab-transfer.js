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

/**
 * Pure - the window actions that seat a transferred sitting in a stream
 * window of its own. Instance 1 is the desk's own stream and never reads a
 * payload, so an OPEN_NEW while it is closed would become instance 1 and drop
 * the sitting: the desk stream opens first and the sitting lands beside it.
 * @param {string} payload - encodeStreamTransfer's string
 * @param {Array<{id: string}>} windows - the window manager's open windows
 * @returns {object[]}
 */
export const openSittingActions = (payload, windows = []) => [
  ...((windows || []).some((w) => w.id === 'chat') ? [] : [{ type: 'OPEN', id: 'chat' }]),
  { type: 'OPEN_NEW', appId: 'chat', payload },
];
