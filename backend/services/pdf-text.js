/**
 * PDF TEXT — a being reading a PDF on disk gets its words, page by page.
 *
 * fs/read used to decode a PDF's bytes as UTF-8 and hand the being noise. The
 * desk already extracts attached PDFs in the browser (frontend
 * pdf-attachment.js); this is the same library on the backend, so a PDF the
 * being reaches by path reads like one the operator attached: `[Page N]`
 * sections, and an honest refusal for scans with no selectable text.
 */
import fs from 'node:fs/promises';

/** Past this a PDF is refused rather than parsed. */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

/**
 * Impure — the text of the PDF at `filePath`, `[Page N]` per page.
 * @param {string} filePath an already-validated path
 * @returns {Promise<string>}
 */
export const pdfText = async (filePath) => {
  const { size } = await fs.stat(filePath);
  if (size > MAX_PDF_BYTES) throw new Error(`That PDF is ${Math.round(size / 1048576)}MB — over the ${MAX_PDF_BYTES / 1048576}MB read limit.`);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(filePath)), isEvalSupported: false });
  try {
    const pdf = await loading.promise;
    const pages = [];
    let hasText = false;
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items.filter((item) => typeof item.str === 'string')
        .map((item) => `${item.str}${item.hasEOL ? '\n' : ' '}`).join('').trim();
      hasText ||= Boolean(text);
      pages.push(`[Page ${number}]\n${text}`);
      page.cleanup();
    }
    if (!hasText) throw new Error('This PDF has no selectable text (a scan?) — ask your operator for a searchable copy or the pages as images.');
    return pages.join('\n\n');
  } catch (error) {
    if (error.name === 'PasswordException') throw new Error('This PDF is password-protected — ask your operator for an unlocked copy.', { cause: error });
    if (error.name === 'InvalidPDFException') throw new Error('This file could not be read as a PDF.', { cause: error });
    throw error;
  } finally {
    await loading.destroy();
  }
};
