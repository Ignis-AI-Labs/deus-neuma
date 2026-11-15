// campaign-links-view.js — how linked campaigns read on a position's hub. Pure.

const PLAIN = Object.freeze({ cmo: 'MARKETING', cro: 'SALES' });

/** A position's plain name on a link line. */
export const officeWords = (office) => PLAIN[office] ?? String(office).toUpperCase();

/**
 * The campaigns one campaign may still be linked with: another position's,
 * for the same company, not linked already. As Select options.
 */
export const linkChoices = (campaign, all) => (all ?? [])
  .filter((c) => c.office !== campaign.office && c.company === campaign.company && !campaign.links.some((l) => l.key === c.key))
  .map((c) => ({ value: c.key, label: `${officeWords(c.office)} · ${c.name}` }));
