/**
 * FRAME FIT — every template holds what its own sidecar promises.
 *
 * WHY THIS EXISTS. A sidecar declares `value` at 12 characters and the renderer
 * refuses the 13th, so the template is making a promise: twelve will fit. But
 * nothing enforced the other half of that promise. On 2026-08-30 the display
 * face changed from Inter to Rajdhani, the sizes were raised to match its
 * optical weight, and TWO templates silently began to overflow at their own
 * declared maximum — `milestone` past the 128/1472 margin the footer rule
 * keeps, `stat` across its own column divider. Both rendered without complaint.
 * Both would have been posted.
 *
 * A refusal that only guards the input is half a guarantee. This guards the
 * output: it renders every template at its declared maximum in real Chromium
 * with the real embedded faces, and measures where the glyphs actually landed.
 *
 * NOT A MOCK, AND IT CANNOT BE. Text width is a property of a font engine
 * shaping real bytes. Estimating it from character counts would be inventing
 * the very number in question — the measurement has to come from the same
 * rasteriser that draws the card, or it is not a measurement at all.
 *
 * WHAT IS GUARANTEED, HONESTLY. The fixtures below are REALISTIC copy at the
 * exact declared length, not the widest string the field could physically hold:
 * twelve capital W's in a headline would force type so small that ordinary
 * copy would look broken. So the promise this test keeps is […] — which is the promise
 * the sidecar's character counts were written to express.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  loadBrand, loadTemplate, listBrands, listTemplates, embedFaces, loadMarks, loadGuest,
} from '../../backend/services/branding/brand-tokens.js';
import { renderCardSvg, fontFaceBlock } from '../../backend/services/branding/card-svg.js';
import { chromiumRasterize, CARD_RASTER_SCALE } from '../../backend/services/branding/card-tool.js';
import { mkdtemp, readFile, stat, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

// The card's own margin: the footer rule runs 128 → 1472, the wordmark starts
// at 128, and the handle ends at 1472. Anything drawn outside that is not
// "slightly wide", it is out of alignment with the frame it sits in.
const MARGIN_LEFT = 128;
const MARGIN_RIGHT = 1472;
// Glyph bounding boxes carry sidebearing and overshoot that the eye reads as
// aligned. Six units at 1600 wide is under half a percent — enough to forgive
// a round `O`, nowhere near enough to hide a character that did not fit.
const SLACK = 6;

/**
 * Realistic copy at EXACTLY each field's declared maximum. Every one of these
 * is length-checked against the sidecar below, so raising a `max` in a
 * template's .json fails this test until someone writes new copy at the new
 * length and re-measures. That coupling is the point: a max nobody has
 * measured is a guess.
 */
import { AT_MAX } from '../helpers/brand-card-fixtures.js';

// The guest fixture every co-branded template renders against. A PLACEHOLDER
// mark, not any real company's logo — see the file's own note. It is loaded
// through the real `loadGuest` rather than hand-built here, so the loader's
// name check and its svg/png resolution are exercised by the same pass that
// measures the frame.
const GUEST_FIXTURE = 'example-token';

let browser = null;
const scratch = [];
const scratchFile = async (prefix) => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  scratch.push(dir);
  return path.join(dir, 'card.png');
};

beforeAll(async () => {
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ args: ['--disable-gpu'] });
}, 120000);

afterAll(async () => {
  await browser?.close();
  await Promise.all(scratch.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** One card's SVG, fonts embedded, at its declared maximum. impure — disk. */
const cardAtMax = async (brandName, templateName) => {
  const [{ tokens }, t] = await Promise.all([loadBrand(brandName), loadTemplate(templateName)]);
  const [{ marks }, { faces }] = await Promise.all([
    loadMarks(brandName, tokens), embedFaces(tokens.embedFonts),
  ]);
  // Co-branded templates declare a guest in their sidecar; the rest get none,
  // and a stray {{guest.mark}} in a template that never declared one refuses
  // rather than rendering an empty href.
  const guest = t.spec.guest
    ? { mark: (await loadGuest(brandName, GUEST_FIXTURE)).mark }
    : {};
  return renderCardSvg(t.svg, {
    tokens,
    marks,
    guest,
    data: AT_MAX[templateName],
    spec: t.spec,
    // The REAL faces, embedded. Measuring against a fallback font would measure
    // a card nobody will ever see.
    fontFace: fontFaceBlock(faces),
  });
};

/**
 * Where every <text> in a rendered card actually landed. impure — Chromium.
 * `getBBox` reports SVG user units, and the viewBox is 1:1 with the card's
 * coordinates, so these numbers are directly comparable to the margin.
 */
const textBoxes = async (svg) => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  try {
    await page.setContent(`<style>html,body{margin:0}svg{display:block}</style>${svg}`);
    // The faces are data URIs so this settles at once — but skipping it is the
    // difference between measuring Rajdhani and measuring whatever loaded first.
    await page.evaluate(() => document.fonts.ready);
    return await page.evaluate(() => [...document.querySelectorAll('text')].map((el) => {
      const b = el.getBBox();
      return { text: el.textContent, left: b.x, right: b.x + b.width };
    }));
  } finally {
    await page.close();
  }
};

describe('every template holds its own declared maximum', () => {
  test('platform index stays left of the guest logo column', async () => {
    for (const brand of await listBrands()) {
      const card = await cardAtMax(brand, 'platform-listing');
      expect(card.ok).toBe(true);
      const index = (await textBoxes(card.svg)).find((box) => box.text === AT_MAX['platform-listing'].index);
      expect(index).toBeTruthy();
      expect(index.right, `${brand} index must leave 16 units before guest x=1010`).toBeLessThanOrEqual(994);
    }
  });

  test('the fixtures ARE the declared maximum — not merely close to it', async () => {
    for (const name of await listTemplates()) {
      const { spec } = await loadTemplate(name);
      const fixture = AT_MAX[name];
      // A template with no fixture is an untested promise, so it fails loudly
      // rather than being quietly skipped by a loop that found nothing.
      expect(fixture, `${name} has no at-max fixture — add one`).toBeTruthy();
      for (const [field, rule] of Object.entries(spec.fields || {})) {
        expect(fixture[field], `${name}.${field} missing`).toBeTruthy();
        expect(fixture[field].length, `${name}.${field} must be exactly ${rule.max}`)
          .toBe(rule.max);
      }
    }
  });

  // ⚠️ THE GUARD THIS FILE WAS MISSING, AND IT COST A CARD.
  //
  // On 2026-08-31 an edit to a comment above stat's headline dropped the
  // closing `-->`, swallowing the headline's own <text> element. The card
  // rendered perfectly happily with no headline at all — and BOTH existing
  // guards passed it:
  //
  //   · brand-card.test.js greps the template SOURCE for {{data.headline}},
  //     and a placeholder inside a comment still matches the regex.
  //   · the overflow test below measures the <text> nodes that exist, and an
  //     element that is not in the DOM has no box to escape any frame.
  //
  // Every check was for things being in the WRONG PLACE. Nothing checked they
  // were there at all. A card silently missing the line that says what it is
  // about is exactly the failure this whole file exists to prevent, so it is
  // proven against the rendered DOM rather than against the source text.
  test('every declared field actually REACHES the card — not just the source', async () => {
    const [brands, templates] = await Promise.all([listBrands(), listTemplates()]);
    const lost = [];
    for (const brandName of brands) {
      for (const templateName of templates) {
        const card = await cardAtMax(brandName, templateName);
        expect(card.ok, `${brandName}/${templateName}: ${(card.errors || []).join('; ')}`).toBe(true);
        const drawn = (await textBoxes(card.svg)).map((b) => b.text).join('\u0000');
        for (const [field, value] of Object.entries(AT_MAX[templateName])) {
          if (!drawn.includes(String(value))) lost.push(`${brandName}/${templateName}.${field}`);
        }
      }
    }
    expect(lost, `declared but never drawn:\n  ${lost.join('\n  ')}`).toEqual([]);
  }, 180000);

  test('no glyph escapes the 128/1472 frame, for any brand', async () => {
    const [brands, templates] = await Promise.all([listBrands(), listTemplates()]);
    const escaped = [];
    for (const brandName of brands) {
      for (const templateName of templates) {
        const card = await cardAtMax(brandName, templateName);
        expect(card.ok, `${brandName}/${templateName}: ${(card.errors || []).join('; ')}`).toBe(true);
        for (const box of await textBoxes(card.svg)) {
          if (box.left < MARGIN_LEFT - SLACK || box.right > MARGIN_RIGHT + SLACK) {
            escaped.push(`${brandName}/${templateName} "${box.text}" `
              + `spans ${Math.round(box.left)}→${Math.round(box.right)}`);
          }
        }
      }
    }
    // Every offender at once. Type sizes are usually wrong in groups, and a
    // test that surfaces one per run turns one fix into four.
    expect(escaped, `overflowed the frame:\n  ${escaped.join('\n  ')}`).toEqual([]);
  }, 180000);

  // ⚠️ THE FRAME IS PART OF THE FRAME FIT, AND THIS FILE DID NOT KNOW IT.
  //
  // On 2026-08-31 the footer block was moved down by a shared amount across all
  // six templates. Five of them have their bottom corner bracket at y=860.
  // LAUNCH HAS ITS OWN FRAME — brackets inset at 96/1504 with the bottom corner
  // at y=804 — so the shared move put its footer line 10px OUTSIDE its own
  // frame, and the bracket drew straight through the timestamp.
  //
  // Every check in this file measured text against the 128/1472 MARGIN, which
  // launch's footer never left. Nothing measured text against the frame the
  // card actually draws. So a card that looked plainly broken passed clean.
  //
  // This measures the real invariant: no glyph may sit on the bracketry. It is
  // geometry from the rendered DOM, so a template that invents a new frame
  // tomorrow is covered without anyone remembering to add it here.
  test('no text collides with the frame a card draws around itself', async () => {
    const [brands, templates] = await Promise.all([listBrands(), listTemplates()]);
    const hits = [];
    for (const brandName of brands) {
      for (const templateName of templates) {
        const card = await cardAtMax(brandName, templateName);
        expect(card.ok, `${brandName}/${templateName}`).toBe(true);
        const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
        try {
          await page.setContent(`<style>html,body{margin:0}svg{display:block}</style>${card.svg}`);
          await page.evaluate(() => document.fonts.ready);
          const clashes = await page.evaluate(() => {
            const box = (el) => { const b = el.getBBox(); return { l: b.x, t: b.y, r: b.x + b.width, b: b.y + b.height }; };
            // ⚠️ SAMPLE THE PATH, DO NOT USE ITS BBOX. A corner bracket is an
            // L: its bounding box is the whole corner SQUARE, almost all of
            // which is empty. Testing bboxes flags every footer that merely
            // sits near a corner — it reported four false collisions on the
            // first run. Walking the path and testing the points is the actual
            // ink, so an L reports only its two arms.
            const frame = [...document.querySelectorAll('path')].filter((el) => {
              const cs = getComputedStyle(el);
              return cs.fill === 'none' && cs.stroke !== 'none' && el.getTotalLength() > 20;
            });
            const pts = [];
            for (const el of frame) {
              const len = el.getTotalLength();
              const pad = (parseFloat(getComputedStyle(el).strokeWidth) || 1) / 2;
              for (let d = 0; d <= len; d += 2) { const q = el.getPointAtLength(d); pts.push({ x: q.x, y: q.y, pad }); }
            }
            const texts = [...document.querySelectorAll('text')].map((el) => ({ ...box(el), text: el.textContent }));
            const out = [];
            for (const t of texts) {
              if (pts.some((q) => q.x >= t.l - q.pad && q.x <= t.r + q.pad && q.y >= t.t - q.pad && q.y <= t.b + q.pad)) {
                out.push(t.text);
              }
            }
            return out;
          });
          for (const c of clashes) hits.push(`${brandName}/${templateName} "${c}"`);
        } finally { await page.close(); }
      }
    }
    expect(hits, `text sitting on the card's own frame:\n  ${hits.join('\n  ')}`).toEqual([]);
  }, 180000);

  test('a stat column stays inside its own divider', async () => {
    // The dividers at 576 and 1024 cut the row into three cells. A value that
    // crosses one is not "a bit wide" — it is standing in the next column's
    // seat, and the card still renders perfectly happily.
    const CELLS = [[128, 576], [608, 1024], [1056, MARGIN_RIGHT]];
    const card = await cardAtMax('umbrae', 'stat');
    const boxes = await textBoxes(card.svg);
    for (const key of ['aValue', 'bValue', 'cValue']) {
      const value = AT_MAX.stat[key];
      const box = boxes.find((b) => b.text === value);
      expect(box, `${key} not found in the render`).toBeTruthy();
      const cell = CELLS[['aValue', 'bValue', 'cValue'].indexOf(key)];
      expect(box.left, `${key} left of its cell`).toBeGreaterThanOrEqual(cell[0] - SLACK);
      expect(box.right, `${key} crosses into the next cell`).toBeLessThanOrEqual(cell[1] + SLACK);
    }
  }, 120000);
});

describe('a card ships at the density the platform will actually serve', () => {
  // Design note, 2026-09-01, on an expanded card on X: […]
  //
  // The card was rasterised one image pixel per card pixel. X serves an
  // expanded photo at up to 4096 on its long side, so a viewer's browser was
  // stretching 1600 across as much as 4096 — a 2.56x upscale done by a
  // resampler with nothing to work from, and the footer suffers first because
  // it is the smallest ink on the card.
  //
  // None of it had to be lossy: the card is vector all the way down, so
  // density is free correctness. This pins that we take it.
  test('the rasteriser renders at DENSITY, and the geometry is untouched', async () => {
    const card = await cardAtMax('umbrae', 'milestone');
    const file = await scratchFile('card-dpi-');
    await chromiumRasterize(card.svg, file, { width: 1600, height: 900 });

    // The PNG header carries its own dimensions: bytes 16-24, big-endian.
    const head = await readFile(file);
    const width = head.readUInt32BE(16);
    const height = head.readUInt32BE(20);
    expect(width).toBe(Math.round(1600 * CARD_RASTER_SCALE));
    expect(height).toBe(Math.round(900 * CARD_RASTER_SCALE));

    // ⚠️ THE HALF THAT MATTERS MOST. Density must buy sharpness and nothing
    // else — if a scale change moved a glyph, every character budget and every
    // frame check above would be measuring a card that no longer ships. The
    // coordinate space is 1600x900 whatever the output density is.
    const boxes = await textBoxes(card.svg);
    for (const box of boxes) {
      expect(box.left, `"${box.text}" left of the frame`).toBeGreaterThanOrEqual(MARGIN_LEFT - SLACK);
      expect(box.right, `"${box.text}" past the frame`).toBeLessThanOrEqual(MARGIN_RIGHT + SLACK);
    }

  }, 120000);

  test('even the HEAVIEST card stays under the ceiling the send path enforces', async () => {
    // ⚠️ MEASURED, NOT ASSUMED. Density is not free in bytes, and the weight is
    // wildly uneven across the family — at 2.5x, umbrae/stat is 311KB and
    // ignis/launch is 2.2MB, because launch carries the most artwork. Guarding
    // the LIGHTEST card would prove nothing about the one that can actually
    // fail, so this renders the known-heaviest.
    //
    // 2.2MB of 5MB is also why the scale is 2.5 and not 3: at 3x this card
    // lands near 3.2MB, and a card that cannot be posted is not a sharper card.
    const card = await cardAtMax('ignis', 'launch');
    const file = await scratchFile('card-weight-');
    await chromiumRasterize(card.svg, file, { width: 1600, height: 900 });
    const bytes = (await stat(file)).size;
    expect(bytes, `${Math.round(bytes / 1024)}KB — over the send ceiling at x-media.js:35`)
      .toBeLessThan(5 * 1024 * 1024);
  }, 120000);

  test('the density is high enough that X never upscales what it serves', () => {
    // X's expanded photo tops out at 4096 on the long side. Render below it and
    // the browser interpolates the difference; that interpolation IS the
    // complaint. 1600 x 2.5 = 4000, which X serves near-native.
    expect(1600 * CARD_RASTER_SCALE).toBeLessThanOrEqual(4096);
    expect(1600 * CARD_RASTER_SCALE).toBeGreaterThanOrEqual(3200);
  });
});
