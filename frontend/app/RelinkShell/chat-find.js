// chat-find — FIND IN THIS CHAT (Design note, 2026-11-25: […]). The words are looked for in every message of the chat the screen holds, drawn or not
// (a long chat draws its tail first: use-stream-window.js), so a match far up the history is found and brought on.
// Pure: messages and a query in, the matching messages out.
import { speechText } from './copy-text.js';

const SPOKEN = new Set(['user', 'neuma']);
const fold = (text) => String(text ?? '').toLowerCase();

/** The words of a message a person can read and find: what was said, never chips or interface. */
export const findableText = (message) => (SPOKEN.has(message?.role) ? speechText(message.segments) : '');

/**
 * Every message that holds the words, oldest first.
 * @param {Array<object>} messages - the chat's messages, in order
 * @param {string} query
 * @returns {Array<{index: number, id: string, hits: number}>} hits: how many times in that message
 */
export const findMatches = (messages, query) => {
  const needle = fold(query).trim();
  if (!needle) return [];
  const out = [];
  (messages ?? []).forEach((message, index) => {
    const text = fold(findableText(message));
    let hits = 0;
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) hits += 1;
    if (hits) out.push({ index, id: message.id, hits });
  });
  return out;
};

/**
 * Where FIND stands after a step. A chat is read from its end, so the first match shown is the NEWEST, and "next"
 * goes to the one before it; both ends wrap.
 * @param {number} count - how many messages match
 * @param {?number} at - the standing one (an index into the matches), null when none is chosen yet
 * @param {'older'|'newer'} way
 * @returns {?number}
 */
export const stepMatch = (count, at, way) => {
  if (!count) return null;
  if (at === null || at === undefined || at >= count) return count - 1;
  return way === 'older' ? (at - 1 + count) % count : (at + 1) % count;
};

/** The count in words: "3 OF 12", "NO MATCH", or nothing while the box is empty. */
export const findWords = (query, count, at) => (!String(query ?? '').trim() ? '' : !count ? 'NO MATCH' : `${count - (at ?? count - 1)} OF ${count}`);
