// card-design-save — keeping a company's own card design, and letting it go.
//
// A design is saved only if it is safe to draw (card-safety.js) AND it draws: it is rendered once
// against the company's saved kit with sample copy, exactly as the preview and render_card draw
// it, and a design that would refuse there is refused here, with the renderer's own reasons. So a
// saved design never turns up later as a card that cannot be made. Written into the operator's own
// ground only (card-designs.js designWriteDir). impure — disk.

import { mkdir, writeFile, rm, access } from 'fs/promises';
import path from 'path';
import { designNameRefusal, designWriteDir } from './card-designs.js';
import { designRefusals, specRefusals } from './card-safety.js';
import { loadBrand, loadMarks, loadGuest } from './brand-tokens.js';
import { renderCardSvg } from './card-svg.js';
import { sampleFor } from './card-sample.js';

/** The fixture that stands in for a guest logo (card-preview.js keeps the same one). */
const SAMPLE_GUEST = 'example-token';
/** A shipped kit that carries the fixture (brands/umbrae/guests/example-token.svg). */
const SAMPLE_HOME = 'umbrae';

/**
 * Draw a design once against a kit with sample copy (impure: marks and the guest fixture are read
 * from disk). The preview and the save both stand on this, so they cannot disagree.
 * @returns {Promise<{ok: true, svg: string, missing: string[], sample: object} | {ok: false, errors: string[]}>}
 */
export const drawDesign = async ({ brand, kit, svg, spec, data = null, dir = null, wallet = null }) => {
  const unsafe = [...designRefusals(svg), ...specRefusals(spec)];
  if (unsafe.length) return { ok: false, errors: unsafe };
  const { marks, missing } = await loadMarks(brand, kit, { dir, wallet });
  let guest = {};
  if (spec.guest) {
    // A company of the operator's own carries no sample guest; the repo's fixture is ours and the
    // same in every shipped kit, so a sample card never waits on someone else's logo.
    const got = await loadGuest(brand, SAMPLE_GUEST, { dir, wallet });
    const fixture = got.mark ? got : await loadGuest(SAMPLE_HOME, SAMPLE_GUEST);
    if (fixture.mark) guest = { mark: fixture.mark };
    else missing.push(got.missing);
  }
  const sample = sampleFor(spec, kit);
  const drawn = renderCardSvg(svg, {
    tokens: kit, data: { ...sample, ...(data && typeof data === 'object' ? data : {}) }, spec, fontFace: '', marks, guest,
  });
  return drawn.ok ? { ok: true, svg: drawn.svg, missing, sample } : { ok: false, errors: drawn.errors };
};

/**
 * Keep this design as the company's own card of that name. impure
 * @returns {Promise<{ok: true, name: string, dir: string} | {ok: false, error: string, errors?: string[]}>}
 */
export const saveDesign = async ({ brand, template, svg, spec, wallet }) => {
  const named = designNameRefusal(brand) || designNameRefusal(template);
  if (named) return { ok: false, error: named };
  const kit = await loadBrand(brand, { wallet });
  if (!kit.ok) return { ok: false, error: `save the ${brand} kit before designing its cards — ${kit.error}` };
  const drawn = await drawDesign({ brand, kit: kit.tokens, svg, spec, dir: kit.dir, wallet });
  if (!drawn.ok) return { ok: false, error: `this ${template} design cannot be drawn yet: ${drawn.errors.join('; ')}`, errors: drawn.errors };
  const dir = await designWriteDir(brand, wallet);
  if (!dir) return { ok: false, error: 'no house ground is set, so there is nowhere of your own to keep a card design' };
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${template}.json`), `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  await writeFile(path.join(dir, `${template}.svg`), svg.endsWith('\n') ? svg : `${svg}\n`, 'utf8');
  return { ok: true, name: template, dir };
};

/**
 * Let the company's own design go: the shared card of that name stands again (a card type of its
 * own is gone). Only the operator's own ground is touched. impure
 */
export const removeDesign = async ({ brand, template, wallet }) => {
  const named = designNameRefusal(brand) || designNameRefusal(template);
  if (named) return { ok: false, error: named };
  const dir = await designWriteDir(brand, wallet);
  const file = dir ? path.join(dir, `${template}.svg`) : null;
  if (!file || !(await access(file).then(() => true, () => false))) {
    return { ok: false, error: `${brand} has no design of its own for ${template} in your ground` };
  }
  await rm(file, { force: true });
  await rm(path.join(dir, `${template}.json`), { force: true });
  return { ok: true, name: template };
};
