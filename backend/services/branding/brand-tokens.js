// brand-tokens.js — the branding lane's only door to disk: brands, templates,
// and the font files that get embedded into a card.
//
// Everything shaped like a decision lives in card-svg.js and is pure. This file
// reads bytes and validates them, so a broken brand or a missing template
// refuses with the path it looked at rather than throwing somewhere downstream.

import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveBrandDir, listBrandNames, brandRoots } from './kit-locate.js';
import { pressRefusals, ownerRefusals } from './kit-shape.js';
import { EMBEDDABLE, fontsDir } from './embeddable-faces.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const brandsDir = () => path.join(here, 'brands');
export const templatesDir = () => path.join(here, 'templates');

// Re-exported so every existing importer keeps working — this file was the one
// door to the branding lane's disk and its callers should not have to learn
// that the registry moved. embeddable-faces.js holds the faces themselves.
export { EMBEDDABLE, fontsDir };

// A brand or template name reaches disk, so it is a path component and nothing
// else — no separators, no dots, no traversal. Names come from a being's tool
// call, and "../../.." is a name too.
const SAFE_NAME = /^[a-z][a-z0-9-]{0,39}$/;
const nameRefusal = (kind, name) =>
  (SAFE_NAME.test(String(name || '')) ? null : `${kind} "${name}" is not a name — lowercase letters, digits and hyphens only`);

/** Every colour a brand declares must be a real CSS colour we recognise. A
 *  typo'd hex renders as black on black and nobody sees it until it is posted. */
const COLOR = /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba?\([\d\s.,%]+\))$/;

/**
 * Validate a brand's tokens (pure). Returns the refusals; empty means good.
 * @param {object} tokens
 * @returns {Array<string>}
 */
export const tokenRefusals = (tokens) => {
  const out = [];
  if (!tokens || typeof tokens !== 'object') return ['the brand file is not an object'];
  if (!tokens.name) out.push('the brand has no name');
  const colors = tokens.colors;
  if (!colors || typeof colors !== 'object') {
    out.push('the brand declares no colors');
  } else {
    for (const [key, value] of Object.entries(colors)) {
      if (!COLOR.test(String(value))) out.push(`color "${key}" is "${value}", which is not a colour this renderer can trust`);
    }
    // ⚠️ `rise` joined the required set on 2026-08-31, when the stat card began
    // colouring a gain green. It is required for the same reason `accent` is:
    // a shared template draws it for EVERY brand, and `renderCardSvg` refuses
    // an unresolved token rather than falling back — so a brand without it does
    // not render slightly wrong, it does not render at all. Ignis found this
    // the instant the template changed, which is the cross-product guard doing
    // its job; requiring it here moves the failure to load time, where it names
    // the missing key instead of surfacing as a refused card.
    for (const required of ['bg', 'ink', 'accent', 'rise', 'halo']) {
      if (!colors[required]) out.push(`color "${required}" is required — every template rests on it`);
    }
  }
  // DISPLAY is required alongside voice and data. The templates reference all
  // three, and `renderCardSvg` REFUSES an unresolved token rather than falling
  // back — so a brand missing one does not render slightly wrong, it does not
  // render at all. Better to say which key is absent here, by name, than to let
  // it surface as […] three layers down.
  // ⚠️ Adding a font slot means every brands/*/tokens.json must gain it.
  for (const slot of ['display', 'voice', 'data']) {
    if (!tokens.type?.[slot]) out.push(`the brand must declare type.${slot} — every template rests on it`);
  }
  // The press half and the owner are OPTIONAL, so every tokens.json already on
  // disk stays valid — but when present they are checked, because a kit that
  // names a page format nobody supports fails at render time instead of here.
  out.push(...pressRefusals(tokens), ...ownerRefusals(tokens));
  return out;
};

/**
 * Load one brand's tokens. impure — disk.
 * @param {string} brand
 * @returns {Promise<{ok: true, tokens: object} | {ok: false, error: string}>}
 */
export const loadBrand = async (brand, { wallet = null } = {}) => {
  const bad = nameRefusal('brand', brand);
  if (bad) return { ok: false, error: bad };
  // WORKSPACE FIRST, repo as fallback — the operator's own kit for a company he
  // manages outranks anything that happens to ship in the source tree.
  const found = await resolveBrandDir(brand, wallet, brandsDir());
  if (!found) {
    return { ok: false, error: `no brand "${brand}" — looked in the house ground's brands/ and in ${brandsDir()}` };
  }
  const file = path.join(found.dir, found.file);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    return { ok: false, error: `brand "${brand}" at ${file} could not be read (${err.code || err.message})` };
  }
  const refusals = tokenRefusals(parsed);
  if (refusals.length) return { ok: false, error: `brand "${brand}" is not renderable: ${refusals.join('; ')}` };
  // `dir` and `where` ride along so marks resolve from the SAME place the kit
  // came from — a workspace kit must never load the repo's marks by accident.
  return { ok: true, tokens: parsed, dir: found.dir, where: found.where };
};

/** Every brand on disk, for the tool description and the operator's board. impure */
export const listBrands = async ({ wallet = null } = {}) =>
  (await listBrandNames(wallet, brandsDir())).map((b) => b.brand);

/** The same list, saying WHERE each kit came from — for the operator's board
 *  and for a being that needs to explain which kit it is about to use. impure */
export const listBrandsDetailed = async ({ wallet = null } = {}) =>
  listBrandNames(wallet, brandsDir());

/**
 * Every kit dir an ASSET may be read from, in precedence order — the caller's
 * resolved dir first, then each root's copy of the same brand, deduped.
 *
 * The kit as a whole goes to the workspace (kit-locate law: the operator's own
 * outranks what the repo ships). But that precedence is about DECISIONS —
 * tokens, recolor rules — not about holding individual files hostage: a guest
 * logo or mark dropped into the repo kit must not become invisible the moment
 * a workspace kit stands. So an asset the winner lacks falls through to the
 * next root, the same fallback the kit itself stands on. impure — the
 * operator's ground record.
 */
const kitHomes = async (brand, dir, wallet) => {
  const homes = dir ? [dir] : [];
  for (const root of await brandRoots(wallet, brandsDir())) {
    const d = path.join(root.dir, brand);
    if (!homes.includes(d)) homes.push(d);
  }
  return homes;
};

/**
 * Load one template: its SVG and the sidecar that declares its fields. A
 * template with no sidecar is refused rather than rendered unchecked — the
 * sidecar is what makes "refuse, never deform" possible. impure — disk.
 * @param {string} template
 * @returns {Promise<{ok: true, svg: string, spec: object} | {ok: false, error: string}>}
 */
export const loadTemplate = async (template) => {
  const bad = nameRefusal('template', template);
  if (bad) return { ok: false, error: bad };
  const svgPath = path.join(templatesDir(), `${template}.svg`);
  const specPath = path.join(templatesDir(), `${template}.json`);
  try {
    const [svg, spec] = await Promise.all([
      readFile(svgPath, 'utf8'),
      readFile(specPath, 'utf8').then(JSON.parse),
    ]);
    return { ok: true, svg, spec };
  } catch (err) {
    return { ok: false, error: `no template "${template}" (${svgPath} + its .json): ${err.code || err.message}` };
  }
};

/** Every template on disk, by name. impure */
export const listTemplates = async () => {
  const entries = await readdir(templatesDir()).catch(() => []);
  return entries.filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)).sort();
};

/**
 * A brand's MARKS — its wordmark, its mask — as data URIs ready for an
 * <image> element.
 *
 * WHY DATA URIs AND NOT INLINED SVG. A mark is a foreign document with its own
 * ids, gradients and styles; inlining it into a card invites id collisions
 * that show up as one card silently borrowing another's gradient. An <image>
 * with a data URI is its own document, and it cannot reach into ours.
 *
 * WHY RECOLOURING IS DECLARED, NOT INFERRED. Both Umbrae marks are drawn in
 * pure #000000 with no background — they are built for light surfaces, and
 * dropped onto our near-black cards they are INVISIBLE (checked 2026-08-29:
 * 9 fills in the wordmark, 6 in the mask, every one of them black). So a brand
 * declares what to swap and for which of its own tokens; nothing here guesses
 * at a colour, and a mark that needs no swap declares none.
 *
 * impure — disk.
 * @param {string} brand
 * @param {object} tokens that brand's tokens
 * @returns {Promise<{marks: Object<string, string>, missing: Array<string>}>}
 */
export const loadMarks = async (brand, tokens, { dir = null, wallet = null } = {}) => {
  const homes = await kitHomes(brand, dir, wallet);
  const declared = tokens?.marks && typeof tokens.marks === 'object' ? tokens.marks : {};
  const marks = {};
  const missing = [];
  for (const [name, rule] of Object.entries(declared)) {
    const file = String(rule?.file || '');
    if (!/^[a-z][a-z0-9-]*\.svg$/.test(file)) {
      missing.push(`${name} (declares "${file}", which is not a mark file name)`);
      continue;
    }
    // PER-FILE fallback: the winning kit's own marks/ first, then the other
    // roots'. Recolor rules still come from the winning kit's tokens — the
    // asset borrows a file, never a decision.
    let svg = null;
    for (const home of homes) {
      svg = await readFile(path.join(home, 'marks', file), 'utf8').catch(() => null);
      if (svg !== null) break;
    }
    if (svg === null) {
      missing.push(`${name} (no marks/${file} for brand ${brand} — looked in ${homes.map((h) => path.join(h, 'marks')).join(' and ')})`);
      continue;
    }
    for (const [from, tokenName] of Object.entries(rule?.recolor || {})) {
      const to = tokens?.colors?.[tokenName];
      if (!to) { missing.push(`${name} recolours to "${tokenName}", which this brand does not carry`); continue; }
      svg = svg.split(from).join(to);
    }
    marks[name] = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  }
  return { marks, missing };
};

/**
 * Read and base64 the faces a brand asks to embed. A face that is not on this
 * machine is REPORTED, never silently skipped: the card still renders (the
 * stack falls back), and the caller can say plainly that this render is
 * machine-dependent. impure — disk.
 *
 * @param {Array<string>} names keys of EMBEDDABLE
 * @returns {Promise<{faces: Array<object>, missing: Array<string>}>}
 */
export const embedFaces = async (names) => {
  const faces = [];
  const missing = [];
  for (const name of Array.isArray(names) ? names : []) {
    const face = EMBEDDABLE[name];
    if (!face) { missing.push(`${name} (not an embeddable face)`); continue; }
    try {
      const bytes = await readFile(face.file);
      faces.push({
        family: face.family,
        weight: face.weight,
        format: face.format || 'ttf',
        base64: bytes.toString('base64'),
      });
    } catch {
      missing.push(`${name} (${face.family}, not on this machine at ${face.file})`);
    }
  }
  return { faces, missing };
};

/**
 * Read a GUEST brand's mark — the token being listed, the partner being
 * announced — as a data URI. impure — disk.
 *
 * Design note, 2026-08-31: […]
 *
 * ⚠️ A GUEST LOGO IS SOMEONE ELSE'S ARTWORK, AND IT IS NEVER RECOLOURED.
 * `loadMarks` maps our own marks onto our own palette, which is fine because
 * they are ours. Doing that to a partner's logo would mean publishing their
 * mark in colours they did not choose, over their brand guidelines, under a
 * post that reads as jointly authored. It rides exactly as supplied.
 *
 * The file lives under the brand's `guests/` directory and is named, never
 * pathed — the same closed door `loadMarks` keeps. A card renderer that took an
 * arbitrary path would be a door for reading any file on the rig into a PNG
 * that then gets posted publicly.
 *
 * EVERY kit home is tried (kitHomes law): a logo dropped into the repo kit
 * still resolves when a workspace kit shadows it. And the refusal names every
 * directory that was checked — […] with "there"
 * unnamed is what sent a being hunting through the resolution chain for hours
 * (2026-09-01, the Virtuals listing card).
 *
 * @param {string} brand the HOST brand (whose card this is)
 * @param {string} slug the guest's file, without extension — "aerodrome"
 * @param {object} [opts]
 * @param {string} [opts.dir] the host brand's resolved directory
 * @param {object} [opts.wallet]
 * @returns {Promise<{mark: string|null, missing: string|null}>}
 */
export const loadGuest = async (brand, slug, { dir = null, wallet = null } = {}) => {
  const name = String(slug || '');
  if (!SAFE_NAME.test(name)) {
    return { mark: null, missing: `guest "${slug}" is not a name — lowercase letters, digits and hyphens only` };
  }
  const homes = await kitHomes(brand, dir, wallet);
  // SVG first (it scales to any card), then PNG — a token's logo is very often
  // only ever published as a raster, and refusing those would mean refusing
  // most listings.
  for (const home of homes) {
    for (const [ext, mime] of [['svg', 'image/svg+xml'], ['png', 'image/png']]) {
      try {
        const bytes = await readFile(path.join(home, 'guests', `${name}.${ext}`));
        return { mark: `data:${mime};base64,${bytes.toString('base64')}`, missing: null };
      } catch { /* try the next extension, then the next kit home */ }
    }
  }
  return {
    mark: null,
    missing: `no guests/${name}.svg or guests/${name}.png for brand ${brand} — looked in ${homes.map((h) => path.join(h, 'guests')).join(' and ')}; drop their logo in any of these`,
  };
};

/**
 * Every guest slug a brand can mount, merged across all kit homes — what the
 * describe call lists so a being never has to guess a slug. impure — disk.
 * @param {string} brand
 * @param {object} [opts] same as loadGuest
 * @returns {Promise<Array<string>>}
 */
export const listGuestSlugs = async (brand, { dir = null, wallet = null } = {}) => {
  const slugs = new Set();
  for (const home of await kitHomes(brand, dir, wallet)) {
    const entries = await readdir(path.join(home, 'guests')).catch(() => []);
    for (const f of entries) {
      const m = /^([a-z][a-z0-9-]{0,39})\.(svg|png)$/.exec(f);
      if (m) slugs.add(m[1]);
    }
  }
  return [...slugs].sort();
};
