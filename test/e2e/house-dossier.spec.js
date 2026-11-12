// @ts-check
import { test, expect } from '@playwright/test';
import { openDockApp } from './helpers/dock.js';
import { passDeskGates } from './helpers/desk-gates.js';
import { setupIsolatedHouse, openDesk, settledShot as shot } from './helpers/isolated-house.js';

/**
 * End-to-end THE HOUSE AS A FILE (2026-10-17) — the HOUSE window as the
 * SHEET's dossier: a cover with every member's light, and five spaces one
 * page at a time (MEMBERS · SUMMONING · GATHER · POSITIONS · GROUNDS), walked by
 * click and by arrow keys, the last one opened remembered. Every member wears
 * its own soul color — read from the real roster, derived from a real forged
 * birth identity. The SUMMON door opens the ceremony's consent gate and the
 * test stops there (a test never begins a birth).
 *
 * Driven for real: own backend child, own vite dev server, real
 * challenge-sign-verify auth, real disk. No mock anywhere (RULE 0).
 * SAFETY LAW: NEVER a live stack — PID-derived bind-probed ports, a
 * disposable temp WORKSPACES_ROOT, realm and settings routed into it; the
 * recorded PIDs only are killed in afterAll. Shots: test/e2e/shots/house-*.png
 */

const MEMBERS = [
  { id: 'e2e-hd-one', name: 'Ashwren', utc: '2026-06-11T18:03:38.075Z' },
  { id: 'e2e-hd-two', name: 'Corvane', utc: '2026-07-02T09:41:12.000Z' },
  { id: 'e2e-hd-three', name: 'Sefira', utc: '2026-09-20T22:15:00.000Z' },
  // born before births kept their moment seed: no film can be drawn for it
  { id: 'e2e-hd-four', name: 'Orrin', utc: '2026-06-01T07:30:00.000Z', seedless: true },
];
const BY_BIRTH = [...MEMBERS].sort((a, b) => a.utc.localeCompare(b.utc)).map((m) => m.name);
const stack = setupIsolatedHouse(MEMBERS, 4631);

test.use({ viewport: { width: 1500, height: 1000 } });

test('the house is a file: its cover, five spaces, every member in its own light', async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await openDesk(page, stack, MEMBERS[0]);
  await openDockApp(page, 'HOUSE');
  const house = page.locator('.house.hd');
  await expect(house).toBeVisible();
  const win = page.locator('.fwin', { has: house });
  await win.locator('.fwin-bar').dblclick(); // full size: the file read whole

  // THE COVER: its name, how many it holds, one light per member in its soul color
  await expect(page.locator('.hd-mast-name')).not.toHaveText('—');
  await expect(page.locator('.hd-file')).toContainText('4 HELD');
  await expect(page.locator('.hd-mast-operator')).toContainText(`OPERATOR · ${stack.addr.slice(0, 6).toUpperCase()}`);
  const lights = page.locator('.hd-light');
  await expect(lights).toHaveCount(4);
  const colors = await lights.evaluateAll((els) => els.map((el) => getComputedStyle(el).getPropertyValue('--soul').trim()));
  colors.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/i));
  expect(new Set(colors).size).toBe(4); // four beings, four lights
  await expect(page.locator('.hd-light.is-linked')).toContainText(MEMBERS[0].name);

  // FIVE SPACES; MEMBERS first, carrying the count
  const tabs = page.locator('.hd .dos-index [role="tab"]');
  await expect(tabs).toHaveText(['01MEMBERS · 4', '02SUMMONING', '03GATHER', '04POSITIONS', '05GROUNDS']);
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.house-seats-card')).toHaveCount(4);
  await expect(page.locator('.house-seats-card.is-linked')).toContainText(MEMBERS[0].name);
  await shot(win, 'house-01-members');

  // SUMMONING — its own space: the two doors, and every birth with its film
  await tabs.nth(1).click();
  await expect(page.locator('.hd-door.is-primary')).toContainText('SUMMON A NEUMA');
  await expect(page.locator('.hd-door', { hasText: 'REHEARSE A SUMMONING' })).toBeVisible();
  await expect(page.locator('.hd-birth')).toHaveCount(4);
  await expect(page.locator('.hd-birth .hd-birth-name')).toHaveText(BY_BIRTH); // oldest first
  // every member with a moment seed has its film; the one without says so
  await expect(page.locator('.hd-birth .sheet-rewatch')).toHaveCount(3, { timeout: 15000 });
  await expect(page.locator('.hd-birth', { hasText: 'Orrin' }).locator('.hd-birth-nofilm')).toHaveText('NO FILM ON RECORD');
  await shot(win, 'house-02-summoning');

  // ← → walk the strip: GATHER, then POSITIONS
  await tabs.nth(1).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.hd-door', { hasText: 'FORM A TEAM' }).locator('button')).toBeEnabled();
  await expect(page.locator('.hd-door', { hasText: 'CONVENE A COUNCIL' }).locator('button')).toBeEnabled();
  await shot(win, 'house-03-gather');
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.house-seat-reference')).toBeVisible();
  await shot(win, 'house-04-seats');

  // GROUNDS — and the last space opened is the one the house reopens on
  await tabs.nth(4).click();
  await expect(page.locator('.house-ground-head', { hasText: 'HOUSE WORKSPACE' })).toBeVisible();
  await expect(page.locator('.house-ground-head', { hasText: 'CROSS-HOUSE GROUNDS' })).toBeVisible();
  await shot(win, 'house-05-grounds');
  await page.reload();
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30000 });
  await passDeskGates(page);
  await openDockApp(page, 'HOUSE');
  await expect(page.locator('.hd .dos-index [role="tab"]').nth(4)).toHaveAttribute('aria-selected', 'true');

  // A member's SHEET still reads as its dossier (its styles now live in Dossier.css)
  await page.locator('.hd .dos-index [role="tab"]').nth(0).click();
  await page.locator('.house-seats-card', { hasText: MEMBERS[0].name }).locator('.house-seats-act', { hasText: 'SHEET' }).click();
  const sheet = page.locator('.sheet');
  const record = sheet.getByRole('tablist', { name: 'Record sections' }); // the record's own strip, not its GIVEN plates'
  await expect(record.getByRole('tab').first()).toBeVisible({ timeout: 15000 });
  const strip = await record.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { position: cs.position, marginTop: parseFloat(cs.marginTop) };
  });
  expect(strip.position).toBe('sticky');
  expect(strip.marginTop).toBeLessThan(0); // the sheet's own bleed still applies
  await expect(sheet.locator('.dos-sec').first()).toHaveCSS('display', 'flex');
  await shot(page.locator('.fwin', { has: sheet }), 'house-06-sheet-still-whole');

  // THE SUMMON DOOR opens the ceremony's consent gate — and the test stops there
  await page.locator('.hd .dos-index [role="tab"]').nth(1).click();
  await page.locator('.hd-door.is-primary button').click();
  await expect(page.locator('.witness-commitment-overlay')).toBeVisible();

  expect(crashes, crashes.join(' | ')).toEqual([]);
});
