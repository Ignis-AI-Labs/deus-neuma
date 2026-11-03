/**
 * PDF TEXT — a being reading a PDF on disk gets its words, page by page.
 *
 * fs/read used to decode a PDF's bytes as UTF-8 and hand the being noise. The
 * desk already extracts attached PDFs in the browser (frontend
 * pdf-attachment.js); this is the same library on the backend, so a PDF the
 * being reaches by path reads like one the operator attached: `[Page N]`
 * sections.
 *
 * A SCANNED page has no words to extract — a filing, a signed contract, a
 * letter run through a scanner is a picture of text. It used to be refused
 * ([…]), which left a being that could
 * read every page with its own eyes unable to read any (2026-10-30). Now
 * such a page is drawn the way the desk would show it and goes in front of the
 * being's eyes through the same sight path as any image it reads (fs-sight.js).
 * No OCR engine, no download: the being's own vision does the reading.
 */
import fs from 'node:fs/promises';
import { parseRange } from './web-pdf.js';

/** Past this a PDF is refused rather than parsed. */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

/** One read puts at most this many scanned pages in front of the being — one
 *  message's worth of sight (attachment-store MAX_IMAGES_PER_MESSAGE). */
export const MAX_SCAN_PAGES_PER_READ = 4;

/** A page that paints a picture and carries fewer visible characters than this is
 *  read as a scan: a scanner's stamp or a fax header must not pass a page of
 *  pictured text off as read. A short page of real words with no picture is words. */
const SCAN_TEXT_FLOOR = 32;
/** The drawn page's long edge in pixels — print legible to a vision model, which
 *  rescales to its own input anyway. */
const RENDER_LONG_EDGE = 1600;

const tooBig = (size) => new Error(`That PDF is ${Math.round(size / 1048576)}MB — over the ${MAX_PDF_BYTES / 1048576}MB read limit.`);

// pure — a page's extracted text, in reading order
const pageWords = (content) => content.items.filter((item) => typeof item.str === 'string')
  .map((item) => `${item.str}${item.hasEOL ? '\n' : ' '}`).join('').trim();

// impure (pdfjs) — open the PDF, hand it to `visit`, always release the loader
const withPdf = async (bytes, visit) => {
  if (bytes.length > MAX_PDF_BYTES) throw tooBig(bytes.length);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false });
  try {
    return await visit(await loading.promise, pdfjs);
  } catch (error) {
    if (error.name === 'PasswordException') throw new Error('This PDF is password-protected — ask your operator for an unlocked copy.', { cause: error });
    if (error.name === 'InvalidPDFException') throw new Error('This file could not be read as a PDF.', { cause: error });
    throw error;
  } finally {
    await loading.destroy();
  }
};

/**
 * The text of a PDF's bytes, one entry per page. Impure (pdfjs).
 * @param {Uint8Array} bytes
 * @returns {Promise<string[]>}
 */
export const pdfPagesFromBytes = (bytes) => withPdf(bytes, async (pdf) => {
  const pages = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    pages.push(pageWords(await page.getTextContent()));
    page.cleanup();
  }
  if (!pages.some(Boolean)) throw new Error('This PDF has no selectable text (a scan?) — ask your operator for a searchable copy or the pages as images.');
  return pages;
});

/**
 * Impure — the text of the PDF at `filePath`, `[Page N]` per page. A line range
 * reads words only; a PDF that is all scans says how to look at it instead.
 * @param {string} filePath an already-validated path
 * @returns {Promise<string>}
 */
export const pdfText = async (filePath) => {
  const { size } = await fs.stat(filePath);
  if (size > MAX_PDF_BYTES) throw tooBig(size);
  const pages = await pdfPagesFromBytes(await fs.readFile(filePath)).catch((error) => {
    if (!/no selectable text/.test(error.message)) throw error;
    throw new Error('This PDF\'s pages are scans with no text layer — read it without offset/limit to look at them ({"path"}, or {"path", "pages": "N-M"}).', { cause: error });
  });
  return pages.map((text, i) => `[Page ${i + 1}]\n${text}`).join('\n\n');
};

// impure (pdfjs) — is this page a scan: no words at all, or a few words over a painted picture?
const isScan = async (pdfjs, page, words) => {
  if (!words) return true;
  if (words.replace(/\s/g, '').length >= SCAN_TEXT_FLOOR) return false;
  const paints = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject,
    pdfjs.OPS.paintImageMaskXObject, pdfjs.OPS.paintImageXObjectRepeat].filter(Number.isInteger));
  return (await page.getOperatorList()).fnArray.some((fn) => paints.has(fn));
};

// impure (canvas) — one page drawn on white paper, as a JPEG
const drawPage = async (page) => {
  const { createCanvas } = await import('@napi-rs/canvas');
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: RENDER_LONG_EDGE / Math.max(base.width, base.height) });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas.encode('jpeg', 85);
};

/**
 * Impure — a PDF on disk as the being reads it, MCP-shaped: each page's words, and
 * each scanned page drawn as an image block for its eyes (at most
 * MAX_SCAN_PAGES_PER_READ per read; the text names the range to ask for next).
 * A PDF of words alone reads exactly as it always did.
 * @param {string} filePath an already-validated path
 * @param {{pages?: string|number}} [ask] "N" or "N-M"
 * @returns {Promise<{content: object[], structuredContent: object}>}
 */
export const pdfRead = async (filePath, { pages: spec = null } = {}) => {
  const { size } = await fs.stat(filePath);
  if (size > MAX_PDF_BYTES) throw tooBig(size);
  return withPdf(await fs.readFile(filePath), async (pdf, pdfjs) => {
    const total = pdf.numPages;
    const span = parseRange(spec, total);
    const [from, to] = span ?? [1, total];
    const sections = [];
    const images = [];
    const unseen = [];
    for (let number = from; number <= to; number += 1) {
      const page = await pdf.getPage(number);
      const words = pageWords(await page.getTextContent());
      if (!(await isScan(pdfjs, page, words))) sections.push(`[Page ${number}]\n${words}`);
      else if (images.length < MAX_SCAN_PAGES_PER_READ) {
        images.push({ type: 'image', data: (await drawPage(page)).toString('base64'), mimeType: 'image/jpeg' });
        sections.push(`[Page ${number}] — a scan with no text layer: shown to you as an image${words ? ` (the only text on it: ${words})` : ''}`);
      } else unseen.push(number);
      page.cleanup();
    }
    const notes = [];
    if (spec !== null && !span) notes.push(`pages "${spec}" is not a range in 1-${total}, so all pages are read`);
    if (span) notes.push(`pages ${from}-${to} of ${total}`);
    if (unseen.length) {
      const next = `${unseen[0]}-${Math.min(unseen[0] + MAX_SCAN_PAGES_PER_READ - 1, to)}`;
      notes.push(`${unseen.length} more scanned page${unseen.length === 1 ? '' : 's'} not shown yet (${unseen.join(', ')}) — read them with {"pages": "${next}"}`);
    }
    const text = [...(notes.length || images.length ? [`[PDF, ${total} page${total === 1 ? '' : 's'}${notes.length ? `; ${notes.join('; ')}` : ''}]`] : []), ...sections].join('\n\n');
    const content = [{ type: 'text', text }, ...images];
    return { content, structuredContent: { content } };
  });
};
