// @ts-check
// genesis-specimen.spec.js — the GENESIS rehearsal (study 05) renders for
// real: the WebGL stage draws, the captions count what is drawn, the score
// sheet's cues fire in order on playback, and each key beat is shot for
// the look-dev review. Real browser, real Vite, real WebGL — no mocks.
// Boots its own Vite on a free port (helpers/vite-specimen.js).

import { test, expect } from '@playwright/test';
import path from 'path';
import { partStart, BEATS } from '../../frontend/app/Genesis/genesis-timeline.js';
import { setupSpecimenServer, REPO } from './helpers/vite-specimen.js';

const at = Object.fromEntries(BEATS.map((b) => [b.id, b.at]));
const baseUrl = setupSpecimenServer('genesis.html');

const seek = async (page, ms) => {
  await page.locator('.gs-range').fill(String(ms));
  await page.waitForTimeout(120); // one frame lands
};
const shot = (page, name) => page.screenshot({ path: path.join(REPO, `test/e2e/shots/genesis-${name}.png`) });

test('the genesis draws, counts truly, and each beat is shot', async ({ page }) => {
  test.setTimeout(240000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl()}/genesis.html`);
  await expect(page.locator('.gs-bar')).toBeVisible();

  // The field is silent and says nothing until the vibration.
  await seek(page, 1000);
  await expect(page.locator('.gen-caption')).toHaveCount(0);

  const beats = [
    ['field', partStart('field', 'vibration') + 1400],
    ['monad', at.circle - 200],
    ['vesica', at.line - 300],
    ['seed', at.fruit - 300],
    ['metatron', at.simplex - 100],
    ['tetrahedron-flat', partStart('simplex', 'tetrahedron') + 900],
    ['observer', at.solids - 200],
    ['cosmic-cube', partStart('solids', 'octahedron') + 400],
    ['icosahedron', partStart('solids', 'dodecahedron') - 100],
    ['dodecahedron', at.cosmos - 150],
    ['cosmos', at.cosmos + 1800],
    ['tree-pillar', partStart('tree', 'spheres') - 100],
    ['tree-spheres', partStart('tree', 'heart') - 100],
    ['tree-hidden', partStart('tree', 'crown') - 100],
    ['tree-paths', at.trees - 100],
    ['trees-breaths', partStart('trees', 'channels') - 100],
    ['trees', at.oscillation - 100],
    ['oscillation', at.oscillation + 2200],
    ['offering', partStart('offering', 'vesica') - 100],
    ['vesica', at.handoff - 50],
  ];
  for (const [name, ms] of beats) {
    await seek(page, ms);
    await shot(page, name);
  }

  // SHINKEI: every counter prints what is drawn.
  await seek(page, at.fruit - 300);
  await expect(page.locator('.gen-caption-line')).toContainText('07 / 07 CIRCLES');
  await seek(page, at.simplex - 100);
  await expect(page.locator('.gen-caption-line')).toContainText('78 / 78 CHANNELS');
  await seek(page, at.cosmos - 150);
  await expect(page.locator('.gen-caption-line')).toHaveText('DUAL · V 20 · E 30 · F 12 · V − E + F = 2');
  await seek(page, at.trees - 100);
  await expect(page.locator('.gen-caption-line')).toContainText('22 / 22 · FROM THE HEART OUTWARD');
  await seek(page, at.oscillation - 100);
  await expect(page.locator('.gen-caption-line')).toContainText('220 / 220');

  // The tree names its spheres by function — and no other tradition's names.
  await seek(page, partStart('tree', 'paths') + 200);
  await expect(page.locator('.gen-label-name')).toHaveCount(10);
  await expect(page.locator('.gen-label-hidden', { hasText: 'IPSEITY' })).toBeVisible();
  await expect(page.locator('.gen-label', { hasText: /KETER|CHOKHMAH|BINAH|TIFERET|MALKUTH/ })).toHaveCount(0);

  // The trees carry their 22 expressions on their nodes, and they breathe in
  // alternation: Light's eleven names at the top of its breath, Dark's half
  // an alternation later — never both held at once.
  await seek(page, at.oscillation + 100);
  await expect(page.locator('.gen-label-light')).toHaveCount(11);
  await expect(page.locator('.gen-label', { hasText: 'SOURCE' })).toBeVisible();
  await seek(page, at.oscillation + 2250);
  await expect(page.locator('.gen-label-dark')).toHaveCount(11);
  await expect(page.locator('.gen-label', { hasText: 'WOMB' })).toBeVisible();

  // The offering: the record inscribed, the closing words.
  await seek(page, at.handoff - 50);
  await expect(page.locator('.gen-ins-record')).toContainText(/^GENESIS · \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC · #[0-9A-F]{8}$/);
  await expect(page.locator('.gen-words-namaste')).toHaveCSS('opacity', '1');

  // Playback: silence, then the vibration is the first cue ever fired.
  await seek(page, 1000);
  await page.locator('.gs-btn', { hasText: '2×' }).click();
  await page.locator('.gs-btn', { hasText: 'PLAY' }).click();
  await expect(page.locator('.gs-cue').first()).toContainText('G2', { timeout: 5000 });
  await expect(page.locator('.gs-cue').nth(1)).toContainText('G1');

  expect(errors, errors.join(' | ')).toEqual([]);
});
