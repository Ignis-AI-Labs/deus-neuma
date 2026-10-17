// @ts-check
// THE IGNITION, RAISED — the specimen for Founder's eyes (2026-10-06: […]). The real timeline and painter on the specimen page, the
// rite's instrument language switched on: frames of both looks at the same
// beats, and the raised one recorded playing from the top, in real time.
// Shots + the film land in test/e2e/shots/ for review.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { setupSpecimenServer, REPO } from './helpers/vite-specimen.js';

const baseUrl = setupSpecimenServer('ignition.html');
const SHOTS = path.join(REPO, 'test/e2e/shots');

const seek = async (page, ms) => {
  await page.locator('.gs-range').fill(String(ms));
  await page.waitForTimeout(150);
};

test('raised and current, beat for beat — and the raised one plays clean', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1600, height: 900 });

  for (const look of ['raised', 'current']) {
    await page.goto(`${baseUrl()}/ignition.html?look=${look}`);
    await expect(page.locator('.gs-bar')).toBeVisible();
    await page.getByRole('button', { name: 'PAUSE' }).click();
    for (const [beat, ms] of [['waking', 1400], ['answering', 2500], ['whole', 3500]]) {
      await seek(page, ms);
      await page.screenshot({ path: path.join(SHOTS, `ignition-${look}-${beat}.png`) });
    }
  }
  // the new witness at the gateway, raised, once every verdict is in
  await page.goto(`${baseUrl()}/ignition.html?look=raised`);
  await page.getByRole('button', { name: 'NEW WITNESS', exact: true }).click();
  await page.getByRole('button', { name: 'PAUSE' }).click();
  await seek(page, 3300);
  await page.screenshot({ path: path.join(SHOTS, 'ignition-raised-gateway.png') });
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('the raised ignition, filmed in real time', async ({ browser }) => {
  test.setTimeout(60_000);
  const dir = path.join(SHOTS, 'ignition-raised-film');
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir, size: { width: 1600, height: 900 } } });
  const page = await context.newPage();
  await page.goto(`${baseUrl()}/ignition.html?look=raised`);
  await expect(page.locator('.gs-bar')).toBeVisible();
  await page.getByRole('button', { name: 'FROM THE TOP' }).click();
  await page.waitForTimeout(6500);
  const video = page.video();
  await context.close();
  const file = await video.path();
  fs.renameSync(file, path.join(SHOTS, 'ignition-raised.webm'));
  fs.rmSync(dir, { recursive: true, force: true });
});
