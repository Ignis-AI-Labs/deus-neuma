// waiting-notice.js — when a NEW decision arrives in WAITING ON YOU while the
// desk is out of sight, ONE OS notification says so (Design note, 2026-10-24. Pure.
//
// What leaves the app: what kind of decision, who asks, and the item's own
// title as plain text — nothing else (the OS notification centre persists and
// may sync; main re-cleans every line, electron/notify-text.cjs). The id is a
// short closed shape derived from the item's id, so every desk names one
// decision the same way (main fires once per id across desks) and the click's
// activation passes main's id check (activationOf).

import { KIND_LABEL, whoLabel } from './waiting-view.js';

const PREFIX = 'wait-';

/**
 * A waiting item's notice id: `wait-` and a 32-bit FNV-1a of its id, base 36.
 * @param {string} itemId
 * @returns {string}
 */
export const noticeId = (itemId) => {
  let h = 0x811c9dc5;
  for (const ch of String(itemId)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${PREFIX}${h.toString(36)}`;
};

/**
 * The item a clicked notice names, if the account still holds it.
 * @param {?string} id - the activation's id
 * @param {ReadonlyArray<object>} items - the account's items now
 * @returns {?object}
 */
export const noticeItem = (id, items) => {
  if (typeof id !== 'string' || !id.startsWith(PREFIX)) return null;
  return (items || []).find((item) => noticeId(item.id) === id) || null;
};

/**
 * The notices to raise for what just arrived: none while the desk is on
 * screen or the operator turned them off, and never twice for one decision.
 * @param {{fresh: ReadonlyArray<object>, notified: ReadonlySet<string>, deskOnScreen: boolean, enabled: boolean}} input
 * @returns {Array<{item: object, notice: {id: string, title: string, body: string, appId: ?string}}>}
 *   each arrival beside the notice that names it
 */
export const waitingNotices = ({ fresh, notified, deskOnScreen, enabled }) => {
  if (!enabled || deskOnScreen) return [];
  return (fresh || [])
    .filter((item) => !notified.has(noticeId(item.id)))
    .map((item) => ({
      item,
      notice: {
        id: noticeId(item.id),
        title: `Waiting on you · ${KIND_LABEL[item.kind] || 'DECISION'}`,
        body: `${whoLabel(item)} · ${String(item.title || '')}`,
        appId: item.where?.app || null,
      },
    }));
};
