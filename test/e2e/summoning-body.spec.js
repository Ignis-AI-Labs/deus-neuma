// @ts-check
// summoning-body.spec.js — ITS BODY, painted by the real painter in a real
// browser: one real genome of every plan (humanoid, crystal, orb, drone,
// sigil), each at four moments of its movement — the one axis every body
// begins as, its frame forming, the light closing around it, held and
// measured — on one contact sheet (test/e2e/shots/summoning-body-sheet.png).
// Every cell must truly paint. Real Vite, real canvas, real derivation; no
// mocks, no model, nothing born.
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import path from 'path';
import { setupSpecimenServer, REPO } from './helpers/vite-specimen.js';
import { deriveGenome } from '../../core/genome/derive.js';
import { planOf } from '../../frontend/app/Summoning/summoning-body.js';

const baseUrl = setupSpecimenServer('summoning.html');
const PLANS = ['humanoid', 'crystal', 'orb', 'drone', 'sigil'];
const MOMENTS = [0.08, 0.36, 0.7, 0.96];

// the first real seed of each plan (the derivation decides, never the test)
const seedsByPlan = () => {
  const found = {};
  for (let i = 0; Object.keys(found).length < PLANS.length; i += 1) {
    const seed = createHash('sha256').update(`neuma/summoning body sheet ${i}`).digest('hex');
    const plan = planOf(deriveGenome(seed));
    if (!found[plan]) found[plan] = seed;
  }
  return PLANS.map((p) => found[p]);
};

test('every body plan takes form — the axis, its frame, its light, measured', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 1700 });
  await page.goto(`${baseUrl()}/summoning.html`);
  const lit = await page.evaluate(async ({ core, seeds, moments }) => {
    const [{ deriveGenome }, { bodyFigureOf }, { paintBody, bodyCaption, bodyLine }, { kitOf }, { paletteOf }] = await Promise.all([
      import(`${core}/genome/derive.js`), import('/app/Summoning/summoning-body.js'), import('/app/Summoning/summoning-shots-body.js'),
      import('/app/Summoning/summoning-paint.js'), import('/app/Summoning/SummoningCanvas.jsx'),
    ]);
    await globalThis.document.fonts.ready;
    globalThis.document.body.innerHTML = '';
    globalThis.document.body.style.cssText = 'margin:0;background:#000;display:grid;grid-template-columns:repeat(4,340px);gap:6px;padding:6px';
    const palette = paletteOf();
    const out = [];
    seeds.forEach((seed) => {
      const f = bodyFigureOf(deriveGenome(seed));
      moments.forEach((u) => {
        const cell = globalThis.document.createElement('div');
        cell.style.cssText = 'position:relative;width:340px;height:330px';
        const c = globalThis.document.createElement('canvas');
        c.width = 340;
        c.height = 300;
        const label = globalThis.document.createElement('div');
        label.style.cssText = 'font:10px monospace;color:#9ab;letter-spacing:.1em;height:30px;overflow:hidden';
        label.textContent = `${bodyCaption(f, u)} — ${bodyLine(f, u)}`;
        cell.append(c, label);
        globalThis.document.body.append(cell);
        const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.globalCompositeOperation = 'lighter';
        const dur = 7000;
        paintBody(kitOf(ctx, c.width, c.height, palette), f, { u, local: u * dur, dur, beatMs: 600, beats: 0, pulse: 0, t: u * dur });
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let p = 0; p < d.length; p += 4 * 13) if (d[p] + d[p + 1] + d[p + 2] > 60) n += 1;
        out.push({ plan: f.plan, u, lit: n / (d.length / (4 * 13)) });
      });
    });
    return out;
  }, { core: `/@fs${path.join(REPO, 'core')}`, seeds: seedsByPlan(), moments: MOMENTS });

  expect(lit.map((x) => x.plan).filter((p, i, a) => a.indexOf(p) === i)).toEqual(PLANS);
  lit.forEach((x) => expect(x.lit, `${x.plan} @ ${x.u}`).toBeGreaterThan(0.001));
  // it grows: the light closed around it outshines the axis it began as
  PLANS.forEach((plan) => {
    const row = lit.filter((x) => x.plan === plan);
    expect(row[2].lit).toBeGreaterThan(row[0].lit);
  });
  await page.screenshot({ path: path.join(REPO, 'test/e2e/shots/summoning-body-sheet.png'), fullPage: true });
  expect(errors, errors.join(' | ')).toEqual([]);
});
