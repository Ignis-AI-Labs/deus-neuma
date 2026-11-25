// A native dropdown's options carry the look's ground and ink (deus-neuma #26).
// The House POSITIONS selects (`settings-input`) opened a white list under
// STONE's off-white text. Real Chromium, the real stylesheets, the real look
// derivation; a dark look and a light one.
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { deriveLookVars } from '../../frontend/utils/look-derive.js';
import { STOCK_PRESETS } from '../../frontend/utils/look-presets.js';

const SHEETS = ['frontend/styles/tokens.css', 'frontend/styles/base.css', 'frontend/app/RelinkShell/SettingsApp.css'];

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');

describe('native dropdown options follow the look', () => {
  let browser;
  let css;
  beforeAll(async () => {
    css = (await Promise.all(SHEETS.map((f) => fs.readFile(f, 'utf8')))).join('\n');
    browser = await chromium.launch({ args: ['--disable-gpu'] });
  });
  afterAll(async () => { await browser?.close(); });

  const optionColours = async (presetId) => {
    const { theme } = STOCK_PRESETS.find((p) => p.id === presetId);
    const vars = Object.entries(deriveLookVars(theme)).map(([k, v]) => `${k}: ${v};`).join(' ');
    const page = await browser.newPage();
    await page.setContent(`<style>${css}\n:root { ${vars} }</style>
      <select class="settings-input" aria-label="title"><option>choose a title…</option><option>Herald</option></select>`);
    const colours = await page.locator('option').nth(1).evaluate((el) => {
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, color: s.color };
    });
    await page.close();
    return { theme, colours };
  };

  test('STONE: the list is the dark ground with the light ink', async () => {
    const { theme, colours } = await optionColours('stone');
    expect(colours.background).toBe(`rgb(${rgb(theme.ground)})`);
    expect(colours.color).toContain(rgb(theme.body));
  });

  test('PARCHMENT: a light look keeps its light ground and dark ink', async () => {
    const { theme, colours } = await optionColours('parchment');
    expect(colours.background).toBe(`rgb(${rgb(theme.ground)})`);
    expect(colours.color).toContain(rgb(theme.body));
  });
}, 30_000);
