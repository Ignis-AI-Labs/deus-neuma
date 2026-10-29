// waiting-view.js — how the WAITING ON YOU account reads on the desk. Pure.
//
// Design note, 2026-10-24 (#585): […] One account (the
// backend's /api/v1/waiting) drives the notification tray's mark and section
// (bottom-right, Design note, 2026-10-24: […]) and every platform window's band, so two places can never disagree. SHINKEI:
// the count shown is the count of items listed — nothing is counted that the
// list does not name.

/** What each kind of decision is called, in the operator's words. */
export const KIND_LABEL = Object.freeze({
  approval: 'APPROVAL',
  ask: 'QUESTION',
  plan: 'PLAN',
  seal: 'SEAL',
  'house-ask': 'HOUSE ASK',
  charter: 'CHARTER',
  post: 'POST',
  reply: 'REPLY',
  proposal: 'PROPOSAL',
  'campaign-ask': 'CAMPAIGN ASK',
  spend: 'SPEND',
  'treasury-flag': 'TREASURY FLAG',
  mandate: 'MANDATE',
  'link-change': 'LINKS',
  'company-line': 'COMPANY LINE',
  hands: 'YOUR HANDS',
  security: 'SECURITY',
});

/** The most copy a band row shows whole — and so the most it may approve in one press. */
export const BAND_TEXT_MAX = 120;
/** How many of a platform's decisions its band lists before it counts the rest. */
export const BAND_ROWS = 3;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long a decision has waited, at a glance: NOW, 4M, 2H 10M, 3D 4H.
 * @param {?string} atIso
 * @param {number} now - epoch ms
 * @returns {string}
 */
export const waitedLabel = (atIso, now) => {
  const ms = now - Date.parse(atIso);
  if (!Number.isFinite(ms)) return '—';
  if (ms < MINUTE) return 'NOW';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}M`;
  if (ms < DAY) {
    const m = Math.floor((ms % HOUR) / MINUTE);
    return `${Math.floor(ms / HOUR)}H${m ? ` ${m}M` : ''}`;
  }
  const h = Math.floor((ms % DAY) / HOUR);
  return `${Math.floor(ms / DAY)}D${h ? ` ${h}H` : ''}`;
};

/** Who asks: the being by name, else its lane, else the house itself. */
export const whoLabel = (item) => item?.who?.name || item?.who?.laneId || 'THE HOUSE';

/**
 * Only one platform's decisions (its queue drafts and replies).
 * @param {ReadonlyArray<object>} items
 * @param {string} channelId
 */
export const ofPlatform = (items, channelId) => (items || []).filter((i) => i.where?.channelId === channelId);

/**
 * The items that were not in the last account — what just arrived.
 * @param {ReadonlySet<string>|null} seen - ids of the last account (null: the first read, nothing is new)
 * @param {ReadonlyArray<object>} items
 */
export const arrivals = (seen, items) => (seen ? (items || []).filter((i) => !seen.has(i.id)) : []);

/**
 * Should an arrival sound? A chat card already sounds in its own stream as it
 * lands (stream-message-handlers.js), so only what arrives elsewhere does.
 * @param {ReadonlyArray<object>} fresh
 */
export const arrivalSounds = (fresh) => fresh.some((i) => i.where?.app !== 'chat' && i.where?.app !== 'council');

/**
 * May the band approve this item in one press? Only where the backend found
 * nothing hidden behind the yes (oneTap: no platform card of choices, no
 * unseen image, no thread riding along) AND the band shows the copy whole.
 * @param {object} item
 */
export const bandMayApprove = (item) => Boolean(item?.oneTap)
  && typeof item.text === 'string' && item.text.length <= BAND_TEXT_MAX;

/**
 * A platform band's rows: the longest-waiting first, at most BAND_ROWS, and
 * how many more wait beyond them.
 * @param {ReadonlyArray<object>} items - already one platform's, oldest first
 */
export const bandRows = (items) => ({ shown: (items || []).slice(0, BAND_ROWS), more: Math.max(0, (items || []).length - BAND_ROWS) });

/**
 * The indicator's line: how many, and how long the oldest has waited.
 * @param {{count: number, oldestAt: ?string}} account
 * @param {number} now
 */
export const indicatorLine = (account, now) => ({
  count: account?.count ?? 0,
  oldest: account?.oldestAt ? waitedLabel(account.oldestAt, now) : null,
});

/**
 * What the tray's mark says on hover and to a screen reader: the true count
 * and how long the oldest has waited. Null while nothing waits.
 * @param {{count: number, oldest: ?string}} line - indicatorLine's answer
 * @returns {?string}
 */
export const markWords = (line) => {
  if (!line?.count) return null;
  return `${line.count} waiting on you${line.oldest ? ` · oldest ${line.oldest}` : ''}`;
};

/**
 * What the tray's bell says on hover and to a screen reader: what waits
 * first, then a standing mandate, then the unread notifications.
 * @param {{count: number, oldest: ?string}} line
 * @param {number} unread
 * @param {?string} error - the account's read failure, when nothing was read
 * @param {?string} [mandate] - the active mandate's words (mandate-view.js bellMandate)
 */
export const bellWords = (line, unread, error, mandate = null) => {
  const owed = markWords(line) || (error ? `waiting on you cannot be read: ${error}` : null);
  const notes = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';
  return [owed, mandate, notes].filter(Boolean).join(' · ');
};

/**
 * The tray's arrival toasts after a fresh account: what just arrived stands
 * first, and a toast whose decision is already made (gone from the account)
 * retires at once. At most `cap` stand.
 * @param {ReadonlyArray<object>} toasts - standing
 * @param {ReadonlyArray<object>} fresh - just arrived
 * @param {ReadonlyArray<object>} items - the account's items now
 * @param {number} [cap]
 */
export const nextToasts = (toasts, fresh, items, cap = 2) => {
  const live = new Set((items || []).map((i) => i.id));
  const ids = new Set(fresh.map((f) => f.id));
  return [...fresh, ...toasts.filter((t) => !ids.has(t.id))].filter((t) => live.has(t.id)).slice(0, cap);
};

/**
 * The selector of the card an item lives on, once its window shows it — the
 * mark each card carries (data-wait-id on a chat card, data-entry-id on a
 * queue card, data-ask on a house ask, data-proposal-id on a proposal,
 * data-spend-id on a SPEND card, data-flag-id on a Quaestor's flag,
 * data-link-change-id on a link change the CMO proposed).
 * @param {object} item
 * @returns {?string}
 */
export const cardSelector = (item) => {
  const w = item?.where || {};
  const safe = (v) => String(v).replace(/["\\]/g, '');
  if (w.cardId) return `[data-wait-id="${safe(w.cardId)}"]`;
  if (w.entryId) return `[data-entry-id="${safe(w.entryId)}"]`;
  if (w.askId) return `[data-ask="${safe(w.askId)}"]`;
  if (w.proposalId) return `[data-proposal-id="${safe(w.proposalId)}"]`;
  if (w.spendId) return `[data-spend-id="${safe(w.spendId)}"]`;
  if (w.flagId) return `[data-flag-id="${safe(w.flagId)}"]`;
  if (w.changeId) return `[data-link-change-id="${safe(w.changeId)}"]`;
  if (w.handsId) return `[data-hands-id="${safe(w.handsId)}"]`;
  if (w.app === 'companyline' && w.companyId) return `[data-company-line="${safe(w.companyId)}"]`;
  if (w.tab === 'charter') return '[data-charter-pending]';
  return null;
};
