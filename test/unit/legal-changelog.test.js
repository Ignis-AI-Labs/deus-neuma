// No text a witness can sign changes unlogged: every current binding document's
// SHA-256 stands in docs/legal/CHANGELOG.md with its version. Real files, real hashes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadDocuments, parseVersionLine } from '../../backend/services/covenant.js';

const LEGAL = join(dirname(fileURLToPath(import.meta.url)), '../../docs/legal');
const changelog = readFileSync(join(LEGAL, 'CHANGELOG.md'), 'utf8');

/** The changelog's table rows as {id, version, sha256}. Pure. */
const loggedRows = (text) => text.split('\n')
  .map((line) => line.split('|').map((c) => c.trim()))
  .filter((cells) => cells.length >= 6 && /^`[0-9a-f]{64}`$/.test(cells[4]))
  .map((cells) => ({ id: cells[2], version: cells[3], sha256: cells[4].slice(1, -1) }));

describe('the binding documents evolve on the record', () => {
  const docs = loadDocuments();

  it('every document carries a version and an effective date', () => {
    for (const doc of docs) {
      expect(doc.version, doc.id).toMatch(/^\d+(\.\d+)*$/);
      expect(doc.effective, doc.id).toBeTruthy();
    }
  });

  it('every current text is logged with its own version', () => {
    const rows = loggedRows(changelog);
    for (const doc of docs) {
      const row = rows.find((r) => r.sha256 === doc.sha256);
      expect(row, `${doc.id} ${doc.sha256} is not in docs/legal/CHANGELOG.md`).toBeTruthy();
      expect(row.id).toBe(doc.id);
      expect(row.version).toBe(doc.version);
    }
  });

  it('no counsel bracket or DRAFT mark rides into a signed text', () => {
    for (const doc of docs) {
      expect(doc.text, doc.id).not.toMatch(/\[counsel/i);
      expect(doc.text, doc.id).not.toMatch(/DRAFT/);
    }
  });
});

describe('parseVersionLine', () => {
  it('reads the version and the effective date', () => {
    expect(parseVersionLine('# T\n\n*Version 2.1 · Early access · Effective 1 March 2027 · Ignis*\n'))
      .toEqual({ version: '2.1', effective: '1 March 2027' });
  });

  it('answers null for a text without one', () => {
    expect(parseVersionLine('# T\n\nbody\n')).toEqual({ version: null, effective: null });
  });
});
