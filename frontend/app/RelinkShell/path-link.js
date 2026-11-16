// path-link — which code spans in a being's speech are places you can GO
// (Design note, 2026-07-26: […]).
//
// A being names paths constantly — the folder it made, the file it wrote, the
// ground it stepped onto. Until now every one of them was dead text: the
// operator read `/workspace/repos/neuma/repos`, then went and typed it into a
// folder picker by hand. The path is already the address; it should be the
// door.
//
// Pure decision, deliberately narrow. A code span becomes a door only when its
// WHOLE content is one path — absolute by default, project-relative only where
// the caller supplies a focused base. Prose, commands, and traversal stay text.

import { isAbsolutePath } from '../../utils/path.js';

// Sentence punctuation a being trails after a path inside a span. Stripped so
// "`/mnt/thing.`" still opens /mnt/thing. Closing brackets are NOT stripped —
// a directory may legitimately end in one, and guessing there loses a real path.
const TRAILING_PUNCT = /[.,;:!?]+$/;

/**
 * The path a code span addresses, or null when it is just text.
 *
 * @param {unknown} raw - the code span's text content
 * @param {{relative?: boolean}} [options] - allow project-relative paths for a caller with a focused base
 * @returns {string|null} a normalized path, or null
 */
export const openablePath = (raw, { relative = false } = {}) => {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text.length < 2 || text.length > 4096) return null;
  const absolute = isAbsolutePath(text);
  // Markdown may explicitly allow a project-relative path; PathOpener supplies
  // the focused base. Tool lines keep the absolute-only default.
  if (!absolute && (!relative || !text.includes('/'))) return null;
  // One line, one path. A multi-line span is a code block, not an address.
  if (/[\n\r\t]/.test(text)) return null;
  // Control characters have no place in a path and are a UI-injection shape.
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return null;
  }
  // A command, not a place: `/usr/bin/env node`, `/bin/ls -la`. Two or more
  // space-separated words where the tail looks like an argument rather than a
  // path with spaces in it. Flags are the honest tell.
  if (/\s-{1,2}\w/.test(text)) return null;
  // URLs that merely begin with a slash-slash are not local paths. A Windows
  // UNC share is `\\host\share` and is NOT caught by this — it is a real place.
  if (text.startsWith('//')) return null;

  const trimmed = text.replace(TRAILING_PUNCT, '');
  if (trimmed.length < 2) return null;
  // Drop a trailing separator so /repos/ and /repos are one door, never two —
  // and C:\repos\ with it.
  const normalized = trimmed.length > 1 && /[\\/]$/.test(trimmed)
    ? trimmed.slice(0, -1)
    : trimmed;
  if (normalized.length < 2) return null;
  if (!absolute && normalized.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  return normalized;
};

// The endings a bare name must carry to be read as a site with no "https://" in front of it. Kept to endings that
// are not also common file extensions: `notes.md`, `build.sh`, `lib.so`, `main.rs` and `data.json` stay files.
const SITE_ENDINGS = new Set(['com', 'org', 'net', 'io', 'ai', 'co', 'dev', 'app', 'xyz', 'gov', 'edu', 'info', 'finance', 'exchange', 'fi', 'eu', 'uk', 'de', 'us', 'ca', 'tech', 'cloud', 'gg', 'tv']);
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,24})$/i;

/**
 * The web address a code span names, or null (Design note, 2026-11-16, right-clicking `peopledatalabs.com/data-lab/…` in a
 * member's words and being offered […]: […]). A span is a web address when its WHOLE content is one: it starts with http:// or https://, or with
 * www., or its first part is a site name with a well-known ending. It is judged BEFORE the path rule, because a
 * site with a path after it reads as a relative path otherwise.
 * @param {unknown} raw - the code span's text content
 * @returns {string|null} the address with https:// in front, or null
 */
export const webAddress = (raw) => {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().replace(TRAILING_PUNCT, '');
  if (text.length < 4 || text.length > 2048 || /[\s<>"'`\\]/.test(text)) return null;
  const schemed = /^https?:\/\//i.test(text);
  const rest = schemed ? text.replace(/^https?:\/\//i, '') : text;
  const host = rest.split(/[/?#]/)[0].replace(/:\d{1,5}$/, '');
  const ending = HOST.exec(host)?.[1]?.toLowerCase();
  if (!ending) return null;
  if (!schemed && !/^www\./i.test(host) && !SITE_ENDINGS.has(ending)) return null;
  try { return new URL(schemed ? text : `https://${text}`).href; } catch { return null; }
};

