// card-svg.js — the brand card's PURE core: a template, a brand's tokens, and
// one card's data go in; finished SVG comes out.
//
// WHY TEMPLATES ARE DATA. Design note, 2026-08-28, holding up @deltaliquidity's feed:
// […] A card system earns
// that only if a new card shape or a new brand costs no code — so a template is
// an .svg file with placeholders plus a sidecar .json declaring its fields, and
// a brand is one tokens.json. Nothing in this module knows what a milestone
// card looks like.
//
// THE NAMESPACES, and the split matters:
//   {{token.accent}}  a brand colour        — ours, from tokens.json
//   {{font.voice}}    a brand font stack    — ours, from tokens.json
//   {{brand.footer}}  a brand string        — ours, from tokens.json
//   {{mark.wordmark}} a brand mark data URI — ours, composed by the caller
//   {{data.value}}    THE CARD'S CONTENT    — from a stats feed or a being
//   {{fontface}}      the embedded @font-face block, composed by the caller
// Everything substituted is XML-escaped without exception. Card copy arrives
// from outside this module — an unescaped `&` breaks the document outright, and
// an unescaped `<` is an injection into our own render.
//
// REFUSE, NEVER DEFORM. An unknown placeholder, a missing required field, an
// undeclared field, or a value past its declared length refuses BY NAME. A card
// that silently renders "undefined", or spills its label out of its own frame,
// is worse than a card that did not render — it gets posted.
//
// Pure throughout: no IO, no clock, no randomness. The same inputs give the
// same bytes, which is the whole reason this path exists instead of a model.

// Exported so template-tokens.js can scan the templates for what they DRAW
// using the identical pattern this file resolves with. A second regex over
// there would drift from this one, and the drift would surface as a template
// requirement nobody knew about until a card refused — which is exactly the
// bug that scan exists to prevent.
export const PLACEHOLDER = /\{\{\s*([a-z]+)(?:\.([a-zA-Z][a-zA-Z0-9_]*))?\s*\}\}/g;

/** The colours this renderer trusts — the same set brand tokens are held to.
 *  Duplicated as a constant rather than imported so this module stays pure and
 *  dependency-free; `tokenRefusals` holds brands to the identical shape. */
const COLOR = /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba?\([\d\s.,%]+\))$/;

const XML_ESCAPES = Object.freeze({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
});

/** XML-escape one value for an SVG text node or attribute. Pure. */
export const escapeXml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);

/**
 * The fields a template declares, checked against the data actually given.
 * Returns the refusal reasons — an empty array means the data is renderable.
 * Pure.
 *
 * @param {{fields?: Object<string, {required?: boolean, max?: number, label?: string}>}} spec
 * @param {Object<string, unknown>} data
 * @returns {Array<string>}
 */
export const fieldRefusals = (spec, data) => {
  const fields = spec?.fields || {};
  const given = data && typeof data === 'object' ? data : {};
  const out = [];
  for (const [name, rule] of Object.entries(fields)) {
    const value = given[name];
    const empty = value === undefined || value === null || String(value).trim() === '';
    if (rule?.required && empty) {
      out.push(`"${name}" is required by this template and was not given`);
      continue;
    }
    if (empty) continue;
    // A colour field reaches a fill attribute. XML-escaping keeps it from
    // breaking the document, but a typo'd hex is not an injection — it is a
    // card that renders black on black and gets posted before anyone looks.
    // Named here, at the same seam as every other refusal.
    if (rule?.color && !COLOR.test(String(value).trim())) {
      out.push(`"${name}" is "${value}", which is not a colour — use #rgb, #rrggbb, #rrggbbaa, rgb() or rgba()`);
      continue;
    }
    const len = String(value).length;
    if (Number.isFinite(rule?.max) && len > rule.max) {
      // The number matters: a being that hears "too long" guesses, and a being
      // that hears "37 of 24" rewrites the line correctly the first time.
      out.push(`"${name}" is ${len} characters and this template holds ${rule.max} — shorten it, do not let the card decide`);
    }
  }
  // A field the template never declared is almost always a typo for one it did,
  // and silently dropping it renders a card missing the thing it was made for.
  for (const name of Object.keys(given)) {
    if (!fields[name]) {
      const known = Object.keys(fields).join(', ') || 'none';
      out.push(`"${name}" is not a field of this template — it takes: ${known}`);
    }
  }
  return out;
};

// One placeholder's value, or null when the namespace does not carry it.
// Token/font/brand values are ours and already validated; they are escaped all
// the same, because […] is a claim about today's code, not a guarantee.
const resolve = ({ tokens, data, fontFace, marks, guest }, ns, key) => {
  if (ns === 'fontface' && !key) return fontFace || '';
  if (!key) return null;
  if (ns === 'token') return tokens?.colors?.[key] ?? null;
  if (ns === 'font') return tokens?.type?.[key] ?? null;
  // A GUEST is another company's brand riding on ours — the token being listed,
  // the partner being announced. It is deliberately its own namespace and not
  // folded into `marks`: a guest's mark is never recoloured to our palette (a
  // partner's logo redrawn in our accent is a logo we altered without asking),
  // and keeping it separate means a template cannot reach for one thinking it
  // is the other.
  if (ns === 'guest') return guest?.[key] ?? null;
  // A mark is a data URI composed by the caller (marks live on disk and may be
  // recoloured for this brand). Base64 carries no character XML escapes, so it
  // rides an href attribute untouched.
  if (ns === 'mark') return marks?.[key] ?? null;
  if (ns === 'brand') {
    const v = tokens?.[key];
    return v === null || v === undefined || typeof v === 'object' ? null : v;
  }
  if (ns === 'data') {
    const v = data?.[key];
    return v === undefined || v === null ? null : v;
  }
  return null;
};

/**
 * Render one card to SVG. Pure.
 *
 * @param {string} template the template's SVG source, with {{placeholders}}
 * @param {object} params
 * @param {object} params.tokens the brand's tokens.json, already validated
 * @param {object} params.data this card's content
 * @param {object} [params.spec] the template's sidecar declaration
 * @param {string} [params.fontFace] a composed @font-face block (the caller
 *   reads the font files; this module stays pure)
 * @param {Object<string, string>} [params.marks] the brand's marks as data
 *   URIs, already recoloured for this brand by the caller
 * @returns {{ok: true, svg: string} | {ok: false, errors: Array<string>}}
 */
export const renderCardSvg = (template, { tokens, data, spec = {}, fontFace = '', marks = {}, guest = {} } = {}) => {
  const source = typeof template === 'string' ? template : '';
  if (!source.trim()) return { ok: false, errors: ['the template is empty'] };

  const errors = fieldRefusals(spec, data);
  const missing = [];
  const svg = source.replace(PLACEHOLDER, (whole, ns, key) => {
    const value = resolve({ tokens, data, fontFace, marks, guest }, ns, key);
    if (value === null) {
      if (ns === 'data' && Object.hasOwn(spec.fields || {}, key)
        && !spec.fields[key]?.required) return '';
      // Named exactly as written, so the refusal points at the character the
      // template author must fix.
      missing.push(whole.trim());
      return whole;
    }
    return ns === 'fontface' ? String(value) : escapeXml(value);
  });

  // A placeholder that resolved to nothing is only worth reporting when the
  // field checks above did not already explain it — a missing REQUIRED field
  // is one fault, and saying it twice teaches a reader to skim the list. What
  // survives here is the genuinely different fault: the TEMPLATE asks for
  // something no brand carries and no field declares.
  const declared = new Set(Object.keys(spec?.fields || {}));
  for (const name of [...new Set(missing)]) {
    const field = name.match(/^\{\{\s*data\.([a-zA-Z][a-zA-Z0-9_]*)/)?.[1];
    if (field && declared.has(field)) continue;
    errors.push(`${name} resolved to nothing — the brand does not carry it and the data did not supply it`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, svg };
};

// A face declared with the wrong format string does not fall back — it does
// not load at all, and the card quietly draws in a system face. Fedora ships
// JetBrains Mono as .otf, which is `opentype`, not `truetype`.
const FONT_FORMATS = Object.freeze({ ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' });

/**
 * The @font-face block for fonts embedded as base64. Pure given the encoded
 * faces — a card that reads its fonts from the machine it renders on is not
 * reproducible, and reproducibility is the entire argument for this pipeline
 * over a generative one.
 *
 * @param {Array<{family: string, weight?: number|string, style?: string,
 *   format?: string, base64: string}>} faces
 * @returns {string} a <style> element, or '' when nothing was embedded
 */
export const fontFaceBlock = (faces) => {
  const rows = (Array.isArray(faces) ? faces : []).filter((f) => f?.family && f?.base64);
  if (!rows.length) return '';
  const rules = rows.map((f) => [
    '@font-face{',
    `font-family:'${String(f.family).replace(/['\\]/g, '')}';`,
    `font-weight:${f.weight || 400};`,
    `font-style:${f.style || 'normal'};`,
    `src:url(data:font/${f.format || 'ttf'};base64,${f.base64}) format('${FONT_FORMATS[f.format] || 'truetype'}');`,
    '}',
  ].join(''));
  return `<style type="text/css">${rules.join('')}</style>`;
};
