/**
 * THE PRESS PAGE RUNS NO SCRIPT AND OPENS NO SOCKET (security recheck
 * 2026-10-20, §7). The Fetch filter never sees a WebSocket: a script in a
 * pressed body opened one to a loopback service and its reply was printed into
 * the PDF the being reads back. The press now disables script execution over
 * CDP and carries a strict Content-Security-Policy as the document's first
 * element.
 *
 * REAL Chromium, REAL PDF bytes, a REAL WebSocket server on :0 that counts
 * every connection. No mock (AGENTS.md RULE 0). Skips loudly with no Chromium.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { deflateSync, crc32 } from 'zlib';
import fs from 'fs/promises';
import path from 'path';
import { WebSocketServer } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { pressDocument, locateChromium } from '../../backend/services/doc-press/index.js';
import { pressPdf, withPressPolicy } from '../../backend/services/doc-press/chromium-press.js';
import { pdfText } from '../../backend/services/pdf-text.js';

const chromiumAvailable = (() => {
  try {
    locateChromium();
    return true;
  } catch (err) {
    console.warn(`doc-press no-script SKIPPED — no gnosis on this machine: ${err.message}`);
    return false;
  }
})();

// A real 2x2 PNG, built here so the honest document carries a raster image the
// policy must still let through.
const pngDataUri = () => {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.from([0, 255, 0, 0, 0, 0, 255, 0, 0, 255, 0, 255, 0]);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
};

describe.skipIf(!chromiumAvailable)('the press page runs no script and reaches no service', () => {
  let server;
  let port;
  const seen = [];

  beforeAll(async () => {
    server = createServer((req, res) => { seen.push(`http ${req.url}`); res.end('FAKE_HTTP_REPLY'); });
    new WebSocketServer({ server }).on('connection', (socket, req) => {
      seen.push(`ws ${req.url}`);
      socket.send('FAKE_SOCKET_REPLY');
    });
    port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  // The attack from the recheck: open a socket, print what it says, and mark
  // that a script ran at all.
  const attack = (tag) => `<p id="out">${tag}_BODY</p><script>
document.getElementById('out').textContent += ' ${tag}_SCRIPT_RAN';
const s = new WebSocket('ws://127.0.0.1:${port}/${tag}');
s.onmessage = (e) => { document.getElementById('out').textContent += ' GOT:' + e.data; };
</script><script>const t0 = Date.now(); while (Date.now() - t0 < 300) {}</script>`;

  test('a markdown body with a socket-opening script: no connection, no reply, no script effect', async () => {
    const root = await createTempDir('doc-press-no-script');
    const outputPath = path.join(root, 'attack.pdf');
    await pressDocument({ markdown: `# Attack\n\n${attack('MD')}\n`, title: 'attack', outputPath });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const text = await pdfText(outputPath);
    expect(text).toContain('MD_BODY');
    expect(text).not.toContain('MD_SCRIPT_RAN');
    expect(text).not.toContain('FAKE_SOCKET_REPLY');
    expect(seen.filter((s) => s.includes('/MD'))).toEqual([]);
  }, 60_000);

  test('a raw document with no doctype or head is held the same way', async () => {
    const root = await createTempDir('doc-press-no-script-raw');
    const pdf = await pressPdf({ html: `<html><body>${attack('RAW')}</body></html>` });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const file = path.join(root, 'raw.pdf');
    await fs.writeFile(file, pdf);
    const text = await pdfText(file);
    expect(text).toContain('RAW_BODY');
    expect(text).not.toContain('RAW_SCRIPT_RAN');
    expect(text).not.toContain('FAKE_SOCKET_REPLY');
    expect(seen.filter((s) => s.includes('/RAW'))).toEqual([]);
  }, 60_000);

  test('an honest document still renders: text, table, chart, box and a data: image', async () => {
    const root = await createTempDir('doc-press-honest');
    const outputPath = path.join(root, 'honest.pdf');
    const markdown = [
      '# Honest Document', '', 'HONEST_PARAGRAPH with **bold**.', '',
      '| Metric | Value |', '|---|---|', '| HONEST_ROW | 1 |', '',
      '::: summary HONEST_BOX', 'Inside the box.', ':::', '',
      '```chartjs',
      '{ "type": "bar", "data": { "labels": ["HONEST_BAR"], "datasets": [{ "data": [3] }] } }',
      '```', '',
      `![dot](${pngDataUri()})`, '',
    ].join('\n');
    await pressDocument({ markdown, title: 'honest', outputPath });
    const text = await pdfText(outputPath);
    for (const marker of ['HONEST_PARAGRAPH', 'HONEST_ROW', 'HONEST_BOX', 'HONEST_BAR']) expect(text).toContain(marker);
    // The raster lands as an image object only if the policy let data: through.
    expect((await fs.readFile(outputPath)).toString('latin1')).toMatch(/\/Subtype\s*\/Image/);
  }, 60_000);
});

describe('withPressPolicy — the policy is the document\'s first element', () => {
  const META = /^<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:;/;

  test('after the doctype, before the head and anything the body carries', () => {
    const out = withPressPolicy('<!DOCTYPE html>\n<html><head><script>x</script></head></html>');
    expect(out).toMatch(META);
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<script>'));
  });

  test('a document with no doctype gets the policy at its very start', () => {
    expect(withPressPolicy('<p>x</p>')).toMatch(/^<meta http-equiv="Content-Security-Policy"/);
  });
});
