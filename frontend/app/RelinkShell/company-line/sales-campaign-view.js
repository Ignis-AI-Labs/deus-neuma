// sales-campaign-view.js — how a sales campaign reads on the CAMPAIGNS tab. Pure.
// SHINKEI: every number is the count the backend made from the house's own
// records (sales/campaign-shape.js); nothing here adds or estimates.

/** What the numbers mean, said once under the list. */
export const FUNNEL = 'GATHERED: companies pulled from a lead source. SCORED: companies the sales seat judged for fit. LEADS: people on the lead list. WRITTEN: leads the house has emailed. REPLIED: leads who wrote back.';

/** The campaign's funnel, in order, as tiles. WON is the one that reads loud. */
export const funnelOf = (c) => [
  { key: 'gathered', n: c.gathered, label: 'GATHERED' },
  { key: 'scored', n: c.scored, label: 'SCORED' },
  { key: 'leads', n: c.leads, label: 'LEADS' },
  { key: 'written', n: c.written, label: 'WRITTEN' },
  { key: 'replied', n: c.replied, label: 'REPLIED' },
  { key: 'qualified', n: c.qualified, label: 'QUALIFIED' },
  { key: 'won', n: c.won, label: 'WON', loud: c.won > 0 },
];

/** One channel's line: what that channel brought this campaign. */
export const channelWords = (c) => `${String(c.channel).toUpperCase()} — ${c.leads} LEAD${c.leads === 1 ? '' : 'S'} · ${c.written} WRITTEN · ${c.replied} REPLIED · ${c.qualified} QUALIFIED · ${c.won} WON · ${c.lost} LOST`;
