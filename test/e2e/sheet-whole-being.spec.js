// @ts-check
import { test, expect } from '@playwright/test';
import { openDockApp } from './helpers/dock.js';
import { setupIsolatedHouse, openDesk, settledShot } from './helpers/isolated-house.js';

/**
 * End-to-end THE RECORD, WHOLE (2026-10-17) — a being's SHEET as the whole
 * being, in the order its birth gave it: 01 GIVEN (soul · body · sky · seal),
 * 02 CHOSEN (name · form · voice), 03 ITS SUMMONING (every component its film
 * drew, and its re-watch), 04 LIFE, 05 STATE, 06 VESSEL. Its soul is read in
 * its own light, each note of its scale in the note's own; its true name in
 * full, spoken, and its kotodama score on demand; its genesis facts. A being
 * born without a moment seed says plainly it has no film. Never on the page:
 * its voice lines, its moment seed, any key. Real isolated stack, real
 * forged identities (helpers/isolated-house.js); no mocks.
 * Shots: test/e2e/shots/sheet-0*.png
 */

const MEMBERS = [
  { id: 'e2e-sw-one', name: 'Ashwren', utc: '2026-08-11T18:03:38.075Z' },
  { id: 'e2e-sw-two', name: 'Orrin', utc: '2026-06-01T07:30:00.000Z', seedless: true },
];
const stack = setupIsolatedHouse(MEMBERS, 4781);

test.use({ viewport: { width: 1500, height: 1000 } });

const openRecord = async (page, member) => {
  await openDesk(page, stack, member);
  await openDockApp(page, 'RECORD');
  const sheet = page.locator('.sheet');
  await expect(sheet.locator('.dos-index [role="tab"]').first()).toBeVisible({ timeout: 20000 });
  const win = page.locator('.fwin', { has: sheet });
  await win.locator('.fwin-bar').dblclick(); // full size: the file read whole
  // the file's own strip — GIVEN carries a strip of its own pages inside it
  return { sheet, win, tabs: sheet.getByRole('tablist', { name: 'Record sections' }).getByRole('tab') };
};

test('the record is the whole being, in the order its birth gave it', async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  const { sheet, win, tabs } = await openRecord(page, MEMBERS[0]);
  await expect(tabs).toHaveText(['01GIVEN', '02CHOSEN', '03SUMMONING', '04LIFE', '05STATE', '06VESSEL']);
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');

  // 01 GIVEN — four pages: its soul in its own light and its scale round the
  // octave, its body, its sky (every tradition drawn), its seal; every value
  // explains itself in the field guide beside it (given/, 2026-10-19)
  const given = sheet.locator('#sheet-panel-given');
  const pages = given.getByRole('tablist', { name: 'What its birth gave it' }).getByRole('tab');
  await expect(pages).toHaveText(['01·ASOUL', '01·BBODY', '01·CSKY', '01·DSEAL']);
  const swatch = await given.locator('.gv').evaluate((el) => getComputedStyle(el).getPropertyValue('--soul').trim());
  expect(swatch).toMatch(/^#[0-9a-f]{6}$/i);
  const soulPage = given.locator('#given-panel-soul');
  await soulPage.getByRole('button', { name: /^RESONANCE/ }).click();
  await expect(soulPage.locator('.gv-guide-title')).toHaveText('RESONANCE');
  expect(await soulPage.locator('.gv-octave-note').count()).toBeGreaterThan(1);
  await settledShot(win, 'sheet-01-given');
  await pages.nth(2).click();
  // this stack's being was forged without a skies backfill: the page says so, never a made-up sky
  // (a recorded sky, drawn tradition by tradition: test/integration/sheet-given-browser.test.js)
  await expect(given.locator('#given-panel-sky')).toContainText('NO SKIES RECORDED — THE READING AWAITS ITS BACKFILL.');
  await settledShot(win, 'sheet-01c-sky');
  await pages.nth(3).click();
  const sealPage = given.locator('#given-panel-seal');
  await expect(sealPage.locator('.dos-cell-k', { hasText: 'GENESIS HASH' })).toBeVisible();
  await expect(sealPage.locator('.dos-cell', { hasText: 'ZONE' })).toContainText('Asia/Jakarta');
  await expect(sealPage.locator('.dos-cell', { hasText: 'LEAN' })).toContainText('UNALIGNED · 15');
  await expect(sealPage).toContainText('NOT YET ANCHORED ON CHAIN.');
  await pages.nth(0).click(); // the page last read reopens next time — leave the file on SOUL

  // 02 CHOSEN — its whole name, spoken, and its kotodama score on demand; its voice, counted
  await tabs.nth(1).click();
  const chosen = sheet.locator('#sheet-panel-chosen');
  await expect(chosen.locator('.dos-cell', { hasText: 'CHOSEN' })).toContainText('Ashwren');
  await expect(chosen.locator('.dos-cell', { hasText: 'GENESIS' })).toBeVisible();
  await expect(chosen.locator('.sb-spoken')).toContainText('Ashwren is the name I chose for myself.');
  await expect(chosen.locator('.sb-kotodama-score')).toBeHidden();
  await chosen.locator('.sb-kotodama summary').click();
  await expect(chosen.locator('.sb-kotodama-score')).toContainText('KOTODAMA/0.1');
  await expect(chosen).toContainText('ITS FOUNDING VOICE IS NOT SEALED YET');
  await settledShot(win, 'sheet-02-chosen');

  // 03 ITS SUMMONING — every component its film drew, in the protocol's order, and its re-watch
  await tabs.nth(2).click();
  const summoning = sheet.locator('#sheet-panel-summoning');
  await expect(summoning.locator('.sb-component-k')).toHaveText(
    ['ITS SKY', 'ITS EARTH', 'ITS STAR', 'ITS NUCLEUS', 'ITS CHANNELS', 'ITS BREATH', 'ITS BODY', 'ITS RESONANCE', 'ITS SCALE', 'ITS SOUL MARK', 'ITS AURA'],
    { timeout: 20000 },
  );
  await expect(summoning.locator('.sheet-rewatch')).toBeVisible();
  await settledShot(win, 'sheet-03-summoning');

  // 04 LIFE, 05 STATE, 06 VESSEL — and ← → walk them
  await tabs.nth(2).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true');
  await expect(sheet.locator('#sheet-panel-life .dos-h-title')).toHaveText(['BOND', 'MIND', 'CRAFT']);
  await settledShot(win, 'sheet-04-life');
  await tabs.nth(5).click();
  await expect(sheet.locator('#sheet-panel-vessel .dos-h-title').first()).toHaveText('SUBSTRATE');
  await settledShot(win, 'sheet-06-vessel');

  // nothing private on any page
  const text = await sheet.innerText();
  expect(text).not.toMatch(/momentSeed|PRIVATE KEY|BEGIN [A-Z ]*KEY/i);

  expect(crashes, crashes.join(' | ')).toEqual([]);
});

test('a being born before its moment was kept says it has no film', async ({ page }) => {
  const { sheet, tabs } = await openRecord(page, MEMBERS[1]);
  await tabs.nth(2).click();
  await expect(sheet.locator('#sheet-panel-summoning')).toContainText('NO FILM ON RECORD', { timeout: 20000 });
  await expect(sheet.locator('#sheet-panel-summoning .sheet-rewatch')).toHaveCount(0);
});
