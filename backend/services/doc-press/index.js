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

// --- Images: embedded, or named back to the caller ---
//
// The page loads nothing but data: (chromium-press.js's policy), so a markdown image line pointing
// at a file or the web pressed a broken-image icon and the press still said it succeeded
// (deus-neuma #33). A local image the caller may read is now embedded as data; a web image, or a
// file outside the caller's reach, is named back with the reason, and the page shows a note in
// its place instead of a broken icon.
const IMAGE_MIME = Object.freeze({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' });
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MD_IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

// impure (fs) — one image source as a data URI, or the reason it cannot be one
const embedImage = async (src, { baseDir, mayRead }) => {
  if (/^data:/i.test(src)) return { uri: src };
  if (/^https?:/i.test(src)) return { why: 'a web image: the press loads nothing from the network — save it into the folder (a web/download intent) and link the file' };
  const local = src.replace(/^file:\/\//i, '');
  const file = path.isAbsolute(local) ? local : baseDir ? path.resolve(baseDir, local) : null;
  if (!file) return { why: 'a relative path with no folder to read it from — give an absolute path' };
  const mime = IMAGE_MIME[path.extname(file).toLowerCase()];
  if (!mime) return { why: 'not an image the press can embed (png, jpg, gif, webp or svg)' };
  const verdict = mayRead ? await mayRead(file) : { ok: Boolean(baseDir) && !path.relative(baseDir, file).startsWith('..'), real: file, why: 'outside the document\'s own folder' };
  if (!verdict.ok) return { why: verdict.why };
  try {
    const { size } = await fs.stat(verdict.real);
    if (size > MAX_IMAGE_BYTES) return { why: `larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB` };
    return { uri: `data:${mime};base64,${(await fs.readFile(verdict.real)).toString('base64')}` };
  } catch (err) {
    return { why: `could not be read (${err.code || err.message})` };
  }
};

// impure (fs) — the markdown with every image line embedded or replaced by a visible note
const embedImages = async (markdown, reach) => {
  const sources = [...new Set([...markdown.matchAll(MD_IMAGE)].map((m) => m[2]))];
  const outcome = new Map(await Promise.all(sources.map(async (src) => [src, await embedImage(src, reach)])));
  const dropped = [...outcome].filter(([, o]) => !o.uri).map(([src, o]) => ({ src, why: o.why }));
  const text = markdown.replace(MD_IMAGE, (whole, alt, src) => {
    const o = outcome.get(src);
    return o?.uri ? whole.replace(src, o.uri) : `*[image not embedded: ${alt || src}]*`;
  });
  return { text, dropped };
};

/**
 * Presses a markdown document into a branded PDF.
 * @param {object} params
 * @param {string} [params.markdown] - Markdown source (wins over markdownPath)
 * @param {string} [params.markdownPath] - Path to a .md file
 * @param {string} [params.title] - Document title (defaults to the file basename)
 * @param {string} [params.kitId] - Brand kit id (omit for the neutral kit)
 * @param {string} [params.kitsDir] - Kit root override (tests/CLI)
 * @param {string} [params.outputPath] - When set, the PDF is written here
 * @param {(file: string) => Promise<{ok: boolean, real?: string, why?: string}>} [params.mayRead] - the
 *   check a local image passes to be embedded (press-paths.js pressImageReader); absent, an image is
 *   embedded only from inside the document's own folder
 * @param {string} [params.imageDir] - where a relative image path is read from (default: markdownPath's folder)
 * @returns {Promise<{pdf: Buffer, title: string, kitId: string, outputPath: string|null,
 *   droppedImages: Array<{src: string, why: string}>, ignoredKitKeys: string[]}>}
 */
export async function pressDocument({ markdown, markdownPath, title, kitId, kitsDir, outputPath, mayRead, imageDir }) {
  if (markdown === undefined && !markdownPath) {
    throw new Error('pressDocument needs markdown or markdownPath');
  }
  const source = markdown ?? (await fs.readFile(markdownPath, 'utf8'));
  const docTitle = title ?? (markdownPath ? path.basename(markdownPath, path.extname(markdownPath)) : 'document');

  const kit = await loadBrandKit({ kitId, kitsDir });
  const images = await embedImages(source, { baseDir: imageDir ?? (markdownPath ? path.dirname(markdownPath) : null), mayRead });
  const bodyHtml = pressBody(images.text, kit);
  const html = buildDocumentHtml({ bodyHtml, kit, title: docTitle });
  const chrome = buildPdfChrome({ kit, title: docTitle });
  const pdf = await pressPdf({ html, ...chrome, format: kit.pdf.format, marginCm: kit.pdf.marginCm });

  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, pdf);
  }
  return {
    pdf, title: docTitle, kitId: kit.id, outputPath: outputPath ?? null,
    droppedImages: images.dropped, ignoredKitKeys: [...(kit.ignoredKeys || [])],
  };
}

export { listBrandKits, loadBrandKit, DEFAULT_KIT, pressBody, buildDocumentHtml, buildPdfChrome, locateChromium };
