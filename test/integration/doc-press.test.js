/**
 * THE PRESS end to end — real markdown through a real Chromium print
 * pipeline to real PDF bytes on a real disk. No mocks anywhere (RULE 0).
 *
 * Requires a local Chromium (Playwright cache, system Chrome, or
 * NEUMA_CHROMIUM_PATH). Skips loudly when none exists on this machine.
 */
import { describe, test, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { createServer } from 'http';
import { pressDocument, locateChromium } from '../../backend/services/doc-press/index.js';
import { pressMayLoad } from '../../backend/services/doc-press/chromium-press.js';
import { pdfText } from '../../backend/services/pdf-text.js';

const TINY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#ff0000"/></svg>';

const FIXTURE_MD = `# Press Integration Fixture

A paragraph with **bold**, a [link](https://kenorie.ai), and a table:

| Metric | Value |
|--------|-------|
| Alpha  | 1     |
| Beta   | 2     |

::: summary The Gist
Boxes hold *markdown*.
:::

[PAGEBREAK]

\`\`\`chartjs
{ "type": "pie", "data": { "labels": ["Yes", "No"], "datasets": [{ "data": [70, 30] }] }, "options": { "title": { "text": "Verdict" } } }
\`\`\`

\`\`\`js
const pressed = true;
\`\`\`
`;

const chromiumAvailable = (() => {
  try {
    locateChromium();
    return true;
  } catch (err) {
    console.warn(`doc-press integration SKIPPED — no gnosis on this machine: ${err.message}`);
    return false;
  }
})();

const pageCount = (pdf) => {
  const match = pdf.toString('latin1').match(/\/Count (\d+)/);
  return match ? Number(match[1]) : 0;
};

describe.skipIf(!chromiumAvailable)('pressDocument (real Chromium, real PDF)', () => {
  test('presses markdown to a multi-page PDF with the neutral kit', async () => {
    const { pdf, kitId } = await pressDocument({ markdown: FIXTURE_MD, title: 'fixture' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(10_000);
    expect(pdf.toString('latin1')).toContain('/Type /Pages');
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(2); // [PAGEBREAK] must land in print
    expect(kitId).toBe('default');
  }, 60_000);

  test('presses a file with a branded kit and writes the PDF to disk', async () => {
    const root = await createTempDir('doc-press');
    const kitDir = path.join(root, 'kits', 'acme');
    await fs.mkdir(kitDir, { recursive: true });
    await fs.writeFile(path.join(kitDir, 'kit.json'), JSON.stringify({
      companyName: 'Acme Corp',
      documentFooter: 'Pressed by Acme',
      logos: { primary: 'logo.svg', badge: 'logo.svg', seal: 'logo.svg' }
    }));
    await fs.writeFile(path.join(kitDir, 'logo.svg'), TINY_SVG);

    const markdownPath = path.join(root, 'branded-doc.md');
    await fs.writeFile(markdownPath, FIXTURE_MD);
    const outputPath = path.join(root, 'out', 'branded-doc.pdf');

    const result = await pressDocument({ markdownPath, kitId: 'acme', kitsDir: path.join(root, 'kits'), outputPath });
    expect(result.title).toBe('branded-doc');
    expect(result.kitId).toBe('acme');

    const onDisk = await fs.readFile(outputPath);
    expect(onDisk.subarray(0, 5).toString()).toBe('%PDF-');
    expect(onDisk.equals(result.pdf)).toBe(true);
    expect(pageCount(onDisk)).toBeGreaterThanOrEqual(2);
  }, 60_000);

  // A pressed body may carry raw HTML. The PDF lands in the being's lane and
  // it reads it back, so whatever the page loads is a read around the file
  // sandbox (audit 2026-10-19, F2). Every secret here is FAKE.
  test('the press page loads no local file and no loopback service into the PDF', async () => {
    const root = await createTempDir('doc-press-wall');
    const planted = path.join(root, 'planted.txt');
    await fs.writeFile(planted, 'FAKE_PLANTED_LOCAL_LINE\n');
    let loopbackHits = 0;
    const loopback = createServer((req, res) => { loopbackHits += 1; res.end('FAKE_LOOPBACK_BODY'); });
    const port = await new Promise((resolve) => loopback.listen(0, '127.0.0.1', () => resolve(loopback.address().port)));
    try {
      const markdown = [
        '# Wall', '', 'VISIBLE_BODY_LINE', '',
        `<iframe src="file://${planted}" width="600" height="80"></iframe>`, '',
        `<object data="${planted}" width="600" height="80"></object>`, '',
        `<iframe src="http://127.0.0.1:${port}/" width="600" height="80"></iframe>`, '',
      ].join('\n');
      const outputPath = path.join(root, 'wall.pdf');
      await pressDocument({ markdown, title: 'wall', outputPath });
      const text = await pdfText(outputPath);
      expect(text).toContain('VISIBLE_BODY_LINE');
      expect(text).not.toContain('FAKE_PLANTED_LOCAL_LINE');
      expect(text).not.toContain('FAKE_LOOPBACK_BODY');
      expect(loopbackHits).toBe(0);
    } finally {
      loopback.close();
    }
  }, 60_000);
});

describe('pressMayLoad — the press page loads its own document and inline data only', () => {
  const doc = 'file:///tmp/doc-press-x/document.html';
  test('its document, data: and blob: load; every other file, page and service does not', () => {
    expect(pressMayLoad(doc, doc)).toBe(true);
    expect(pressMayLoad('data:image/svg+xml;base64,AAAA', doc)).toBe(true);
    expect(pressMayLoad('blob:null/1234', doc)).toBe(true);
    expect(pressMayLoad('file:///etc/passwd', doc)).toBe(false);
    expect(pressMayLoad('file:///tmp/doc-press-x/other.html', doc)).toBe(false);
    expect(pressMayLoad('http://127.0.0.1:3333/api/v1/auth/me', doc)).toBe(false);
    expect(pressMayLoad('https://example.com/x.png', doc)).toBe(false);
  });
});
