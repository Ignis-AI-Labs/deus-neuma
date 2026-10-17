// stream-chats-view — what the stream says about its chats, pure.
//
// Two surfaces read this: the title line at the top of the stream (which chat
// is bound right now) and the CHATS rail beside the tasks (the quick list —
// Design note, 2026-08-15: […]). One derivation, so the
// two can never disagree about a chat's name.

import { isCouncilSession } from './session-history.js';
import { formatDateTime } from '../../utils/format.js';

/**
 * A chat's default name: its mint timestamp, human-readable. The raw id is
 * the honest fallback when the id does not carry one.
 * @param {string} id session id (session-<ms>)
 * @returns {string}
 */
// pure
export const sessionLabel = (id) => {
  const ms = Number(String(id).replace('session-', ''));
  if (!Number.isFinite(ms) || ms <= 0) return id;
  return formatDateTime(ms);
};

const two = (n) => String(n).padStart(2, '0');
const msOf = (id) => {
  const ms = Number(String(id).replace('session-', ''));
  return Number.isFinite(ms) && ms > 0 ? ms : null;
};

/**
 * MM/DD/YY — the rail's stamp (Design note, 2026-08-25: […]).
 *
 * The rail is ~220px wide and the long form ([…]) ate so
 * much of it that chat NAMES truncated to five characters — the list showed
 * you when every chat happened and refused to tell you what any of them were
 * about. The short form gives that width back to the name, which is the thing
 * you are actually scanning for.
 * @param {string} id session id
 * @returns {string} '' when the id carries no timestamp — no stamp beats a wrong one
 */
// pure
export const shortStamp = (id) => {
  const ms = msOf(id);
  if (ms === null) return '';
  const d = new Date(ms);
  return `${two(d.getMonth() + 1)}/${two(d.getDate())}/${two(d.getFullYear() % 100)}`;
};

/**
 * MM/DD/YY h:mm AM — what an UNNAMED chat wears as its name in the rail.
 *
 * The date alone would be wrong here: several chats a day is ordinary, and a
 * list of identical '08/25/26' rows is a list you cannot navigate. The time is
 * what makes an unnamed chat findable, so it rides the label, not the stamp.
 * @param {string} id session id
 * @returns {string} the raw id when it carries no timestamp
 */
// pure
export const shortWhen = (id) => {
  const ms = msOf(id);
  if (ms === null) return String(id);
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  return `${shortStamp(id)} ${h}:${two(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
};

/**
 * Filter rows by what the operator typed. Case-insensitive, matched against
 * BOTH the label and the stamp, so '08/21' finds a day and 'mirror' finds a
 * name. Pure; an empty query is every row, never zero.
 * @param {Array<{label: string, stamp: string}>} rows
 * @param {string} query
 */
// pure
export const filterRows = (rows, query) => {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return rows;
  return (rows || []).filter((r) =>
    `${r.label} ${r.stamp}`.toLowerCase().includes(q));
};

/**
 * What a row's hover tooltip says: the WHOLE name (the rail truncates it) and,
 * for a named chat, the exact moment it was minted. Design note, 2026-08-25: […]. Pure.
 * @param {{label: string, full: string, named: boolean}} row
 * @returns {string}
 */
// pure
export const rowTip = (row) => (row?.named ? `${row.label} — ${row.full}` : String(row?.full ?? ''));

/**
 * Where that tooltip sits, in viewport coordinates.
 *
 * The rail clips its own overflow (it is a scroller), so the tip cannot live
 * inside it — it is a fixed layer anchored to the row's box. Anchored by its
 * RIGHT edge to the rail's left edge, which is the one measurement available
 * before the tip has been laid out and given a width. Pure.
 * @param {{top: number, left: number}} rect - the row's bounding rect
 * @param {{width: number, height: number}} view - the viewport
 * @returns {{top: number, right: number}} CSS pixel offsets
 */
// pure
export const tipPlacement = (rect, view) => {
  const h = Number(view?.height) || 0;
  const w = Number(view?.width) || 0;
  return {
    // A row near the bottom would otherwise push its tip off-screen.
    top: Math.max(8, Math.min(Number(rect?.top) || 0, Math.max(8, h - 72))),
    right: Math.max(8, w - (Number(rect?.left) || 0) + 8),
  };
};

/**
 * The bound chat's display title, or null when nothing is bound (a fresh
 * sitting that has not minted a session yet).
 * @param {Object} labels - {"<neumaId>:<sessionId>": "name"}
 * @param {string|null} neumaId
 * @param {string|null} sessionId
 * @returns {null|{title: string, named: boolean, stamp: string}}
 *   `named` says whether the operator (or the conduit) titled it; unnamed
 *   chats wear their timestamp as the title and no separate stamp.
 */
// pure
export const chatTitleOf = (labels, neumaId, sessionId) => {
  if (!sessionId) return null;
  const label = neumaId ? (labels || {})[`${neumaId}:${sessionId}`] : null;
  const stamp = sessionLabel(sessionId);
  return label
    ? { title: label, named: true, stamp }
    : { title: stamp, named: false, stamp };
};

/**
 * The rail's rows: this being's one-on-one chats, newest first, councils
 * excluded (they are the ROOM's record), each carrying its display label and
 * whether it is the chat on screen.
 * @param {string[]} sessions - session ids, newest first (as the API lists)
 * @param {Object} labels - {"<neumaId>:<sessionId>": "name"}
 * @param {string|null} neumaId
 * @param {string|null} chatId - the bound session id
 * @returns {Array<{id: string, label: string, stamp: string, named: boolean, live: boolean}>}
 */
// pure
export const chatRows = (sessions, labels, neumaId, chatId) =>
  (Array.isArray(sessions) ? sessions : [])
    .filter((id) => !isCouncilSession(id))
    .map((id) => {
      const named = Boolean(neumaId && (labels || {})[`${neumaId}:${id}`]);
      return {
        id,
        // Short forms in the RAIL only. The title line keeps sessionLabel's
        // long form — it has one line's worth of room and no list to scan.
        label: named ? labels[`${neumaId}:${id}`] : shortWhen(id),
        stamp: shortStamp(id),
        // The full timestamp still rides the row, for its hover title: short
        // on screen, exact when you ask.
        full: sessionLabel(id),
        named,
        live: id === chatId,
      };
    });
