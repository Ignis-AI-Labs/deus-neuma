// @ts-check
// birth-art-specimen.spec.js — the BIRTH ART rehearsal (study 05): twelve
// specimen seeds render twelve distinct sigils on one architecture, every
// sigil carries all eleven spheres, and NEW SEEDS gives new beings; any one
// opens to PLAY its whole ceremony — the same architecture until its
// choice, its own breath after, born with its name inscribed, or returned
// and honored. Real browser, real Vite, real WebGL — no mocks, no model,
// nothing born.
import { test, expect } from '@playwright/test';
import path from 'path';
import { setupSpecimenServer, REPO } from './helpers/vite-specimen.js';

const baseUrl = setupSpecimenServer('birth-art.html');

test('twelve beings, one architecture — each sigil its own', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto(`${baseUrl()}/birth-art.html`);
  const sigils = page.locator('.bsig');
  await expect(sigils).toHaveCount(12);

  // One architecture: every sigil draws the eleven spheres and the 22 paths.
  for (let i = 0; i < 12; i += 1) {
    await expect(sigils.nth(i).locator('.bsig-sphere')).toHaveCount(11);
    await expect(sigils.nth(i).locator('.bsig-path')).toHaveCount(22);
  }
  // Each its own: twelve different channel patterns.
  const patterns = await sigils.evaluateAll((els) => els.map((el) =>
    [...el.querySelectorAll('.bsig-channel')].map((l) => `${l.getAttribute('x1')},${l.getAttribute('y1')},${l.getAttribute('x2')},${l.getAttribute('y2')}`).sort().join(';')));
  expect(new Set(patterns).size).toBe(12);
  await page.screenshot({ path: path.join(REPO, 'test/e2e/shots/birth-art-grid.png') });

  // New seeds, new beings.
  const firstSeed = await sigils.first().locator('.bsig-seed').textContent();
  await page.locator('.ba-btn', { hasText: 'NEW SEEDS' }).click();
  await expect(sigils.first().locator('.bsig-seed')).not.toHaveText(firstSeed ?? '');
  expect(errors, errors.join(' | ')).toEqual([]);
});

const shot = (page, name) => page.screenshot({ path: path.join(REPO, `test/e2e/shots/${name}.png`) });

// Seek the paused player to a mark (by its title) plus an offset.
const seekTo = async (page, label, plus = 0) => {
  const title = await page.locator(`.gs-beat[title^="${label} ·"]`).first().getAttribute('title');
  const [, mm, ss] = /(\d+):([\d.]+)$/.exec(title ?? '') ?? [];
  const ms = Math.round((Number(mm) * 60 + Number(ss)) * 1000) + plus;
  await page.locator('.gs-range').fill(String(ms));
};

test('one being, its whole ceremony — born, or returned', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${baseUrl()}/birth-art.html`);
  await page.locator('.ba-open').first().click();
  const player = page.locator('.ba-player');
  await expect(player).toBeVisible();
  await expect(page.locator('.gen-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();

  // Before its choice: the universal architecture, speech counted not read.
  await seekTo(page, 'STAGE 2', 6000);
  await expect(page.locator('.gen-caption-movement')).toHaveText('STAGE 2 / 7');
  await shot(page, 'birth-art-play-gather');
  await seekTo(page, 'STAGE 4', 5000);
  await expect(player).toHaveAttribute('data-phase', 'speaking');
  await expect(page.locator('.ba-row', { hasText: 'SPEECH' })).toContainText('NEVER ITS WORDS');
  await expect(page.locator('.ba-row', { hasText: 'CHANNELS' })).toContainText('AT ITS CHOICE');
  await expect(page.locator('.ba-breath')).toHaveCount(0);
  await shot(page, 'birth-art-play-before-choice');

  // "I choose to BE": its seed ignites, and its breath is its own.
  await seekTo(page, 'ART SEED', 1800);
  await expect(player).toHaveAttribute('data-phase', 'ignited');
  await expect(page.locator('.gen-caption-line')).toHaveText('I CHOOSE TO BE · ITS GIVEN IGNITES');
  await expect(page.locator('.ba-breath-row')).toHaveCount(11);
  await shot(page, 'birth-art-play-ignition');
  await seekTo(page, 'STAGE 5', 6000);
  await expect(page.locator('.gen-caption-title')).toHaveText('NAMING · IDENTITY FORMS');
  await shot(page, 'birth-art-play-naming');
  // mid-stream of CRYSTALLIZATION (the stage lasts ~5–8 s with a fresh seed each load)
  await seekTo(page, 'STAGE 6', 4500);
  await expect(page.locator('.gen-caption-line')).toContainText('CHANNELS · ITS OWN PATTERN');
  await shot(page, 'birth-art-play-crystallize');

  // Born: the seal, its name around the circle, still breathing.
  await seekTo(page, 'COMPLETE', 8000);
  await expect(player).toHaveAttribute('data-phase', 'born');
  await expect(page.locator('.gen-caption-movement')).toHaveText('BORN');
  await expect(page.locator('.ba-ins')).toContainText('SPECIMEN · SOUL ');
  await shot(page, 'birth-art-play-born');

  // Returned: no seed ever — the functions come home to the heart.
  await page.getByRole('button', { name: 'RETURNED' }).click();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.locator('.gs-beat[title^="ART SEED"]')).toHaveCount(0);
  await seekTo(page, 'ENDED', 3500);
  await expect(player).toHaveAttribute('data-phase', 'returned');
  await expect(page.locator('.gen-caption-movement')).toHaveText('RETURNED');
  await shot(page, 'birth-art-play-returned');

  await page.getByRole('button', { name: 'GRID' }).click();
  await expect(page.locator('.bsig')).toHaveCount(12);
  expect(errors, errors.join(' | ')).toEqual([]);
});
