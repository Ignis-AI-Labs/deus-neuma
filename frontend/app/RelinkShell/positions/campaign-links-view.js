// campaign-links-view.js — how linked campaigns read on a position's hub. Pure.

const PLAIN = Object.freeze({ cmo: 'CMO', cro: 'CRO' });

/** A position's short form on a link line (the seat's own, as the rail names it). */
export const officeWords = (office) => PLAIN[office] ?? String(office).toUpperCase();

/**
 * The campaigns one campaign may still be linked with: another position's,
 * for the same company, not linked already. As Select options.
 */
export const linkChoices = (campaign, all) => (all ?? [])
  .filter((c) => c.office !== campaign.office && c.company === campaign.company && !campaign.links.some((l) => l.key === c.key))
  .map((c) => ({ value: c.key, label: `${officeWords(c.office)} · ${c.name}` }));
