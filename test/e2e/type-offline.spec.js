// @ts-check
// THE DESK'S TYPE NEVER ASKS THE NETWORK — Inter and JetBrains Mono ship inside the app
// (frontend/styles/main.css, fontsource), so a page renders its own faces with every request to
// anywhere but this machine refused, and no request ever tries to leave (the privacy page says so).
import { test, expect } from '@playwright/test';
import { setupSpecimenServer } from './helpers/vite-specimen.js';

const base = setupSpecimenServer('ignition.html');

test('the faces load from the app itself, and nothing tries to leave the machine', async ({ page }) => {
  const outside = [];
  await page.route('**/*', (route) => {
    const { hostname } = new URL(route.request().url());
    if (hostname === 'localhost' || hostname === '127.0.0.1') return route.continue();
    outside.push(route.request().url());
    return route.abort();
  });
  await page.goto(`${base()}/ignition.html`);
  await page.evaluate(async () => {
    // Ask for both families at the weights the tokens use, the way text on screen would.
    await Promise.all(['200 16px Inter', '400 16px Inter', '600 16px Inter', '400 16px "JetBrains Mono"']
      .map((f) => document.fonts.load(f)));
    await document.fonts.ready;
  });
  const loaded = await page.evaluate(() => [...document.fonts]
    .filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`));
  expect(loaded.some((f) => f.startsWith('Inter'))).toBe(true);
  expect(loaded.some((f) => f.startsWith('JetBrains Mono'))).toBe(true);
  expect(outside).toEqual([]);
});
