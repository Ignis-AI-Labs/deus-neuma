/**
 * READING ONLY WHAT IS NEEDED — AND A PDF AS ITS WORDS — THROUGH THE REAL ORGAN.
 *
 * Design note, 2026-10-06: grep what is necessary by default, read the whole document
 * when it is asked for. A being finds the line with fs/search, then reads just
 * that neighbourhood with {offset, limit}; a PDF on disk reads as its pages,
 * not as decoded bytes. Real files, the real in-process filesystem organ with
 * its real path validation, the real fs/ routing; a real PDF written byte by
 * byte. No mocks (RULE 0).
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';
import { setNativeFilesystemRoots } from '../../backend/services/native-fs-roots.js';
import { withFsRouting } from '../../backend/services/fs-primitives.js';

// A minimal, valid one-page PDF whose page says `words` — offsets computed, not guessed.
const pdfSaying = (words) => {
  const stream = words === null ? '' : `BT /F1 18 Tf 20 100 Td (${words}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const at = body.length;
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
};

let dir;
const fsCall = withFsRouting((_server, name, args) => nativeFilesystemClient.callTool({ name, arguments: args }));
const text = (result) => (result.content || []).map((c) => c.text || '').join('');

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'fs-read-room-'));
  writeFileSync(path.join(dir, 'long.md'), Array.from({ length: 300 }, (_, i) => `line ${i + 1}${i === 141 ? ' NEEDLE' : ''}`).join('\n'));
  writeFileSync(path.join(dir, 'press.pdf'), pdfSaying('Hello from the press'));
  writeFileSync(path.join(dir, 'scan.pdf'), pdfSaying(null));
  await setNativeFilesystemRoots([dir]);
});

afterAll(async () => {
  await setNativeFilesystemRoots([]);
  rmSync(dir, { recursive: true, force: true });
});

describe('search, then read just the neighbourhood', () => {
  test('fs/search names the line; {offset, limit} reads only around it, and says where it sits', async () => {
    const found = text(await fsCall('fs', 'search', { path: dir, pattern: 'NEEDLE', content: true }));
    expect(found).toContain('long.md:142:');
    const range = text(await fsCall('fs', 'read', { path: path.join(dir, 'long.md'), offset: 140, limit: 5 }));
    expect(range.split('\n')).toEqual([
      '[lines 140–144 of 300; continue at offset 145]', 'line 140', 'line 141', 'line 142 NEEDLE', 'line 143', 'line 144',
    ]);
  });

  test('a range past the end stops at the end and says so', async () => {
    const tail = text(await fsCall('fs', 'read', { path: path.join(dir, 'long.md'), offset: 299, limit: 50 }));
    expect(tail.split('\n')[0]).toBe('[lines 299–300 of 300; end of file]');
  });
});

describe('a PDF reads as its words', () => {
  test('pages, not bytes', async () => {
    const pdf = text(await fsCall('fs', 'read', { path: path.join(dir, 'press.pdf') }));
    expect(pdf).toBe('[Page 1]\nHello from the press');
  });

  test('a PDF takes a line range like any document', async () => {
    const page = text(await fsCall('fs', 'read', { path: path.join(dir, 'press.pdf'), offset: 2, limit: 1 }));
    expect(page).toBe('[lines 2–2 of 2; end of file]\nHello from the press');
  });

  test('a PDF with no selectable text is refused honestly, never handed back empty', async () => {
    const result = await fsCall('fs', 'read', { path: path.join(dir, 'scan.pdf') });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/no selectable text/);
  });
});

describe('a Word document reads as its words', () => {
  test('fs/read of a .docx returns its paragraphs, and takes a line range', async () => {
    const { docxSaying } = await import('../helpers/docx-fixture.js');
    const file = path.join(dir, 'brief.docx');
    writeFileSync(file, docxSaying(['The brief', 'Point one', 'Point two']));
    expect(text(await fsCall('fs', 'read', { path: file }))).toBe('The brief\nPoint one\nPoint two');
    expect(text(await fsCall('fs', 'read', { path: file, offset: 2, limit: 1 }))).toBe('[lines 2–2 of 3; continue at offset 3]\nPoint one');
  });
});
