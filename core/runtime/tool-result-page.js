/** Exact character paging of a stored result; cursor boundaries preserve UTF-16 pairs. */
const isHigh = (code) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code) => code >= 0xdc00 && code <= 0xdfff;

/** The standing page ceiling; a caller that measured the room may raise it (read-room.js). */
export const PAGE_CHARS_MAX = 3000;

/** Pure - bounded page with an explicit next offset, or a validation error. */
export const pageToolResult = (record, { offset = 0, pageChars = PAGE_CHARS_MAX, cap = 4000, maxPageChars = PAGE_CHARS_MAX } = {}) => {
  const { content, ref } = record;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > content.length) {
    throw new Error('offset must be an integer within the stored result');
  }
  if (!Number.isSafeInteger(pageChars) || pageChars < 2 || pageChars > maxPageChars) {
    throw new Error(`pageChars must be an integer from 2 to ${maxPageChars}`);
  }
  if (!Number.isSafeInteger(cap) || cap < 512) throw new Error('page response cap must be at least 512 chars');
  if (isLow(content.charCodeAt(offset)) && isHigh(content.charCodeAt(offset - 1))) {
    throw new Error('offset splits a Unicode pair; use the previous page next_offset');
  }
  let end = Math.min(content.length, offset + Math.min(pageChars, cap - 256));
  if (end < content.length && isHigh(content.charCodeAt(end - 1)) && isLow(content.charCodeAt(end))) end--;
  if (end === offset && offset < content.length) end = offset + 2;
  const nextOffset = end < content.length ? end : null;
  const response = `[ccr:${ref} page @${offset}-${end} of ${content.length}; next_offset: ${nextOffset ?? 'end'}]\n${content.slice(offset, end)}`;
  if (response.length > cap) throw new Error('page metadata exceeds the response cap');
  return Object.freeze({ response, mode: 'page', start: offset, end, nextOffset, totalChars: content.length });
};
