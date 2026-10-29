// kit-shape — ONE brand kit per company: colour, type, marks and page setup in
// a single file that every renderer obeys.
//
// Design note, 2026-08-30: […]
//
// WHAT THIS REPLACES. A brand lived in two places that could not see each
// other: `branding/brands/<b>/tokens.json` (colour + type + marks, for cards)
// and `data/brand-kits/<b>/kit.json` (logos + page setup + chart palette, for
// the press). Nothing kept them in step, and they had already drifted — the
// Ignis press kit drew its charts from a generic rainbow (#FF4444, #4444FF…)
// while the Ignis card drew in cyan. A company's documents and its cards were
// literally different brands.
//
// So a kit is ONE object. `press` is the only new top block, and it is optional
// precisely so every tokens.json already on disk is a valid kit that simply has
// no page setup yet.
//
// THE OWNER IS PART OF THE BRAND. `owner` names the house member responsible
// for it — Founder asked for a kit […], and a responsibility
// nobody is named for is one nobody holds.
//
// Pure throughout. Locating a kit on disk is kit-locate.js; reading it is
// brand-tokens.js.

import { reposOf, repoRefusals } from './company-repos.js';

/** The colour roles a kit may declare. `bg`, `ink` and `accent` are required
 *  by `tokenRefusals` — every template rests on them. The rest are optional and
 *  a renderer that wants one must tolerate its absence. */
export const COLOR_ROLES = Object.freeze([
  'bg', 'bgScreen', 'bgSoft', 'bgElev',
  'ink', 'inkSoft', 'muted', 'gray',
  'hairline', 'hairlineSoft',
  'accent', 'trim', 'trimHot', 'token', 'base',
  'warn', 'pending',
]);

/**
 * The order a derived chart palette walks. Deliberate rather than alphabetical:
 * the first series on a chart should be the brand's own accent, and adjacent
 * entries should be tellable apart at a glance — so hue-distinct roles come
 * before the greys, and `warn` sits late because a reader has been taught that
 * colour means something.
 */
const CHART_ORDER = Object.freeze([
  'accent', 'trim', 'trimHot', 'base', 'token', 'pending', 'muted', 'warn', 'gray', 'inkSoft',
]);

/** How many series a derived palette covers before it repeats. */
export const CHART_SERIES = 8;

const PAGE_FORMATS = Object.freeze(['Letter', 'A4', 'Legal', 'Tabloid']);

/**
 * A chart palette that is ACTUALLY THIS BRAND. Pure.
 *
 * An explicit `press.chartPalette` always wins — a brand may have chart colours
 * its guidelines fix. When there is none, the palette is derived from the
 * brand's own roles rather than defaulted to a generic rainbow, because a
 * rainbow is what "on brand" is not. Duplicates are dropped: two roles set to
 * the same hex would draw two series in one colour, which reads as one series.
 *
 * @param {object} kit
 * @returns {Array<string>}
 */
export const chartPaletteFor = (kit) => {
  const explicit = kit?.press?.chartPalette;
  if (Array.isArray(explicit) && explicit.length) return Object.freeze([...explicit]);
  const colors = kit?.colors || {};
  const seen = new Set();
  const out = [];
  for (const role of CHART_ORDER) {
    const value = colors[role];
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length === CHART_SERIES) break;
  }
  return Object.freeze(out);
};

/**
 * The press half of a kit, with the brand's own defaults filled in. Pure.
 *
 * `documentFooter` falls back to the brand's card footer rather than to a
 * generic string: a company that told us what to write at the bottom of a card
 * has told us what to write at the bottom of a page.
 */
export const pressOf = (kit) => Object.freeze({
  name: kit?.name || kit?.brand || 'Brand',
  companyName: kit?.press?.companyName || kit?.name || kit?.brand || 'Brand',
  documentFooter: kit?.press?.documentFooter || kit?.footer || '',
  format: PAGE_FORMATS.includes(kit?.press?.format) ? kit.press.format : 'Letter',
  marginCm: Number.isFinite(kit?.press?.marginCm) ? kit.press.marginCm : 1.5,
  logos: Object.freeze({ ...(kit?.press?.logos || {}) }),
  chartPalette: chartPaletteFor(kit),
  // WHAT CROSSES MEDIUMS, AND WHAT MUST NOT.
  //
  // A card is drawn on a dark screen; a document is printed as ink on paper.
  // The two palettes are NOT the same set, and mapping one onto the other
  // mechanically — bg→paper, ink→ink — would print a black page with white
  // text and eat a toner cartridge per copy. So the page keeps its own paper
  // and ink, declared in `press.colors` or left to the press's own defaults.
  //
  // What genuinely travels is the part that identifies the brand rather than
  // the surface: the ACCENT, the logos, and the chart palette. That is the
  // honest meaning of "one kit" — one source of truth, two renderings.
  colors: Object.freeze({
    ...(kit?.press?.colors || {}),
    accent: kit?.press?.colors?.accent || kit?.colors?.accent || undefined,
  }),
});

/** Who in the house holds this brand. Pure. null when nobody has been named. */
export const ownerOf = (kit) => {
  const owner = typeof kit?.owner === 'string' ? kit.owner.trim() : '';
  return owner || null;
};

/**
 * What is wrong with the PRESS half of a kit, named. Pure.
 *
 * Kept separate from `tokenRefusals` so a kit with no `press` block is not
 * merely tolerated but genuinely correct — every tokens.json already on disk
 * has none, and none of them is broken.
 *
 * @param {object} kit
 * @returns {Array<string>}
 */
export const pressRefusals = (kit) => {
  const press = kit?.press;
  if (press === undefined || press === null) return [];
  const out = [];
  if (typeof press !== 'object' || Array.isArray(press)) return ['press must be an object'];
  if (press.format !== undefined && !PAGE_FORMATS.includes(press.format)) {
    out.push(`press.format is "${press.format}" — it is one of: ${PAGE_FORMATS.join(', ')}`);
  }
  if (press.marginCm !== undefined && (!Number.isFinite(press.marginCm) || press.marginCm < 0)) {
    out.push('press.marginCm must be a number of centimetres, and not negative');
  }
  if (press.logos !== undefined) {
    if (typeof press.logos !== 'object' || Array.isArray(press.logos)) out.push('press.logos must be an object of role → file name');
    else {
      for (const [role, file] of Object.entries(press.logos)) {
        // Same law the marks keep: a file name reaches disk, so it is a name
        // and never a path. "../../.." is a name too.
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.svg$/.test(String(file))) {
          out.push(`press.logos.${role} is "${file}", which is not a logo file name`);
        }
      }
    }
  }
  if (press.chartPalette !== undefined) {
    if (!Array.isArray(press.chartPalette)) out.push('press.chartPalette must be a list of colours');
    else {
      for (const c of press.chartPalette) {
        if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(c))) {
          out.push(`press.chartPalette has "${c}", which is not a hex colour`);
        }
      }
    }
  }
  if (press.companyName !== undefined && typeof press.companyName !== 'string') {
    out.push('press.companyName must be text');
  }
  return out;
};

/**
 * What is wrong with a kit's OWNER, named. Pure.
 *
 * A neumaId reaches a path and a lane lookup, so it crosses the same identity
 * law every neumaId crosses: one segment, no separators, no traversal.
 */
export const ownerRefusals = (kit) => {
  if (kit?.owner === undefined || kit?.owner === null || kit?.owner === '') return [];
  if (typeof kit.owner !== 'string') return ['owner must be the neumaId of the house member who holds this brand'];
  return /^[a-zA-Z0-9_-]+$/.test(kit.owner.trim())
    ? []
    : [`owner "${kit.owner}" is not a neumaId — letters, digits, dash and underscore only`];
};

// THE COMPANY BLOCK (campaign plan §2.4, 2026-10-23). A kit already IS a
// company; the block records what makes it one beyond its look: where it
// sits in the house's tree (`parentId` — a core company heads its
// subsidiaries; an unrelated client is its own top-level company), its site,
// and its legal entity when it has one. Every field is optional, so every kit
// on disk is a valid top-level company with nothing recorded yet. `repos`
// (2026-10-24) lists the code it is built from (company-repos.js).

const KIT_ID = /^[a-z][a-z0-9-]{0,39}$/;
const httpUrl = (v) => typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v) && v.length <= 300;
const shortText = (v, max = 120) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/**
 * The company a kit is, normalized. Pure.
 * @param {object} kit
 * @param {string} brand - the kit's id (its directory name)
 * @returns {{id: string, name: string, parentId: ?string, site: {url: ?string, links: string[]},
 *   legalEntity: ?{name: string, jurisdiction: ?string}, repos: Array<{path: ?string, remote: ?string, role: string}>}}
 */
export const companyOf = (kit, brand) => {
  const block = kit?.company && typeof kit.company === 'object' ? kit.company : {};
  const legal = block.legalEntity && typeof block.legalEntity === 'object' ? block.legalEntity : null;
  return Object.freeze({
    id: brand,
    name: kit?.name || brand,
    parentId: KIT_ID.test(String(block.parentId ?? '')) && block.parentId !== brand ? block.parentId : null,
    site: Object.freeze({
      url: httpUrl(block.site?.url) ? block.site.url : null,
      links: Object.freeze(Array.isArray(block.site?.links) ? block.site.links.filter(httpUrl) : []),
    }),
    legalEntity: legal && shortText(legal.name)
      ? Object.freeze({ name: legal.name.trim(), jurisdiction: shortText(legal.jurisdiction) ? legal.jurisdiction.trim() : null })
      : null,
    repos: reposOf(block),
  });
};

/**
 * What is wrong with a company block, named. Pure. Whether the parent exists
 * (and the tree has no loop) is the house's question, answered where every
 * company is in view (marketing/company-tree.js).
 * @param {object} block
 * @param {string} brand
 * @returns {string[]}
 */
export const companyRefusals = (block, brand) => {
  if (block === undefined || block === null) return [];
  if (typeof block !== 'object' || Array.isArray(block)) return ['company must be an object'];
  const out = [];
  const allowed = ['parentId', 'site', 'legalEntity', 'repos'];
  for (const key of Object.keys(block)) if (!allowed.includes(key)) out.push(`company.${key} is not a company field (${allowed.join(', ')})`);
  if (block.parentId !== undefined && block.parentId !== null) {
    if (!KIT_ID.test(String(block.parentId))) out.push(`company.parentId "${block.parentId}" is not a company id`);
    else if (block.parentId === brand) out.push('a company cannot be its own parent');
  }
  if (block.site !== undefined && block.site !== null) {
    if (typeof block.site !== 'object' || Array.isArray(block.site)) out.push('company.site must be an object {url, links}');
    else {
      if (block.site.url !== undefined && block.site.url !== null && !httpUrl(block.site.url)) out.push('company.site.url must be a web address (https://…)');
      if (block.site.links !== undefined && (!Array.isArray(block.site.links) || !block.site.links.every(httpUrl))) out.push('company.site.links must be a list of web addresses');
    }
  }
  if (block.legalEntity !== undefined && block.legalEntity !== null) {
    const legal = block.legalEntity;
    if (typeof legal !== 'object' || Array.isArray(legal) || !shortText(legal.name)) out.push('company.legalEntity needs a name');
    else if (legal.jurisdiction !== undefined && legal.jurisdiction !== null && !shortText(legal.jurisdiction)) out.push('company.legalEntity.jurisdiction must be short text');
  }
  out.push(...repoRefusals(block.repos));
  return out;
};
