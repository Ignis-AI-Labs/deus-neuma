// @ts-check
// Desk e2e — BRAND KITS: the rail, the OWNER binding, and the type specimens.
//
// Design note, 2026-08-31, on the panel this replaced: […]
//
// What is proven here is the SHAPE, not the styling. Three things the old panel
// got wrong and that a unit test cannot catch, because they are about what
// reaches the operator:
//
//   1. every gated section is reachable — twenty of thirty-nine fields used to
//      live only in a raw JSON textarea
//   2. OWNER is the house's own dropdown, not a box asking for an identifier
//      nobody ever sees
//   3. typography is four ROLES with real specimens, not eleven flat rows
//
// The rules underneath (neumaId as the value, a departed owner kept and marked,
// the form/gate arithmetic) are unit-proven in brand-kits-view.test.js,
// kit-form.test.js and brand-kit-editor.test.js. This is the seam where they
// reach a browser.
import { test, expect } from '@playwright/test';
import { openDockApp } from './helpers/dock.js';
import { setupDesk } from './helpers/desk-harness.js';

setupDesk();

/** Open the window and select the first kit from the header switcher.
 *  ⚠️ The roster moved into the header on 2026-08-31 — the left column is the
 *  SECTION rail now, which is what the panel was actually missing. */
const openFirstKit = async (page) => {
  await openDockApp(page, 'BRAND KITS');
  const panel = page.locator('.outreach-panel').last();
  const switcher = panel.locator('.bk-switch .lc-sel-trigger');
  await expect(switcher).toBeVisible();
  if (await switcher.isDisabled()) return { panel, switcher, empty: true };
  await switcher.click();
  await page.locator('.lc-sel-panel .lc-sel-opt').first().click();
  await expect(panel.locator('.bk-rail-row').first()).toBeVisible();
  return { panel, switcher, empty: false };
};

/** Click a section in the rail by its label. */
const openSection = async (panel, label) => {
  await panel.locator('.bk-rail-row', { hasText: label }).first().click();
};

test('BRAND KITS: every gated section is reachable from the rail', async ({ page }) => {
  const { panel, empty } = await openFirstKit(page);
  test.skip(empty, 'no brand kits on this rig');

  // THE REGRESSION THIS ASSERTS. POSITIONING, MESSAGE, VOICE, CLAIMS, LEGAL,
  // ASSET RULES, ACCESSIBILITY and CHANNELS had no control of any kind — the
  // panel presented a brand kit as "colours and fonts" while the gate that
  // blocks every campaign asked for nine sections.
  for (const label of [
    'IDENTITY', 'COLOUR', 'TYPOGRAPHY', 'MARKS', 'POSITIONING', 'MESSAGE',
    'VOICE', 'CLAIMS', 'LEGAL', 'ASSET RULES', 'ACCESSIBILITY', 'CHANNELS',
  ]) {
    await expect(
      panel.locator('.bk-rail-row', { hasText: label }).first(),
      `${label} has no rail entry`,
    ).toBeVisible();
  }

  // And a section opens onto real controls rather than a JSON blob.
  await openSection(panel, 'CLAIMS');
  await expect(panel.locator('.bk-section-head', { hasText: 'CLAIMS' })).toBeVisible();
  await expect(panel.locator('.bk-list').first()).toBeVisible();

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('BRAND KITS: OWNER is a bound picker, never a typed identifier', async ({ page }) => {
  const { panel, empty } = await openFirstKit(page);
  test.skip(empty, 'no brand kits on this rig');
  await openSection(panel, 'IDENTITY');

  const owner = panel.locator('.bk-field', { hasText: 'OWNER' });
  await expect(owner).toBeVisible();

  // A text input here is the old field: it accepts "metidar", "Metidar", or a
  // typo, and stores all three — binding to nobody.
  await expect(owner.locator('input')).toHaveCount(0);
  await expect(owner.locator('.lc-sel-trigger')).toBeVisible();

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('BRAND KITS: the picker offers the house, and the choice survives a round trip', async ({ page }) => {
  const { panel, empty } = await openFirstKit(page);
  test.skip(empty, 'no brand kits on this rig');
  await openSection(panel, 'IDENTITY');
  const trigger = panel.locator('.bk-field', { hasText: 'OWNER' }).locator('.lc-sel-trigger');

  // An empty house disables the control rather than offering an empty menu —
  // there is genuinely nobody to answer for the brand yet, and a dropdown that
  // opens onto nothing reads as a bug rather than as an answer.
  if (await trigger.isDisabled()) {
    await expect(trigger).toContainText('NO HOUSE MEMBERS YET');
    expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
    return;
  }

  await trigger.click();
  const options = page.locator('.lc-sel-panel .lc-sel-opt');
  await expect(options.first()).toBeVisible();
  const chosen = (await options.first().innerText()).trim();
  await options.first().click();
  await expect(trigger).toContainText(chosen);

  // ⚠️ AND THE PIP APPEARS. This is the failure Founder hit: […] The choice was held in a draft with nothing on
  // screen saying so and SAVE at the bottom of a long scroll.
  await expect(panel.locator('.bk-dirty')).toBeVisible();

  // The choice survives leaving the section and returning — a draft that
  // reverts on navigation is the failure that looks exactly like success at
  // the moment of clicking.
  await openSection(panel, 'VOICE');
  await openSection(panel, 'IDENTITY');
  await expect(trigger).toContainText(chosen);

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('BRAND KITS: typography is four roles with honest specimens', async ({ page }) => {
  const { panel, empty } = await openFirstKit(page);
  test.skip(empty, 'no brand kits on this rig');
  await openSection(panel, 'TYPOGRAPHY');

  // Four roles, not eleven flat rows. The old panel drew DISPLAY, DISPLAY
  // WEIGHT, DISPLAY TRACKING, VOICE, VOICE WEIGHT… with no indication of which
  // belonged to which — […]
  for (const role of ['HEADLINES', 'PROSE', 'LABELS & DATA', 'BIG NUMBERS']) {
    await expect(panel.locator('.bk-role', { hasText: role }).first()).toBeVisible();
  }

  const headlines = panel.locator('.bk-role', { hasText: 'HEADLINES' }).first();

  // Family and weight are PICKERS over the vendored registry, not free text.
  // A kit could previously name a font, show it correctly on the operator's own
  // machine from their system fonts, and draw every card in a fallback.
  await expect(headlines.locator('.lc-sel-trigger')).toHaveCount(2);

  // ⚠️ THE SPECIMEN APPLIES THE WEIGHT THE CONTROL SHOWS, not just the family.
  // The old one set `fontFamily` to the row's own value, so DISPLAY WEIGHT
  // rendered its specimen in a font named "900" — and no specimen anywhere
  // applied a weight or a tracking at all.
  //
  // Asserted against the picker rather than against a fixed number, because
  // which weight is right is the brand's business; that the specimen AGREES
  // with it is ours.
  const specimen = headlines.locator('.bk-specimen');
  await expect(specimen).toBeVisible();
  const shown = await headlines.locator('.lc-sel-trigger').nth(1).innerText();
  const declared = shown.match(/\b(\d{3})\b/)?.[1];
  if (declared) {
    expect(await specimen.evaluate((el) => getComputedStyle(el).fontWeight)).toBe(declared);
  }

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
