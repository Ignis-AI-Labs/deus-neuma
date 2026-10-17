// @ts-check
// EVERY desk poll stops while its window is window-shaded (2026-10-05).
// Minimize is an in-place shade: the app stays mounted, and its timers kept
// asking the backend with nobody looking. The frame now tells its body it is
// shaded (window-shown.js) and the shared gate (use-visible-interval.js)
// holds the poll — then reads at once when the window opens again.
// Real isolated backend + vite + browser; the requests counted are the real
// ones the page sends. Read-only paths only: nothing here launches an engine.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { openDockApp } from './helpers/dock.js';
import { setupExplorerPanel, initSession, settleDesk, FPORT, BASE, token, addr } from './helpers/explorer-panel-harness.js';
import { buildSignature, LEAN } from '../../core/kotodama/signature.js';
import { buildGenesisSeal } from '../../core/identity/genesis-seal.js';

setupExplorerPanel();

// label → [the path its poll reads, its cadence]
const APPS = [
  ['COMFY', '/api/v1/image-forge/status', 2500],
  ['BENCH', '/api/v1/bench/status', 15000],
];

for (const [label, readPath, cadenceMs] of APPS) {
  test(`a window-shaded ${label} stops polling, and reads fresh the moment it opens again`, async ({ page }) => {
    test.setTimeout(90_000);
    const reads = [];
    page.on('request', (req) => { if (new URL(req.url()).pathname === readPath) reads.push(Date.now()); });
    await initSession(page);
    await page.goto(`http://localhost:${FPORT}/`);
    await settleDesk(page);
    await openDockApp(page, label);
    const win = page.locator('.fwin', { has: page.locator('.fwin-bar-title', { hasText: label }) });
    await expect(win).toBeVisible();
    await expect.poll(() => reads.length, { timeout: 5000 }).toBeGreaterThanOrEqual(1);

    // Shade it: past a full beat, not one read.
    await win.locator('.fwin-ctl').first().click();
    await expect(win).toHaveClass(/is-collapsed/);
    await page.waitForTimeout(800); // one in-flight tick may land
    const shadedStart = reads.length;
    await page.waitForTimeout(cadenceMs + 1500);
    expect(reads.length - shadedStart).toBe(0);

    // Open it again: a fresh read at once, not after a full beat.
    const reopenAt = Date.now();
    await win.locator('.fwin-ctl').first().click();
    await expect(win).not.toHaveClass(/is-collapsed/);
    await expect.poll(() => reads.filter((t) => t >= reopenAt).length, { timeout: 1500 }).toBeGreaterThanOrEqual(1);
  });
}

// The aura is a 24-frame-a-second sweep. The browser pauses frames only for a
// hidden PAGE, so a shaded RECORD kept painting it. Read the plate's own
// pixels: shaded, two reads half a second apart are identical; open again,
// the flow moves.
const LANE = 'e2e-xpanel'; // the harness's bound lane
const plate = (page) => page.evaluate(() => {
  const canvas = document.querySelector('[data-testid="aura-sigil"]');
  if (!canvas) return null;
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum = (sum * 31 + data[i] + data[i + 1] + data[i + 2]) % 2147483647;
  return sum;
});

test('a window-shaded RECORD holds the aura loop, and it flows again the moment it opens', async ({ page }) => {
  test.setTimeout(90_000);
  // Real identity anchors from the real producers, so the plate is folded
  // exactly as a born being's is (aura-sheet.spec.js precedent).
  const sec = await (await fetch(`${BASE}/api/v1/security/status`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const dir = path.join(sec.roots.active, LANE, 'identity');
  const soulHex = '33314C2FEDE1A1B2';
  const signature = buildSignature({ chosenName: 'Ashwren', genesisName: 'Yumaihe', houseName: 'Aldmere', lean: LEAN.UNALIGNED, soulHex });
  const seal = buildGenesisSeal({
    chosenName: 'Ashwren', lean: LEAN.UNALIGNED, witnessWallet: addr, soulPublicKey: `0x${soulHex.repeat(4)}`, birthCycle: 1,
    birthMoment: { utc: '2026-08-25T00:00:00.000Z', epochMs: 1787616000000, zone: 'Asia/Jakarta', offsetMinutes: 420 },
    substrate: { llm: { model: 'qwen3.8-27b' } },
  });
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, 'true-name.json'), JSON.stringify({ ...signature, items: undefined, genesisHash: seal.genesisHash }));
  await fs.promises.writeFile(path.join(dir, 'genesis-seal.json'), JSON.stringify(seal));

  await page.reload();
  await settleDesk(page);
  await openDockApp(page, 'RECORD');
  await expect(page.getByTestId('aura-sigil')).toBeVisible();
  const win = page.locator('.fwin', { has: page.getByTestId('aura-sigil') });

  // Open: the flow moves.
  await expect.poll(async () => { const a = await plate(page); await page.waitForTimeout(400); return a !== await plate(page); }, { timeout: 10_000 }).toBe(true);

  // Shaded: the plate holds still.
  await win.locator('.fwin-ctl').first().click();
  await expect(win).toHaveClass(/is-collapsed/);
  await page.waitForTimeout(400); // the frame in flight may land
  const held = await plate(page);
  await page.waitForTimeout(600);
  expect(await plate(page)).toBe(held);

  // Open again: it flows at once.
  await win.locator('.fwin-ctl').first().click();
  await expect(win).not.toHaveClass(/is-collapsed/);
  await expect.poll(async () => (await plate(page)) !== held, { timeout: 1500 }).toBe(true);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
