// What the sales office and the company record owe the operator, as WAITING
// ON YOU rows (Design note, 2026-11-16: no function in two places; a decision that
// waits is shown where every other decision is, and one press opens it). Each
// was only visible inside its own tab before:
//   - a facts sheet filed and not yet reviewed            → POSITIONS, CHIEF REVENUE OFFICER, COMPANY
//   - an audience still a draft                            → POSITIONS, CHIEF REVENUE OFFICER, CAMPAIGNS
//   - an approved audience with companies off its list     → POSITIONS, CHIEF REVENUE OFFICER, CAMPAIGNS
//   - a business model a member filed                      → POSITIONS, CHIEF REVENUE OFFICER, COMPANY
//   - emails the sales seat staged for review             → POSITIONS, CHIEF REVENUE OFFICER, EMAILS
// impure (store reads); the rows are pure.

import { readSalesFacts, readSegments, readProspects, readCampaigns } from './sales-store.js';
import { readModels } from '../positions/business-model.js';
import { listCompanies } from '../marketing/companies.js';
import { readOutbox } from './email-outbox.js';
import { factsToReview } from './sales-facts.js';

const TEXT_MAX = 200;
const who = (laneId, names) => (laneId && laneId !== 'operator' ? { laneId, name: names.get(laneId) ?? null } : null);
const at = (office, tab, mark) => ({ app: 'positions', office, tab, ...mark });

/**
 * pure — the rows, from what was read.
 * @param {{facts: ?object, segments: object[], prospects: object[], models: Map<string, object>, companies: object[]}} read
 * @param {Map<string, string>} names - lane id → the name it goes by
 */
export const salesWaitingRows = ({ facts, segments, prospects, models, companies, outbox = null, campaigns = [] }, names) => [
  // emails the sales seat staged: one row for the lot, opening on the outbox
  ...((outbox?.drafts ?? []).some((d) => d.state === 'waiting') ? (() => {
    const waiting = outbox.drafts.filter((d) => d.state === 'waiting');
    return [{ id: `sales-email:${waiting.map((d) => d.id).join('.')}`, kind: 'sales-email', who: who(waiting[0].by, names), at: waiting.at(-1).at,
      title: `${waiting.length} email${waiting.length === 1 ? '' : 's'} to leads wait${waiting.length === 1 ? 's' : ''} for your review`, where: at('cro', 'emails', { outbox: true }) }];
  })() : []),
  ...(facts?.sheet && !facts.review ? [{
    id: `sales-facts:${facts.sheet.id}`, kind: 'sales-facts', who: who(facts.sheet.by, names), at: facts.sheet.filedAt,
    // Only the facts that wait count: one approved before stands and is not asked again (sales-facts.js).
    title: (() => { const n = factsToReview(facts).length; const carried = (facts.carried ?? []).length; return `${n} ${carried ? 'new ' : ''}fact${n === 1 ? '' : 's'} a buyer may be told wait${n === 1 ? 's' : ''} for your approval`; })(), where: at('cro', 'model', { factsSheet: facts.sheet.id }),
  }] : []),
  ...segments.filter((s) => s.state === 'draft').map((s) => ({
    id: `sales-audience:${s.id}:${s.filedAt ?? s.at ?? ''}`, kind: 'sales-audience', who: who(s.by, names), at: s.filedAt ?? s.at ?? null,
    title: `Audience "${s.name}" waits for your approval`, where: at('cro', 'discover', { segmentId: s.id }),
  })),
  // (No list for the operator to approve any more: a lead run validates every fit from its own page — lead-run.js.)
  // a campaign's email plan, filed and not yet locked in (email-formula.js): no first email of it is written until then
  ...campaigns.filter((c) => c.state === 'open' && c.emailPlan?.proposed && c.emailPlan.review?.verdict !== 'returned').map((c) => ({
    id: `email-plan:${c.id}:${c.emailPlan.proposedAt}`, kind: 'email-plan', who: who(c.emailPlan.proposedBy, names), at: c.emailPlan.proposedAt,
    title: `The email plan of "${c.name}" waits for you to lock it in`, where: at('cro', 'campaigns', { campaignId: c.id }),
  })),
  ...companies.filter((c) => models.get(c.id)?.proposal).map((c) => ({
    id: `business-model:${c.id}:${models.get(c.id).at}`, kind: 'business-model', who: who(models.get(c.id).by, names), at: models.get(c.id).at,
    title: `The business model of ${c.name} waits for your approval`, where: at('cro', 'model', { modelCompany: c.id }),
  })),
].map((row) => Object.freeze({ ...row, title: row.title.slice(0, TEXT_MAX), at: row.at ?? new Date(0).toISOString() }));

/** impure — the rows for one house. */
export const salesWaitingItems = async (wallet, names) => {
  const [facts, segments, prospects, models, companies, outbox, campaigns] = await Promise.all([
    readSalesFacts(wallet), readSegments(wallet), readProspects(wallet), readModels(wallet), listCompanies(wallet).catch(() => []), readOutbox(wallet).catch(() => null), readCampaigns(wallet).catch(() => []),
  ]);
  return salesWaitingRows({ facts, segments, prospects, models, companies, outbox, campaigns }, names);
};
