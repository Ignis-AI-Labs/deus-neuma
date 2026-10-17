// @ts-check
//
// Impure test module: drives a REAL chromium page (Rule 1 marker, file level).
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * The PDF reader gnosis — a real document opened from the FILES tree renders
 * in its own window, proven by PIXELS (RULE 0: no mocks anywhere): real auth
 * (the witness wallet's challenge-sign-verify), the real backend + tree, the
 * real upload route, the real pdf.js render in a real browser.
 *
 * Proves:
 *   1. clicking a .pdf in the tree opens THE READER (not the text editor's
 *      BINARY FILE — NOT SHOWN)
 *   2. the canvas carries real raster — non-white pixels (the page's text)
 *   3. the instrument reads the document honestly: 1 / 1
 *
 * Requires the isolated dev stack (PRIVATE root — the same recipe as
 * retry-anywhere.spec.js).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BACKEND = `http://localhost:${process.env.PORT || 3333}`;
const LANE = { laneId: 'witness-kimi-code-Basunor', name: 'Basunor' };

// A REAL one-page PDF with visible text, assembled with exact xref offsets
// (a reader must never see a broken document from its own house).
const buildProofPdf = () => {
  const text = 'GNOSIS';
  const content = `BT /F1 36 Tf 40 150 Td (${text}) Tj ET`;
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${content.length}>>stream\n${content}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
};

const mintToken = async () => {
  const env = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8');
  const pk = env.match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  const w = new ethers.Wallet(pk);
  const addr = w.address;
  const { challenge } = await (await fetch(`${BACKEND}/api/v1/auth/challenge?address=${addr}`)).json();
  const signature = await w.signMessage(challenge);
  const res = await fetch(`${BACKEND}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, signature, challenge }),
  });
  const { token } = await res.json();
  if (!token) throw new Error('auth/verify returned no token');
  return { token, addr };
};

test('a PDF opened from the tree renders — real raster, honest instrument', async ({ page }) => {
  const { token, addr } = await mintToken();

  // The document's home: a PRIVATE folder, opened through the real roots
  // route, the PDF landed through the real upload bridge.
  const home = fs.mkdtempSync(path.join('/tmp/', 'pdf-gnosis-'));
  const opened = await fetch(`${BACKEND}/api/v1/user/files/roots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ root: home }),
  });
  expect(opened.status).toBe(200);
  const up = await fetch(
    `${BACKEND}/api/v1/user/files/upload?path=${encodeURIComponent(home)}&name=proof.pdf`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: buildProofPdf() },
  );
  expect(up.status).toBe(201);

  await page.addInitScript(({ t, a, id, n }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: n, neumaId: id }));
    sessionStorage.setItem('authToken', t);
    sessionStorage.setItem(`arrivalSeen:${w}`, '1');
  }, { t: token, a: addr, id: LANE.laneId, n: LANE.name });

  await page.goto('/');
  // The birth-setup gate rises over a freshly provisioned lane — stand aside.
  const standAside = page.locator('.birth-setup-gate button', { hasText: 'STAND ASIDE' });
  if (await standAside.isVisible({ timeout: 8000 }).catch(() => false)) {
    await standAside.click();
    await expect(page.locator('.birth-setup-gate')).toHaveCount(0);
  }

  // The tree: expand the opened root, click the document.
  const rootRow = page.locator('.files-row', { hasText: path.basename(home) });
  await expect(rootRow).toBeVisible({ timeout: 30000 });
  await rootRow.click();
  const docRow = page.locator('.files-row', { hasText: 'proof.pdf' });
  await expect(docRow).toBeVisible({ timeout: 10000 });
  await docRow.click();

  // THE READER — never the editor's BINARY refusal.
  const canvas = page.locator('.pdf-canvas');
  await expect(canvas).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.pdf-pos').first()).toHaveText('1 / 1');
  await expect(page.locator('text=BINARY FILE')).toHaveCount(0);

  // The raster is REAL: pdf.js drew the page's text — non-white pixels
  // exist on the canvas.
  await expect
    .poll(async () => canvas.evaluate((c) => {
      const cv = /** @type {HTMLCanvasElement} */ (c);
      if (!cv.width || !cv.height) return false;
      const ctx = cv.getContext('2d');
      if (!ctx) return false;
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) return true;
      }
      return false;
    }), { timeout: 30000 })
    .toBe(true);

  // The zoom instrument moves and reads honestly.
  await page.locator('.pdf-act[title="Zoom in"]').click();
  await expect(page.locator('.pdf-pos').nth(1)).toHaveText('125%');

  // Leave the house as found: close the root, remove the folder.
  await fetch(`${BACKEND}/api/v1/user/files/roots`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ root: home }),
  });
  fs.rmSync(home, { recursive: true, force: true });
});
