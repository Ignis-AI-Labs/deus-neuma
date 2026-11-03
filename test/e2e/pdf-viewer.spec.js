// @ts-check
/* global fetch, Buffer, Event, WheelEvent */
// Real PDF rendering: production build, isolated backend, signed wallet auth,
// real upload/tree/pdf.js and pixel checks. No mocks in the claimed path.
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { setupPerfStack, initPerfSession, perf, PERF_LAUNCH } from './helpers/perf-harness.js';
import { passDeskGates } from './helpers/desk-gates.js';
import { openFolderViaPanel } from './helpers/explorer-panel-harness.js';
import { ownerClaimHeaders } from './helpers/owner-claim.js';
import { claimOwner } from '../helpers/claim-owner.js';

setupPerfStack();
test.use({ viewport: { width: 1600, height: 900 }, launchOptions: PERF_LAUNCH });

test.beforeAll(async () => {
  const wallet = ethers.Wallet.createRandom();
  const { challenge } = await (await fetch(`${perf.BASE}/api/v1/auth/challenge?address=${wallet.address}`)).json();
  const signature = await wallet.signMessage(challenge);
  const verified = await fetch(`${perf.BASE}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ownerClaimHeaders(path.join(perf.root, 'data')) },
    body: JSON.stringify({ address: wallet.address, signature, challenge }),
  });
  const { token } = await verified.json();
  if (!token) throw new Error('PDF test wallet did not authenticate');
  perf.token = token;
  perf.addr = wallet.address;
  await claimOwner(perf.root, 'e2e-perf', wallet.address);
});

// Exact xref offsets make these real, parseable PDFs, not a renderer fixture.
const buildProofPdf = (pageLabels = ['GNOSIS']) => {
  const fontObject = 3 + pageLabels.length * 2;
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    `<</Type/Pages/Kids[${pageLabels.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}]/Count ${pageLabels.length}>>`,
  ];
  for (const [index, label] of pageLabels.entries()) {
    const content = `BT /F1 36 Tf 40 350 Td (${label}) Tj ET`;
    objects.push(
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 500 700]/Contents ${4 + index * 2} 0 R/Resources<</Font<</F1 ${fontObject} 0 R>>>>>>`,
      `<</Length ${content.length}>>stream\n${content}\nendstream`,
    );
  }
  objects.push('<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>');
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

const homes = [];
const showPdf = async (page, bytes) => {
  const home = fs.mkdtempSync(path.join('/tmp/', 'pdf-gnosis-'));
  homes.push(home);
  const opened = await fetch(`${perf.BASE}/api/v1/user/files/roots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${perf.token}` },
    body: JSON.stringify({ root: home }),
  });
  expect(opened.status).toBe(200);
  const uploaded = await fetch(
    `${perf.BASE}/api/v1/user/files/upload?path=${encodeURIComponent(home)}&name=proof.pdf`,
    { method: 'POST', headers: { Authorization: `Bearer ${perf.token}` }, body: bytes },
  );
  expect(uploaded.status).toBe(201);

  await initPerfSession(page);
  await page.goto(`http://localhost:${perf.FPORT}/?test=1`);
  await passDeskGates(page, 10000);
  await page.locator('.xp-open').waitFor({ timeout: 20000 });
  await openFolderViaPanel(page, home);
  await page.locator('.files-name', { hasText: 'proof.pdf' }).click();
  await expect(page.locator('.pdf-canvas')).toHaveCount(1, { timeout: 30000 });
  await expect(page.locator('text=BINARY FILE')).toHaveCount(0);
};

const hasRaster = (canvas) => canvas.evaluate((node) => {
  const cv = /** @type {HTMLCanvasElement} */ (node);
  if (!cv.width || !cv.height) return false;
  const data = cv.getContext('2d')?.getImageData(0, 0, cv.width, cv.height).data;
  if (!data) return false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) return true;
  }
  return false;
});

const scrollToBottom = async (page) => {
  const stage = page.locator('.pdf-stage');
  await stage.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    node.dispatchEvent(new Event('scroll', { bubbles: true }));
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: 500, bubbles: true }));
  });
};

test.afterEach(async () => {
  for (const home of homes.splice(0)) {
    await fetch(`${perf.BASE}/api/v1/user/files/roots`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${perf.token}` },
      body: JSON.stringify({ root: home }),
    });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a PDF opened from the tree renders — real raster, honest instrument and zoom', async ({ page }) => {
  await showPdf(page, buildProofPdf());
  const canvas = page.locator('.pdf-canvas');
  await expect(page.locator('.pdf-pos').first()).toHaveText('1 / 1');
  await expect.poll(() => hasRaster(canvas), { timeout: 30000 }).toBe(true);

  await page.locator('.pdf-act[title="Zoom in"]').click();
  await expect(page.locator('.pdf-pos').nth(1)).toHaveText('125%');
  await expect.poll(() => hasRaster(canvas), { timeout: 30000 }).toBe(true);
});

test('continuous scrolling reveals every page and preserves upward navigation', async ({ page }) => {
  await showPdf(page, buildProofPdf(['PAGE ONE', 'PAGE TWO', 'PAGE THREE']));
  const canvases = page.locator('.pdf-canvas');
  await expect(page.locator('.pdf-pos').first()).toHaveText('1 / 3');
  await expect.poll(() => hasRaster(canvases.first()), { timeout: 30000 }).toBe(true);

  await scrollToBottom(page);
  await expect(canvases).toHaveCount(2, { timeout: 30000 });
  await expect(page.locator('.pdf-pos').first()).toHaveText('2 / 3');
  await expect.poll(() => hasRaster(canvases.nth(1)), { timeout: 30000 }).toBe(true);

  await scrollToBottom(page);
  await expect(canvases).toHaveCount(3, { timeout: 30000 });
  await expect(page.locator('.pdf-pos').first()).toHaveText('3 / 3');
  await expect.poll(() => hasRaster(canvases.nth(2)), { timeout: 30000 }).toBe(true);
  await expect.poll(() => hasRaster(canvases.first()), { timeout: 30000 }).toBe(true);

  await page.locator('.pdf-page[data-page="1"]').evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await expect(page.locator('.pdf-pos').first()).toHaveText('1 / 3');
  await expect(canvases).toHaveCount(3);

  await page.locator('.pdf-act[title="Next page"]').click();
  await expect(page.locator('.pdf-pos').first()).toHaveText('2 / 3');
  await page.locator('.pdf-act[title="Next page"]').click();
  await expect(page.locator('.pdf-pos').first()).toHaveText('3 / 3');
  await page.locator('.pdf-act[title="Previous page"]').click();
  await expect(page.locator('.pdf-pos').first()).toHaveText('2 / 3');
});
