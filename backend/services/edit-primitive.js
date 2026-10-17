// Exact-match file-edit primitive — the OpenCode pattern, NEUMA-native.
// PURE: takes a content string + edit spec, returns the next content +
// stats. Does NO filesystem IO; the caller (commands/edit.js) handles
// read/write + snapshot + stale-content check.
//
// Design choices (carried from OpenCode `packages/core/src/tool/edit.ts`
// per docs/archive/research/cli-patterns-inventory.md §3):
//   - Exact-match only (no fuzzy). Disambiguating the match is the
//     operator's responsibility; fuzziness invites silent wrong-replace.
//   - Line-ending aware. CRLF / LF detected from the file content;
//     oldString / newString containing bare \n are expanded to match the
//     file's convention. (Lookbehind (?<!\r)\n avoids double-expanding
//     a \n that's already part of a CRLF the operator typed literally.)
//   - BOM preserved. UTF-8 BOM (U+FEFF) at file start is detected,
//     stripped before search, re-prepended to output.
//   - Multi-match safety: occurrences > 1 throws unless replaceAll is
//     explicitly set. The error names the count so the operator can
//     narrow oldString or opt in to replace-all.
//   - No-match: throws with a clear "no match" message. Silent zero-
//     replace would be the worst outcome (caller never knows nothing
//     happened).
//
// Stale-content protection is NOT here — that's a fs concern (re-read
// before write) and lives in cli/commands/edit.js.

const detectLineEnding = (content) => content.includes('\r\n') ? '\r\n' : '\n';
const detectBOM = (content) => content.length > 0 && content.charCodeAt(0) === 0xFEFF;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Apply an exact-match edit to a content string.
 * @param {{
 *   content: string,
 *   oldString: string,
 *   newString: string,
 *   replaceAll?: boolean,
 * }} params
 * @returns {{
 *   nextContent: string,
 *   occurrences: number,
 *   lineEnding: '\n' | '\r\n',
 *   hadBOM: boolean,
 * }}
 */
export const applyEdit = ({ content, oldString, newString, replaceAll = false }) => {
  if (typeof content !== 'string') throw new Error('content must be a string');
  if (typeof oldString !== 'string' || oldString === '') {
    throw new Error('oldString must be a non-empty string');
  }
  if (typeof newString !== 'string') throw new Error('newString must be a string');

  const hadBOM = detectBOM(content);
  const lineEnding = detectLineEnding(content);

  // Strip BOM from working body; restore on output.
  const body = hadBOM ? content.slice(1) : content;

  // Normalize the search/replace strings to the file's line ending.
  // Lookbehind (?<!\r)\n means […] — so an
  // operator who types CRLF literally won't get it doubled.
  const normalize = (s) =>
    lineEnding === '\r\n' ? s.replace(/(?<!\r)\n/g, '\r\n') : s;

  const normalizedOld = normalize(oldString);
  const normalizedNew = normalize(newString);

  // Count occurrences via global regex on the escaped pattern.
  const occurrences = (body.match(new RegExp(escapeRegex(normalizedOld), 'g')) || []).length;

  if (occurrences === 0) {
    throw new Error('No match for oldString in file');
  }
  if (occurrences > 1 && !replaceAll) {
    throw new Error(
      `Found ${occurrences} matches for oldString; pass --replace-all to replace every one, `
      + 'or narrow oldString to make it unique.',
    );
  }

  // Apply: replaceAll uses split/join (no regex escaping issues); single
  // uses string.replace (literal-first-match, no regex flags).
  const nextBody = replaceAll
    ? body.split(normalizedOld).join(normalizedNew)
    : body.replace(normalizedOld, () => normalizedNew);

  const nextContent = hadBOM ? '﻿' + nextBody : nextBody;

  return { nextContent, occurrences, lineEnding, hadBOM };
};
