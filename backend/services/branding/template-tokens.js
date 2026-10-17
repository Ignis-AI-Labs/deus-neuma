// template-tokens — what the cards actually DRAW, read from the cards.
//
// THE BUG THIS FILE EXISTS TO END. On 2026-08-31 the six templates drew
// fourteen colour roles and eleven type slots. `tokenRefusals` demanded five
// colours and three type slots, and `kitSkeleton` seeded exactly those. So a
// brand kit created from the scaffold SAVED — and could not render a single one
// of the six cards, because `renderCardSvg` refuses an unresolved token rather
// than falling back. The law it broke was written four lines above the bug, in
// kit-store.js: […]
//
// It broke because the requirement lived in three hand-maintained places — a
// template's SVG, a required-list in the loader, and a defaults block in the
// scaffold — and nothing tied them together. A template author adding
// {{token.hairlineSoft}} had no reason to know the other two existed.
//
// So this file DERIVES the requirement from the templates themselves. Adding a
// placeholder to an SVG is now the only edit needed; the scaffold, the loader's
// warnings and the panel's badges all follow from the scan. It cannot drift,
// because there is no second list to drift from.
//
// It uses card-svg.js's exported PLACEHOLDER so the scan and the renderer agree
// by construction.
//
// impure — reads the templates directory once, then serves from a process
// cache. The templates ship with the source and do not change under a running
// server; a card render is a hot path and re-reading six files per card to
// answer a question with a constant answer would be silly.

import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { PLACEHOLDER } from './card-svg.js';
import { templatesDir } from './brand-tokens.js';

/** The namespaces a kit is answerable for. `data` is the caller's copy and
 *  `fontface` is composed by the renderer, so neither is a kit requirement. */
const KIT_NAMESPACES = Object.freeze(['token', 'font', 'mark', 'brand', 'guest']);

let cached = null;

/** Every placeholder one SVG draws, grouped by namespace. Pure. */
export const scanTemplate = (svg) => {
  const found = {};
  for (const ns of KIT_NAMESPACES) found[ns] = new Set();
  // A fresh regex per call: PLACEHOLDER carries /g, and a shared lastIndex
  // across calls would silently skip matches on every second scan.
  const re = new RegExp(PLACEHOLDER.source, 'g');
  let match = re.exec(svg);
  while (match) {
    const [, ns, key] = match;
    if (key && found[ns]) found[ns].add(key);
    match = re.exec(svg);
  }
  return Object.fromEntries(
    KIT_NAMESPACES.map((ns) => [ns, [...found[ns]].sort()]),
  );
};

/**
 * What every template on disk draws, by template name. impure — disk, cached.
 * @returns {Promise<Object<string, {token: string[], font: string[], mark: string[], brand: string[], guest: string[]}>>}
 */
export const templateNeeds = async () => {
  if (cached) return cached;
  const dir = templatesDir();
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.svg'));
  const out = {};
  for (const file of files.sort()) {
    const svg = await readFile(path.join(dir, file), 'utf8').catch(() => '');
    out[file.slice(0, -4)] = scanTemplate(svg);
  }
  cached = Object.freeze(out);
  return cached;
};

/**
 * One namespace's keys across every template, each naming which templates want
 * it. Pure over the scan.
 *
 * The templates are named, not counted, because that is what makes the panel's
 * badge worth reading: "hairlineSoft — stat" tells an operator which card goes
 * dark without it, where "required" only tells them to obey.
 *
 * @returns {Array<{key: string, templates: string[]}>}
 */
export const acrossTemplates = (needs, namespace) => {
  const byKey = new Map();
  for (const [template, drawn] of Object.entries(needs || {})) {
    for (const key of drawn?.[namespace] || []) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(template);
    }
  }
  return [...byKey.entries()]
    .map(([key, templates]) => ({ key, templates: templates.sort() }))
    .sort((a, b) => a.key.localeCompare(b.key));
};

/** Every colour role the cards draw, with who draws it. impure — cached scan. */
export const requiredColors = async () => acrossTemplates(await templateNeeds(), 'token');

/** Every type slot the cards draw, with who draws it. impure — cached scan. */
export const requiredType = async () => acrossTemplates(await templateNeeds(), 'font');

/** Every mark the cards draw, with who draws it. impure — cached scan. */
export const requiredMarks = async () => acrossTemplates(await templateNeeds(), 'mark');

/** Every top-level brand field the cards draw. impure — cached scan.
 *  ⚠️ `handle` lives here: four of six templates sign with it and the readiness
 *  gate never asked for it, so a kit could read 39/39 READY and still refuse
 *  every card. */
export const requiredBrandFields = async () => acrossTemplates(await templateNeeds(), 'brand');
