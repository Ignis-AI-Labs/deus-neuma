// card-set — which SHARED card types a company does not use.
//
// Design note, 2026-11-16: […] Adding and redesigning is card-designs.js
// (a design of its own). REMOVING one of its own is letting that design go. This file is the
// third case: a shared card type the company simply does not draw. It is named in
// `<kit>/cards/_set.json` ({retired: [names]}); a retired card is listed apart, is not offered to
// render_card for that company, and comes back with one act. The shared template is untouched, so
// every other company keeps it. `_set` cannot be a card's name (a name starts with a letter).
// impure — disk; written only into the operator's own ground.

import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { designDirs, designWriteDir, designNameRefusal } from './card-designs.js';

const FILE = '_set.json';

/** The shared card types this company does not use. impure */
export const readRetired = async (brand, wallet) => {
  if (designNameRefusal(brand)) return [];
  for (const { dir } of await designDirs(brand, wallet)) {
    try {
      const set = JSON.parse(await readFile(path.join(dir, FILE), 'utf8'));
      return Array.isArray(set?.retired) ? [...new Set(set.retired.filter((n) => !designNameRefusal(n)))].sort() : [];
    } catch {
      continue;
    }
  }
  return [];
};

/**
 * Stop using one card type for this company, or use it again. impure
 * @returns {Promise<{ok: true, retired: string[]} | {ok: false, error: string}>}
 */
export const setRetired = async ({ brand, template, retired, wallet }) => {
  const named = designNameRefusal(brand) || designNameRefusal(template);
  if (named) return { ok: false, error: named };
  const dir = await designWriteDir(brand, wallet);
  if (!dir) return { ok: false, error: 'no house ground is set, so there is nowhere of your own to keep a company\'s card set' };
  const now = await readRetired(brand, wallet);
  const next = retired ? [...new Set([...now, template])].sort() : now.filter((n) => n !== template);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, FILE), `${JSON.stringify({ retired: next }, null, 2)}\n`, 'utf8');
  return { ok: true, retired: next };
};
