// A REAL SCANNED PDF, byte by byte: each scanned page is a JPEG picture of its words with no text
// layer at all — what a scanner or a phone camera hands an operator. Text pages carry real
// Helvetica text, so one document can mix both. Offsets computed, not guessed. No mocks (RULE 0).
import { createCanvas, loadImage } from '@napi-rs/canvas';

const PAGE = { w: 612, h: 792 }; // US Letter, points
const SCAN = { w: 1224, h: 1584 }; // 144 dpi
export const SCAN_TEXT = Object.freeze({ x: 120, y: 300, step: 90, px: 56 });

// impure — one page "scanned": words painted into pixels on off-white paper
export const scanOf = async (lines) => {
  const canvas = createCanvas(SCAN.w, SCAN.h);
  const g = canvas.getContext('2d');
  g.fillStyle = '#f4f1ea';
  g.fillRect(0, 0, SCAN.w, SCAN.h);
  g.fillStyle = '#111111';
  g.font = `bold ${SCAN_TEXT.px}px sans-serif`;
  lines.forEach((line, i) => g.fillText(line, SCAN_TEXT.x, SCAN_TEXT.y + i * SCAN_TEXT.step));
  return canvas.encode('jpeg', 85);
};

/**
 * impure — a PDF of `pages`, each `{ scan: [lines] }` (a picture, no text layer — or, with `stamp`,
 * only that scanner's stamp as text) or `{ text }`.
 * @returns {Promise<Buffer>}
 */
export const scannedPdf = async (pages) => {
  const objects = [null, null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (const page of pages) {
    const pageAt = objects.length + 1;
    kids.push(`${pageAt} 0 R`);
    if (page.scan) {
      const jpeg = await scanOf(page.scan);
      const draw = `q ${PAGE.w} 0 0 ${PAGE.h} 0 0 cm /Im0 Do Q${page.stamp ? ` BT /F1 7 Tf 20 12 Td (${page.stamp}) Tj ET` : ''}`;
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /Font << /F1 3 0 R >> /XObject << /Im0 ${pageAt + 2} 0 R >> >> /Contents ${pageAt + 1} 0 R >>`);
      objects.push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
      objects.push([`<< /Type /XObject /Subtype /Image /Width ${SCAN.w} /Height ${SCAN.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream']);
    } else {
      const draw = `BT /F1 14 Tf 72 700 Td (${page.text}) Tj ET`;
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageAt + 1} 0 R >>`);
      objects.push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    }
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  const parts = [Buffer.from('%PDF-1.4\n', 'latin1')];
  let length = parts[0].length;
  const push = (piece) => { const b = Buffer.isBuffer(piece) ? piece : Buffer.from(piece, 'latin1'); parts.push(b); length += b.length; };
  const offsets = objects.map((body, i) => {
    const at = length;
    push(`${i + 1} 0 obj\n`);
    [].concat(body).forEach(push);
    push('\nendobj\n');
    return at;
  });
  const xref = length;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
};

/**
 * impure — how dark a band of a drawn page is (0..1 share of near-black pixels), the band given in
 * the SCAN's own pixel rows so a caller asks […] at any render size.
 */
export const darkShare = async (jpegBase64, { top, bottom, left = 0, right = SCAN.w }) => {
  const image = await loadImage(Buffer.from(jpegBase64, 'base64'));
  const canvas = createCanvas(image.width, image.height);
  const g = canvas.getContext('2d');
  g.drawImage(image, 0, 0);
  const sx = image.width / SCAN.w;
  const sy = image.height / SCAN.h;
  const x = Math.round(left * sx);
  const y = Math.round(top * sy);
  const { data } = g.getImageData(x, y, Math.round((right - left) * sx), Math.round((bottom - top) * sy));
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 200) dark += 1;
  return dark / (data.length / 4);
};
