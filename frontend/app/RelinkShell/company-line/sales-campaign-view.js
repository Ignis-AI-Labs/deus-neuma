// sales-campaign-view.js — how a sales campaign reads on the CAMPAIGNS sheet. Pure. (Its counts stand on the pipeline's
// rail now, sales-pipeline-view.js; the sheet keeps what each channel brought in.)
// SHINKEI: every number is the count the backend made from the house's own
// records (sales/campaign-shape.js); nothing here adds or estimates.

/** One channel's line: what that channel brought this campaign. */
export const channelWords = (c) => `${String(c.channel).toUpperCase()} — ${c.leads} LEAD${c.leads === 1 ? '' : 'S'} · ${c.written} WRITTEN · ${c.replied} REPLIED · ${c.qualified} QUALIFIED · ${c.won} WON · ${c.lost} LOST`;
