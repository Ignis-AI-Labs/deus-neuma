// card-safety — what a company's own card design may contain.
//
// The shared templates are this repo's source. A company's own design (card-designs.js) is
// written by an operator or a house member, and the desk draws it as an inert image
// (InlineSvg.jsx) while Chromium rasterizes it for a post. An SVG can carry script
// (<script>, an onload= on any element, a javascript: link, an animation that sets one), reach
// out (an external href, a CSS @import), or smuggle HTML (<foreignObject>). So a design is held to
// what a card actually draws: shapes, text, gradients, patterns, filters, clips, masks and the
// images the renderer itself mounts (the brand's marks, a guest logo) — and nothing else.
//
// ALLOWLIST, NOT DENYLIST. An element or construct this file does not name is refused by name,
// so a vector nobody thought of is closed by default. Pure: text in, refusals out.

import { DOMParser } from '@xmldom/xmldom';

// Every element the shared templates draw, and the drawing elements beside them.
const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'style',
  'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'image',
  'text', 'tspan', 'textPath',
  'linearGradient', 'radialGradient', 'stop', 'pattern', 'clipPath', 'mask', 'marker',
  'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix',
  'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood',
  'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feMerge', 'feMergeNode',
  'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile',
  'feTurbulence',
]);

// An href may point inside the card (#grid), at what the renderer mounts ({{mark.*}},
// {{guest.*}}), or carry an image inline (data:image/png or jpeg or webp or gif). Never
// data:image/svg+xml — an SVG inside an <image> is sealed, but one inside <use> is not.
const SAFE_HREF = /^(#[\w-]+|\{\{\s*(mark|guest)\.[a-zA-Z][\w]*\s*\}\}|data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+)$/i;

const cssRefusals = (text, out) => {
  if (/@import/i.test(text)) out.push('@import reaches outside the card');
  for (const [, inner] of String(text).matchAll(/url\(([^)]*)\)/gi)) {
    const target = inner.trim().replace(/^['"]|['"]$/g, '').trim();
    if (!/^#[\w-]+$/.test(target) && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(target)) {
      out.push(`url(${target.slice(0, 60)}) may point only inside the card (#id) or at an inline image`);
    }
  }
  if (/expression\s*\(|-moz-binding|behavior\s*:/i.test(text)) out.push('CSS expressions and bindings have no place in a card');
};

/**
 * Why this design may not be drawn, or [] when it may. Pure.
 * @param {string} svg the design's source, placeholders and all
 * @returns {Array<string>}
 */
export const designRefusals = (svg) => {
  const source = typeof svg === 'string' ? svg : '';
  if (!source.trim()) return ['the design is empty'];
  // The brand lane rides a 100kb JSON limit (server.js), and a design travels in a preview with its kit.
  if (source.length > 80_000) return [`the design is ${source.length} characters — a card is at most 80,000 (inline images belong in marks)`];
  const out = [];
  if (!/^\s*<svg[\s>]/.test(source)) out.push('a design starts with <svg> (no XML prolog or doctype)');
  if (/<!(?:DOCTYPE|ENTITY|\[CDATA\[)|<\?/i.test(source)) out.push('a design carries no <!DOCTYPE>, <!ENTITY>, CDATA or processing instruction');
  const comments = [...source.matchAll(/<!--[\s\S]*?-->/g)];
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, '');
  // a tag that opens inside another tag; comments are read apart below (a template's comment may name `<text>`)
  if (/<[^>]*</.test(withoutComments)) out.push('a design tag has a malformed opening boundary');
  if (comments.some(([comment]) => {
    const body = comment.slice(4, -3);
    return /^(?:>|->)/.test(body) || body.includes('--');
  }) || /<!--|-->/.test(withoutComments)) {
    out.push('a design comment has an unsafe or malformed boundary');
  }
  if (out.length) return out;

  const parseErrors = [];
  const document = new DOMParser({ errorHandler: (level) => parseErrors.push(level) }).parseFromString(source, 'image/svg+xml');
  if (parseErrors.length || document.documentElement?.tagName !== 'svg') return ['the design is not one well-formed SVG document'];
  for (const element of Array.from(document.getElementsByTagName('*'))) {
    const name = element.tagName;
    if (!ELEMENTS.has(name)) out.push(`<${name}> is not something a card draws — shapes, text, gradients, patterns, filters, clips, masks and images only`);
    for (const attribute of Array.from(element.attributes ?? [])) {
      const attr = attribute.name;
      const value = String(attribute.value ?? '').trim();
      if (/^on/i.test(attr)) out.push(`${attr}= runs script — a card does nothing when it is looked at`);
      if (/(^|:)href$/i.test(attr) && !SAFE_HREF.test(value)) out.push(`href "${value.slice(0, 60)}" reaches outside the card — use #id, {{mark.*}}, {{guest.*}} or an inline PNG/JPEG`);
      if (/javascript\s*:|vbscript\s*:|data\s*:\s*text\/html/i.test(value)) out.push('a script address (javascript:, vbscript:, data:text/html) has no place in a card');
      cssRefusals(value, out);
    }
    if (name === 'style') cssRefusals(element.textContent, out);
  }
  return [...new Set(out)];
};

/**
 * A design's fields sidecar, judged as data (pure): the same shape the shared templates carry
 * ({title?, use?, size?, fields: {name: {required?, max?, label?}}, guest?}).
 * @returns {Array<string>}
 */
export const specRefusals = (spec) => {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return ['the design\'s fields are not an object'];
  const out = [];
  const fields = spec.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return ['the design declares no fields ({"fields": {"headline": {"required": true, "max": 40}}})'];
  for (const [name, field] of Object.entries(fields)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(name)) out.push(`field "${name}" is not a name — letters, digits and _ only`);
    if (!field || typeof field !== 'object') { out.push(`field "${name}" is not an object`); continue; }
    if (field.max !== undefined && !(Number.isInteger(field.max) && field.max > 0 && field.max <= 2000)) out.push(`field "${name}": max is a whole number of characters, 1 to 2000`);
  }
  if (spec.title !== undefined && typeof spec.title !== 'string') out.push('title is words');
  return out;
};
