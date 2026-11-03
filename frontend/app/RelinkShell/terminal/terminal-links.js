const HTTP_URL = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[\],.;:!?)\]}]+$/g;

const normalized = (raw) => {
  try {
    const url = new URL(String(raw).replace(TRAILING_PUNCTUATION, ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
};

/** Pure — every usable http(s) URL in one terminal line, with cell offsets. */
export const linksIn = (text) => {
  const links = [];
  for (const match of String(text || '').matchAll(HTTP_URL)) {
    const url = normalized(match[0]);
    if (url) links.push(Object.freeze({ url, start: match.index, end: match.index + match[0].length }));
  }
  return Object.freeze(links);
};

/** Pure — the URL under a one-based terminal cell column, or null. */
export const linkAt = (text, column) => linksIn(text)
  .find((link) => Number.isInteger(column) && column >= link.start + 1 && column <= link.end) ?? null;

/** Pure — pointer coordinates to one-based viewport cells, or null outside the screen. */
export const terminalCellAt = ({ clientX, clientY, rect, cols, rows }) => {
  if (!(rect?.width > 0 && rect.height > 0 && cols > 0 && rows > 0)) return null;
  const x = Math.floor((clientX - rect.left) / (rect.width / cols)) + 1;
  const y = Math.floor((clientY - rect.top) / (rect.height / rows)) + 1;
  return x >= 1 && x <= cols && y >= 1 && y <= rows ? Object.freeze({ x, y }) : null;
};

export const TERMINAL_LINK_ITEMS = Object.freeze([
  Object.freeze({ kind: 'item', id: 'integrated', label: 'Open in integrated browser' }),
  Object.freeze({ kind: 'item', id: 'external', label: 'Open in external browser' }),
]);
