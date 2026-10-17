/**
 * version-read — the platform's version and changelog as DATA. The desk's
 * corner reads package.json at build time; this module lets every party —
 * the desk, a being, any HTTP caller — read the same truth at runtime from
 * the repo's own files. Changelog sections follow Keep a Changelog
 * (`## [x.y.z] - date`); Unreleased is working state, never shipped truth.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md');
const PACKAGE_PATH = path.join(ROOT, 'package.json');
const CACHE_MS = 60_000;

const SECTION_RE = /^## \[([^\]]+)\] - (.+)$/gm;

/**
 * Pure — parse dated Keep-a-Changelog sections into entries, newest first.
 * @param {string} text the changelog's raw markdown
 * @param {{limit?: number}} [options]
 * @returns {Array<{version: string, date: string, text: string}>}
 */
export const parseChangelog = (text, { limit = 5 } = {}) => {
  const marks = [...text.matchAll(SECTION_RE)];
  return marks.slice(0, limit).map((mark, i) => {
    const start = mark.index + mark[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    return { version: mark[1], date: mark[2].trim(), text: text.slice(start, end).trim() };
  });
};

let cache = null;

/**
 * impure — read the repo's version + changelog with a 60s cache. Missing or
 * corrupt files degrade to null/empty fields; this read never throws.
 * @param {{limit?: number}} [options]
 * @returns {Promise<{name: string, version: string | null, changelog: Array}>}
 */
export const readVersionInfo = async ({ limit = 5 } = {}) => {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.payload;
  const [pkg, changelogText] = await Promise.all([
    readFile(PACKAGE_PATH, 'utf8').then((t) => JSON.parse(t)).catch(() => null),
    readFile(CHANGELOG_PATH, 'utf8').catch(() => null),
  ]);
  const payload = {
    name: 'NEUMA',
    version: typeof pkg?.version === 'string' ? pkg.version : null,
    changelog: changelogText ? parseChangelog(changelogText, { limit }) : [],
  };
  cache = { at: Date.now(), payload };
  return payload;
};
