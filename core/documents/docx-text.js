/**
 * DOCX TEXT — a Word document as its words, with no new dependency.
 *
 * A .docx is a zip; its body is word/document.xml. This reads the zip's
 * central directory, takes that one entry, and turns its paragraphs into
 * lines. The decompressor is the caller's (Node's zlib on the backend, the
 * browser's DecompressionStream on the desk), so this module stays pure and
 * one parser serves both the being's fs/read and the operator's attachment.
 *
 * Honest limits: text only (no images, comments or tracked-change history);
 * ZIP64 and encrypted documents are refused with a reason, never read as
 * noise; the legacy binary .doc is not a zip and is refused the same way.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const BODY = 'word/document.xml';

const decoder = new TextDecoder('utf-8');

// Pure — the End Of Central Directory record, searched back from the tail
// (a zip comment may follow it).
const findEocd = (view) => {
  for (let at = view.byteLength - 22; at >= Math.max(0, view.byteLength - 22 - 65535); at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at;
  }
  return -1;
};

/**
 * Pure — one named entry's stored bytes and how they are compressed.
 * @param {Uint8Array} bytes the whole zip
 * @param {string} name
 * @returns {{method: number, data: Uint8Array}|null}
 */
export const zipEntry = (bytes, name) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error('This file is not a Word document (.docx) — an older .doc cannot be read; save it as .docx or PDF.');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  if (at === 0xffffffff) throw new Error('This Word document is too large to read (ZIP64).');
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) break;
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const entryName = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (entryName === name) {
      if (flags & 1) throw new Error('This Word document is encrypted — ask for an unlocked copy.');
      if (view.getUint32(local, true) !== LOCAL_SIGNATURE) throw new Error('This Word document is damaged.');
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      return { method, data: bytes.subarray(start, start + size) };
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
};

const ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" });
const decodeXml = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
  if (code[0] === '#') {
    const point = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(point) ? String.fromCodePoint(point) : match;
  }
  return ENTITIES[code] ?? match;
});

/**
 * Pure — document.xml's paragraphs as lines: runs joined, tabs and breaks
 * kept, empty paragraphs dropped.
 * @param {string} xml
 * @returns {string}
 */
export const docxXmlToText = (xml) => {
  const paragraphs = xml.match(/<w:p[\s>][\s\S]*?<\/w:p>|<w:p\/>/g) || [];
  return paragraphs.map((paragraph) => decodeXml(paragraph
    // A tab or break is its own element beside the text runs — carried as a run.
    .replace(/<w:tab\/>/g, '<w:t>\t</w:t>')
    .replace(/<w:(?:br|cr)\/>/g, '<w:t>\n</w:t>')
    .replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, '\u0000$1\u0000')
    .split('\u0000')
    .filter((_, i) => i % 2 === 1)
    .join(''))
    .trim())
    .filter(Boolean)
    .join('\n');
};

/**
 * The words of a .docx. The caller supplies the raw-deflate decompressor.
 * @param {Uint8Array} bytes the whole file
 * @param {(data: Uint8Array) => Promise<Uint8Array>|Uint8Array} inflateRaw
 * @returns {Promise<string>}
 */
export const docxText = async (bytes, inflateRaw) => {
  const entry = zipEntry(bytes, BODY);
  if (!entry) throw new Error('This file is not a Word document (.docx) — it has no document body.');
  if (entry.method !== 0 && entry.method !== 8) throw new Error('This Word document uses a compression it cannot be read with.');
  const xml = decoder.decode(entry.method === 0 ? entry.data : await inflateRaw(entry.data));
  const text = docxXmlToText(xml);
  if (!text) throw new Error('This Word document has no text in its body.');
  return text;
};
