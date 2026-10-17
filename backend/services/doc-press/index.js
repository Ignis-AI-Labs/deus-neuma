/**
 * THE PRESS — markdown pressed into branded PDF documentation. // impure (fs + chromium)
 *
 * The one-call surface: markdown + a brand kit → a finished, print-faithful
 * PDF carrying the kit's livery (masthead, icons, palette, running chrome).
 * Every stage below it is its own module:
 *   brand-kit.js      kit loading/validation (the productizable branding seam)
 *   markdown-press.js markdown → body HTML (pure)
 *   chart-press.js    chartjs fences → SVG (pure)
 *   document-shell.js branded HTML shell + PDF chrome (pure)
 *   chromium-press.js HTML → PDF via real Chromium over CDP (impure)
 */

import fs from 'fs/promises';
import path from 'path';
import { loadBrandKit, listBrandKits, DEFAULT_KIT } from './brand-kit.js';
import { pressBody } from './markdown-press.js';
import { buildDocumentHtml, buildPdfChrome } from './document-shell.js';
import { pressPdf, locateChromium } from './chromium-press.js';

/**
 * Presses a markdown document into a branded PDF.
 * @param {object} params
 * @param {string} [params.markdown] - Markdown source (wins over markdownPath)
 * @param {string} [params.markdownPath] - Path to a .md file
 * @param {string} [params.title] - Document title (defaults to the file basename)
 * @param {string} [params.kitId] - Brand kit id (omit for the neutral kit)
 * @param {string} [params.kitsDir] - Kit root override (tests/CLI)
 * @param {string} [params.outputPath] - When set, the PDF is written here
 * @returns {Promise<{pdf: Buffer, title: string, kitId: string, outputPath: string|null}>}
 */
export async function pressDocument({ markdown, markdownPath, title, kitId, kitsDir, outputPath }) {
  if (markdown === undefined && !markdownPath) {
    throw new Error('pressDocument needs markdown or markdownPath');
  }
  const source = markdown ?? (await fs.readFile(markdownPath, 'utf8'));
  const docTitle = title ?? (markdownPath ? path.basename(markdownPath, path.extname(markdownPath)) : 'document');

  const kit = await loadBrandKit({ kitId, kitsDir });
  const bodyHtml = pressBody(source, kit);
  const html = buildDocumentHtml({ bodyHtml, kit, title: docTitle });
  const chrome = buildPdfChrome({ kit, title: docTitle });
  const pdf = await pressPdf({ html, ...chrome, format: kit.pdf.format, marginCm: kit.pdf.marginCm });

  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, pdf);
  }
  return { pdf, title: docTitle, kitId: kit.id, outputPath: outputPath ?? null };
}

export { listBrandKits, loadBrandKit, DEFAULT_KIT, pressBody, buildDocumentHtml, buildPdfChrome, locateChromium };
