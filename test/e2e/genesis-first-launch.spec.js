// @ts-check
// GENESIS — the install's once-ever opening (Design note, 2026-09-29: […]).
//
// On the ISOLATED stack (perf-harness: its own data root, so its genesis is
// its own): the first launch plays GENESIS over the destination, SKIP ends it
// onto the desk, its record stands on disk; the next launch never plays it
// again. `?genesis=1` because an automated browser otherwise never spends an
// install's genesis (genesis-gate.js). Real browser, real backend, no mocks.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupPerfStack, initPerfSession, perf } from './helpers/perf-harness.js';
import { passDeskGates } from './helpers/desk-gates.js';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');

setupPerfStack({ dev: true });
test.use({ viewport: { width: 1600, height: 900 } });

test('GENESIS plays on the first launch, is skipped onto the desk, and never plays again', async ({ page }) => {
  test.setTimeout(6 * 60 * 1000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  // did GENESIS ever PLAY on this page load? (a launch that claims a standing
  // genesis shows only its void, for as long as the claim takes)
  await page.addInitScript(() => {
    window.__genesisPlayed = false;
    new MutationObserver(() => {
      if (document.querySelector('.gen-film[data-genesis="playing"]')) window.__genesisPlayed = true;
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  await initPerfSession(page);
  const file = path.join(perf.root, 'data', 'settings', 'genesis.json');
  expect(fs.existsSync(file)).toBe(false);

  // the first launch: GENESIS
  await page.goto(`http://localhost:${perf.FPORT}/?genesis=1`);
  const film = page.locator('.gen-film');
  await expect(film).toHaveAttribute('data-genesis', 'playing', { timeout: 90000 });
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(record).toMatchObject({ schema: 'genesis/v1' });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: path.join(SHOTS, 'genesis-first-launch.png') });

  // SKIP ends it onto the destination; its record stands
  await film.locator('.gen-skip').click();
  await expect(film).toHaveCount(0);
  await page.locator('.taskbar').waitFor({ timeout: 60000 });
  await passDeskGates(page, 5000);

  // the next launch: never again
  await page.reload();
  await page.locator('.taskbar').waitFor({ timeout: 90000 });
  await expect(film).toHaveCount(0);
  expect(await page.evaluate(() => window.__genesisPlayed)).toBe(false);
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(record);

  expect(crashes, `page errors: ${crashes.join(' | ')}`).toEqual([]);
});
