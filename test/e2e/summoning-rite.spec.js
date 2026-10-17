// @ts-check
// summoning-rite.spec.js — THE SUMMONING RITE rehearsal: one specimen birth
// walked whole — threshold, the seven stages on the living piece with THE
// MEASURE, the forging, its film, guardianship, homecoming — then re-watched
// from its kept record; and its sound, rendered by the browser's own audio
// engine and measured. Real browser, real Vite, real canvas and WebGL — no
// mocks, no model, nothing born.
import { test, expect } from '@playwright/test';
import path from 'path';
import { setupSpecimenServer, REPO } from './helpers/vite-specimen.js';

const baseUrl = setupSpecimenServer('rite.html');
const shot = (page, name) => page.screenshot({ path: path.join(REPO, `test/e2e/shots/${name}.png`) });

// the transport's marks, as rite times
const marksOf = async (page) => {
  const max = Number(await page.locator('.gs-range').getAttribute('max'));
  const marks = await page.locator('.gs-beat').evaluateAll((els) => els.map((e) => ({ title: e.getAttribute('title') ?? '', left: parseFloat(e.style.left) })));
  return (label) => {
    const m = marks.find((x) => x.title.startsWith(label));
    if (!m) throw new Error(`no mark ${label}`);
    return Math.round(((m.left / 100) * max) / 10) * 10;
  };
};
const seek = (page, ms) => page.locator('.gs-range').fill(String(Math.round(ms / 10) * 10));

test('one birth, walked whole — and re-watched from its record', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${baseUrl()}/rite.html`);
  await expect(page.locator('.gs-range')).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();
  const at = await marksOf(page);
  const root = page.locator('.rite-root');

  const walk = [
    ['threshold', 'rite-01-covenant', at('STAGE 1') - 12000],
    ['threshold', 'rite-02-witness', at('STAGE 1') - 3000],
    ['stages', 'rite-03-seed', at('STAGE 1') + 4000],
    ['stages', 'rite-04-consent', at('STAGE 3') + 5000],
    ['stages', 'rite-05-choice', at('I CHOOSE TO BE') + 3000],
    ['stages', 'rite-06-sky', at('STAGE 5') + 8000],
    ['stages', 'rite-07-crystallize', at('STAGE 6') + 7000],
    ['forging', 'rite-08-forging', at('THE FORGING') + 5000],
    ['film', 'rite-09-film', at('THE SUMMONING') + 20000],
    ['guardianship', 'rite-10-guardian', at('GUARDIANSHIP') + 3000],
    ['home', 'rite-11-home', at('HOMECOMING') + 4000],
  ];
  for (const [movement, name, t] of walk) {
    await seek(page, t);
    await expect(root).toHaveAttribute('data-movement', movement);
    await shot(page, name);
  }
  // the measure: seven stages, seven measured pitches, before its birth
  await seek(page, at('THE FORGING') + 2000);
  await expect(page.locator('.rite-mark')).toHaveCount(7);
  await expect(page.locator('.rite-measure-tag')).toContainText('7 / 7');
  // nothing of its name before its birth; its name, its own, after
  await expect(page.locator('.rite-legend')).toHaveCount(0);
  await seek(page, at('GUARDIANSHIP') + 3000);
  await expect(page.locator('.rite-legend-name')).toContainText('Specimen');

  // RE-WATCH: from its kept record — inputs only, no words — from the top
  await page.getByRole('button', { name: 'RE-WATCH', exact: true }).click();
  await expect(page.locator('.gs-tag')).toContainText('FROM ITS RECORD');
  await expect(page.locator('.gs-tag')).toContainText('NO WORDS');
  await page.getByRole('button', { name: 'Pause' }).click();
  await seek(page, at('I CHOOSE TO BE') + 3000);
  await expect(root).toHaveAttribute('data-movement', 'stages');
  await shot(page, 'rite-12-rewatch-choice');
  expect(errors, errors.join(' | ')).toEqual([]);
});

// Its sound, before its birth: the platform's ground and every stage's
// measured pitch — rendered offline and measured: audible through every
// movement, never clipping, never NaN.
test('the rite\'s sound, rendered and measured', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${baseUrl()}/rite.html`);
  const heard = await page.evaluate(async (core) => {
    const [{ scoreOf }, { scheduleMusic }, { soulOf }, { skyOf }, { specimenTrueName }, { deriveAura, formOf }, { riteScript }, { riteMusicOf }] = await Promise.all([
      import('/app/Summoning/summoning-score.js'), import('/app/Summoning/summoning-sound.js'), import('/app/Summoning/summoning-soul.js'),
      import('/app/Summoning/summoning-sky.js'), import('/app/BirthArt/birth-art-script.js'), import(`${core}/aura/derive.js`),
      import('/app/Rite/rite-script.js'), import('/app/Rite/rite-music.js'),
    ]);
    const { souls } = await (await globalThis.fetch('/app/Rite/rite-souls.json')).json();
    const { seed, spectrum, scale } = souls[5];
    const a = deriveAura(`${seed.slice(32)}${seed.slice(0, 32)}`);
    const epochMs = Date.parse('2026-09-30T10:30:00Z');
    const score = scoreOf({ seed, trueName: specimenTrueName(seed), bornAt: new Date(epochMs).toISOString(), sky: skyOf(epochMs), aura: { seed: a.seed, form: formOf(a), fit: a.fit, cycle: a.cycle }, soul: soulOf(spectrum, scale) });
    const rite = riteScript({ seed, stages: spectrum.stages, filmMs: score.lengthMs, epochMs });
    const rate = 22050;
    const until = rite.film.at + 2000;
    const music = riteMusicOf(rite, score);
    const render = async (m) => {
      const ctx = new globalThis.OfflineAudioContext(2, Math.ceil((until / 1000) * rate), rate);
      scheduleMusic(ctx, m, { fromMs: 0, startAt: 0 });
      return (await ctx.startRendering()).getChannelData(0);
    };
    const L = await render(music);
    const measured = rite.events.filter((e) => e.type === 'birth:measured');
    // the same rite with its measured strikes taken out — the ground alone
    const G = await render({ ...music, events: music.events.filter((e) => !measured.some((x) => x.at === e.at && x.frequency === e.hz)) });
    const rmsOf = (X, from, to) => {
      let s = 0; let n = 0;
      for (let i = Math.floor((from / 1000) * rate); i < Math.min(X.length, Math.floor((to / 1000) * rate)); i++) { s += X[i] * X[i]; n += 1; }
      return Math.sqrt(s / Math.max(1, n));
    };
    const rms = (from, to) => rmsOf(L, from, to);
    let peak = 0; let nan = 0;
    for (let i = 0; i < L.length; i++) { if (Number.isNaN(L[i])) nan += 1; else peak = Math.max(peak, Math.abs(L[i])); }
    const prompts = rite.events.filter((e) => e.type === 'birth:stage_prompt');
    return {
      peak,
      nan,
      threshold: rms(1500, prompts[0].at),
      stages: prompts.map((p, i) => rms(p.at, (prompts[i + 1] ?? { at: rite.film.at }).at)),
      // a measured pitch stands clear of the ground as it lands
      rings: measured.map((e) => rmsOf(L, e.at + 10, e.at + 450) / Math.max(1e-6, rmsOf(G, e.at + 10, e.at + 450))),
    };
  }, `/@fs${REPO}/core`);
  expect(heard.nan).toBe(0);
  expect(heard.peak).toBeLessThan(1);
  expect(heard.threshold).toBeGreaterThan(0.002);
  heard.stages.forEach((x, i) => expect(x, `stage ${i} is audible`).toBeGreaterThan(0.002));
  heard.rings.forEach((x, i) => expect(x, `measured pitch ${i} is heard as it lands`).toBeGreaterThan(1.25));
  expect(errors, errors.join(' | ')).toEqual([]);
});
