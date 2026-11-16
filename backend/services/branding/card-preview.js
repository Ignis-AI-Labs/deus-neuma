// card-preview — a card drawn from a kit that is NOT on disk yet.
//
// Design note, 2026-08-31, on the BRAND KITS panel: […]
// The most objective thing a brand kit has is the card it produces, and the
// panel never showed one.
//
// IT RENDERS FROM THE DRAFT, NOT FROM THE SAVED KIT. That is the whole point:
// change a colour, see the card change, decide, then save. Previewing what is
// already on disk would only ever show you the past.
//
// IT REUSES renderCardSvg EXACTLY. Not a lighter second renderer — a preview
// that draws differently from the real card is worse than no preview, because
// it is trusted. Refusals come back verbatim too, so a card that will not draw
// says which token or which over-long field stopped it.
//
// ⚠️ NO FONTS ARE EMBEDDED HERE, AND THAT IS DELIBERATE. `embedFaces` inlines
// each face as base64 — Umbrae's six run about 1.6MB per render, which on a
// keystroke stream is indefensible. `card-svg.js` returns '' for a missing
// `fontface` namespace with no refusal, so the SVG comes back at ~8-20KB and
// the BROWSER supplies the same vendored bytes from /faces/:id/file, fetched
// once per session and cached. Same faces, same render, two orders of magnitude
// less traffic. The CLI and the being's own render_card still embed, because
// those bytes leave this machine.
//
// impure — reads marks and the template off disk.

import { loadTemplate, brandsDir } from './brand-tokens.js';
import { resolveBrandDir } from './kit-locate.js';
import { drawDesign } from './card-design-save.js';

/**
 * Draw one card from a draft kit.
 *
 * The card drawn is the company's OWN design when it has one (card-designs.js), else the shared
 * one; given `design` ({svg, spec}, unsaved, straight from the card designer) that is drawn
 * instead, so a redesign is seen as it is typed. An unsaved design is held to the same safety
 * law as a saved one (card-safety.js) before it is drawn, because the panel draws it inline.
 *
 * @param {object} params
 * @param {string} params.brand the brand whose ARTWORK to load (marks live on disk)
 * @param {object} params.kit the draft — unsaved, straight from the panel
 * @param {string} params.template
 * @param {?{svg: string, spec: object}} [params.design] an unsaved design to draw instead
 * @param {object} [params.data] copy to draw; anything absent is sampled
 * @param {string} [params.wallet]
 * @returns {Promise<{ok: true, svg: string, missing: string[], sample: object, source: string}
 *                  | {ok: false, errors: string[]}>}
 */
export const previewCard = async ({ brand, kit, template, design = null, data = null, wallet = null }) => {
  if (!kit || typeof kit !== 'object') return { ok: false, errors: ['no kit to preview'] };

  const loaded = design && typeof design === 'object'
    ? { ok: true, svg: design.svg, spec: design.spec, source: 'draft' }
    : await loadTemplate(template, { brand, wallet });
  if (!loaded.ok) return { ok: false, errors: [loaded.error] };

  // Artwork resolves from wherever this brand's kit LIVES, so a workspace kit
  // previews with its own marks and never the repo's by accident — the same
  // rule loadBrand keeps. A brand with no directory yet (a kit being created)
  // simply has no marks, and the refusal will say which one it wanted.
  const found = await resolveBrandDir(brand, wallet, brandsDir());
  const drawn = await drawDesign({ brand, kit, svg: loaded.svg, spec: loaded.spec, data, dir: found?.dir || null, wallet });
  if (!drawn.ok) return drawn;
  // Named, never swallowed: a mark that did not load is the difference
  // between […] and […].
  return { ok: true, svg: drawn.svg, missing: drawn.missing, sample: drawn.sample, source: loaded.source };
};

/**
 * The faces this kit's type slots ask the BROWSER to install, so the preview
 * draws in the real vendored bytes. Pure over the kit.
 *
 * Reads `embedFonts` rather than deriving from the type block, because the kit
 * is the authority on what it embeds and the panel keeps that array honest.
 */
export const previewFaceIds = (kit) =>
  (Array.isArray(kit?.embedFonts) ? kit.embedFonts : []).filter((id) => typeof id === 'string' && id);
