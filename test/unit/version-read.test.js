/**
 * version-read — the parser is proven pure on real-shaped markdown, and the
 * impure read is proven against the repo's REAL package.json + CHANGELOG.md
 * (RULE 0: the truth being served is these files, so the test reads them).
 */
import { describe, test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChangelog, readVersionInfo } from '../../backend/services/version-read.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('parseChangelog — pure', () => {
  const sample = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '### Fixed',
    '- working state, never shipped truth',
    '',
    '## [0.1.19] - 2026-09-23',
    '',
    '### Added',
    '- the bench control plane',
    '',
    '## [0.7.0] - 2026-02-22',
    '',
    '### Added',
    '- older history',
  ].join('\n');

  test('dated sections parse newest-first with their text bounded by the next section', () => {
    const entries = parseChangelog(sample);
    expect(entries.map((e) => e.version)).toEqual(['0.1.19', '0.7.0']);
    expect(entries[0].date).toBe('2026-09-23');
    expect(entries[0].text).toContain('the bench control plane');
    expect(entries[0].text).not.toContain('older history');
  });

  test('Unreleased carries no date and is never served as shipped truth', () => {
    expect(parseChangelog(sample).some((e) => e.version === 'Unreleased')).toBe(false);
  });

  test('the limit caps how many sections come back', () => {
    expect(parseChangelog(sample, { limit: 1 })).toHaveLength(1);
  });

  test('a changelog with no dated sections yields no entries', () => {
    expect(parseChangelog('# Changelog\n\n## [Unreleased]\n')).toEqual([]);
  });
});

describe('readVersionInfo — the repo’s real files', () => {
  test('serves the package version and a changelog whose newest entry is real', async () => {
    const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
    const changelog = await readFile(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
    const newest = parseChangelog(changelog)[0];

    const info = await readVersionInfo();
    expect(info.name).toBe('NEUMA');
    expect(info.version).toBe(pkg.version);
    expect(info.changelog.length).toBeGreaterThan(0);
    expect(info.changelog[0]).toEqual({ version: newest.version, date: newest.date, text: newest.text });
  });

  test('the 60s cache returns the identical payload object', async () => {
    const first = await readVersionInfo();
    const second = await readVersionInfo();
    expect(second).toBe(first);
  });
});
