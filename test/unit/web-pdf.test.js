/**
 * WEB PDF (web-pdf.js + pdf-text.js pdfPagesFromBytes) — a PDF reads like a page,
 * and a reader takes only the pages it needs. A real PDF (the house's own pressed
 * EULA) through the real pdfjs reader. No mocks (RULE 0).
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { isPdfResponse, selectPdfPages } from '../../backend/services/web-pdf.js';
import { pdfPagesFromBytes } from '../../backend/services/pdf-text.js';

const PAGES = ['first page about licences', 'second page: 17-29-102. Definitions.', 'third page', 'fourth: see 17-29-102 again'];

describe('isPdfResponse', () => {
  test('application/pdf, or octet-stream for a .pdf URL; nothing else', () => {
    expect(isPdfResponse('application/pdf', 'https://x/a')).toBe(true);
    expect(isPdfResponse('application/octet-stream', 'https://x/title17.pdf')).toBe(true);
    expect(isPdfResponse('application/octet-stream', 'https://x/file.bin')).toBe(false);
    expect(isPdfResponse('text/html', 'https://x/a.pdf')).toBe(false);
  });
});

describe('selectPdfPages', () => {
  test('find keeps only the pages holding the phrase, and says which', () => {
    const r = selectPdfPages(PAGES, { find: '17-29-102' });
    expect(r.shown).toEqual([2, 4]);
    expect(r.note).toBe('PDF, 4 pages; pages containing "17-29-102": 2, 4');
    expect(r.text).toContain('[Page 2]');
    expect(r.text).not.toContain('[Page 1]');
  });

  test('a range, clamped to the document; a range and a find narrow together', () => {
    expect(selectPdfPages(PAGES, { pages: '2-9' }).shown).toEqual([2, 3, 4]);
    expect(selectPdfPages(PAGES, { pages: '3-4', find: '17-29-102' }).shown).toEqual([4]);
  });

  test('a miss says so instead of returning everything; a bad range is named', () => {
    expect(selectPdfPages(PAGES, { find: 'no such words' })).toMatchObject({ shown: [], text: '' });
    expect(selectPdfPages(PAGES, { pages: 'ten' }).note).toContain('is not a range in 1-4');
  });

  test('a whole read tells the reader it can ask for less', () => {
    expect(selectPdfPages(PAGES).note).toContain('ask with {find}');
  });
});

describe('pdfPagesFromBytes — a real PDF', () => {
  test('the pressed EULA reads page by page, and find reaches its model list', async () => {
    const pages = await pdfPagesFromBytes(readFileSync('docs/legal/pdf/EULA.pdf'));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toContain('END USER LICENSE AGREEMENT');
    const r = selectPdfPages(pages, { find: 'Wan 2.2' });
    expect(r.shown.length).toBeGreaterThan(0);
    expect(r.text).toContain('Apache-2.0');
  });

  test('bytes that are not a PDF are refused in words', async () => {
    await expect(pdfPagesFromBytes(Buffer.from('not a pdf at all'))).rejects.toThrow(/could not be read as a PDF|Invalid PDF/);
  });
});
