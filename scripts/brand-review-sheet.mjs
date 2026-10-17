#!/usr/bin/env node
// brand-review-sheet.mjs — every card, and every variation under review, on ONE
// page so a design decision can be made by looking rather than by imagining.
//
// Design note, 2026-08-31: […]
//
//   node scripts/brand-review-sheet.mjs --brand umbrae --out /tmp/brand-review
//
// It renders the SHIPPING templates plus the open variations against the real
// brand and the real embedded faces, then writes index.html with every PNG
// inlined — one file, openable straight from disk, nothing to serve.
//
// This is a REVIEW instrument, not part of the render path: it never writes to
// the repo's templates or tokens. A variation lives here until it is chosen,
// and only then does it become a template or a token change.

import { writeFile, mkdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  loadBrand, loadTemplate, listTemplates, embedFaces, loadMarks, loadGuest,
} from '../backend/services/branding/brand-tokens.js';
import { renderCardSvg, fontFaceBlock } from '../backend/services/branding/card-svg.js';
import { chromiumRasterize } from '../backend/services/branding/card-tool.js';
import { fetchPlatformStats, statFact, asOfLabel } from '../backend/services/branding/platform-stats.js';

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : (argv[i + 1] ?? d); };
const brandName = flag('brand', 'umbrae');
// Design note, 2026-08-31: […] It lands beside the other design references and is
// committed, so the current look of every card is readable from the repo
// without anyone having to run a renderer first.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(flag('out', path.join(repoRoot, 'docs/design/brand-cards')));
// The comparison sections are DECISION-MAKING scaffolding, not reference. They
// are 34 extra renders of options already chosen, so they are opt-in and the
// committed sheet stays focused on the shipping templates.
const withVariations = argv.includes('--variations');

// ⚠️ EVERY FIGURE ON THIS SHEET COMES OFF THE LIVE FEED. NONE IS WRITTEN HERE.
//
// Design note, 2026-08-31, at a review card reading $12.4M: […]
//
// He was right and this is the fix. The first version of this sheet carried
// hand-written "realistic" figures on the reasoning that a review is about the
// LOOK. That reasoning is wrong twice over. A number on a card is a claim
// whatever the context, and a review sheet is exactly where a fabricated figure
// gets normalised — it is looked at for an hour, and the eye stops asking.
// platform-stats.js has said so since the day it was written: […] A sheet that invents one is
// no different.
//
// So the numbers are read from https://umbrae.io/api/platform/stats through the
// same statFact() the real cards use — which carries the `~` on approximate
// figures and refuses a stat the feed did not send. If the feed cannot be
// reached, this script EXITS rather than drawing a placeholder.
//
// Only the prose is written here, and prose is not a claim about a quantity.
const copyFrom = (facts) => ({
  milestone: {
    eyebrow: facts.tvl.eyebrow,
    value: facts.tvl.value,
    label: facts.tvl.label,
    asOf: facts.asOfLabel,
  },
  stat: {
    eyebrow: 'UMBRAE · LIVE',
    headline: 'THE BOOK AT A GLANCE',
    // Three different FACTS, so the three cells are three real measurements
    // rather than one number wearing three hats.
    aValue: facts.tvl.value, aLabel: 'VALUE LOCKED',
    bValue: facts.trades.value, bLabel: 'TRADES SETTLED',
    cValue: facts.lpEarnings.value, cLabel: 'EARNED BY LPS',
    asOf: facts.asOfLabel,
  },
  announcement: { eyebrow: 'NOW LIVE', lineOne: 'PARTIAL WITHDRAWALS', lineTwo: 'ARE LIVE ON UMBRAE', support: 'Pull part of a position and leave the rest still earning.' },
  // ⚠️ No asOf on the event cards. A timestamp is the provenance of a
  // MEASUREMENT; launch, listing and partnership announce events, and […] under a partnership says nothing. Only milestone and stat, which
  // draw figures off the feed, carry the moment they were true.
  launch: { eyebrow: 'NOW LIVE ON BASE', lineOne: 'UMBRAE DLMM IS OPEN', lineTwo: 'TO EVERY WALLET', support: 'One book, one venue, and no privileged seat at the table.' },
  listing: { eyebrow: 'NOW LISTED', name: 'Aerodrome', ticker: '$AERO', network: 'BASE · UMBRAE DLMM', support: 'Concentrated liquidity for the pair, live now on Umbrae.' },
  'platform-listing': { eyebrow: 'LAYOUT SPECIMEN', name: 'DefiLlama',
    index: 'DESIGN REVIEW',
    support: 'Typography and mark placement for design review only.' },
  partnership: { eyebrow: 'PARTNERSHIP', partner: 'Aerodrome', support: 'Routing through Umbrae pools, so a swap finds the deeper book.' },
  // The VOICE cards. ⚠️ No asOf on any of them either, for the same reason —
  // and note the quote is written here as SPECIMEN COPY, not attributed to a
  // real person saying a real thing. A review sheet may not put words in
  // somebody's mouth any more than it may invent a number.
  quote: {
    eyebrow: 'ON BUILDING IN THE OPEN',
    lineOne: 'We only publish a number',
    lineTwo: 'anyone can go and check',
    lineThree: 'for themselves.',
    speaker: 'SPECIMEN COPY',
    role: 'NOT A REAL ATTRIBUTION',
  },
  statement: {
    eyebrow: 'WHAT WE BUILD FOR',
    lineOne: 'Every number we',
    lineTwo: 'show can be',
    lineThree: 'checked by anyone',
  },
  // The RECORD card. Specimen prose again, and deliberately NOT a version
  // number: the eyebrow's other legal form ([…]) reviews the same
  // type tier without drawing "0.4.2" — a release tag nobody cut. The updates
  // are written the way a real week reads, shortest line last, because the
  // fourth line is exactly where a thin week gets papered over and the sheet
  // should show that shape rather than four padded sentences.
  changelog: {
    eyebrow: 'THIS WEEK IN UMBRAE',
    headline: 'A faster book this week',
    updateOne: 'Partial withdrawals — pull some, leave the rest',
    updateTwo: 'Vault positions settle in a single block',
    updateThree: 'Fee accrual reads live on the position page',
    updateFour: '— more landing next week',
    footer: 'FULL CHANGELOG IN THE RELEASE NOTES',
  },
  explainer: {
    eyebrow: 'HOW A VAULT WORKS',
    headline: 'Three steps, once',
    aLabel: 'DEPOSIT', aOne: 'Send the pair into', aTwo: 'the vault contract',
    bLabel: 'EARN', bOne: 'Fees accrue to your', bTwo: 'position each block',
    cLabel: 'WITHDRAW', cOne: 'Take it out again', cTwo: 'whenever you want',
  },
});

/** Every template on disk, in review order: what is measured, then what
 *  happened, then what the house says. A template with no home in this order
 *  still renders — it lands at the end rather than silently vanishing.
 *
 *  `changelog` sits at the end of the event run: it is still a report of what
 *  happened, but it reports a WEEK rather than a moment, so it reads last of
 *  the records and before the house opens its mouth. */
const reviewOrder = (all) => {
  const RANK = { milestone: 0, stat: 1, announcement: 2, launch: 3, listing: 4, partnership: 5, changelog: 6, quote: 7, statement: 8, explainer: 9, 'platform-listing': 10 };
  return [...all].sort((a, b) => (RANK[a] ?? 99) - (RANK[b] ?? 99) || a.localeCompare(b));
};

/** The live figures, or an exit. impure — network. */
const liveFacts = async () => {
  const read = await fetchPlatformStats({ timeoutMs: 25000 });
  if (!read.ok) {
    console.error(`✗ the platform feed could not be read — ${read.error}`);
    console.error('  Refusing to draw a review sheet with invented numbers.');
    process.exit(1);
  }
  const want = ['tvl', 'trades', 'lpEarnings', 'volumeAllTime', 'volume24h'];
  const facts = {};
  for (const name of want) {
    const f = statFact(read.payload, name);
    if (!f.ok) { console.error(`✗ ${f.error}`); process.exit(1); }
    facts[name] = f;
  }
  // ⚠️ The sheet used to format this moment itself. That is exactly how it
  // drifted from the cards it is supposed to be the reference FOR: the sheet
  // showed […] while a real card printed the raw ISO.
  // One formatter, owned by the module that owns the moment.
  facts.asOfLabel = asOfLabel(read.payload);
  facts.approximate = want.some((n) => facts[n].approximate);
  return facts;
};

// The face that has to be embedded for each numeral weight under review. A
// weight with no vendored face silently falls back and the comparison becomes
// a comparison of nothing.
const NUMERAL_FACE = { 200: 'mono-extralight', 300: 'mono-light', 400: 'mono-data' };

/** One override set, applied to a deep copy — the loaded tokens are never touched. */
const withType = (tokens, patch, extraFonts = []) => {
  const next = structuredClone(tokens);
  next.type = { ...next.type, ...patch };
  for (const f of extraFonts) if (!next.embedFonts.includes(f)) next.embedFonts.push(f);
  return next;
};

const withColors = (tokens, patch) => {
  const next = structuredClone(tokens);
  next.colors = { ...next.colors, ...patch };
  return next;
};

// PALETTE CANDIDATES.
//
// Design note, 2026-08-31: […]
//
// THE DIAGNOSIS FIRST, because it explains why every card reads as two colours.
// `accent` and `trimHot` are BOTH #22d3ee today, so the eyebrow marker and the
// hero value are the same cyan — the card has one accent wearing two names. The
// kit meanwhile carries caution/pending #fb923c, gold, rise, fall and breakeven
// that no template has ever drawn. The range was always there; nothing spent it.
//
// Every candidate below keeps the pure black void and the hairline system —
// those are the look-dev's spine and are not in question. What varies is how
// many registers the card speaks in, and which colour carries which meaning.
const PALETTES = [
  {
    id: 'current', label: 'A · CURRENT — one cyan, two names',
    note: 'What ships today. accent and trimHot are the same hex, so eyebrow and value cannot be told apart.',
    colors: {},
  },
  {
    id: 'ember', label: 'B · SIGNAL & EMBER — cyan reads, amber marks',
    note: 'The smallest change that buys a second register: cyan stays the VALUE (what you read), amber becomes the MARKER (where to look). Two jobs, two colours, nothing else moved.',
    colors: { trimHot: '#fb923c' },
  },
  {
    id: 'phosphor', label: 'C · PHOSPHOR — warm white, amber lead, cyan second',
    note: 'Closest to "phosphor white, orange and cyan". The ink warms off pure white, amber takes the hero value, cyan drops to the marker — the inverse of B.',
    colors: {
      ink: '#F7F3EA',
      inkSoft: 'rgba(247,243,234,0.62)',
      muted: 'rgba(247,243,234,0.42)',
      gray: 'rgba(247,243,234,0.42)',
      hairline: 'rgba(247,243,234,0.12)',
      hairlineSoft: 'rgba(247,243,234,0.04)',
      trim: 'rgba(247,243,234,0.30)',
      accent: '#ff9d3c',
      accentGlow: 'rgba(255,157,60,0.35)',
      trimHot: '#22d3ee',
    },
  },
  {
    id: 'tritone', label: 'D · TRI-TONE — amber, cyan and gold in play',
    note: 'Three registers on one card: amber value, cyan marker, gold for the timestamp and footer. Denser without adding a single element — the maximal half of minimal-maximal.',
    colors: {
      ink: '#F7F3EA',
      inkSoft: 'rgba(247,243,234,0.62)',
      muted: 'rgba(247,243,234,0.46)',
      gray: 'rgba(255,215,0,0.42)',
      hairline: 'rgba(247,243,234,0.12)',
      hairlineSoft: 'rgba(247,243,234,0.04)',
      trim: 'rgba(34,211,238,0.30)',
      accent: '#ff9d3c',
      accentGlow: 'rgba(255,157,60,0.35)',
      trimHot: '#22d3ee',
    },
  },
  // ── THE SEMANTIC SET ──────────────────────────────────────────────────────
  // Design note, 2026-08-31: […]
  //
  // These stop treating colour as decoration and give every register a JOB, so
  // a reader scrolling past knows what a number is before reading its label:
  //
  //   phosphor white  the anchor — what is held. Neutral on purpose.
  //   cyan            the flow — throughput, the machine running.
  //   phosphor green  the gain — and ONLY ever a real gain.
  //   amber           the marker — where to look. Never a quantity.
  //   coral           the loss or the warning, bright enough to actually read.
  //   gold            the moment — timestamps, provenance, the footer.
  {
    id: 'semantic', label: 'F · SEMANTIC — every colour has a job',
    note: 'Phosphor white anchors, cyan is flow, phosphor green is gain, amber marks, gold dates it. The stat card now reads left-to-right as held → running → earned without reading a single label.',
    colors: {
      ink: '#F7F3EA',
      inkSoft: 'rgba(247,243,234,0.66)',
      // ⚠️ NOT a flat grey. This is the "legible" note: supporting copy at 0.42
      // white is the first thing to disappear on a phone in daylight.
      muted: 'rgba(247,243,234,0.58)',
      gray: 'rgba(255,215,0,0.50)',
      hairline: 'rgba(247,243,234,0.14)',
      hairlineSoft: 'rgba(34,211,238,0.06)',
      trim: 'rgba(34,211,238,0.34)',
      accent: '#22d3ee',
      accentGlow: 'rgba(34,211,238,0.30)',
      trimHot: '#ff9d3c',
      rise: '#6EF7A5',
      riseGlow: 'rgba(110,247,165,0.35)',
      fall: '#FF6B5A',
      fallGlow: 'rgba(255,107,90,0.35)',
      warn: '#FF6B5A',
    },
  },
  {
    id: 'semantic-amber', label: 'G · SEMANTIC, AMBER LEAD — the NERV read',
    note: 'Same job-per-colour system as F, but amber leads and cyan supports — the Evangelion/MGS register rather than the Ghost in the Shell one. Warmest of the set.',
    colors: {
      ink: '#F7F3EA',
      inkSoft: 'rgba(247,243,234,0.66)',
      muted: 'rgba(247,243,234,0.58)',
      gray: 'rgba(255,157,60,0.52)',
      hairline: 'rgba(255,157,60,0.14)',
      hairlineSoft: 'rgba(255,157,60,0.05)',
      trim: 'rgba(255,157,60,0.34)',
      accent: '#ff9d3c',
      accentGlow: 'rgba(255,157,60,0.30)',
      trimHot: '#22d3ee',
      rise: '#6EF7A5',
      riseGlow: 'rgba(110,247,165,0.35)',
      fall: '#FF6B5A',
      fallGlow: 'rgba(255,107,90,0.35)',
      warn: '#FF6B5A',
    },
  },
  {
    id: 'ember-warm', label: 'E · EMBER, WARM FRAME — amber lead, cyan frame',
    note: 'As C, but the corner brackets and dividers pick up cyan so the FRAME carries the second colour instead of the type. Quietest of the multi-colour options.',
    colors: {
      ink: '#F7F3EA',
      inkSoft: 'rgba(247,243,234,0.62)',
      muted: 'rgba(247,243,234,0.42)',
      gray: 'rgba(247,243,234,0.38)',
      hairline: 'rgba(34,211,238,0.16)',
      hairlineSoft: 'rgba(34,211,238,0.05)',
      trim: 'rgba(34,211,238,0.38)',
      accent: '#ff9d3c',
      accentGlow: 'rgba(255,157,60,0.30)',
      trimHot: '#ff9d3c',
    },
  },
];

const sectionsFor = (shipping) => [
  // PALETTE FIRST — it is the open question, so it is the top of the page.
  ...['milestone', 'stat', 'listing'].map((template) => ({
    id: `palette-${template}`,
    title: `PALETTE · ${template.toUpperCase()}`,
    note: 'The same card and the same type in every candidate — only the colour roles change, so what differs here is only ever the palette.',
    cards: PALETTES.map((p) => ({
      template,
      label: p.label,
      caption: p.note,
      tokens: (tk) => withColors(tk, p.colors),
    })),
  })),
  {
    id: 'shipping',
    title: `THE ${shipping.length} TEMPLATES, AS THEY STAND`,
    note: 'Every card as it ships today. Space Grotesk Light 300 on 0.16em for headlines, JetBrains Mono Light 300 for figures. Colour carries meaning: phosphor white anchors, cyan is flow, phosphor green is gain, amber marks, and the hero halo is warm.',
    // ⚠️ READ FROM DISK, NOT LISTED HERE. This held its own copy of the six
    // shipping templates, so the three voice cards landed on 2026-09-01 and the
    // sheet Founder reviews from showed no sign of them — the exact failure this
    // sheet exists to prevent, in the sheet itself. Ordered so the measured
    // cards lead, then the events, then the voice cards.
    cards: shipping.map((t) => ({ template: t })),
  },
  {
    id: 'numeral-weight',
    title: 'NUMERAL WEIGHT — the "too thin" question',
    note: '200 is what the look-dev specifies. 300 and 400 are the alternatives. Same card, same size, only the weight of the figures changes.',
    cards: [200, 300, 400].flatMap((w) => ['milestone', 'stat'].map((t) => ({
      template: t,
      label: `${t} · numerals ${w}${w === 200 ? ' (look-dev)' : ''}`,
      tokens: (tk) => withType(tk, { numeralWeight: String(w) }, [NUMERAL_FACE[w]]),
    }))),
  },
  {
    id: 'display-weight',
    title: 'HEADLINE WEIGHT — for comparison',
    note: 'The headline face at 300 (look-dev) against 500. Only shown so the thinness question can be answered for headlines as well as figures.',
    cards: [300, 500].flatMap((w) => ['announcement', 'listing'].map((t) => ({
      template: t,
      label: `${t} · headline ${w}${w === 300 ? ' (look-dev)' : ''}`,
      tokens: (tk) => withType(tk, { displayWeight: String(w) }, [w === 500 ? 'grotesk-medium' : 'grotesk-light']),
    }))),
  },
  {
    id: 'tracking',
    title: 'HEADLINE TRACKING',
    note: '0.16em is the look-dev\'s. Tighter tracking fits more characters per line and reads denser.',
    cards: ['0.16em', '0.08em', '0.02em'].map((tr) => ({
      template: 'announcement',
      label: `announcement · tracking ${tr}${tr === '0.16em' ? ' (look-dev)' : ''}`,
      tokens: (tk) => withType(tk, { displayTrack: tr }),
    })),
  },
];

const rasterizeCard = async (svg, file) => {
  await chromiumRasterize(svg, file, { width: 1600, height: 900 });
  return `renders/${path.basename(file)}`;
};

const main = async () => {
  const brand = await loadBrand(brandName);
  if (!brand.ok) { console.error(`✗ ${brand.error}`); process.exit(1); }
  const { marks } = await loadMarks(brandName, brand.tokens, { dir: brand.dir });
  // The REAL partner mark, not the placeholder — Design note, 2026-08-31: […] example-token stays
  // as the test fixture; the reference sheet shows what actually ships.
  const guestSlug = flag('guest', 'aerodrome');
  const { mark: guestMark, missing: guestGap } = await loadGuest(brandName, guestSlug, { dir: brand.dir });
  if (guestGap) { console.error(`\u2717 ${guestGap}`); process.exit(1); }
  const facts = await liveFacts();
  const COPY = copyFrom(facts);
  console.error(`live feed · TVL ${facts.tvl.value} · trades ${facts.trades.value} · as of ${facts.asOfLabel}`);
  await mkdir(path.join(outDir, 'renders'), { recursive: true });

  const rendered = [];
  // ⚠️ The shipping list is READ FROM DISK. It used to be written here, so a new
  // template could ship and the sheet Founder reviews from would not show it — which
  // is exactly what happened when the voice cards landed on 2026-09-01. A
  // reference that has to be edited to stay a reference is not one.
  const shipping = reviewOrder(await listTemplates());
  const SECTIONS = sectionsFor(shipping);
  const sections = withVariations ? SECTIONS : SECTIONS.filter((s) => s.id === 'shipping');
  const noCopy = shipping.filter((t) => !COPY[t]);
  if (noCopy.length) {
    // Refuse rather than skip. A card missing from the sheet is invisible, and
    // invisible is the failure this whole change is fixing.
    console.error(`\u2717 no review copy written for: ${noCopy.join(', ')}`);
    console.error('  Add it to copyFrom() — a template with no copy cannot be reviewed.');
    process.exit(1);
  }
  for (const section of sections) {
    const items = [];
    for (const [i, card] of section.cards.entries()) {
      const t = await loadTemplate(card.template);
      const cardGuest = card.template === 'platform-listing'
        ? await loadGuest(brandName, 'defillama', { dir: brand.dir }) : { mark: guestMark };
      if (cardGuest.missing) throw new Error(cardGuest.missing);
      const tokens = card.tokens ? card.tokens(brand.tokens) : brand.tokens;
      const { faces, missing } = await embedFaces(tokens.embedFonts);
      for (const gap of missing) console.error(`⚠ ${gap}`);
      const out = renderCardSvg(t.svg, {
        tokens,
        marks,
        guest: t.spec.guest ? { mark: cardGuest.mark } : {},
        data: COPY[card.template],
        spec: t.spec,
        fontFace: fontFaceBlock(faces),
      });
      if (!out.ok) { console.error(`✗ ${section.id}/${card.template}: ${out.errors.join('; ')}`); process.exit(1); }
      const file = path.join(outDir, 'renders', `${section.id}-${i}-${card.template}.png`);
      items.push({ label: card.label || card.template, caption: card.caption || '', src: await rasterizeCard(out.svg, file) });
      process.stderr.write('.');
    }
    rendered.push({ ...section, items });
  }
  process.stderr.write('\n');

  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const html = `<!doctype html>
<!-- @generated by scripts/brand-review-sheet.mjs — do not hand-edit.
     Regenerate:  node scripts/brand-review-sheet.mjs
     With the comparison sections:  node scripts/brand-review-sheet.mjs --variations
     Every figure is read LIVE from the platform feed at generation time; the
     stamp below says when. Nothing on this page is a hand-written number. -->
<meta charset="utf-8">
<title>${esc(brand.tokens.name)} — card review</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#000; color:#fff; font:300 15px/1.7 Inter, system-ui, sans-serif; padding:56px 6vw 120px; }
  h1 { font-weight:300; font-size:34px; letter-spacing:.22em; text-transform:uppercase; margin:0 0 6px; }
  .sub { font-family:'JetBrains Mono', ui-monospace, monospace; font-size:11px; letter-spacing:.22em;
         text-transform:uppercase; color:rgba(255,255,255,.45); margin-bottom:56px; }
  h2 { font-family:'JetBrains Mono', ui-monospace, monospace; font-weight:400; font-size:13px;
       letter-spacing:.3em; text-transform:uppercase; color:#22d3ee; margin:64px 0 6px;
       padding-top:28px; border-top:1px solid rgba(255,255,255,.12); }
  .note { color:rgba(255,255,255,.5); max-width:74ch; margin:0 0 28px; font-size:14px; }
  figure { margin:0 0 40px; }
  figcaption { font-family:'JetBrains Mono', ui-monospace, monospace; font-size:10px; letter-spacing:.2em;
               text-transform:uppercase; color:rgba(255,255,255,.4); margin-bottom:10px; }
  img { width:100%; height:auto; display:block; border:1px solid rgba(255,255,255,.12); }
  .cap { color:rgba(255,255,255,.42); font-size:13px; margin:10px 0 0; max-width:70ch; }
  @media (min-width:1400px) { .grid { display:grid; grid-template-columns:1fr 1fr; gap:40px; } }
</style>
<h1>${esc(brand.tokens.name)} — card review</h1>
<p class="note">Event and voice copy is layout specimen text, not publication approval or verification of a listing or partnership.</p>
<p class="sub">${rendered.reduce((n, s) => n + s.items.length, 0)} renders · real embedded faces · <b>every figure read live from umbrae.io/api/platform/stats, ${esc(facts.asOfLabel)}</b></p>
${rendered.map((s) => `<h2>${esc(s.title)}</h2>
<p class="note">${esc(s.note)}</p>
<div class="grid">
${s.items.map((it) => `  <figure><figcaption>${esc(it.label)}</figcaption><img src="${it.src}" alt="${esc(it.label)}">${it.caption ? `<p class="cap">${esc(it.caption)}</p>` : ''}</figure>`).join('\n')}
</div>`).join('\n')}
`;
  const indexFile = path.join(outDir, 'index.html');
  await writeFile(indexFile, html);
  console.log(indexFile);
};

main().catch((err) => { console.error(err); process.exit(1); });
