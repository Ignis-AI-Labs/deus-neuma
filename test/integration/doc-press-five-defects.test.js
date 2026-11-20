/**
 * The document press's five defects (deus-neuma #33, Wendell), each pressed for real: the REAL
 * pressDocument through REAL Chromium into a REAL PDF on disk, read back with poppler (pdftoppm,
 * pdfimages). Kits, images and markdown are written into a temp folder; the images are real PNGs
 * made here. No model, no network.
 *   1. a tinted kit's paper colour reaches the page margins (was white)
 *   2. a local markdown image is embedded; a web image is named back with its reason
 *   3. charts carry a viewBox (scale, never crop) and a bar chart draws every dataset
 *   4. a large badge is drawn small: ten pages no longer carry ten copies of it
 *   5. kit keys the press cannot express are named back
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { pressDocument } from '../../backend/services/doc-press/index.js';
import { pressChart } from '../../backend/services/doc-press/chart-press.js';

// a real PNG: RGB, one filter byte per row, deflated, CRC-checked chunks
const png = (width, height, pixel) => {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(body), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) raw.set(pixel(x, y), y * (width * 3 + 1) + 1 + x * 3);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};

let dir; let kitsDir;
const PAPER = [243, 233, 210]; // #F3E9D2

// the pixel at (x, y) of page 1, rendered by poppler at 30 dpi
const pixelOf = (pdfPath, at) => {
  const ppm = execFileSync('pdftoppm', ['-r', '30', '-f', '1', '-l', '1', pdfPath]);
  const header = ppm.toString('latin1', 0, 32).match(/^P6\s+(\d+)\s+(\d+)\s+255\s/);
  const width = Number(header[1]);
  const offset = header[0].length + (at.y * width + at.x) * 3;
  return [ppm[offset], ppm[offset + 1], ppm[offset + 2]];
};
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 3);

beforeAll(async () => {
  dir = await createTempDir('doc-press-33');
  kitsDir = path.join(dir, 'kits');
  await fs.mkdir(path.join(kitsDir, 'tinted'), { recursive: true });
  await fs.writeFile(path.join(kitsDir, 'tinted', 'kit.json'), JSON.stringify({
    name: 'Demo', companyName: 'Demo Co.', colors: { paper: '#F3E9D2', tableHeader: '#000000' },
    fonts: { body: 'Arial', heading: 'Georgia' }, logoHeightPx: 200, cover: true,
    pdf: { format: 'A4', marginCm: 2.0, background: '#F3E9D2' }, logos: { badge: 'badge.png' },
  }));
  // a ~1 MB noise badge: random pixels barely compress, like a large photographic PNG
  const noise = randomBytes(600 * 600 * 3);
  await fs.writeFile(path.join(kitsDir, 'tinted', 'badge.png'), png(600, 600, (x, y) => noise.subarray((y * 600 + x) * 3, (y * 600 + x) * 3 + 3)));
  await fs.mkdir(path.join(dir, 'doc'), { recursive: true });
  await fs.writeFile(path.join(dir, 'doc', 'red.png'), png(200, 120, () => [220, 20, 20]));
}, 60_000);

afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('the press, after #33', () => {
  test('1, 2 and 5: the paper reaches the margins; a local image embeds, a web one is named back; unknown kit keys are named', async () => {
    const outputPath = path.join(dir, 'out', 'one.pdf');
    const result = await pressDocument({
      markdown: '# Report\n\nA picture:\n\n![red box](red.png)\n\n![remote](https://example.com/x.png)\n',
      markdownPath: path.join(dir, 'doc', 'report.md'), title: 'Report', kitId: 'tinted', kitsDir, outputPath,
    });
    // 1. the corner and the left margin read the paper colour, like the page itself
    expect(near(pixelOf(outputPath, { x: 2, y: 2 }), PAPER)).toBe(true);
    expect(near(pixelOf(outputPath, { x: 5, y: 150 }), PAPER)).toBe(true);
    // 2. the 200 x 120 image is in the PDF; the web image is named, with why
    const images = execFileSync('pdfimages', ['-list', outputPath]).toString();
    expect(images).toMatch(/\s200\s+120\s/);
    expect(result.droppedImages).toEqual([{ src: 'https://example.com/x.png', why: expect.stringMatching(/web image/) }]);
    // 5. what the kit asked for and the press cannot express
    expect(result.ignoredKitKeys.sort()).toEqual(['colors.tableHeader', 'cover', 'fonts.heading', 'logoHeightPx', 'pdf.background'].sort());
  }, 120_000);

  test('4: a ~1 MB badge on ten pages no longer makes a PDF of ten badges', async () => {
    const badgeBytes = (await fs.stat(path.join(kitsDir, 'tinted', 'badge.png'))).size;
    expect(badgeBytes).toBeGreaterThan(900_000);
    const outputPath = path.join(dir, 'out', 'ten.pdf');
    const pages = Array.from({ length: 10 }, (_, i) => `## Page ${i + 1}\n\nText.`).join('\n\n```pagebreak\n```\n\n');
    await pressDocument({ markdown: pages, title: 'Ten', kitId: 'tinted', kitsDir, outputPath });
    const info = execFileSync('pdfinfo', [outputPath]).toString();
    expect(info).toMatch(/Pages:\s+10/);
    const size = (await fs.stat(outputPath)).size;
    expect(size).toBeLessThan(badgeBytes); // was ~10x the badge (10.4 MB for a 1 MB badge)
  }, 120_000);

  test('3: charts scale with a viewBox; a bar chart draws every dataset; a pie names the ones it cannot', () => {
    const bars = pressChart(JSON.stringify({ type: 'bar', data: { labels: ['A', 'B', 'C', 'D', 'E'], datasets: [{ label: '2026', data: [10, 20, 30, 40, 50] }, { label: '2027', data: [50, 40, 30, 20, 10] }] } }));
    expect(bars).toContain('viewBox="0 0 800 500"');
    expect((bars.match(/<rect /g) || []).length).toBe(10 + 2); // ten bars, two legend swatches
    expect(bars).toContain('2027');
    const pie = pressChart(JSON.stringify({ type: 'pie', data: { labels: ['A', 'B'], datasets: [{ label: '2026', data: [1, 2] }, { label: '2027', data: [2, 1] }] } }));
    expect(pie).toContain('viewBox=');
    expect(pie).toContain('1 more dataset not drawn');
    const line = pressChart(JSON.stringify({ type: 'line', data: { labels: ['A', 'B'], datasets: [{ data: [1, 2] }] } }));
    expect(line).toContain('viewBox="0 0 800 400"');
  });
});
