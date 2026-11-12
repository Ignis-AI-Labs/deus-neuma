/**
 * READ ROOM — how much a being may read at once, measured against the room
 * its conversation actually has left.
 *
 * Design note, 2026-10-06: […]
 *
 * So there are three ways to read, and the cap follows the intent:
 *   - NAVIGATING (a plain read): the standing cap (tool-exchange.js) holds; an
 *     over-cap file is told its size and the moves that read only what is
 *     needed — search inside it, read a line range, or read it whole.
 *   - A RANGE (offset/limit) was asked for on purpose: it rides whole, up to
 *     the room left.
 *   - WHOLE: the full text rides when it fits the room; when it does not, the
 *     lines that fit ride with an honest account — its size, the room, where
 *     to continue, and whether a fresh chat could hold it at all.
 *
 * The room is the served window minus the latest round's MEASURED prompt
 * (portal-turn-rounds.js captureUsage), less a reserve for the answer.
 */
import { TOOL_RESULT_MAX_CHARS } from './tool-exchange.js';
import { PAGE_CHARS_MAX } from '../../core/runtime/tool-result-page.js';

/** Conservative chars per token — code and dense prose run 3–4. */
export const CHARS_PER_TOKEN = 3;
/** A window nobody measured is treated as a small machine's. */
export const UNKNOWN_WINDOW_TOKENS = 32768;
/** Held back for the being's own thinking and answer. */
const ANSWER_RESERVE_TOKENS = 8192;
/** What a fresh chat already carries before any reading (a being's standing head ≈13.4k). */
const FRESH_CHAT_BASE_TOKENS = 16000;
/** A whole read that cannot fit takes at most this share of the room. */
const OVERFLOW_ROOM_SHARE = 0.9;

const toTokens = (chars) => Math.ceil(chars / CHARS_PER_TOKEN);
const fmt = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : String(n));

/**
 * Impure — note what this round measured (the room's two inputs).
 * @param {Object} connection
 * @param {{contextTokens?: number|null}|null} budget the turn's context budget
 * @param {{promptTokens?: number}|null} usage the round's measured usage
 */
export const noteRoundRoom = (connection, budget, usage) => {
  if (!connection) return;
  const promptTokens = Number.isFinite(usage?.promptTokens) ? usage.promptTokens : connection._turnRoom?.promptTokens ?? null;
  connection._turnRoom = { window: budget?.contextTokens ?? null, promptTokens };
};

/**
 * Pure — the room left, in tokens and chars.
 * @param {{window?: number|null, promptTokens?: number|null}|null} room
 * @returns {{window: number, known: boolean, leftTokens: number, leftChars: number}}
 */
export const roomOf = (room) => {
  const known = Number.isFinite(room?.window) && room.window > 0;
  const window = known ? room.window : UNKNOWN_WINDOW_TOKENS;
  const used = Number.isFinite(room?.promptTokens) ? room.promptTokens : 0;
  const reserve = Math.max(ANSWER_RESERVE_TOKENS, Math.floor(window / 16));
  const leftTokens = Math.max(0, window - used - reserve);
  return { window, known, leftTokens, leftChars: leftTokens * CHARS_PER_TOKEN };
};

// Pure — the first whole lines of `text` within `chars`; at least one line,
// and a single line longer than the budget (minified text) is cut to it.
const linesWithin = (text, chars) => {
  const lines = text.split('\n');
  let used = 0;
  let count = 0;
  for (const line of lines) {
    if (count > 0 && used + line.length + 1 > chars) break;
    used += line.length + 1;
    count += 1;
  }
  const kept = lines.slice(0, count).join('\n');
  return { text: kept.length > chars ? kept.slice(0, Math.max(0, chars)) : kept, count, total: lines.length };
};

/**
 * Pure — fit one fs/read result to its intent and the room. Anything that is
 * not a single-file text read passes through unchanged.
 * @param {{window?: number|null, promptTokens?: number|null}|null} room
 * @param {{server: string, tool: string, args: Object, content: string, defaultCap?: number}} read
 * @returns {{content: string, cap?: number}}
 */
export const fitRead = (room, { server, tool, args, content, defaultCap = TOOL_RESULT_MAX_CHARS }) => {
  const isFileRead = server === 'fs' && tool === 'read' && typeof content === 'string'
    && !(Array.isArray(args?.paths) && args.paths.length) && args?.info !== true;
  if (!isFileRead) return { content };
  const { window, known, leftTokens, leftChars } = roomOf(room);
  const ranged = Number.isInteger(args.offset) || Number.isInteger(args.limit)
    || Number.isInteger(args.head) || Number.isInteger(args.tail);

  if (args.whole === true && !ranged) {
    if (content.length <= leftChars) return { content, cap: content.length };
    const fit = linesWithin(content, Math.floor(leftChars * OVERFLOW_ROOM_SHARE));
    const fresh = toTokens(content.length) <= roomOf({ window, promptTokens: FRESH_CHAT_BASE_TOKENS }).leftTokens;
    const note = `[whole read: this file is ~${fmt(toTokens(content.length))} tokens (${fit.total} lines); this conversation has room for ~${fmt(leftTokens)} more`
      + `${known ? '' : ' (window not measured — assumed small)'}. Shown: lines 1–${fit.count}. `
      + `Review it in parts: note what matters from this part, then continue with {"path", "offset": ${fit.count + 1}, "limit": …} — `
      + 'what a turn reads leaves the window when the turn ends, so the room comes back. '
      + `${fresh ? 'A fresh chat could hold all of it.' : `Even a fresh chat (~${fmt(window)}-token window) cannot hold all of it at once.`} `
      + 'Tell your operator this limit plainly before you review.]';
    const shown = `${note}\n${fit.text}`;
    return { content: shown, cap: shown.length };
  }
  if (ranged) return content.length <= leftChars ? { content, cap: Math.max(defaultCap, content.length) } : { content };
  if (content.length <= defaultCap) return { content };
  const lines = content.split('\n').length;
  const fits = content.length <= leftChars;
  const note = `[this file is ${lines} lines, ~${fmt(toTokens(content.length))} tokens — shown cut. Read only what you need: `
    + '{"pattern", "path", "content": true} with fs/search finds the lines; {"path", "offset", "limit"} reads a line range; '
    + `{"path", "whole": true} reads all of it (${fits ? 'it fits the room left' : `it does NOT fit the ~${fmt(leftTokens)} tokens left — you would get the first part`}).]`;
  return { content: `${note}\n${content}` };
};

/** A listing (posts, replies, a queue) takes at most this share of the room… */
const LISTING_ROOM_SHARE = 0.25;
/** …and never more than this: 25 whole posts with the house's answers beside them. */
export const LISTING_CHARS_MAX = 40000;

/**
 * Pure — the window a whole-entry listing (read_x, replies_list, queue_list,
 * the platform reads) may fill now: the standing cap, raised to a share of
 * the room left. Design note, 2026-11-12: a fixed ~3,900-char window held back four of
 * ten replies on a 262K context, and the CMO missed the one it was looking
 * for. The listing still drops its oldest whole entries past this window.
 * @param {{window?: number|null, promptTokens?: number|null}|null} room
 * @returns {number} chars
 */
export const listingRoom = (room) => Math.max(TOOL_RESULT_MAX_CHARS - 120,
  Math.min(LISTING_CHARS_MAX, Math.floor(roomOf(room).leftChars * LISTING_ROOM_SHARE)));

/**
 * Pure — how large one retrieve_result page may be now: the standing 3,000
 * chars, raised to most of the room left (so a long cut result reads in a few
 * pages, not dozens), and the response cap that holds that page.
 * @param {{window?: number|null, promptTokens?: number|null}|null} room
 * @returns {{maxPageChars: number, cap: number}}
 */
export const pageRoom = (room) => {
  const maxPageChars = Math.max(PAGE_CHARS_MAX, Math.floor(roomOf(room).leftChars * OVERFLOW_ROOM_SHARE));
  return { maxPageChars, cap: Math.max(TOOL_RESULT_MAX_CHARS, maxPageChars + 256) };
};

/**
 * Pure — fit the documents the operator attached to this message into the
 * room the turn starts with (the window less the last measured standing
 * prompt; a fresh chat counts its standing head). A document that fits rides
 * whole; the first that does not carries the lines that fit and an honest
 * note; any after it carry only the note. No room given = no fitting (the
 * caller's own ceiling holds).
 * @param {Array<{name: string, text: string}>} docs
 * @param {{window?: number|null, promptTokens?: number|null}|null} [room]
 * @returns {Array<{name: string, text: string, cut?: true}>}
 */
export const fitDocs = (docs, room = null) => {
  if (!room) return docs;
  const promptTokens = Number.isFinite(room.promptTokens) && room.promptTokens > 0 ? room.promptTokens : FRESH_CHAT_BASE_TOKENS;
  const { window, leftTokens, leftChars } = roomOf({ window: room.window, promptTokens });
  const freshTokens = roomOf({ window, promptTokens: FRESH_CHAT_BASE_TOKENS }).leftTokens;
  let left = Math.floor(leftChars * OVERFLOW_ROOM_SHARE);
  return docs.map((doc) => {
    if (doc.text.length <= left) { left -= doc.text.length; return doc; }
    const fit = left > 0 ? linesWithin(doc.text, left) : { text: '', count: 0, total: doc.text.split('\n').length };
    left = 0;
    const tokens = toTokens(doc.text.length);
    const shown = fit.count ? `only lines 1–${fit.count} fit below` : 'none of it fits below';
    const note = `[this document is ~${fmt(tokens)} tokens (${fit.total} lines); this conversation had room for ~${fmt(leftTokens)} — ${shown}. `
      + `${tokens <= freshTokens ? 'A fresh chat could hold all of it.' : `Even a fresh chat (~${fmt(window)}-token window) cannot hold all of it at once.`} `
      + 'Tell your operator plainly what you could review, and ask for the rest in parts.]';
    return { ...doc, text: fit.text ? `${note}\n${fit.text}` : note, cut: true };
  });
};
