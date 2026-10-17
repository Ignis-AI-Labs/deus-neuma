// @ts-check
import { test, expect } from '@playwright/test';

/**
 * THE LOOK is global — the intro and the identity door wear the dress
 * BEFORE any sign-in. No token anywhere in this spec: the mirror
 * (localStorage 'neuma-look') is the pre-auth paint path, applied by the
 * index.html pre-paint script and re-applied in full by bootLook.
 *
 * The dress here is the operator's own "Castlevainia" — the palette that
 * exposed the broken flow (legacy --color-cyan doors on a dressed card).
 */

const DRESS = { ground: '#2E2E2D', panel: '#C5303F', ink: '#FFFFFF', trim: '#B31414', head: '#FF9E9E', alert: '#D42A5B' };

const seedDress = (page) =>
  page.addInitScript((d) => localStorage.setItem('neuma-look', JSON.stringify(d)), DRESS);

const signalVar = (page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--signal').trim());

test('the gateway wears the mirrored dress before any sign-in', async ({ page }) => {
  await seedDress(page);
  await page.goto('/?noboot=1');
  // The ground carries the page — the pre-paint script lands before paint.
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(46, 46, 45)');
  // The signal token IS the dress's trim, portal-wide.
  expect(await signalVar(page)).toBe('#B31414');
  // The heading register carries the dress's HEAD voice.
  expect(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-heading').trim())).toBe('#FF9E9E');
  // A CLAIMED register lands; an UNCLAIMED one keeps the stylesheet's voice.
  expect(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--alert').trim())).toBe('#D42A5B');
  expect(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--warn').trim())).toBe('#FFB86B');
  await expect(page.locator('#portal-enter')).toBeVisible();
});

test('the identity door reads in INK, with the dress TRIM on its accents — never legacy cyan', async ({ page }) => {
  await seedDress(page);
  await page.goto('/?noboot=1');
  await page.locator('#portal-enter').click();
  const create = page.locator('#wp-create');
  await expect(create).toBeVisible();
  // Doctrine: the label is INK (legible on the panel under any dress)…
  expect(await create.evaluate((el) => getComputedStyle(el).color)).toBe('rgba(255, 255, 255, 0.95)');
  // …and the TRIM (#B31414) lights the border on hover — never #00FFFF.
  await create.hover();
  await expect.poll(() => create.evaluate((el) => getComputedStyle(el).borderTopColor))
    .toBe('rgb(179, 20, 20)');
});

test('with no dress the gateway stands stock', async ({ page }) => {
  await page.goto('/?noboot=1');
  expect(await signalVar(page)).toBe('#5FE9FF');
  // Stock headings ride the secondary ink — the register exists pre-dress.
  // (a custom property reads back as written — 0.7 and 0.70 are the same ink)
  expect(await page.evaluate(() =>
    getComputedStyle(document.body).getPropertyValue('--color-heading').trim())).toMatch(/^rgba\(255, 255, 255, 0\.70?\)$/);
  await expect(page.locator('#portal-enter')).toBeVisible();
});
