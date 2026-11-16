// card-gallery-view — the CARDS section's words, as pure functions over the gallery
// (card-gallery.js): what each card is, and how much of the company is still the shared look.

const pct = (score) => `${Math.round(score * 100)}%`;
const brandList = (likeness) => likeness.map((l) => l.brand.toUpperCase()).join(', ');

/**
 * One card's standing, in the operator's words. Pure.
 * @returns {{tone: 'own'|'shared'|'alike'|'error', label: string, detail: string}}
 */
export const cardStanding = (card, brandName) => {
  const name = String(brandName || 'this company').toUpperCase();
  if (card.error) return { tone: 'error', label: 'CANNOT BE DRAWN', detail: card.error };
  const alike = card.likeness || [];
  if (card.source === 'shared') {
    return {
      tone: 'shared',
      label: 'SHARED LAYOUT',
      detail: alike.length
        ? `The same drawing ${brandList(alike)} ${alike.length === 1 ? 'uses' : 'use'}, in ${name}'s colours. Make it ${name}'s own and redesign it.`
        : `The shared drawing, in ${name}'s colours. Make it ${name}'s own and redesign it.`,
    };
  }
  if (alike.length) {
    const top = alike[0];
    return {
      tone: 'alike',
      label: `OWN · ${pct(top.score)} LIKE ${top.brand.toUpperCase()}`,
      detail: `${name}'s own design, but its layout is ${pct(top.score)} like ${top.brand.toUpperCase()}'s ${card.title || card.name}. Move, resize or replace shapes until it reads as ${name}'s.`,
    };
  }
  return {
    tone: 'own',
    label: card.ownType ? `${name}'S OWN CARD TYPE` : 'OWN DESIGN',
    detail: card.ownType ? `A card only ${name} has.` : `${name}'s own design; no other company's ${card.title || card.name} looks like it.`,
  };
};

/** The line over the gallery: how much of the company still wears the shared look. Pure. */
export const gallerySummary = (gallery, brandName) => {
  const name = String(brandName || 'this company').toUpperCase();
  const total = gallery?.cards?.length || 0;
  if (!total) return 'No cards yet.';
  const shared = gallery.shared || 0;
  const alike = (gallery.cards || []).filter((c) => c.source === 'company' && c.likeness?.length).length;
  if (!shared && !alike) return `Every one of ${name}'s ${total} cards is its own design.`;
  return [
    shared ? `${shared} of ${total} cards are still the shared layout other companies draw too` : null,
    alike ? `${alike} of ${name}'s own still look${alike === 1 ? 's' : ''} like another company's` : null,
  ].filter(Boolean).join(' · ') + `. Open one to make it ${name}'s.`;
};

/** A new card type's name, as the server will accept it — or why not. Pure. */
export const newCardNameRefusal = (name, gallery) => {
  const n = String(name || '').trim();
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(n)) return 'lowercase letters, digits and hyphens, starting with a letter';
  if ((gallery?.cards || []).some((c) => c.name === n)) return `there is already a ${n} card`;
  return null;
};
