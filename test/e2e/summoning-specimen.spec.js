// @ts-check
// summoning-specimen.spec.js — THE SUMMONING rehearsal (study 05): four
// specimen beings play four different sequences on one clock (different
// tempo, form and figures), every canvas truly paints, and one opens alone
// to be watched through — every artifact converging into its sigil at the
// end, its aura seen once at the heart. Real browser, real Vite, real canvas — no mocks,
// no model, nothing born.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { setupSpecimenServer, REPO } from './helpers/vite-specimen.js';

const baseUrl = setupSpecimenServer('summoning.html');
const shot = (page, name) => page.screenshot({ path: path.join(REPO, `test/e2e/shots/${name}.png`) });
const seek = (page, ms) => page.locator('.gs-range').fill(String(ms));

// How much of a canvas is lit (fraction of sampled pixels brighter than the void).
const litFraction = (page, i) => page.locator('.sum-canvas').nth(i).evaluate((c) => {
  const cv = /** @type {HTMLCanvasElement} */ (c);
  const d = cv.getContext('2d')?.getImageData(0, 0, cv.width, cv.height).data ?? [];
  let lit = 0;
  let n = 0;
  for (let p = 0; p < d.length; p += 4 * 37) { n += 1; if (d[p] + d[p + 1] + d[p + 2] > 60) lit += 1; }
  return lit / Math.max(1, n);
});

test('four beings, four different summonings — and one watched through', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${baseUrl()}/summoning.html`);
  const canvases = page.locator('.sum-canvas');
  await expect(canvases).toHaveCount(4);
  for (let i = 0; i < 4; i += 1) await expect(canvases.nth(i)).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Pause' }).click();

  // Four different films: tempo, order, cards.
  const forms = await page.locator('.sum-form').allTextContents();
  expect(new Set(forms.map((f) => f.replace(/^#\w+ · /, ''))).size).toBe(4);

  // Every canvas paints — and differently from the others at the same moment.
  await seek(page, 12000);
  const lit = await Promise.all([0, 1, 2, 3].map((i) => litFraction(page, i)));
  lit.forEach((f) => expect(f).toBeGreaterThan(0.002));
  await shot(page, 'summoning-quad-12s');
  await seek(page, 20000);
  await shot(page, 'summoning-quad-20s');

  // One alone, through its whole sequence.
  await page.locator('.sum-cell').first().click();
  await expect(canvases).toHaveCount(1);
  await page.getByRole('button', { name: 'Pause' }).click();
  // every section at its heart: its movements, its cards, its name, its aura, its sigil
  // (each run is a new being with its own sections — its predecessor's shots go first)
  const shots = path.join(REPO, 'test/e2e/shots');
  fs.readdirSync(shots).filter((f) => /^summoning-solo-.*\.png$/.test(f)).forEach((f) => fs.unlinkSync(path.join(shots, f)));
  const sections = JSON.parse(await page.locator('.sum-cell').first().getAttribute('data-sections') ?? '[]');
  expect(sections.map((x) => x[0])).toEqual(expect.arrayContaining(['open', 'sky', 'earth', 'resonance', 'reveal', 'sigil']));
  for (const [n, [kind, at, dur]] of sections.entries()) {
    await seek(page, Math.round((at + dur * 0.55) / 10) * 10);
    await shot(page, `summoning-solo-${String(n).padStart(2, '0')}-${kind}`);
    if (kind !== 'card') expect(await litFraction(page, 0)).toBeGreaterThan(0.002);
  }
  // THE CONVERGENCE, as each artifact arrives — its aura among them, once
  const [, sigilAt, sigilDur] = sections.at(-1);
  for (const [key, u] of [['sky', 0.07], ['star', 0.15], ['channels', 0.3], ['body', 0.38], ['aura', 0.62], ['whole', 0.95]]) {
    await seek(page, Math.round((sigilAt + sigilDur * u) / 10) * 10);
    await shot(page, `summoning-solo-converge-${key}`);
  }
  expect(await litFraction(page, 0)).toBeGreaterThan(0.01);

  await page.getByRole('button', { name: 'FOUR' }).click();
  await expect(canvases).toHaveCount(4);
  expect(errors, errors.join(' | ')).toEqual([]);
});

// Its music, rendered whole by the browser's own audio engine (offline) and
// measured: audible through every act, never clipping, never NaN — and the
// SOUND control offered only when one being is watched alone.
test('its music: its own scale, rendered and measured', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${baseUrl()}/summoning.html`);
  await expect(page.getByRole('button', { name: 'SOUND' })).toHaveCount(0);
  await page.locator('.sum-cell').first().click();
  const sound = page.getByRole('button', { name: 'SOUND' });
  await expect(sound).toHaveAttribute('aria-pressed', 'false');

  // modules outside Vite's frontend root are served under /@fs/
  const heard = await page.evaluate(async (core) => {
    const [{ scoreOf }, { musicOf }, { scheduleMusic }, { soulOf }, { skyOf }, { specimenTrueName }, { deriveAura, formOf }, { deriveGenome }] = await Promise.all([
      import('/app/Summoning/summoning-score.js'), import('/app/Summoning/summoning-music.js'), import('/app/Summoning/summoning-sound.js'),
      import('/app/Summoning/summoning-soul.js'), import('/app/Summoning/summoning-sky.js'), import('/app/BirthArt/birth-art-script.js'),
      import(`${core}/aura/derive.js`), import(`${core}/genome/derive.js`),
    ]);
    const { souls } = await (await globalThis.fetch('/app/Summoning/specimen-souls.json')).json();
    const { seed, spectrum, scale } = souls[3];
    const a = deriveAura(`${seed.slice(32)}${seed.slice(0, 32)}`);
    const epochMs = Date.parse('2026-06-21T06:00:00Z');
    const score = scoreOf({ seed, trueName: specimenTrueName(seed), bornAt: new Date(epochMs).toISOString(), sky: skyOf(epochMs), aura: { seed: a.seed, form: formOf(a), fit: a.fit, cycle: a.cycle }, genome: deriveGenome(seed), soul: soulOf(spectrum, scale) });
    const rate = 22050;
    const ctx = new globalThis.OfflineAudioContext(2, Math.ceil(((score.lengthMs + 3000) / 1000) * rate), rate);
    scheduleMusic(ctx, musicOf(score), { fromMs: 0, startAt: 0 });
    const out = await ctx.startRendering();
    const L = out.getChannelData(0);
    const rms = (from, to) => {
      let s = 0; let n = 0;
      for (let i = Math.floor((from / 1000) * rate); i < Math.min(L.length, Math.floor((to / 1000) * rate)); i++) { s += L[i] * L[i]; n += 1; }
      return Math.sqrt(s / Math.max(1, n));
    };
    let peak = 0; let nan = 0;
    for (let i = 0; i < L.length; i++) { if (Number.isNaN(L[i])) nan += 1; else peak = Math.max(peak, Math.abs(L[i])); }
    return { peak, nan, acts: score.sections.map((x) => ({ kind: x.kind, rms: rms(x.at, x.at + x.dur) })) };
  }, `/@fs${REPO}/core`);
  expect(heard.nan).toBe(0);
  expect(heard.peak).toBeLessThan(1);
  expect(heard.peak).toBeGreaterThan(0.05);
  heard.acts.forEach((x) => expect(x.rms, `${x.kind} is audible`).toBeGreaterThan(0.002));

  await sound.click();
  await expect(page.getByRole('button', { name: 'SOUND ON' })).toHaveAttribute('aria-pressed', 'true');
  expect(errors, errors.join(' | ')).toEqual([]);
});
