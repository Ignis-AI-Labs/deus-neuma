// @ts-check
// SUBSTRATE polls only while someone can see it (use-visible-interval.js).
// A window-shaded lens used to spend 40 telemetry reads a minute — each two
// nvidia-smi spawns and three model-server probes — with nobody looking.
// Real isolated backend + vite + browser; the requests counted are the real
// ones the page sends.
import { test, expect } from '@playwright/test';
import { openDockApp } from './helpers/dock.js';
import { setupExplorerPanel, initSession, settleDesk, FPORT } from './helpers/explorer-panel-harness.js';

setupExplorerPanel();

test('a window-shaded SUBSTRATE lens stops polling, and reads fresh the moment it opens again', async ({ page }) => {
  const reads = [];
  page.on('request', (req) => { if (req.url().includes('/api/v1/substrate/telemetry')) reads.push(Date.now()); });
  await initSession(page);
  await page.goto(`http://localhost:${FPORT}/`);
  await settleDesk(page);
  await openDockApp(page, 'SUBSTRATE');
  const win = page.locator('.fwin', { has: page.locator('.sub-body') });
  await expect(win.locator('.sub-body')).toBeVisible();

  // Open and on screen: it polls (1.5 s cadence).
  const openStart = reads.length;
  await page.waitForTimeout(4000);
  expect(reads.length - openStart).toBeGreaterThanOrEqual(2);

  // Window-shade it: the body clips to nothing and the reads stop.
  await win.locator('.fwin-ctl').first().click();
  await expect(win).toHaveClass(/is-collapsed/);
  await page.waitForTimeout(800); // one in-flight tick may land
  const shadedStart = reads.length;
  await page.waitForTimeout(4500);
  expect(reads.length - shadedStart).toBe(0);

  // Open it again: a fresh read at once, not after a full interval.
  const reopenAt = Date.now();
  await win.locator('.fwin-ctl').first().click();
  await expect(win).not.toHaveClass(/is-collapsed/);
  await expect.poll(() => reads.filter((t) => t >= reopenAt).length, { timeout: 1200 }).toBeGreaterThanOrEqual(1);
});

// RAM (Design note, 2026-10-13: […]). The panel reads
// this machine's real memory — its total must be the kernel's own MemTotal.
test('the SUBSTRATE lens shows the machine\'s RAM, the model server\'s and the cache ceiling', async ({ page }) => {
  const { readFileSync } = await import('fs');
  const totalG = (Number(readFileSync('/proc/meminfo', 'utf8').match(/^MemTotal:\s+(\d+)/m)[1]) / 1048576).toFixed(1);
  await initSession(page);
  await page.goto(`http://localhost:${FPORT}/`);
  await settleDesk(page);
  await openDockApp(page, 'SUBSTRATE');
  const panel = page.locator('.sub-panel', { has: page.locator('.sub-panel-title', { hasText: /^RAM$/ }) });
  await expect(panel).toBeVisible();
  await expect(panel.locator('.sub-kv-pct').first()).toHaveText(new RegExp(`^\\d+\\.\\d/${totalG.replace('.', '\\.')}G$`));
  await expect(panel).toContainText('AVAILABLE');
  await expect(panel).toContainText('MODEL SERVER');
  await expect(panel).toContainText('CACHE LIMIT');
});
