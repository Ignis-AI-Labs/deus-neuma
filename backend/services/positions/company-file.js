// THE COMPANY FILE — what the house knows and may say about each company it
// works for, in one place, for every seat (Design note, 2026-11-15: […]). A company is a brand kit (marketing/companies.js);
// its file joins what stands across the offices: its public face, its code,
// the facts a buyer may be told, its audiences and its campaigns — and names
// what is MISSING, with where the operator sets it, so no seat guesses.
// The text is PURE; companyFiles reads.

import { listCompanies } from '../marketing/companies.js';
import { campaignStoreFor } from '../marketing/campaign-store.js';
import { readSegments, readSalesFacts } from '../sales/sales-store.js';
import { readModels, modelLines } from './business-model.js';

const FACT_LINES = 12;

/**
 * pure — one company's file from what was read.
 * @returns {{id, name, parent, site, links, repos, legal, model, modelProposal, facts, factsWaiting, audiences, campaigns, missing: string[]}}
 *   model: the business model that stands · modelProposal: one a member filed, waiting on the operator
 */
export const companyFile = (company, { facts, segments, campaigns, models = new Map() }) => {
  const model = models.get(company.id) ?? null;
  const approved = (facts?.approved?.facts ?? []).filter((f) => f.company === company.id);
  const waiting = facts?.sheet && !facts.review ? facts.sheet.facts.filter((f) => f.company === company.id).length : 0;
  const audiences = segments.filter((s) => s.company === company.id && s.state !== 'retired');
  const mine = campaigns.filter((c) => (c.company ?? c.companyId) === company.id);
  return {
    id: company.id, name: company.name, parent: company.parentId, site: company.site?.url ?? null,
    links: company.site?.links ?? [], repos: (company.repos ?? []).length, legal: company.legalEntity?.name ?? null,
    model: model?.approved ?? null, modelProposal: model?.proposal ? { model: model.proposal, by: model.by, at: model.at } : null, modelReturned: model?.returned ?? null,
    facts: approved, factsWaiting: waiting,
    audiences: audiences.map((s) => ({ id: s.id, name: s.name, state: s.state })),
    campaigns: mine.map((c) => ({ id: c.id, name: c.name ?? c.title ?? c.id, goal: c.goal ?? null })),
    missing: [
      ...(model?.approved ? [] : [model?.proposal ? 'an approved business model (one waits for the operator in POSITIONS, COMPANY)' : 'its business model: what it sells, who pays, what it costs and what objectively changes for the buyer (the operator writes it in POSITIONS, COMPANY, or works it out with a seat holder who files company/model)']),
      ...(company.site?.url ? [] : ['its site address (the operator sets it in MARKETING, BRAND, SITE & CODE)']),
      ...(approved.length ? [] : [waiting ? `approved facts (${waiting} wait for the operator)` : 'facts a buyer may be told (the sales seat files them with sales/facts; the operator approves)']),
    ],
  };
};

/** pure — the section every seat holder reads. '' when the house has no company. */
export const companiesText = (files) => (!files.length ? '' : [
  '## THE HOUSE\'S COMPANIES — what is known, and what is missing',
  ...files.flatMap((f) => [
    `${f.name} [${f.id}]${f.parent ? `, part of ${f.parent}` : ''}: site ${f.site ?? 'NOT SET'}${f.links.length ? ` (also ${f.links.slice(0, 4).join(', ')})` : ''}${f.legal ? ` · legal entity ${f.legal}` : ''} · ${f.repos} code repositor${f.repos === 1 ? 'y' : 'ies'} listed`,
    ...(f.model ? ['  Business model (approved by the operator):', ...modelLines(f.model).map((l) => `  - ${l}`)] : []),
    ...(f.facts.length ? [`  What a buyer may be told (${f.facts.length} approved):`, ...f.facts.slice(0, FACT_LINES).map((x) => `  - ${x.claim}`), ...(f.facts.length > FACT_LINES ? [`  - and ${f.facts.length - FACT_LINES} more on the sheet`] : [])] : []),
    ...(f.audiences.length ? [`  Audiences: ${f.audiences.map((a) => `${a.name} (${a.state})`).join('; ')}`] : []),
    ...(f.campaigns.length ? [`  Campaigns: ${f.campaigns.map((c) => c.name).join('; ')}`] : []),
    ...(f.missing.length ? [`  MISSING: ${f.missing.join('; ')}. Say nothing about ${f.name} that rests on a missing item; ask the operator for it by house post.`] : []),
  ]),
  'Whatever you write or say for a company starts from its business model: what objectively changes for the buyer, what it costs, and the proof. A reader asks one thing: why are you at my door. Answer it with a result they can check, never with how it feels.',
  'Work for a company uses only what its own lines state. To read a company\'s site, fetch the address above; never guess which company a name means.',
].join('\n'));

/** impure — every company's file for one house; a store that cannot be read counts as empty, never as a refusal. */
export const companyFiles = async (wallet) => {
  const [companies, facts, segments, campaigns, models] = await Promise.all([
    listCompanies(wallet).catch(() => []),
    readSalesFacts(wallet).catch(() => null),
    readSegments(wallet).catch(() => []),
    campaignStoreFor(wallet).then((s) => s.load()).catch(() => []),
    readModels(wallet).catch(() => new Map()),
  ]);
  return companies.map((c) => companyFile(c, { facts, segments, campaigns, models }));
};
