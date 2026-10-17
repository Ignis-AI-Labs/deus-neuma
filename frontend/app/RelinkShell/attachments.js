// attachments.js — what the witness shares with the neuma: images AND
// text-extractable documents (PDFs, code, markdown, csv…).
//
// The composer collects pasted/dropped files. Images become preview-ready data
// URIs; documents are read as text in the browser. On send both upload over
// REST (the portal WS caps frames at 64KB, so only attachment ids ever cross
// it — see attachments-client). Everything here except the FileReader helpers
// is pure, so the classify/accept/reject rules are unit-testable without a browser.

import { isPdf, MAX_PDF_BYTES, fileToPdfText } from './pdf-attachment.js';
import { docxText } from '../../../core/documents/docx-text.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** Pure — a Word document (.docx), by MIME or extension. */
export const isDocx = (file) => file?.type === DOCX_MIME || /\.docx$/i.test(file?.name || '');

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_DOCS = 5;
export const MAX_DOC_CHARS = 400_000;         // matches the backend ceiling; the turn fits it to the room and says what did not fit
export const MAX_DOC_BYTES = 2 * 1024 * 1024; // pre-read ceiling (400k chars of UTF-8 is at most ~1.6MB)

// Image accept-list mirrors the backend (attachment-store.js). SVG stays out:
// a scriptable document, not a picture.
const ACCEPTED_IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

// Text-extractable documents. Browsers report inconsistent MIME for code (often
// '' or text/plain), so the extension is the reliable signal; a text/* MIME (or
// a few known application/* text formats) also qualifies. The backend's NUL
// sniff is the certainty backstop — this is only the early, honest pre-filter.
const DOC_EXTENSIONS = Object.freeze(new Set([
  'txt', 'md', 'markdown', 'rst', 'csv', 'tsv', 'json', 'jsonc', 'yaml', 'yml', 'toml',
  'ini', 'env', 'xml', 'html', 'htm', 'css', 'scss', 'less', 'js', 'jsx', 'ts', 'tsx',
  'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp',
  'cc', 'cs', 'php', 'sh', 'bash', 'zsh', 'sql', 'r', 'lua', 'pl', 'pm', 'ex', 'exs',
  'erl', 'clj', 'hs', 'ml', 'scala', 'dart', 'vue', 'svelte', 'astro', 'graphql', 'gql',
  'proto', 'tf', 'gradle', 'cmake', 'log', 'conf', 'cfg', 'properties', 'diff', 'patch',
]));
// Common extensionless text files (matched by whole lowercased name).
const DOC_NAMES = Object.freeze(new Set([
  'dockerfile', 'makefile', 'readme', 'license', 'gemfile', 'procfile',
  // dotfiles, matched by stem (.gitignore → gitignore)
  'gitignore', 'gitattributes', 'dockerignore', 'editorconfig', 'npmrc', 'prettierrc', 'eslintrc',
]));
const DOC_MIME_EXACT = Object.freeze(new Set(['application/json', 'application/xml', 'application/x-yaml', 'application/toml']));

// The extension of a basename. A DOTFILE (only dot at index 0, e.g. .env,
// .gitignore) has its whole post-dot treated as the extension so it can match
// the allow-list — otherwise the two most common text dotfiles never classify.
const extOf = (name) => {
  const base = String(name || '').toLowerCase().split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 && dot < base.length - 1 ? base.slice(dot + 1) : '';
};

/**
 * Classify a file: 'image', 'doc', or null when neither. Pure.
 * @param {{ name?: string, type?: string }} file
 * @returns {'image'|'doc'|null}
 */
export const classifyFile = (file) => {
  if (!file) return null;
  if (isPdf(file) || isDocx(file)) return 'doc';
  if (ACCEPTED_IMAGE_TYPES.includes(file.type)) return 'image';
  const name = String(file.name || '').toLowerCase().split(/[\\/]/).pop() || '';
  const type = file.type || '';
  if (type.startsWith('text/') || DOC_MIME_EXACT.has(type)) return 'doc';
  // A dotfile matches DOC_NAMES by its stem too (.gitignore → gitignore).
  const stem = name.replace(/^\./, '');
  if (DOC_EXTENSIONS.has(extOf(name)) || DOC_NAMES.has(name) || DOC_NAMES.has(stem)) return 'doc';
  return null;
};

/**
 * Why a file can't ride, or null when it can. Pure.
 * @param {{ name?: string, type?: string, size?: number }} file
 * @returns {string|null}
 */
export const rejectReason = (file) => {
  const kind = classifyFile(file);
  if (!kind) return 'Only images (PNG, JPEG, WebP, GIF), PDFs, Word documents (.docx), or text documents (code, markdown, csv…) can be shared.';
  if (kind === 'image' && file.size > MAX_IMAGE_BYTES) return 'That image is over the 4MB limit.';
  if (isPdf(file)) return file.size > MAX_PDF_BYTES ? 'That PDF is over the 20MB limit.' : null;
  if (isDocx(file)) return file.size > MAX_PDF_BYTES ? 'That Word document is over the 20MB limit.' : null;
  if (kind === 'doc' && file.size > MAX_DOC_BYTES) return `That document is over the ${MAX_DOC_BYTES / 1048576}MB limit.`;
  return null;
};

/**
 * Fold new files into the pending list under per-kind caps. Returns the new
 * accepted files (each tagged with its kind) plus the first refusal (one honest
 * line beats a wall of them). Pure — caller reads the bytes/text and assigns ids.
 * @param {Array<{ kind?: string }>} pending - current attachments
 * @param {Array<{ name?: string, type?: string, size?: number }>} files
 * @returns {{ accepted: Array<{ file: object, kind: 'image'|'doc' }>, refusal: string|null }}
 */
export const admitFiles = (pending, files) => {
  const accepted = [];
  let refusal = null;
  let images = pending.filter((a) => a.kind !== 'doc').length;
  let docs = pending.filter((a) => a.kind === 'doc').length;
  for (const file of files) {
    const why = rejectReason(file);
    if (why) { refusal = refusal || why; continue; }
    const kind = classifyFile(file);
    if (kind === 'image') {
      if (images >= MAX_IMAGES) { refusal = refusal || `At most ${MAX_IMAGES} images per message.`; continue; }
      images += 1;
    } else {
      if (docs >= MAX_DOCS) { refusal = refusal || `At most ${MAX_DOCS} documents per message.`; continue; }
      docs += 1;
    }
    accepted.push({ file, kind });
  }
  return { accepted, refusal };
};

/**
 * Every FILE inside a paste/drop DataTransfer, in order — deliberately not
 * pre-filtered: admitFiles is the one judge, so an unsupported file gets the
 * same honest refusal line instead of silently doing nothing. Pure over the
 * given structure (reads, never mutates).
 * @param {DataTransfer|null|undefined} dt
 * @returns {File[]}
 */
export const filesFrom = (dt) => {
  const items = dt?.items ? Array.from(dt.items) : [];
  return items
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter(Boolean);
};

/**
 * Read a File into a data URI for preview + upload (images).
 * @param {File} file
 * @returns {Promise<string>}
 */
// impure — FileReader
export const fileToDataUri = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error || new Error('read failed'));
  reader.readAsDataURL(file);
});

// impure — the browser's own raw-deflate stream (the zip's one compression).
const inflateRaw = async (data) => new Uint8Array(await new Response(
  new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
).arrayBuffer());

// impure — a Word document's words (core/documents/docx-text.js), under the same ceiling.
const fileToDocxText = async (file) => {
  const text = await docxText(new Uint8Array(await file.arrayBuffer()), inflateRaw);
  if (text.length > MAX_DOC_CHARS) throw new Error(`That document is over the ${Math.round(MAX_DOC_CHARS / 1000)}k-character limit.`);
  return text;
};

/**
 * Read a File as text (documents). Rejects a doc whose text exceeds the
 * per-message budget so the witness learns before send, matching the backend.
 * @param {File} file
 * @returns {Promise<string>}
 */
// impure — FileReader or the PDF worker
export const fileToText = (file) => {
  if (isPdf(file)) return fileToPdfText(file, MAX_DOC_CHARS);
  if (isDocx(file)) return fileToDocxText(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      if (text.length > MAX_DOC_CHARS) {
        reject(new Error(`That document is over the ${Math.round(MAX_DOC_CHARS / 1000)}k-character limit.`));
        return;
      }
      resolve(text);
    };
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsText(file);
  });
};
