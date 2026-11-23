// sales-costs-view — WHAT THE LEADS COST, and where they go (Design note, 2026-11-20: […]). The numbers are
// the server's own (sales/lead-cost.js, carried on the engine as `costs`), so this sheet and both briefings agree.
// This shapes them for the screen: one row a partner (a paid partner with no plan filed still stands, asking for
// one), money said in its currency, and the line as a ladder — each stage against the one before it. Pure.
import { ALL, pipelineOf, leadsIn, callRows } from './sales-pipeline-view.js';

// The partners that sell lead data by plan: each stands on the sheet even before its plan is filed.
export const PAID_PARTNERS = Object.freeze(['Apollo', 'Hunter', 'Tomba']);
const low = (v) => String(v ?? '').trim().toLowerCase();

/** "$1,250" / "$12.50" / "EUR 40" / "—". pure. */
export const cash = (currency, v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—'
  : `${currency === 'USD' || !currency ? '$' : `${currency} `}${Number(v).toLocaleString('en-US', { minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`);

/** One row a partner: those with a plan (the most paid first), then the paid partners still without one. pure. */
export const costRows = (engine) => {
  const costs = engine?.costs ?? null;
  const filed = (costs?.partners ?? []).map((p) => ({ ...p, id: low(p.partner), filed: true }));
  const used = Object.keys(engine?.spentBy ?? {});
  const missing = [...new Set([...PAID_PARTNERS, ...used])].filter((name) => !filed.some((p) => p.id === low(name)))
    .map((name) => ({ id: low(name), partner: name, filed: false, monthly: null, paid: null, leads: null, replied: null, calls: null, won: null, perLead: null, perReply: null, perCall: null, perWon: null, credits: { used: engine?.spentBy?.[name] ?? 0, included: null }, booked: null, unbooked: null, since: null, currency: costs?.currency ?? 'USD' }));
  return [...filed.sort((a, b) => b.paid - a.paid), ...missing];
};

/** The one line over the sheet: what is paid, and what a lead, a reply, a call and a deal have cost. pure. */
export const costHeadline = (engine) => {
  const c = engine?.costs;
  if (!c?.partners?.length) return null;
  return [
    { k: 'A MONTH IN PLANS', v: cash(c.currency, c.monthly) }, { k: 'PAID SO FAR', v: cash(c.currency, c.paid) },
    { k: 'A LEAD', v: cash(c.currency, c.all.perLead) }, { k: 'A REPLY', v: cash(c.currency, c.all.perReply) },
    { k: 'A CALL BOOKED', v: cash(c.currency, c.all.perCall) }, { k: 'A DEAL WON', v: cash(c.currency, c.all.perWon) },
    { k: 'LEADS THROUGH NO PAID PARTNER', v: c.free.share === null ? '—' : `${c.free.leads} · ${c.free.share}%` },
  ];
};

const num = (head) => Number(String(head ?? '0').replace(/[^\d.]/g, '')) || 0;
const pct = (n, of) => (of > 0 ? Math.round((n / of) * 1000) / 10 : null);

/**
 * WHERE IT GOES — the line as a ladder over the campaign in view: each stage's count, what share of the stage before
 * it got this far, and what share of everything found. A stage with nothing before it has no share ("—"). pure.
 */
export const conversionRows = (engine, view = ALL, deals = []) => {
  const stage = Object.fromEntries(pipelineOf({ engine, view, deals }).map((s) => [s.id, s]));
  const leads = leadsIn(engine, view);
  const steps = [
    ['COMPANIES FOUND', num(stage.discover.head)], ['SHORTLISTED', num(stage.filter.head)], ['LEADS', num(stage.validate.head)],
    ['WRITTEN TO', num(stage.sent.head)], ['REPLIED', num(stage.replies.head)], ['CALLS BOOKED', callRows(engine, view).length],
    ['WON', leads.filter((l) => l.status === 'won').length],
  ];
  return steps.map(([label, n], i) => ({ id: label, label, n, ofPrior: i ? pct(n, steps[i - 1][1]) : null, ofFound: i ? pct(n, steps[0][1]) : null }));
};
