import { openablePath } from '../path-link.js';
import { isAbsolutePath } from '../../../utils/path.js';

const HTTP_URL = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[\],.;:!?)\]}]+$/g;
const LINE_SUFFIX = /:\d+(?::\d+)?$/;
const PATH_PATTERNS = [
  /(?:\/[A-Za-z0-9._~@+%=-]+)+\/?/g,
  /[A-Za-z]:[\\/][^\s<>"'`]+/g,
  /\\\\[^\s<>"'`]+/g,
  /\.\.?\/[A-Za-z0-9._~@+%=-]+(?:\/[A-Za-z0-9._~@+%=-]+)*/g,
  /[A-Za-z0-9._~@+%=-]+(?:\/[A-Za-z0-9._~@+%=-]+)+/g,
  /[A-Za-z0-9._~@+%=-]+\.[A-Za-z0-9_-]{1,12}/g,
];
const ROOT_FILE = /^[A-Za-z0-9._~@+%=-]+\.[A-Za-z0-9_-]{1,12}$/;

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
    if (url) links.push(Object.freeze({ kind: 'url', value: url, url, start: match.index, end: match.index + match[0].length }));
  }
  return Object.freeze(links);
};

/** Pure — absolute and cwd-relative filesystem paths in terminal output. */
export const pathsIn = (text) => {
  const candidates = PATH_PATTERNS.flatMap((pattern) =>
    [...String(text || '').matchAll(pattern)].map((match) => {
      const raw = match[0].replace(LINE_SUFFIX, '');
      const path = isAbsolutePath(raw)
        ? openablePath(raw)
        : ROOT_FILE.test(raw) ? raw : openablePath(raw, { relative: true });
      return path ? { kind: 'path', value: path, start: match.index, end: match.index + match[0].length } : null;
    }).filter(Boolean));
  return Object.freeze(candidates.filter((candidate, index) => !candidates.some((other, otherIndex) =>
    otherIndex !== index && other.start <= candidate.start && other.end >= candidate.end
      && (other.end - other.start > candidate.end - candidate.start || otherIndex < index))));
};

/** Pure — URLs and paths together, with URL spans winning any overlap. */
export const doorsIn = (text) => {
  const urls = linksIn(text);
  return Object.freeze([...urls, ...pathsIn(text).filter((path) =>
    !urls.some((url) => path.start >= url.start && path.end <= url.end))]
    .sort((a, b) => a.start - b.start || b.end - a.end));
};

/** Pure — URL-only hit test, kept for the original terminal-link contract. */
export const linkAt = (text, column) => linksIn(text)
  .find((link) => Number.isInteger(column) && column >= link.start + 1 && column <= link.end) ?? null;

/** Pure — the URL or path under a one-based terminal cell column, or null. */
export const doorAt = (text, column) => doorsIn(text)
  .find((door) => Number.isInteger(column) && column >= door.start + 1 && column <= door.end) ?? null;

/** Pure — resolve a terminal-relative path against its own cwd when possible. */
export const terminalPathFor = (path, cwd) => isAbsolutePath(path) || !cwd
  ? path : `${cwd.replace(/[\\/]$/, '')}/${path}`;

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
