/** #424: measure actual embedded-font glyphs against guest marks and other lines. */
import { beforeAll, afterAll, expect, test } from 'vitest';
import { chromium } from 'playwright';
import {
  loadBrand, loadTemplate, listBrands, embedFaces, loadMarks, loadGuest,
} from '../../backend/services/branding/brand-tokens.js';
import { renderCardSvg, fontFaceBlock } from '../../backend/services/branding/card-svg.js';
import { AT_MAX } from '../helpers/brand-card-fixtures.js';

let browser;
beforeAll(async () => { browser = await chromium.launch({ args: ['--disable-gpu'] }); });
afterAll(async () => { await browser?.close(); });

for (const template of ['listing', 'platform-listing']) {
  test(`${template} keeps maximum-length text clear of images and adjacent lines`, async () => {
    const collisions = [];
    for (const brand of await listBrands()) {
      const { tokens } = await loadBrand(brand);
      const { svg, spec } = await loadTemplate(template);
      const { faces } = await embedFaces(tokens.embedFonts);
      const { marks } = await loadMarks(brand, tokens);
      const { mark } = await loadGuest(brand, 'example-token');
      const data = AT_MAX[template];
      for (const [field, rule] of Object.entries(spec.fields)) {
        expect(data[field].length, `${template}.${field} fixture maximum`).toBe(rule.max);
      }
      const card = renderCardSvg(svg, {
        tokens, marks, guest: { mark }, data, spec, fontFace: fontFaceBlock(faces),
      });
      expect(card.ok, JSON.stringify(card.errors)).toBe(true);
      const page = await browser.newPage();
      try {
        await page.setContent(card.svg);
        const geometry = await page.evaluate(async () => {
          const doc = globalThis.document;
          await doc.fonts.ready;
          const boxes = (selector) => [...doc.querySelectorAll(selector)].map((el) => {
            const b = el.getBBox();
            return { text: el.textContent, x: b.x, y: b.y, right: b.x + b.width, bottom: b.y + b.height };
          });
          return { texts: boxes('text'), images: boxes('image') };
        });
        for (const value of Object.values(data)) {
          expect(geometry.texts.some((box) => box.text === value), `missing ${value}`).toBe(true);
        }
        const intersects = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
        geometry.texts.forEach((text, i) => {
          for (const [j, image] of geometry.images.entries()) {
            if (intersects(text, image)) collisions.push(`${brand}: ${text.text} overlaps image ${j}`);
          }
          for (const other of geometry.texts.slice(i + 1)) {
            if (intersects(text, other)) collisions.push(`${brand}: ${text.text} overlaps ${other.text}`);
          }
        });
      } finally { await page.close(); }
    }
    expect(collisions).toEqual([]);
  }, 120000);
}
