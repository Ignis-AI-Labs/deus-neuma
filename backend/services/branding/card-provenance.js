/**
 * WHAT A CARD WAS DRAWN WITH, AND WHETHER THAT IS STILL TRUE.
 *
 * Design note, 2026-09-01, looking at a queued card beside the review sheet: […]
 *
 * It was not. The card in the approval queue carried Umbrae's palette from two
 * commits earlier — an orange eyebrow on a bright cyan frame, from before the
 * kit was locked. Nothing was broken: the queue stores a RESOLVED FILE PATH
 * (`queue-rules.js:181`) and never re-renders, so a card keeps whatever brand
 * it was born with, forever. A kit change reaches every future card and no past
 * one, and nothing said so.
 *
 * That is a quiet failure of exactly the kind this platform refuses elsewhere:
 * the operator was one click from approving a card wearing a retired palette,
 * and the surface that asked for the click looked no different.
 *
 * THE SHAPE OF THE FIX. A card records what it was drawn with, beside itself.
 * At approval time we re-derive that fingerprint from the kit as it stands NOW
 * and compare. Same → the card is what the standard says. Different → say so,
 * and say what moved.
 *
 * WHY A FINGERPRINT AND NOT A TIMESTAMP. File times lie: a copy, a checkout, a
 * restore all reset them, and git does not preserve mtime at all. The bytes a
 * card was drawn from are the only honest witness. The fingerprint covers the
 * three things that decide a card's pixels — the brand's tokens, its marks, and
 * the template's own SVG — so an edit to any of them is caught, including the
 * template standardisation that started this.
 *
 * WHY IT FLAGS AND NEVER BLOCKS. Approving a stale card may be exactly what
 * somebody wants — a card already posted, being re-shared. The operator decides;
 * this only refuses to let them decide it BLIND.
 */

import { createHash } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { loadBrand, loadTemplate, loadMarks, listBrands, listTemplates } from './brand-tokens.js';

/** Recursive key-sort, so a re-serialised kit with the same values fingerprints
 *  the same. Object key order is not part of a brand. Pure. */
const canonical = (v) => {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((out, k) => {
      out[k] = canonical(v[k]);
      return out;
    }, {});
  }
  return v;
};

const digest = (value) => createHash('sha1').update(JSON.stringify(canonical(value))).digest('hex').slice(0, 12);

/**
 * The three fingerprints that decide a card's pixels, kept SEPARATE so a
 * mismatch can name what actually moved. Telling somebody "this is stale" is
 * half an answer; telling them […] is the whole one.
 *
 * pure
 * @param {{tokens: object, marks: object, templateSvg: string}} p
 * @returns {{tokens: string, marks: string, template: string}}
 */
export const fingerprintCard = ({ tokens, marks, templateSvg }) => ({
  tokens: digest(tokens || {}),
  // The mark BYTES, not the declaration. A wordmark redrawn under the same
  // filename is a different card, and the kit would not show it.
  marks: digest(marks || {}),
  template: digest(String(templateSvg || '')),
});

/** Where a card's provenance sits: beside it, same name. Pure. */
export const sidecarPath = (cardPath) => `${String(cardPath || '').replace(/\.[a-z0-9]+$/i, '')}.kit.json`;

/**
 * The verdict, given what was recorded and what is true now. Pure, so the
 * comparison is testable without a disk.
 *
 * @param {object|null} was the recorded provenance, or null if there is none
 * @param {object|null} now the current fingerprint, or null if it cannot be built
 * @returns {{state: string, moved: string[], note: string}}
 */
export const compareProvenance = (was, now) => {
  if (!was) {
    return {
      state: 'unrecorded',
      moved: [],
      // Honest rather than reassuring. A card from before cards recorded this
      // is not KNOWN to be current, and saying "fine" would be a guess wearing
      // a verdict's clothes.
      note: 'drawn before cards recorded their kit — re-render it if it matters',
    };
  }
  if (!now) {
    return {
      state: 'orphaned',
      moved: [],
      note: `the ${was.brand || 'brand'} kit or the ${was.template || 'template'} template no longer exists`,
    };
  }
  const moved = ['tokens', 'marks', 'template'].filter((k) => was.fingerprint?.[k] !== now[k]);
  if (!moved.length) return { state: 'current', moved: [], note: 'drawn with the kit as it stands' };
  const WORDS = { tokens: 'its colours and type', marks: 'its marks', template: 'the template' };
  return {
    state: 'stale',
    moved,
    note: `${was.brand || 'the brand'} has moved since this was drawn — ${moved.map((m) => WORDS[m]).join(' and ')} changed`,
  };
};

/**
 * Record what a card was drawn with. Never throws: a card that rendered is a
 * card, and losing its provenance must not lose the work. The caller gets the
 * reason so it can be said out loud rather than swallowed.
 *
 * @param {{cardPath: string, brand: string, template: string, tokens: object, marks: object, templateSvg: string}} p
 */
export const recordProvenance = async ({ cardPath, brand, template, tokens, marks, templateSvg }) => {
  const record = {
    brand,
    template,
    fingerprint: fingerprintCard({ tokens, marks, templateSvg }),
    // No clock reading is load-bearing here — the fingerprint is what decides.
    // This is for a human reading the file.
    recordedAt: new Date().toISOString(),
  };
  try {
    await writeFile(sidecarPath(cardPath), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    return { ok: true, record };
  } catch (err) {
    return { ok: false, reason: err.message, record };
  }
};

/** The recorded provenance for a card, or null. Never throws. */
export const readProvenance = async (cardPath) => {
  try {
    const raw = await readFile(sidecarPath(cardPath), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && parsed.fingerprint ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * Does this path look like a card this platform drew? The inverse of
 * `groundCardName` — `<brand>-<template>-<yyyy-mm-dd>-<id8>.png`.
 *
 * ⚠️ THIS EXISTS TO KEEP THE FLAG QUIET. Without it, every ordinary photo a
 * being attaches has no provenance record and would be reported "unrecorded",
 * which trains an operator to ignore the badge — and a badge that is ignored
 * is worse than no badge, because it looks like cover. A file that is not
 * card-shaped gets no verdict at all, because we genuinely do not know what
 * it is. A card-shaped file with no record still gets one, which is how the
 * cards drawn before this existed are caught.
 *
 * pure
 * @param {string} cardPath
 * @param {{brands: string[], templates: string[]}} known
 */
export const looksLikeCard = (cardPath, { brands = [], templates = [] } = {}) => {
  const file = String(cardPath || '').split('/').pop() || '';
  const m = /^([a-z0-9-]+)-(\d{4}-\d{2}-\d{2})-[a-z0-9]{1,8}\.[a-z0-9]+$/i.exec(file);
  if (!m) return null;
  const head = m[1];
  // Brand and template are both hyphenated and joined by a hyphen, so the seam
  // is found by asking the real lists rather than by guessing at the split.
  for (const t of templates) {
    if (head.endsWith(`-${t}`)) {
      const brand = head.slice(0, -(t.length + 1));
      if (brands.includes(brand)) return { brand, template: t, day: m[2] };
    }
  }
  return null;
};

/**
 * Is this card still what its brand would draw today?
 *
 * @param {string} cardPath
 * @param {{wallet?: string|null}} opts
 * @returns {Promise<{state: string, moved: string[], note: string, brand?: string, template?: string}>}
 */
export const cardFreshness = async (cardPath, { wallet = null } = {}) => {
  const was = await readProvenance(cardPath);
  if (!was) return compareProvenance(null, null);
  let now = null;
  try {
    const [brand, template] = await Promise.all([
      loadBrand(was.brand, { wallet }),
      loadTemplate(was.template),
    ]);
    if (brand?.ok && template?.ok) {
      const marks = await loadMarks(was.brand, brand.tokens, { dir: brand.dir, wallet });
      now = fingerprintCard({
        tokens: brand.tokens,
        marks: marks?.marks || marks,
        templateSvg: template.svg,
      });
    }
  } catch {
    now = null;
  }
  return { ...compareProvenance(was, now), brand: was.brand, template: was.template };
};

/**
 * Mark every attached CARD in a queue with whether it still matches its brand.
 *
 * ⚠️ THIS LIVES HERE, NOT IN THE ROUTE. It is a statement about cards, not
 * about HTTP — the route's job is to hand it to the board. It also kept
 * `social-channel-routes.js` four lines from the 500-line cap, which is the
 * kind of landmine that goes off in somebody else's commit.
 *
 * Read-only and never fatal: a freshness check that could throw would trade a
 * cosmetic warning for the operator's whole queue. Only card-shaped files are
 * judged at all — see `looksLikeCard`.
 *
 * @param {Array} queue
 * @param {{wallet?: string|null, onError?: (msg: string) => void}} opts
 */
export const withCardFreshness = async (queue, { wallet = null, onError = null } = {}) => {
  const entries = Array.isArray(queue) ? queue : [];
  if (!entries.some((e) => Array.isArray(e?.media) && e.media.length)) return entries;
  try {
    const [brands, templates] = await Promise.all([listBrands(), listTemplates()]);
    return await Promise.all(entries.map(async (e) => {
      if (!Array.isArray(e?.media) || !e.media.length) return e;
      const media = await Promise.all(e.media.map(async (m) => (
        looksLikeCard(m?.path, { brands, templates })
          ? { ...m, kit: await cardFreshness(m.path, { wallet }) }
          : m
      )));
      return { ...e, media };
    }));
  } catch (err) {
    if (onError) onError(err.message);
    return entries;
  }
};
