// kit-store — reading and WRITING the operator's brand kits.
//
// Design note, 2026-08-31: […]
//
// kit-locate answers WHERE a kit lives and kit-readiness answers whether it is
// finished. Neither could ever put one on disk — until now a kit was authored
// by hand-editing JSON, which is the half of Founder's original ask ([…]) that never shipped.
//
// TWO LAWS THIS FILE KEEPS.
//
// 1. A WRITE ONLY EVER LANDS IN THE OPERATOR'S OWN GROUND. The repo's
//    `branding/brands/` is source, not storage. Editing `ignis` from the panel
//    therefore CREATES a workspace kit that shadows the shipped one — which is
//    exactly the precedence kit-locate already declares, and it means the
//    operator can never damage the fallback a fresh clone depends on.
//
// 2. SAVING IS NOT THE GATE. A kit is saved as soon as it is LOADABLE — a
//    name, the three colour roles, the three type slots — and never held to
//    the nine-section standard. Completeness gates going out under a brand
//    (kit-gate.js); it must not gate writing one down, or a kit could only be
//    saved once it was already finished, and nobody authors that way.
//
// impure — disk.

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { brandsDir, tokenRefusals } from './brand-tokens.js';
import { listBrandNames, resolveBrandDir, workspaceBrandsDir } from './kit-locate.js';
import { KIT_SECTIONS, kitReadiness } from './kit-readiness.js';

const SAFE_BRAND = /^[a-z][a-z0-9-]{0,39}$/;

/** Pure — what is wrong with this brand name, or null. */
export const brandNameRefusal = (brand) => (SAFE_BRAND.test(String(brand || ''))
  ? null
  : `"${brand}" is not a brand name — lowercase letters, digits and hyphens, starting with a letter`);

/** Set a dotted path to `value` on a plain object, building branches. Pure. */
const plant = (root, dotted, value) => {
  const parts = dotted.split('.');
  const last = parts.pop();
  let node = root;
  for (const part of parts) {
    if (!node[part] || typeof node[part] !== 'object') node[part] = {};
    node = node[part];
  }
  if (!(last in node)) node[last] = value;
  return root;
};

/**
 * A new kit: the WHOLE shape, already loadable, and plainly unfinished. Pure.
 *
 * THE STANDARD, GENERATED RATHER THAN COPIED (Design note, 2026-08-31: […]). Umbrae's kit set the bar; what makes the bar hold for
 * everyone is that this scaffold is BUILT FROM `KIT_SECTIONS` — the very spec
 * the readiness gate reads. Add a section to the gate tomorrow and it appears
 * in every new kit the same day. A hand-written starter would have drifted
 * from the gate on the first change, and the drift would surface as an
 * operator filling in a kit that still refuses.
 *
 * EVERY FIELD IS `null`, NOT A PLACEHOLDER. `holds()` refuses null for every
 * kind, so the shape is visible without a single section passing vacuously.
 * This matters most for the two fields where an empty list IS a real answer —
 * `disclosures` and `competitors.neverName`. Seeding those as `[]` would let a
 * brand nobody had thought about clear LEGAL and half of CHANNELS on creation,
 * which is precisely the check those sections exist to force.
 *
 * The DRAWABLE core — every colour role and type slot the templates actually
 * reference — is filled with real values, so a new kit is loadable and its
 * cards compose. Nothing else is invented: no positioning, no voice, no claims,
 * no handle, no artwork. Those are the company's words and the company's files,
 * and a scaffold that guessed at them would put them in its mouth.
 */
export const kitSkeleton = (brand, { name = null, owner = null } = {}) => {
  const kit = {
    brand,
    name: name || brand,
    // ⚠️ EVERY COLOUR THE TEMPLATES DRAW, not merely every colour the loader
    // demands — and the difference used to be nine.
    //
    // Until 2026-08-31 this seeded the five roles `tokenRefusals` requires. The
    // six templates reference fourteen. `renderCardSvg` refuses an unresolved
    // token rather than falling back, so a kit made from this scaffold saved
    // cleanly and then failed to render a single card — breaking the law four
    // lines above the bug that introduced it. It broke because the requirement
    // lived in three hand-kept places (an SVG, a required-list, this block) and
    // nothing tied them together.
    //
    // The VALUES here are still a design decision — a scan can say a brand
    // needs a hairline, never that it should be 14% white. So they are authored
    // by hand and their COMPLETENESS is machine-checked: template-tokens.js
    // reads what the cards draw, and brand-template-tokens.test.js fails this
    // block the moment a template reaches for a role it does not carry.
    colors: {
      bg: '#0b0b0c',
      bgScreen: '#121214',
      ink: '#fafafa',
      inkSoft: 'rgba(250,250,250,0.66)',
      muted: 'rgba(250,250,250,0.58)',
      gray: 'rgba(250,250,250,0.44)',
      hairline: 'rgba(250,250,250,0.14)',
      hairlineSoft: 'rgba(250,250,250,0.06)',
      accent: '#4f8bff',
      accentGlow: 'rgba(79,139,255,0.30)',
      trim: 'rgba(79,139,255,0.34)',
      trimHot: '#2fbf7a',
      rise: '#00e08a',
      halo: '#ff9d3c',
    },
    // Every type slot the templates draw, for the same reason — and set in
    // faces this repository actually carries, so the first render is the real
    // typeface rather than whatever the render machine falls back to.
    type: {
      display: "'Rajdhani', Inter, system-ui, sans-serif",
      displayWeight: '600',
      displayTrack: '0.04em',
      voice: 'Inter, system-ui, -apple-system, sans-serif',
      voiceWeight: '400',
      data: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
      labelWeight: '400',
      labelTrack: '0.18em',
      numeral: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
      numeralWeight: '300',
      numeralTrack: '-0.01em',
    },
    // The faces those four roles resolve to. Derived from the type block above,
    // not a wishlist: an embedded face nothing draws is ~400KB of base64 in
    // every card for nothing, which is the state brands/ignis/tokens.json is in.
    embedFonts: ['rajdhani-semibold', 'inter-regular', 'mono-data', 'mono-light'],
    ...(owner ? { owner } : {}),
  };
  for (const section of KIT_SECTIONS) {
    for (const field of section.fields) plant(kit, field.path, null);
  }
  return kit;
};

/** One kit as it stands on disk, with where it came from. impure. */
export const readKit = async (brand, wallet) => {
  const refusal = brandNameRefusal(brand);
  if (refusal) return { ok: false, error: refusal };
  const found = await resolveBrandDir(brand, wallet, brandsDir());
  if (!found) return { ok: false, error: `there is no "${brand}" brand kit` };
  let kit;
  try {
    kit = JSON.parse(await readFile(path.join(found.dir, found.file), 'utf8'));
  } catch (err) {
    // A kit that will not parse is DAMAGED, never empty — reporting it as
    // absent would invite the panel to helpfully overwrite it.
    return { ok: false, error: `the "${brand}" kit could not be read: ${err.message}` };
  }
  return {
    ok: true,
    brand,
    kit,
    where: found.where,
    readiness: kitReadiness(kit),
  };
};

/**
 * Every kit this operator can reach, each with its readiness. impure.
 *
 * A kit that fails to parse still appears, carrying its error — the panel's
 * job is to show what is there, and a broken kit silently missing from the
 * list is how an operator concludes a brand was deleted.
 */
export const listKits = async (wallet) => {
  const names = await listBrandNames(wallet, brandsDir());
  return Promise.all(names.map(async ({ brand, where }) => {
    const read = await readKit(brand, wallet);
    if (!read.ok) return { brand, where, error: read.error };
    return {
      brand,
      where,
      name: read.kit?.name || brand,
      owner: read.kit?.owner || null,
      accent: read.kit?.colors?.accent || null,
      ready: read.readiness.ready,
      done: read.readiness.sections.filter((s) => s.ready).length,
      total: read.readiness.sections.length,
    };
  }));
};

/**
 * Write one kit into the operator's own ground. impure.
 *
 * Refuses before touching disk, and the refusals are the LOADER'S — so a kit
 * that saves is a kit the card renderer and the press can both open. Anything
 * beyond that is readiness, which is reported back rather than enforced.
 *
 * @returns {Promise<{ok: true, brand, kit, where, readiness}|{ok: false, error: string, refusals?: string[]}>}
 */
export const writeKit = async (brand, wallet, kit) => {
  const refusal = brandNameRefusal(brand);
  if (refusal) return { ok: false, error: refusal };
  if (!kit || typeof kit !== 'object' || Array.isArray(kit)) {
    return { ok: false, error: 'a brand kit must be an object' };
  }
  const body = { ...kit, brand };
  const refusals = tokenRefusals(body);
  if (refusals.length > 0) {
    return {
      ok: false,
      // The named fields ride IN the message, not only beside it. Every client
      // — the panel, a script, a being — surfaces `error`; "cannot be saved"
      // alone sends the reader back to guess which of nineteen fields the
      // loader objected to.
      error: `the "${brand}" kit cannot be saved as it stands — ${refusals.join('; ')}`,
      refusals,
    };
  }
  const own = await workspaceBrandsDir(wallet);
  if (!own) {
    // No ground means no place of the operator's own to put it, and the repo
    // is not an alternative — saying so is better than writing somewhere they
    // did not choose.
    return { ok: false, error: 'no house ground is set, so there is nowhere of your own to keep a brand kit' };
  }
  const dir = path.join(own, brand);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'brand.json'), `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  // Re-read rather than echo: the panel must redraw from what is actually on
  // disk, not from what this process believed it wrote.
  return readKit(brand, wallet);
};
