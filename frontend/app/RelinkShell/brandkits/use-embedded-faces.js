// use-embedded-faces — install the vendored fonts into the DOCUMENT, once.
//
// This is what makes both the type specimens and the card preview honest.
//
// THE SPECIMEN PROBLEM. The old panel set `fontFamily` on a span and let the
// browser resolve it, so a specimen rendered in whatever the operator's machine
// had installed. Space Grotesk looks right on a designer's laptop and falls
// back to system-ui in a container — and the CARD is drawn from vendored bytes
// either way. The specimen was showing a different font from the product.
//
// THE PREVIEW PROBLEM. A card SVG with its faces inlined as base64 runs about
// 1.6MB for Umbrae's six. On a keystroke stream that is indefensible, so
// card-preview.js renders with `fontFace: ''` and the bytes come from here
// instead: one fetch per face per session, browser-cached, shared by every
// preview and every specimen on the page.
//
// ⚠️ DOCUMENT-LEVEL ON PURPOSE. `@font-face` cannot be scoped to a shadow root
// — a rule inside one is ignored — and the preview mounts its SVG in a shadow
// root to keep its <defs> ids from colliding. Document-level rules DO pierce
// shadow boundaries, which is exactly the combination this needs.
//
// impure — mutates document.head.

import { useEffect } from 'react';
import { faceFileUrl } from '../../../services/brands.js';

const STYLE_ID = 'bk-vendored-faces';
// Module-level, not per-component: two panels open at once must not each
// install their own copy of the same rule.
const installed = new Set();

const styleEl = () => {
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  return el;
};

/**
 * Ensure every named face is available to the page.
 *
 * @param {Array<{family: string, weights: Array<{id: string, weight: number, format: string}>}>} families
 * @param {string[]} ids the face ids to install — usually the kit's embedFonts
 */
export const useEmbeddedFaces = (families, ids) => {
  const key = (ids || []).join(',');
  useEffect(() => {
    if (!families?.length || !ids?.length) return;
    const byId = new Map();
    for (const family of families) {
      for (const weight of family.weights) byId.set(weight.id, { ...weight, family: family.family });
    }
    const rules = [];
    for (const id of ids) {
      if (installed.has(id)) continue;
      const face = byId.get(id);
      if (!face) continue;
      installed.add(id);
      rules.push(
        `@font-face{font-family:'${face.family}';font-weight:${face.weight};font-style:normal;`
        + `font-display:block;src:url('${faceFileUrl(id)}') format('${face.format === 'otf' ? 'opentype' : 'truetype'}')}`,
      );
    }
    // Appended, never replaced: a later kit's faces must not evict an earlier
    // one's while both are on screen.
    if (rules.length) styleEl().textContent += rules.join('\n');
    // Deliberately no cleanup. The rules are immutable bytes keyed by a face id
    // that names one file shipped with the source; removing them on unmount
    // would only force a refetch the next time the panel opens.
  }, [families, key]);
};
