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

import { loadTemplate, loadMarks, loadGuest } from './brand-tokens.js';
import { renderCardSvg } from './card-svg.js';
import { sampleFor } from './card-sample.js';
import { resolveBrandDir } from './kit-locate.js';
import { brandsDir } from './brand-tokens.js';

/** The fixture that stands in for a guest logo. Ours, and committed for
 *  exactly this — a preview must never require someone else's trademark. */
const SAMPLE_GUEST = 'example-token';

/**
 * Draw one card from a draft kit.
 *
 * @param {object} params
 * @param {string} params.brand the brand whose ARTWORK to load (marks live on disk)
 * @param {object} params.kit the draft — unsaved, straight from the panel
 * @param {string} params.template
 * @param {object} [params.data] copy to draw; anything absent is sampled
 * @param {string} [params.wallet]
 * @returns {Promise<{ok: true, svg: string, missing: string[], sample: object}
 *                  | {ok: false, errors: string[]}>}
 */
export const previewCard = async ({ brand, kit, template, data = null, wallet = null }) => {
  if (!kit || typeof kit !== 'object') return { ok: false, errors: ['no kit to preview'] };

  const loaded = await loadTemplate(template);
  if (!loaded.ok) return { ok: false, errors: [loaded.error] };

  // Artwork resolves from wherever this brand's kit LIVES, so a workspace kit
  // previews with its own marks and never the repo's by accident — the same
  // rule loadBrand keeps. A brand with no directory yet (a kit being created)
  // simply has no marks, and the refusal will say which one it wanted.
  const found = await resolveBrandDir(brand, wallet, brandsDir());
  const dir = found?.dir || null;

  const { marks, missing: markMiss } = await loadMarks(brand, kit, { dir, wallet });

  // Only fetched when the template actually declares a guest slot — most do
  // not, and reading a file for a placeholder nobody draws is waste.
  // ⚠️ `guest` is a TOP-LEVEL key of the sidecar, not one of its `fields`. It
  // describes an image the template mounts, not a piece of copy the caller
  // supplies, so it never belonged in the field table `fieldRefusals` walks.
  let guest = {};
  const guestMiss = [];
  if (loaded.spec?.guest) {
    const got = await loadGuest(brand, SAMPLE_GUEST, { dir, wallet });
    if (got.mark) guest = { mark: got.mark };
    else guestMiss.push(got.missing);
  }

  const sample = sampleFor(loaded.spec, kit);
  const drawn = { ...sample, ...(data && typeof data === 'object' ? data : {}) };

  const result = renderCardSvg(loaded.svg, {
    tokens: kit,
    data: drawn,
    spec: loaded.spec,
    fontFace: '',
    marks,
    guest,
  });
  if (!result.ok) return { ok: false, errors: result.errors };

  return {
    ok: true,
    svg: result.svg,
    // Named, never swallowed: a mark that did not load is the difference
    // between […] and […].
    missing: [...markMiss, ...guestMiss],
    sample,
  };
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
