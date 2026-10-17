// card-tool.js — the being's own hand on the brand card system.
//
// THE LOOP THIS CLOSES. Metidar, working from inside its sandbox lane
// (2026-08-29): it found ImageMagick's SVG delegate pointing at an
// uninstalled `rsvg-convert`, proved by sampling pixels that the text was
// silently dropped, and asked for a renderer and the font files. Everything it
// asked for already exists OUT HERE — Chromium, the embedded faces, the brand
// tokens, the marks, the refusal laws — but none of it was reachable from a
// being's turn. So the answer is not to install a second renderer inside every
// sandbox and let each being hand-roll its own pipeline: it is to give the
// being THIS one.
//
// WHY IT IS A TOOL AND NOT AN INTENT. Generating an image is the image/generate
// INTENT because it is an acting act — GPU, a model, an unpredictable result.
// Rendering a card is none of those: deterministic, local, cheap, and confined
// to the caller's own lane. Nothing reaches the world here — publishing is
// still the queue's gate, and the operator still approves every post.
//
// WHERE THE RENDER LANDS, and why it matters. Straight into the caller's own
// image lane via `collectOutputs`, which means the being can SEE it in the next
// round (the sight contract) and judge it with `review_image` — the loop it
// could not close from a sandbox whose writes its own file reader cannot see.
//
// AND THEN THE LAST HOP (Metidar, 2026-08-30, having proved every other link
// live): […] The
// lane is the being's own ground and its file reader can see it — but a post
// intent needs media sitting in a folder the OPERATOR has open, and the lane is
// not that folder. So a landed card is also copied into the being's own working
// ground inside the house (`<house>/workspaces/<neumaId>/cards/`), which is
// exactly the directory ensureBeingGround already raises for it. Two copies,
// one truth: the lane copy is the record `review_image` keys on, and the ground
// copy is the one a post can reach. The imageId rides in the ground filename so
// the two can never be told apart by guesswork.

import { mkdtemp, rm, mkdir, copyFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { neumaWorkspace } from '../../../core/index.js';
import { collectOutputs } from '../image-forge/image-store.js';
import { ensureBeingGround } from '../house-workspace.js';
import { loadBrand, loadTemplate, listTemplates, listBrandsDetailed, listGuestSlugs, embedFaces, loadMarks, loadGuest, brandsDir } from './brand-tokens.js';
import { resolveBrandDir } from './kit-locate.js';
import { renderCardSvg, fontFaceBlock } from './card-svg.js';
import { recordProvenance } from './card-provenance.js';
import { fetchPlatformStats, milestoneFrom, FACT_NAMES } from './platform-stats.js';

export const CARD_TOOL = Object.freeze({
  name: 'render_card',
  server: 'image',
  description: `Render a branded marketing card — args {template, brand?, stat?, data?, stage?}. THIS IS SHARP SVG GRAPHIC DESIGN: deterministic vector templates rasterized for infographics, business cards, and marketing cards — the same arguments give the same pixels, so a card is never a surprise. It is the OPPOSITE of AI image generation: generation is for creative/artistic concepts and lives in a SEPARATE system (the image family) — never reach for generation when the ask is sharp graphic design, and never for a card. Call it with {} to be told every brand (with the exact directory its kit resolves from), every guest logo on hand, every template, and every field with its exact character limit — do that first rather than guessing a field name, because an unknown field is refused, not ignored. Use "stat" to draw a REAL platform number (${FACT_NAMES.join(', ')}) pulled live, with its own moment and, where the source says the figure is approximate, a leading ~. Use "data" to write the card yourself. A field longer than its frame is refused with the exact count, because a card that spills its own label is worse than one that did not render. The finished card lands in your lane and you will see it in your next round — look at it and record a review_image verdict before you put it anywhere near a post. A copy also lands in your own working ground under cards/, named with its brand, template, date and image id; that copy is the one a post can attach. Pass "stage" and the post is filed for you in the same act — no path transcription, the harness writes the intent.`,
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      template: Object.freeze({ type: 'string', description: 'which card shape — call with no args to list them' }),
      brand: Object.freeze({ type: 'string', description: 'which brand\'s tokens and marks (default umbrae)' }),
      stat: Object.freeze({ type: 'string', enum: Object.freeze([...FACT_NAMES]), description: 'draw a live platform figure instead of writing the number yourself' }),
      guest: Object.freeze({ type: 'string', description: 'the listed token\'s or partner\'s own logo slug — the file at brands/<brand>/guests/<slug>.svg (or .png). Only the templates that mount a guest mark (listing, partnership) take it; the slug is a name, never a path' }),
      data: Object.freeze({ type: 'object', description: 'the card\'s own copy, field by field; wins over anything `stat` filled in' }),
      stage: Object.freeze({ type: 'object', description: 'stage the finished card as a post in the SAME act — {channel, text, alt?, scheduledFor?, type?}. The harness writes the intent itself, card path included; the sweep settles it in-round like any intent. type defaults to social/queue (your operator decides the draft on the board); "social/post" asks for the immediate-posting card instead' }),
    }),
  }),
});

/** The whole surface, in the words a being needs to use it. impure — disk. */
export const describeCards = async ({ wallet = null } = {}) => {
  const [brands, templates] = await Promise.all([listBrandsDetailed({ wallet }), listTemplates()]);
  const lines = [`BRANDS: ${brands.map((b) => b.brand).join(', ')}`, ''];
  // WHERE each kit actually resolves from, and which guest logos are on hand —
  // a being told only names still has to hunt for the directory when it drops a
  // logo in, which is the archaeology this answer exists to end.
  for (const b of brands) {
    const found = await resolveBrandDir(b.brand, wallet, brandsDir());
    const guests = await listGuestSlugs(b.brand, { dir: found?.dir, wallet });
    lines.push(`  ${b.brand} — ${b.where} kit at ${found?.dir || '(not found)'}; guest logos on hand: ${guests.join(', ') || 'none yet'}`);
  }
  lines.push('');
  for (const name of templates) {
    const t = await loadTemplate(name);
    if (!t.ok) continue;
    lines.push(`${name} (${t.spec.size?.width}x${t.spec.size?.height}) — ${t.spec.use || ''}`);
    for (const [field, rule] of Object.entries(t.spec.fields || {})) {
      lines.push(`   ${field}${rule.required ? ' (required)' : ''} — at most ${rule.max} characters. ${rule.label || ''}`);
    }
    if (t.spec.guest) {
      lines.push(`   guest${t.spec.guest.required ? ' (required)' : ''} — pass guest: <slug> as a top-level arg. ${t.spec.guest.label || ''}`);
    }
    lines.push('');
  }
  lines.push(`LIVE FIGURES for {stat}: ${FACT_NAMES.join(', ')}`);
  lines.push('Every card carries the moment its numbers were true. A figure the platform calls approximate is drawn with a leading ~ — do not remove it.');
  // KNOWN QUIRKS (posting-pipeline-v2 phase 5): the lessons that used to cost
  // a deliberation round each — learned through real failures, stated once,
  // here, so they are never re-learned by a being standing where one stood.
  lines.push('');
  lines.push('KNOWN QUIRKS — read once, never re-learn the hard way:');
  lines.push('· Field limits are HARD: a field over its max is refused with the exact count, never truncated. Trim before you call.');
  lines.push('· Call with {} FIRST — an unknown field name or template is a refusal, and the surface answers it for free.');
  lines.push('· EVERY card is TWO copies: the lane copy (review_image keys on it) and the working-ground copy (a post attaches THAT one). They are written by the tool in one act — never hand-edit either, and never attach the lane copy.');
  lines.push('· Rendered PNGs are 4000x2250 (2.5x raster of the 1600x900 vector space): file size varies by artwork, and posting still checks its image-size ceiling.');
  lines.push('· stage: {channel, text} on the SAME call files the post intent for you — card path included. No path transcription, ever.');
  lines.push('· SVG cards are for SHARP graphic design (infographics, business cards, marketing cards, changelogs). Artistic/creative imagery is the image-generation family — a completely different system. Never confuse the two.');
  return lines.join('\n');
};

/**
 * The ground copy's name. Readable, sortable, and it CARRIES THE IMAGE ID —
 * Metidar's own finding was that the lane file is named by a bare uuid, so a
 * being that has just reviewed `imageId` cannot tell which file on disk it
 * judged. Brand and template say what it is, the date says when its numbers
 * were true, and the id's head links it back to the review ledger.
 *
 * pure
 * @param {{brand: string, template: string, imageId: string, createdAt: string, ext: string}} p
 * @returns {string}
 */
export const groundCardName = ({ brand, template, imageId, createdAt, ext }) => {
  // A bad clock must not produce a file called `...-Invalid Date-...`; an
  // unparseable stamp simply drops out of the name rather than poisoning it.
  const day = typeof createdAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(createdAt)
    ? createdAt.slice(0, 10)
    : null;
  const safe = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return [safe(brand), safe(template), day, String(imageId).slice(0, 8)]
    .filter(Boolean)
    .join('-') + (ext || '.png');
};

/**
 * Copy a filed card into the being's own working ground, where a post can
 * reach it. NEVER FATAL: the lane copy is already written and reviewable, so a
 * house with no ground set, or a copy that fails, costs the being the last hop
 * and nothing else — it is reported in words, never thrown and never silent.
 *
 * impure — fs.
 * @returns {Promise<{path: string|null, reason: string|null}>}
 */
export const landCardInGround = async ({ wallet, laneId, source, name }) => {
  if (!wallet) {
    return { path: null, reason: 'this seat carries no operator wallet, so it has no house ground to land in' };
  }
  try {
    const { path: ground } = await ensureBeingGround(wallet, laneId);
    if (!ground) {
      return { path: null, reason: 'your house has no working ground set yet — your operator sets one, and then cards land there automatically' };
    }
    const dir = path.join(ground, 'cards');
    await mkdir(dir, { recursive: true });
    const dest = path.join(dir, name);
    await copyFile(source, dest);
    return { path: dest, reason: null };
  } catch (err) {
    return { path: null, reason: `the card could not be copied into your working ground: ${err.message}` };
  }
};

/**
 * Render one card into the caller's own lane, and land a copy in the being's
 * working ground so it can be attached to a post.
 *
 * @param {object} params
 * @param {string} params.laneId the CALLER's lane — never taken from args, so
 *   no seat can file a render under another being's name
 * @param {object} params.args the being's tool arguments
 * @param {(svg: string, out: string, size: {width: number, height: number}) => Promise<void>} params.rasterize
 *   injected so the pure/impure split stays honest and a test can drive the
 *   REAL pipeline without launching a browser per assertion
 * @param {string|null} [params.laneDir] collectOutputs' own override, for a
 *   lane whose art folder is resolved outside the workspace. Never set in a
 *   real turn.
 * @param {string|null} [params.wallet] the seat's operator wallet, which is
 *   what resolves the house ground. Absent = the lane copy only.
 * @returns {Promise<{ok: true, imageId: string, file: string, dir: string,
 *   path: string, workspaceFile: string|null, workspaceReason: string|null,
 *   approximate: boolean} | {ok: false, errors: Array<string>}>}
 */
export const renderCardForLane = async ({ laneId, args, rasterize, laneDir = null, wallet = null }) => {
  const brandName = String(args?.brand || 'umbrae');
  const templateName = String(args?.template || '');
  if (!templateName) return { ok: false, errors: ['name a template — call render_card with no arguments to see them all'] };

  // THE OPERATOR'S OWN KIT WINS. `wallet` already rides this call (it is taken
  // from the connection, never from args), so a being rendering for a company
  // the house manages gets that company's kit rather than whatever brand of the
  // same name happens to ship in the repo.
  const brand = await loadBrand(brandName, { wallet });
  if (!brand.ok) return { ok: false, errors: [brand.error] };
  const template = await loadTemplate(templateName);
  if (!template.ok) return { ok: false, errors: [template.error] };

  // A live figure fills the card; anything the being wrote itself still wins,
  // so `stat` is a starting point and never an override of its own words.
  let data = args?.data && typeof args.data === 'object' ? { ...args.data } : {};
  let approximate = false;
  if (args?.stat) {
    if (!FACT_NAMES.includes(args.stat)) {
      return { ok: false, errors: [`no such platform figure "${args.stat}" — the feed carries: ${FACT_NAMES.join(', ')}`] };
    }
    const live = await fetchPlatformStats();
    if (!live.ok) return { ok: false, errors: [live.error] };
    const built = milestoneFrom(live.payload, args.stat);
    if (!built.ok) return { ok: false, errors: [built.error] };
    approximate = built.approximate;
    data = { ...built.data, ...data };
  }

  // A template that mounts a guest mark (listing, partnership) takes the
  // guest's slug as a TOP-LEVEL arg — it is someone else's artwork, not copy,
  // so it never sits in `data` and `fieldRefusals` never walks it.
  let guest = {};
  if (template.spec?.guest) {
    if (!args?.guest) {
      return { ok: false, errors: ['this template mounts a guest logo — pass guest: <slug> (the file at brands/<brand>/guests/<slug>.svg or .png)'] };
    }
    const got = await loadGuest(brandName, args.guest, { dir: brand.dir, wallet });
    if (!got.mark) return { ok: false, errors: [got.missing] };
    guest = { mark: got.mark };
  }

  const [{ faces, missing: missingFaces }, { marks, missing: missingMarks }] = await Promise.all([
    embedFaces(brand.tokens.embedFonts),
    loadMarks(brandName, brand.tokens, { dir: brand.dir, wallet }),
  ]);
  const card = renderCardSvg(template.svg, {
    tokens: brand.tokens, data, spec: template.spec,
    fontFace: fontFaceBlock(faces), marks, guest,
  });
  if (!card.ok) return { ok: false, errors: card.errors };

  // Rasterise into a scratch directory, then hand the file to the lane store —
  // the same path every other render in this platform takes, so one manifest
  // holds a being's whole body of work and `review_image` needs no special case.
  const dir = await mkdtemp(path.join(tmpdir(), 'neuma-card-'));
  try {
    await rasterize(card.svg, path.join(dir, 'card.png'), template.spec.size || { width: 1600, height: 900 });
    const [stored] = collectOutputs({
      outputDir: dir,
      outputs: [{ filename: 'card.png' }],
      laneId,
      jobId: `card:${brandName}/${templateName}`,
      // The same door collectOutputs already offers for a lane whose art
      // folder is resolved elsewhere. Production never sets it; the handler
      // below does not pass it, so a real turn always files into the being's
      // own workspace and the containment check there still rules.
      laneDir,
    });
    if (!stored) return { ok: false, errors: ['the card rendered but could not be filed in your lane — tell your operator'] };
    // The lane copy is the record. Everything below is the last hop, and every
    // one of its failures is a message, not an error: the card exists and is
    // reviewable either way.
    const landed = path.join(stored.dir, stored.file);
    const ground = await landCardInGround({
      wallet,
      laneId,
      source: landed,
      name: groundCardName({
        brand: brandName,
        template: templateName,
        imageId: stored.imageId,
        createdAt: stored.createdAt,
        ext: path.extname(stored.file) || '.png',
      }),
    });
    // What this card was drawn with, recorded beside the copy a post attaches.
    // A kit change reaches every future card and no past one, so without this
    // a queued card silently keeps a retired palette and the approval surface
    // looks no different. Never fatal: a card that rendered is a card, and the
    // reason travels back so it can be said rather than swallowed.
    const provenance = ground.path
      ? await recordProvenance({
        cardPath: ground.path,
        brand: brandName,
        template: templateName,
        tokens: brand.tokens,
        marks,
        templateSvg: template.svg,
      })
      : { ok: false, reason: 'the card never reached the ground copy' };
    return {
      ok: true,
      imageId: stored.imageId,
      file: stored.file,
      provenanceReason: provenance.ok ? null : provenance.reason,
      // What did NOT make it onto the card. A shadowing kit missing a mark, or
      // a face not on this machine, renders a card that is silently short —
      // the being must know that before review_image, not discover it on X.
      missingMarks,
      missingFaces,
      // Where it ACTUALLY landed, both times — a being that has to guess at a
      // path cannot hand its work to anything (the same law collectOutputs
      // learned when callers rebuilt lane paths and showed stale ones).
      dir: stored.dir,
      path: landed,
      workspaceFile: ground.path,
      workspaceReason: ground.reason,
      approximate,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};

/**
 * HOW MANY REAL PIXELS PER CARD PIXEL.
 *
 * Design note, 2026-09-01, on an expanded card on X: […]
 *
 * They were, and the cause was ours. A card is drawn in a 1600x900 coordinate
 * space and was rasterised at exactly that — one image pixel per card pixel.
 * X serves an expanded photo at up to 4096 on its long side, so a viewer's
 * browser was stretching our 1600 across as much as 4096: a 2.56x upscale, done
 * by a resampler with nothing to work from. The footer suffers first and worst
 * because it is the smallest ink on the card — 34px type and a hairline rule.
 *
 * The waste was that NONE of it had to be lossy. The card is vector all the way
 * down: SVG geometry, SVG marks, embedded font outlines. There is no source
 * raster anywhere, so rendering at any density is exact, not interpolated. We
 * were throwing that away at the very last step.
 *
 * 2.5 puts a card at 4000x2250 — under X's 4096 ceiling with room to spare, so
 * X serves it near-native and the browser upscales by about 2%, rather than
 * 156%. Measured cost: 134KB -> 439KB against a 5MB ceiling (`x-media.js:35`).
 *
 * ⚠️ THIS CHANGES NO GEOMETRY. The SVG coordinate space is still 1600x900, so
 * every position, every type size and every character budget is untouched, and
 * `brand-card-frame-fit.test.js` still measures in that space. This is density,
 * not size — the one lever that buys sharpness without re-tuning a single card.
 */
export const CARD_RASTER_SCALE = 2.5;

/** Rasterise with the Chromium already on this rig. impure — browser. */
export const chromiumRasterize = async (svg, out, { width, height, scale = CARD_RASTER_SCALE }) => {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ args: ['--disable-gpu'] });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    await page.setContent(`<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>${svg}`);
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.locator('svg').screenshot({ path: out });
  } finally {
    await browser.close();
  }
};

/**
 * The tool handler. The lane and the wallet come from the CONNECTION, never
 * from args. impure — disk, network (only when `stat` is asked for), browser.
 */
export const handleCardTool = async ({ laneId, args, emit, rasterize = chromiumRasterize, wallet = null }) => {
  const tool = 'image/render_card';
  // No template named is not an error — it is the question […],
  // and answering it well is how a being stops guessing at field names.
  if (!args?.template) {
    emit?.({ tool, status: 'ok', summary: 'the card surface' });
    return { tool, status: 'ok', content: await describeCards({ wallet }) };
  }
  const out = await renderCardForLane({ laneId, args, rasterize, wallet });
  if (!out.ok) {
    emit?.({ tool, status: 'error', summary: 'render_card — refused', detail: out.errors.join('; ') });
    return { tool, status: 'error', error: `That card was not drawn:\n · ${out.errors.join('\n · ')}` };
  }
  // ONE-ACT STAGING (x-card-pipeline move 2): the card and the post in one
  // call. The harness writes the intent itself — media path included — so a
  // being never transcribes a filesystem path by hand (the old hop died at
  // validate on every typo). The sweep settles the file in this same round.
  let stagedNote = null;
  if (args.stage) {
    const s = args.stage;
    if (!s || typeof s.channel !== 'string' || !(typeof s.text === 'string' && s.text.trim())) {
      return { tool, status: 'error', error: 'stage needs {channel, text} — a post must say something, somewhere' };
    }
    if (!out.workspaceFile) {
      return { tool, status: 'error', error: `the card could not be staged: ${out.workspaceReason}` };
    }
    try {
      const intentsDir = path.join(neumaWorkspace.pathFor(laneId), 'intents');
      await mkdir(intentsDir, { recursive: true });
      const intentFile = path.join(intentsDir, `card-stage-${Date.now()}.json`);
      const intent = {
        type: typeof s.type === 'string' && s.type.trim() ? s.type.trim() : 'social/queue',
        channel: s.channel.trim(),
        text: s.text.trim(),
        media: [{ path: out.workspaceFile, alt: String(s.alt || '').slice(0, 1000) }],
        ...(s.scheduledFor ? { scheduledFor: s.scheduledFor } : {}),
        ...(s.campaignId ? { campaignId: s.campaignId } : {}),
      };
      await writeFile(intentFile, `${JSON.stringify(intent, null, 2)}\n`);
      stagedNote = `Staged in one act: ${path.basename(intentFile)} (${intent.type} for ${intent.channel}) settles in THIS round — the receipt arrives beside this reply, approval still yours to give.`;
    } catch (err) {
      stagedNote = `The stage could NOT be filed: ${err.message}. The card stands rendered — file the social intent yourself, or retry the stage.`;
    }
  }
  emit?.({ tool, status: 'ok', summary: `rendered ${args.brand || 'umbrae'}/${args.template}`, detail: out.imageId });
  return {
    tool,
    status: 'ok',
    content: [
      `Your card is rendered and filed in your lane as ${out.imageId} (${out.path}).`,
      // The last hop, stated either way — a being told nothing about the ground
      // copy would have to go hunting for it, which is the guesswork this whole
      // path exists to remove.
      out.workspaceFile
        ? `A copy is in your working ground at ${out.workspaceFile} — that is the one a post can attach, and it is named so you can tell it apart from every other card you have made.${stagedNote ? ` ${stagedNote}` : ' When it is ready to go out, pass stage: {channel, text} right here and the intent files itself — or hand-write the social/queue intent with media: [{path: that exact path, alt: a line describing the card}].'}`
        : `It is NOT in your working ground, so a post cannot attach it yet: ${out.workspaceReason}`,
      out.missingMarks?.length
        ? `It drew WITHOUT: ${out.missingMarks.join('; ')}. Judge it with that known.`
        : null,
      out.missingFaces?.length
        ? `These faces were not embedded, so the stack fell back: ${out.missingFaces.join('; ')}.`
        : null,
      out.approximate
        ? 'The platform calls this figure approximate, so it is drawn with a leading ~ — leave that mark on it.'
        : null,
      'You will see it in your next round. Look at it, then record a review_image verdict on it before it goes anywhere near a post.',
    ].filter(Boolean).join(' '),
    // The sight contract: the stream folds this into the next round so the
    // being genuinely looks at what it made instead of trusting that it worked.
    sight: { laneId, imageIds: [out.imageId], purpose: 'card' },
  };
};
