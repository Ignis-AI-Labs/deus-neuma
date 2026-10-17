// Vault note primitives — the markdown grammar of the knowledge vault
// (memory pyramid T3). A note is { relPath, sourceHash, frontmatter, body };
// rendering stamps body_hash into the frontmatter so a later sync can tell
// a hand-edited note (actual body hash ≠ stamped hash) from a generated one.
//
// All pure: strings in, strings out. Hashing is deterministic (sha256).

import { createHash } from 'node:crypto';

/** Short deterministic content hash (16 hex chars). @param {string} text */
export const hashText = (text) =>
  createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);

/**
 * Filesystem/wikilink-safe slug from a title. Lowercase alnum runs joined
 * by single dashes, truncated so filenames stay portable.
 * @param {string} title
 * @param {number} [max]
 */
export const slugify = (title, max = 60) =>
  String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '') || 'untitled';

const yamlScalar = (v) => (typeof v === 'number' ? String(v) : JSON.stringify(String(v)));

/**
 * Serialize a flat frontmatter map (string | number | string[] values) to a
 * YAML block. JSON string quoting is used for scalars — JSON is a strict
 * subset of YAML, so any title/quote content round-trips safely.
 * @param {Record<string, string | number | string[]>} fm
 */
const renderFrontmatter = (fm) => {
  const lines = Object.entries(fm).flatMap(([key, value]) =>
    Array.isArray(value)
      ? [`${key}:`, ...value.map((item) => `  - ${yamlScalar(item)}`)]
      : [`${key}: ${yamlScalar(value)}`]);
  return ['---', ...lines, '---'].join('\n');
};

/**
 * Render a full note file. Stamps `body_hash` (hash of the exact body text)
 * into the frontmatter — the hand-edit detector for incremental sync.
 * @param {{ frontmatter: Record<string, string | number | string[]>, body: string }} note
 * @returns {string} complete file text
 */
export const renderNote = ({ frontmatter, body }) =>
  `${renderFrontmatter({ ...frontmatter, body_hash: hashText(body) })}\n\n${body}\n`;

const parseScalar = (raw) => {
  const s = raw.trim();
  if (s.startsWith('"')) {
    try { return JSON.parse(s); } catch { return s; }
  }
  return s;
};

/**
 * Parse a note file back into { frontmatter, body }. Tolerant by design:
 * only the flat `key: value` / block-list grammar renderFrontmatter emits
 * is recognized; unknown lines are skipped, a missing frontmatter block
 * yields an empty map. Never throws on malformed input.
 * @param {string} text
 * @returns {{ frontmatter: Record<string, string | string[]>, body: string }}
 */
export const parseNote = (text) => {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) return Object.freeze({ frontmatter: Object.freeze({}), body: text });

  const frontmatter = {};
  let listKey = null;
  for (const line of match[1].split('\n')) {
    const item = /^ {2}- (.+)$/.exec(line);
    if (item && listKey) {
      frontmatter[listKey].push(parseScalar(item[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (!kv) continue;
    if (kv[2].trim() === '') {
      listKey = kv[1];
      frontmatter[listKey] = [];
    } else {
      listKey = null;
      frontmatter[kv[1]] = parseScalar(kv[2]);
    }
  }
  const body = text.slice(match[0].length).replace(/^\n/, '');
  return Object.freeze({ frontmatter: Object.freeze(frontmatter), body });
};
