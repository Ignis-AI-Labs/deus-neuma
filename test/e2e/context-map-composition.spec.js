// @ts-check
// CONTEXT MAP · COMPOSITION — the window-anatomy instrument, driven for real
// on the desk harness (real challenge-sign-verify auth, a real claimed lane,
// the real portal WS) and a real turn through the live substrate producing a
// real context:composition event. Compressed-region rendering is proven in
// test/unit/context-map-view.test.js (minting one needs the model to choose a
// tool whose output crosses the cap — nondeterministic through a real model).
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { openDockApp } from './helpers/dock.js';
import { setupDesk } from './helpers/desk-harness.js';

setupDesk();

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');

test('CONTEXT MAP opens from the dock with the honest empty state before any turn', async ({ page }) => {
  await openDockApp(page, 'CONTEXT MAP');
  await expect(page.locator('.ctx')).toBeVisible();

  // No turn has been observed on this fresh portal session — the view says
  // exactly that, and fabricates nothing.
  await expect(page.locator('.empty-state')).toContainText('NO TURN OBSERVED YET THIS SESSION');
  await expect(page.locator('.ctx-sec')).toHaveCount(0);

  // FIELD against the live stack: the seeded lane holds no crystallized memory,
  // so the pane says so (or names the failed read) — never a blank or invented map.
  await page.locator('.ctx-tab', { hasText: 'FIELD' }).click();
  await expect(page.locator('.empty-state')).toContainText(/NO CRYSTALLIZED FIELD YET|THE FIELD COULD NOT BE READ/);
  await expect(page.locator('.ctx-field-refresh')).toBeVisible();

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('a real turn draws the composition: sections, honest token labels, totals, budget', async ({ page }) => {
  // Send a real thought FIRST — the composition hook lives at the desk
  // level, so the event is held even while the MAP window is closed.
  const field = page.locator('.relink-input-field');
  await expect(field).toBeEnabled({ timeout: 15000 });
  await field.fill('Answer with one single word.');
  await field.press('Enter');
  // A live turn needs a being that can speak. The harness's seeded lane holds
  // none, and the composer says so — then there is no real event to draw, and
  // this test says why it did not run rather than drawing a made-up one (the
  // view itself is proven in test/integration/context-map-browser.test.js).
  const refused = await page.getByText('CANNOT BE SPOKEN', { exact: false }).first()
    .waitFor({ timeout: 8000 }).then(() => true, () => false);
  test.skip(refused, 'the active lane holds no being that can speak — no live composition event exists to draw');

  await openDockApp(page, 'CONTEXT MAP');
  await expect(page.locator('.ctx')).toBeVisible();

  // Emission 1 lands right after prompt assembly — the anatomy appears without
  // waiting for the full reply. (Emission 2 later relabels, same anatomy.)
  const secs = page.locator('.ctx-sec');
  await expect(secs.first()).toBeVisible({ timeout: 60000 });
  expect(await secs.count()).toBeGreaterThan(0);

  // Honest labels: per-section counts are never measured (attributed or
  // approx, both rungs) — every one reads ~N with a visible EST tag.
  await expect(secs.first().locator('.ctx-tok')).toContainText('~');
  await expect(secs.first().locator('.ctx-est')).toHaveText('EST');

  // The last request's total, and the window: a real used/total with its named
  // source, or the honest unknown — never an invented ceiling.
  await expect(page.locator('.ctx-panel-h', { hasText: 'SECTION TOTAL' }).locator('.ctx-tok')).toContainText(/\d/);
  await expect(page.locator('.ctx-budget')).toContainText(/(\/ [\d,]+ · [A-Z]|— \/ UNKNOWN)/);

  // A family is a door: pressing it leaves only that family's sections.
  const fam = page.locator('.ctx-fam').first();
  const famClass = (await fam.getAttribute('class')).match(/ctx-fam-[a-z]+/)[0];
  await fam.click();
  await expect(fam).toHaveAttribute('aria-pressed', 'true');
  const shown = await secs.evaluateAll((els) => els.map((e) => e.className));
  expect(shown.every((c) => c.includes(famClass))).toBe(true);
  await fam.click();

  // Compressed regions: with no over-cap tool result this turn, the section
  // says so honestly (ref rendering is proven in the component test).
  await expect(page.locator('.ctx-panel-h', { hasText: 'COMPRESSED REGIONS' })).toBeVisible();

  // The shot: the measured emission when the substrate reports usage, given the desk.
  await page.locator('.ctx-tok-measured').first().waitFor({ timeout: 180000 }).catch(() => {});
  await page.setViewportSize({ width: 1600, height: 1000 });
  const win = page.locator('.fwin', { has: page.locator('.ctx') });
  const maximize = win.getByRole('button', { name: 'Maximize window' });
  if (await maximize.count()) await maximize.first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'context-map-composition.png') });

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

