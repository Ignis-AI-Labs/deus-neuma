#!/usr/bin/env node
// render-card.mjs — one command: a brand, a template, and this card's data go
// in; a pixel-exact PNG comes out.
//
//   node scripts/render-card.mjs --brand umbrae --template milestone \
//     --data '{"eyebrow":"MILESTONE","value":"$100K","label":[…],"asOf":"2026-08-28T15:00:00Z"}' \
//     --out /tmp/card.png
//
//   node scripts/render-card.mjs --list          # brands and templates, with every field
//   node scripts/render-card.mjs ... --svg-only  # the SVG, no browser
//
// Chromium is ALREADY on this rig (Playwright's own build — no install step);
// it is used here purely as a deterministic SVG rasteriser. Nothing is
// generated, sampled, or inferred: the same inputs give the same pixels.

import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import {
  loadBrand, loadTemplate, listBrands, listTemplates, embedFaces, loadMarks, loadGuest,
} from '../backend/services/branding/brand-tokens.js';
import { renderCardSvg, fontFaceBlock } from '../backend/services/branding/card-svg.js';
import {
  fetchPlatformStats, milestoneFrom, FACT_NAMES, statsUrl,
} from '../backend/services/branding/platform-stats.js';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const has = (name) => argv.includes(`--${name}`);

const die = (message) => { console.error(`✗ ${message}`); process.exit(1); };

if (has('list')) {
  const [brands, templates] = await Promise.all([listBrands({ wallet: flag('wallet', process.env.NEUMA_WALLET || null) }), listTemplates()]);
  console.log(`BRANDS     ${brands.join(', ') || '(none)'}`);
  console.log('TEMPLATES');
  for (const name of templates) {
    const t = await loadTemplate(name);
    if (!t.ok) { console.log(`  ${name} — ${t.error}`); continue; }
    const { width, height } = t.spec.size || {};
    console.log(`  ${name} (${width}x${height}) — ${t.spec.use || ''}`);
    for (const [field, rule] of Object.entries(t.spec.fields || {})) {
      console.log(`      ${field}${rule.required ? '*' : ''} ≤${rule.max}  ${rule.label || ''}`);
    }
  }
  process.exit(0);
}

const brandName = flag('brand', 'umbrae');
// A workspace kit belongs to an operator's house ground, so reaching one needs
// the wallet that ground is recorded under. Absent, the repo brands still render.
const wallet = flag('wallet', process.env.NEUMA_WALLET || null);
const templateName = flag('template');
const out = flag('out');
if (!templateName) die('--template is required (see --list)');
if (!out && !has('svg-only')) die('--out <file.png> is required');

let data;
try {
  data = JSON.parse(flag('data', '{}'));
} catch (err) {
  die(`--data is not JSON: ${err.message}`);
}

// --stat pulls a REAL figure from the live platform feed and fills the card
// with it. The feed's own approximation flag rides through to the pixel, so a
// card never claims more precision than the platform does — and a figure the
// feed did not carry refuses rather than drawing an invented zero.
const statName = flag('stat');
if (statName) {
  if (statName === true || !FACT_NAMES.includes(statName)) {
    die(`--stat takes one of: ${FACT_NAMES.join(', ')}`);
  }
  const live = await fetchPlatformStats();
  if (!live.ok) die(`${live.error}\n  (${statsUrl()})`);
  const built = milestoneFrom(live.payload, statName);
  if (!built.ok) die(built.error);
  if (built.approximate) {
    console.error(`~ ${statName} is APPROXIMATE at the source (dlmmVolumeApproximate) — the card marks it with a leading ~`);
  }
  // Anything given by hand still wins: --stat fills the card, it does not
  // overrule an operator who wrote their own line.
  data = { ...built.data, ...data };
  console.error(`· live ${statName} = ${built.data.value}  as of ${built.data.asOf}`);
}

const brand = await loadBrand(brandName, { wallet });
if (!brand.ok) die(brand.error);
const template = await loadTemplate(templateName);
if (!template.ok) die(template.error);

// Fonts ride INSIDE the SVG. A card that reads its faces from the machine it
// renders on is not reproducible, and reproducibility is the whole argument for
// this path over a generative one. A face this machine does not have is said
// out loud rather than swallowed — the card still renders, but the operator
// learns that this particular render is machine-dependent.
const { faces, missing } = await embedFaces(brand.tokens.embedFonts);
for (const gap of missing) console.error(`⚠ font not embedded — ${gap}\n  this render falls back to a system face and is NOT reproducible on another machine`);

// Marks ride the card the same way, and for the same reason. Both Umbrae marks
// are drawn in pure black for a light surface, so the brand declares which fill
// to swap for which of its own tokens — nothing here guesses at a colour.
const { marks, missing: markGaps } = await loadMarks(brandName, brand.tokens, { dir: brand.dir, wallet });
for (const gap of markGaps) console.error(`⚠ mark not loaded — ${gap}`);

// A GUEST is another company's brand riding on this card — the token being
// listed, the partner being announced. Templates that need one say so in their
// sidecar, so a listing card asked for without a logo REFUSES here rather than
// rendering a hole where the token's mark belongs and getting posted that way.
// Their artwork is never recoloured (see loadGuest).
const guestSlug = flag('guest');
let guest = {};
if (guestSlug) {
  const { mark, missing: guestGap } = await loadGuest(brandName, guestSlug, { dir: brand.dir, wallet });
  if (guestGap) { console.error(`\u2717 ${guestGap}`); process.exit(1); }
  guest = { mark };
} else if (template.spec.guest?.required) {
  console.error(`\u2717 ${brandName}/${templateName} needs a guest brand: ${template.spec.guest.label}`);
  process.exit(1);
}

const card = renderCardSvg(template.svg, {
  tokens: brand.tokens,
  data,
  spec: template.spec,
  fontFace: fontFaceBlock(faces),
  marks,
  guest,
});
if (!card.ok) {
  console.error(`✗ ${brandName}/${templateName} refused this card:`);
  for (const e of card.errors) console.error(`   · ${e}`);
  process.exit(1);
}

if (has('svg-only')) {
  if (out) { await mkdir(path.dirname(path.resolve(out)), { recursive: true }); await writeFile(out, card.svg); console.log(out); }
  else process.stdout.write(card.svg);
  process.exit(0);
}

const { width = 1600, height = 900 } = template.spec.size || {};
const scale = Number(flag('scale', 1)) || 1;
const { chromium } = await import('playwright');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: scale,
  });
  // Transparent page background: whatever the card does not paint stays the
  // card's decision, never the browser's white.
  await page.setContent(`<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>${card.svg}`);
  // Fonts are embedded as data URIs, so this settles immediately — but waiting
  // on it is the difference between text drawn in Inter and text drawn in
  // whatever loaded first.
  await page.evaluate(() => document.fonts.ready);
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await page.locator('svg').screenshot({ path: out });
} finally {
  await browser.close();
}
console.log(`${out}  ${width * scale}x${height * scale}  ${brandName}/${templateName}`);
