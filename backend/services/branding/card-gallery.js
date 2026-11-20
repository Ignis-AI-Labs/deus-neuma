// card-gallery — every card one company can draw, and whether each is its own.
//
// The brand kit editor's CARDS section and the being's render_card both stand on this: for each
// card type, whether the company draws its OWN design or the shared one every other company also
// draws, and how alike its layout is to each other company's card of the same name
// (card-likeness.js). A shared card is the same drawing as every company still on it; that is the
// "copying and pasting" look Founder named (2026-11-16), shown so it can be redesigned. impure — disk.

import { loadTemplate, listTemplates, brandsDir } from './brand-tokens.js';
import { listDesigns } from './card-designs.js';
import { readRetired } from './card-set.js';
import { listBrandNames } from './kit-locate.js';
import { layoutLikeness, TOO_ALIKE } from './card-likeness.js';

/**
 * @param {string} brand
 * @param {string|null} wallet
 * @returns {Promise<{cards: Array<object>, own: number, shared: number, tooAlike: number, retired: number}>}
 *   a card with retired: true is a shared type this company does not use (card-set.js); own, shared and
 *   tooAlike count only the cards it does use
 */
export const cardGallery = async (brand, wallet) => {
  const [shared, own, brands, retiredNames] = await Promise.all([
    listTemplates(), listDesigns(brand, wallet), listBrandNames(wallet, brandsDir()), readRetired(brand, wallet),
  ]);
  // Only a card the company still draws from the SHARED layout can be retired; its own design stands.
  const isRetired = (name) => retiredNames.includes(name) && !own.some((d) => d.name === name);
  const others = brands.map((b) => b.brand).filter((b) => b !== brand);
  const names = [...new Set([...shared, ...own.map((d) => d.name)])].sort();
  const otherOwn = new Map(await Promise.all(others.map(async (b) => [b, new Set((await listDesigns(b, wallet)).map((d) => d.name))])));

  const cards = [];
  for (const name of names) {
    const mine = await loadTemplate(name, { brand, wallet });
    if (!mine.ok) { cards.push({ name, source: own.some((d) => d.name === name) ? 'company' : 'shared', error: mine.error, likeness: [] }); continue; }
    const likeness = [];
    for (const other of others) {
      // Another company draws this card type only if it is shared or that company designed one.
      if (!shared.includes(name) && !otherOwn.get(other).has(name)) continue;
      const theirs = await loadTemplate(name, { brand: other, wallet });
      if (!theirs.ok) continue;
      const score = mine.source === 'shared' && theirs.source === 'shared' ? 1 : layoutLikeness(mine.svg, theirs.svg);
      if (score >= TOO_ALIKE) likeness.push({ brand: other, score: Math.round(score * 100) / 100, theirs: theirs.source });
    }
    cards.push({
      name,
      title: mine.spec.title || name,
      use: mine.spec.use || '',
      size: mine.spec.size || null,
      fields: mine.spec.fields || {},
      source: mine.source,
      // a card type no shared template has: this company's alone
      ownType: !shared.includes(name),
      retired: isRetired(name),
      likeness: likeness.sort((a, b) => b.score - a.score),
    });
  }
  const used = cards.filter((c) => !c.retired);
  return {
    cards,
    own: used.filter((c) => c.source === 'company').length,
    shared: used.filter((c) => c.source === 'shared').length,
    tooAlike: used.filter((c) => c.likeness?.length).length,
    retired: cards.length - used.length,
  };
};
