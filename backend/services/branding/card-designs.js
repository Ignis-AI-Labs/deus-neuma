// card-designs — a company's OWN card designs, beside its kit.
//
// Design note, 2026-11-16: […]
//
// Until this file, a card's LAYOUT was global: templates/ held one stat card, one launch card,
// and a kit could change only the paint (colours, faces, marks). So every company's stat card was
// the same drawing. Now a kit carries its own designs in `<kit>/cards/<name>.svg` + `<name>.json`
// — the same two files a shared template is — and a design of its own wins over the shared one
// of the same name, or adds a card type no other company has.
//
// WHERE: the same roots as the kit itself (kit-locate.js), workspace first; a company's design is
// written only into the operator's own ground, never into the repo. Every read is held to
// card-safety.js, because the desk draws a design inline. impure — disk.

import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { brandRoots, workspaceBrandsDir } from './kit-locate.js';
import { designRefusals, specRefusals } from './card-safety.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The repo's own kits (brand-tokens.js brandsDir) — computed here so this file imports no loader. */
const REPO_BRANDS = path.join(here, 'brands');

const SAFE_NAME = /^[a-z][a-z0-9-]{0,39}$/;
export const DESIGNS = 'cards';

/** Why this card type's name cannot reach disk, or null. Pure. */
export const designNameRefusal = (name) =>
  (SAFE_NAME.test(String(name || '')) ? null : `card "${name}" is not a name — lowercase letters, digits and hyphens only`);

/** Every cards/ dir this company's designs may be read from, in precedence order. impure */
export const designDirs = async (brand, wallet) =>
  (await brandRoots(wallet, REPO_BRANDS)).map((root) => ({ dir: path.join(root.dir, brand, DESIGNS), where: root.where }));

/** Where a design is WRITTEN: the operator's own ground, or null when none is set. impure */
export const designWriteDir = async (brand, wallet) => {
  const own = await workspaceBrandsDir(wallet);
  return own ? path.join(own, brand, DESIGNS) : null;
};

/**
 * This company's own design of one card type, or null when it has none (the shared one stands).
 * A design that fails card-safety.js is refused, never drawn. impure
 * @returns {Promise<null | {ok: true, svg: string, spec: object, where: string, dir: string}
 *   | {ok: false, error: string}>}
 */
export const readDesign = async (brand, template, wallet) => {
  if (designNameRefusal(brand) || designNameRefusal(template)) return null;
  for (const { dir, where } of await designDirs(brand, wallet)) {
    let svg;
    try {
      svg = await readFile(path.join(dir, `${template}.svg`), 'utf8');
    } catch {
      continue;
    }
    let spec;
    try {
      spec = JSON.parse(await readFile(path.join(dir, `${template}.json`), 'utf8'));
    } catch (err) {
      return { ok: false, error: `${brand}'s own ${template} card has no readable fields file (${template}.json: ${err.code || err.message})` };
    }
    const refusals = [...designRefusals(svg), ...specRefusals(spec)];
    if (refusals.length) return { ok: false, error: `${brand}'s own ${template} card cannot be drawn: ${refusals.join('; ')}` };
    return { ok: true, svg, spec, where, dir };
  }
  return null;
};

/** The card types this company has designed itself, first root winning. impure */
export const listDesigns = async (brand, wallet) => {
  if (designNameRefusal(brand)) return [];
  const seen = new Map();
  for (const { dir, where } of await designDirs(brand, wallet)) {
    const files = await readdir(dir).catch(() => []);
    for (const file of files) {
      const name = file.endsWith('.svg') ? file.slice(0, -4) : null;
      if (name && !designNameRefusal(name) && !seen.has(name)) seen.set(name, where);
    }
  }
  return [...seen.entries()].map(([name, where]) => ({ name, where })).sort((a, b) => a.name.localeCompare(b.name));
};
