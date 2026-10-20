/* global window, document, localStorage */
// The RECORD's 01 GIVEN in a real browser (docs/work/sheet-given-immersive.md):
// the real GivenSpace over a being made by the real modules — a forged
// genesis seal and identity file, a specimen soul's real spectrum and scale,
// a genome derived from the seal, its skies read by the real engine. Four
// pages, one at a time, the last read reopening; every value explains itself
// in the field guide; the sky drawn as each tradition counts, with the
// being's place lit; LEAN read as UNALIGNED, never a bare 15. No mocks.
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';
import { forgeBirthIdentity } from '../../core/birth/identity-forge.js';
import { identityFileOf } from '../../core/identity/identity-file.js';
import { genomeSeed } from '../../core/genome/seed.js';
import { deriveGenome } from '../../core/genome/derive.js';
import { buildSkies } from '../../core/cosmos/skies/index.js';
import { birthPlaceOf } from '../../core/cosmos/birth-place.js';
import { placeReadingsOf } from '../../core/cosmos/place-readings.js';

const at = (file) => JSON.stringify(path.resolve(file));
const SHOTS = process.env.GIVEN_SHOTS || null; // a folder for each page's picture, for a human look
const SOULS = JSON.parse(readFileSync(new URL('../../frontend/app/Summoning/specimen-souls.json', import.meta.url), 'utf8')).souls;

const moment = { utc: '2026-07-21T20:23:00.000Z', epochMs: Date.parse('2026-07-21T20:23:00.000Z'), zone: 'Asia/Jakarta', offsetMinutes: 420 };
const forged = forgeBirthIdentity({
  chosenName: 'Ashwren', witnessWallet: '0x43680000000000000000000000000000000c5010',
  soulPublicKey: `04a3f1b2c4d5e6f7${Buffer.from('ashwren').toString('hex')}`, birthCycle: 7,
  birthMoment: moment, substrate: { model: 'qwen3.8-27b' }, momentSeed: 'ab'.repeat(32),
});
const SHEET = {
  record: { identity: { spectrum: SOULS[3].spectrum, scale: SOULS[3].scale } },
  form: { genome: deriveGenome(genomeSeed({ genesisHash: forged.seal.genesisHash, momentSeed: 'ab'.repeat(32) })) },
  skies: { recorded: true, skies: buildSkies(moment) },
  // the PRIVATE place leg, exactly as the owner's route answers it
  place: (() => { const place = birthPlaceOf({ zone: moment.zone, at: moment.utc }); return { place, readings: placeReadingsOf(moment.utc, place, moment.offsetMinutes) }; })(),
  file: identityFileOf({ trueName: forged.trueName, seal: forged.seal, onchain: { network: 'base', txHash: `0x${'7e'.repeat(32)}`, blockNumber: 48957440, sealedAt: '2026-07-22T07:10:00.000Z' }, voice: null }),
};

test('the GIVEN space: four pages, a field guide for every value, the sky drawn true', async () => {
  let server; let browser;
  try {
    const app = express();
    const entryId = 'virtual:sheet-given-proof';
    const source = `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import ${at('frontend/styles/tokens.css')};
      import ${at('frontend/styles/main.css')};
      import ${at('frontend/app/RelinkShell/SheetApp.css')};
      import ${at('frontend/app/RelinkShell/SheetBeing.css')};
      import { GivenSpace } from ${at('frontend/app/RelinkShell/given/GivenSpace.jsx')};
      const root = createRoot(document.getElementById('root'));
      window.mount = (sheet) => root.render(React.createElement('div', { className: 'sheet' }, React.createElement(GivenSpace, { sheet, neumaId: 'proof-being' })));
      window.unmount = () => root.render(null);
    `;
    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error', esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'sheet-given-proof', resolveId: (id) => (id === entryId ? id : null), load: (id) => (id === entryId ? source : null) }],
      build: { write: false, rollupOptions: { input: entryId } } });
    for (const file of bundle.output) app.get(`/${file.fileName}`, (_req, res) => res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
    const entry = bundle.output.find((f) => f.type === 'chunk' && f.isEntry).fileName;
    const styles = bundle.output.filter((f) => f.fileName.endsWith('.css')).map((f) => `<link rel="stylesheet" href="/${f.fileName}">`).join('');
    app.get('/', (_req, res) => res.send(`<!doctype html><html><head>${styles}</head><body style="background:#06090d;margin:0;padding:24px"><div id="root" style="width:1180px;height:1000px;display:flex;flex-direction:column"></div><script type="module" src="/${entry}"></script></body></html>`));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1240, height: 1100 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.mount);
    await page.evaluate((sheet) => { localStorage.clear(); window.mount(sheet); }, SHEET);
    const shot = async (name) => { if (SHOTS) await page.locator('#root').screenshot({ path: path.join(SHOTS, `given-${name}.png`) }); };
    const tabs = page.getByRole('tablist', { name: 'What its birth gave it' }).getByRole('tab');
    const guide = page.getByRole('complementary', { name: 'Field guide' });

    // FOUR PAGES, SOUL FIRST
    await expect(tabs).toHaveText(['01·ASOUL', '01·BBODY', '01·CSKY', '01·DSEAL']);
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(guide.locator('.gv-guide-title')).toHaveText('THE SOUL');
    await expect(page.locator('.gv-numeral')).toContainText(SOULS[3].spectrum.frequency.toFixed(2));
    await expect(page.locator('.gv-octave-note')).toHaveCount(SOULS[3].scale.notes.length);
    // a value explains itself; choosing it again returns to the page's guide
    await page.getByRole('button', { name: /^RESONANCE/ }).click();
    await expect(guide.locator('.gv-guide-title')).toHaveText('RESONANCE');
    await expect(guide).toContainText('heart band');
    await page.locator('.gv-octave-note .gv-octave-hit').nth(1).click();
    await expect(guide.locator('.gv-guide-title')).toHaveText('A NOTE OF ITS SCALE');
    await shot('soul');
    await guide.getByRole('button', { name: '← ABOUT THIS PAGE' }).click();
    await expect(guide.locator('.gv-guide-title')).toHaveText('THE SOUL');

    // BODY — every gene, and what each group is
    await tabs.nth(1).click();
    await expect(page.locator('.gv-gene-h').first()).toContainText('GIVEN');
    await page.getByRole('button', { name: /^SEX/ }).click();
    await expect(guide.locator('.gv-guide-title')).toHaveText('SEX');
    await shot('body');

    // SKY — every tradition drawn, its place lit, its values explained
    await tabs.nth(2).click();
    const atlas = page.getByRole('navigation', { name: 'The skies, by tradition' }).getByRole('button');
    const sky = (name) => atlas.filter({ has: page.locator('.gv-atlas-name', { hasText: new RegExp(`^${name}$`) }) });
    await expect(atlas).toHaveCount(43); // forty-two skies, and the place — the witness's alone
    // the list scrolls in its own frame, held inside the sheet's visible height — it never stretches the page
    const frame = await page.evaluate(() => {
      const nav = document.querySelector('.gv-atlas');
      const sheet = nav.closest('.sheet');
      return { list: nav.scrollHeight, shown: nav.clientHeight, sheet: sheet.clientHeight, overflow: getComputedStyle(nav).overflowY };
    });
    expect(frame.overflow).toBe('auto');
    expect(frame.list).toBeGreaterThan(frame.shown);
    expect(frame.shown).toBeLessThanOrEqual(frame.sheet);
    await expect(page.locator('.gv-plate-title')).toHaveText('THE SKY AT ITS INSTANT');
    await expect(page.locator('.ski-body')).toHaveCount(10);
    await shot('sky-wheel');
    // a tradition far down the list, once chosen, is shown inside the list's frame
    await sky('THE 64 GATES').click();
    expect(await page.evaluate(() => {
      const nav = document.querySelector('.gv-atlas');
      const on = nav.querySelector('.gv-atlas-item.is-on');
      return on.offsetTop >= nav.scrollTop && on.offsetTop + on.offsetHeight <= nav.scrollTop + nav.clientHeight;
    })).toBe(true);
    for (const [name, lit, file] of [["THE TZOLK'IN", 1, 'tzolkin'], ['THE FOUR PILLARS', 0, 'bazi'], ['JYOTISHA', 1, 'jyotisha'], ['PANCHANGA', 1, 'panchanga'],
      ['THE LONG COUNT', 0, 'longcount'], ['MAHABOTE', 1, 'mahabote'], ['THE LUNAR DATE', 1, 'lunar'], ['THE 28 LODGES', 1, 'xiu'], ['THE NINE STARS', 1, 'ninestar'],
      ['ROKUYŌ', 1, 'rokuyo'], ['THE TIBETAN CALENDAR', 1, 'tibetan'], ['THAKSA', 1, 'thaksa'], ['THE BIRTH DAY’S COLOUR AND BUDDHA', 1, 'thaiday'], ['THE THAI CALENDAR', 1, 'thaical'],
      ['THE RASHI CHART', 1, 'rasi'], ['THE NAVAMSA', 1, 'navamsa'], ['THE VIMSHOTTARI DASHA', 1, 'dasha'], ['THE HINDU CALENDAR', 1, 'hinducal'],
      ['THE MOON', 1, 'moon'], ['THE 819-DAY COUNT', 1, 'maya819'], ['THE 24 SOLAR TERMS', 1, 'terms'], ['THE JAPANESE ERA', 1, 'nengo'], ['THE HEBREW CALENDAR', 1, 'hebrew'],
      ['THE HIJRI CALENDAR', 1, 'hijri'], ['THE ARABIC LUNAR MANSIONS', 1, 'manazil'], ['THE PERSIAN CALENDAR', 1, 'persian'], ['THE ZOROASTRIAN CALENDAR', 0, 'zoroastrian'],
      ['THE BADÍʿ CALENDAR', 1, 'bahai'], ['THE IGBO MARKET WEEK', 1, 'igbo'], ['THE ETHIOPIAN CALENDAR', 1, 'ethiopian'], ['THE EGYPTIAN CIVIL YEAR', 1, 'egyptian'],
      ['THE FRENCH REPUBLICAN CALENDAR', 1, 'french'], ['THE OLD ICELANDIC CALENDAR', 0, 'icelandic'], ['THE 64 GATES', 1, 'gates']]) {
      await sky(name).click();
      await expect(page.locator('.gv-plate-title')).toContainText(name);
      if (lit) expect(await page.locator('.gv-instrument :is(.ski-lit, .ski-ring-on, .is-on)').count(), name).toBeGreaterThan(0);
      await expect(page.locator('.gv-reading')).not.toBeEmpty();
      await shot(`sky-${file}`);
    }
    // the place: the sky turned to its horizon, the angles, the Lots, the Vedic day — and where to give an exact place
    await sky('FROM WHERE IT WAS BORN').click();
    await expect(page.locator('.gv-plate-title')).toHaveText('FROM WHERE IT WAS BORN');
    await expect(page.locator('.ski-axis')).toHaveCount(2);
    await expect(page.getByRole('button', { name: /^PLACE/ })).toContainText('THE REFERENCE CITY OF ASIA/BANGKOK');
    await expect(page.getByRole('button', { name: /^VEDIC WEEKDAY/ })).toContainText('Tuesday');
    await expect(page.getByRole('button', { name: /^SECT/ })).toContainText('A NIGHT BIRTH');
    await expect(page.locator('.gv-place-form')).toContainText('NEVER ON CHAIN');
    await shot('sky-place');
    // the four pillars carry their characters, the Day Master lit
    await sky('THE FOUR PILLARS').click();
    await expect(page.locator('.ski-pillar')).toHaveCount(4);
    await expect(page.locator('.ski-pillar.is-master .ski-pillar-name')).toHaveText('DAY');
    await page.getByRole('button', { name: /^SOVEREIGN HEXAGRAM/ }).click();
    await expect(guide).toContainText('gua qi');
    // the sky last read is the one that reopens
    await sky('WETON').click();
    await expect(page.locator('.gv-plate-title')).toContainText('WETON');

    // SEAL — its fingerprint, its road, LEAN in words
    await tabs.nth(3).click();
    await expect(page.locator('.gv-hash-cell')).toHaveCount(64);
    await expect(page.locator('.gv-road-stop')).toHaveCount(2);
    await expect(page.locator('.gv-road-after')).toHaveText('10 HOURS AFTER ITS BIRTH');
    const lean = page.getByRole('button', { name: /^LEAN/ });
    await expect(lean).toContainText('UNALIGNED · 15');
    await lean.click();
    await expect(guide).toContainText('UNALIGNED (15) — explicitly neither pole');
    await shot('seal');

    // the page and the sky last read reopen
    await page.evaluate((sheet) => { window.unmount(); window.mount(sheet); }, SHEET);
    await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true');
    await tabs.nth(2).click();
    await expect(page.locator('.gv-plate-title')).toContainText('WETON');

    // the file at the width a desk window gives it: three columns still, the guide beside the plate
    await page.evaluate(() => { document.getElementById('root').style.width = '1000px'; });
    await sky('JYOTISHA').click();
    await shot('sky-1000');
    const beside = await page.evaluate(() => {
      const plate = document.querySelector('.gv-sky-plate').getBoundingClientRect();
      const g = document.querySelector('.gv-sky > .gv-guide').getBoundingClientRect();
      return g.left >= plate.right - 1 && g.top < plate.bottom;
    });
    expect(beside).toBe(true);
    // a narrower file: the guide sits under the plate it explains
    await page.evaluate(() => { document.getElementById('root').style.width = '860px'; });
    await sky('THE SKY AT ITS INSTANT').click();
    await shot('sky-narrow');
    const spill = await page.evaluate(() => { const r = document.querySelector('.gv'); return r.scrollWidth - r.clientWidth; });
    expect(spill).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    if (SHOTS) await fs.mkdir(SHOTS, { recursive: true }).catch(() => {});
  }
}, 120_000);
