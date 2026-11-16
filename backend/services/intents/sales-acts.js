/**
 * sales/* — the lead engine's filed acts, the Mercator's alone (Founder
 * 2026-11-13: a lead generation and lead maintenance system built in, run by
 * the house's sales seat). The being does the thinking with the tools it
 * already has — it reads the house's site, searches the web, reads each
 * company's own pages — and files what it found here:
 *   sales/segment   an audience and its pitch (a draft until the operator approves it)
 *   sales/prospect  companies found for a segment, every sign of fit scored 0–5 with why
 *   sales/drop      a prospect that is not a fit, with why
 *   sales/lead      a prospect of an APPROVED segment onto the house's lead ledger,
 *                   with a real address read on a real page — never a guessed one
 *   sales/suppress  a person or company the house never writes to again
 *   sales/facts     what a buyer may be told, each fact sourced (the operator approves it;
 *                   no email reaches a lead before, and every number in one stands on it)
 *
 * THE OFFICE LAW: every validate re-verifies that the filing lane IS the
 * house's seated Mercator. Tier `allowed`: records in the house's own office,
 * no egress, no spend — the email itself rides email/send, gated as ever.
 */
import { officeContext } from './revenue-acts.js';
import { makeSegment } from '../sales/segment-shape.js';
import { makeProspect, MATCH_WORDS, countryOfAddress } from '../sales/prospect-shape.js';
import { makeSuppression, normalizeEmail, suppressionMatcher } from '../sales/suppress-shape.js';
import { readSegments, fileSegment, readProspects, addProspects, settleProspect, readSuppressions, addSuppression, fileSalesFacts, readCampaigns, addProspectPerson } from '../sales/sales-store.js';
import { makeSalesSheet, SALES_DISCLOSURE } from '../sales/sales-facts.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { listCompanies } from '../marketing/companies.js';
import { salesGatherIntents } from './sales-gather-acts.js';
import { campaignManageIntents } from './campaign-manage-acts.js';
import { companyModelIntent } from './company-model-act.js';
import { salesInboundIntents } from './sales-inbound-acts.js';
import { THREAD_REST_DAYS } from '../revenue/deal-shape.js';

const BATCH_MAX = 10;
const DAY_MS = 86_400_000;
const officerRefusal = { ok: false, status: 'denied', reason: 'the lead engine is the Mercator office\'s — only the seated Mercator files to it (house/post reaches them; the operator seats the office)' };
const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
// impure — why `ids` cannot be filed against: each must be one of the house's companies (its brand kits).
const companyRefusal = async (wallet, ids) => {
  const known = (await listCompanies(wallet)).map((c) => c.id);
  const strangers = [...new Set(ids)].filter((id) => !known.includes(id));
  return strangers.length ? `${strangers.map((s) => `"${s}"`).join(', ')} ${strangers.length === 1 ? 'is' : 'are'} not a company of this house — the house's companies are: ${known.join(', ') || 'none yet (the operator adds one in MARKETING)'}` : null;
};
const availableFor = async ({ connection }) => ((await officeContext(connection).catch(() => null)) ? {} : null);

// impure — the seated Mercator's context, or the refusal.
const seated = async (connection) => (await officeContext(connection).catch(() => null)) || null;

const salesSegmentIntent = Object.freeze({
  name: 'sales/segment',
  policyTool: 'sales.segment',
  fieldsForPrompt: '{id?, name, company, campaign?, offer, customerProblem, targetRole, targetGeography, countries: ["US", ..], targetCompanySize?, positiveCriteria: [..], negativeCriteria?: [..], exampleClients?: [..], why}',
  descriptionForPrompt: 'THE LEAD ENGINE. File an audience to sell to, from what you read on the house\'s own site and its competitors\': the offer, their problem, the role to reach, where (and countries: the ISO codes it may be SENT to — leave out any country whose law limits this offer, such as the UK for anything crypto), how big, the signs a company fits and the signs it does not, real companies that fit, and why they need it. Every claim in the offer must be true of the house today. It waits for the operator\'s approval; pass id to refine one (changing who it targets sends it back for approval).',
  availableFor,
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    try {
      const segment = makeSegment({ ...payload, by: context.laneId, now: new Date().toISOString() });
      const stranger = await companyRefusal(context.wallet, [segment.company]);
      if (stranger) return invalid(stranger);
      // An audience may serve one of the operator's open campaigns for the same company.
      const campaign = segment.campaign ? (await readCampaigns(context.wallet)).find((c) => c.id === segment.campaign) : null;
      if (segment.campaign && (!campaign || campaign.state !== 'open' || campaign.company !== segment.company)) return invalid(`campaign: "${segment.campaign}" is not an open campaign for ${segment.company} — your briefing lists the campaigns the operator opened`);
      return { ok: true, value: { context, segment } };
    } catch (err) {
      return invalid(err.message);
    }
  },
  summarize: (payload) => `segment "${String(payload?.name ?? '?').slice(0, 60)}"`,
  execute: async ({ context, segment }) => {
    const filed = await fileSegment(context.wallet, segment);
    if (!filed.ok) return { ok: false, reason: filed.reason };
    const waits = filed.segment.state === 'draft' ? ' — it waits for the operator\'s approval before any of its prospects reach the ledger' : '';
    return { ok: true, detail: `Segment [${segment.id}] "${segment.name}" is ${filed.segment.state.toUpperCase()}${waits}.` };
  },
});

const salesProspectIntent = Object.freeze({
  name: 'sales/prospect',
  policyTool: 'sales.prospect',
  fieldsForPrompt: '{segment, companies: [{domain, name, description?, country (ISO code, e.g. "US"), size?, scores: [{criterion, score, reasoning}], people?: [{name, role, sourceUrl, email?}], source}]}',
  descriptionForPrompt: `THE LEAD ENGINE. File companies you found for a segment (up to ${BATCH_MAX} at a time). Read each company's own pages first. Score EVERY sign of fit the segment lists 0–5, and any sign of non-fit that applies, each with the reason you read; source is the https page where you found the company; people are the ones you read on its own pages, with that page. A company already in the pool or on the do-not-contact list is refused.`,
  availableFor,
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    const segment = (await readSegments(context.wallet)).find((s) => s.id === String(payload?.segment ?? '').trim());
    if (!segment) return invalid(`"${payload?.segment ?? ''}" is not a segment of this house — your LEAD ENGINE briefing names each by its [id]`);
    if (['paused', 'retired'].includes(segment.state)) return invalid(`segment [${segment.id}] is ${segment.state} — nothing is found for it`);
    const companies = Array.isArray(payload?.companies) ? payload.companies : [];
    if (!companies.length || companies.length > BATCH_MAX) return invalid(`companies: 1 to ${BATCH_MAX} per filing`);
    const now = new Date().toISOString();
    const problems = [];
    const prospects = companies.flatMap((c, i) => {
      try {
        return [makeProspect({ ...c, segment, by: context.laneId, now })];
      } catch (err) {
        problems.push(`companies[${i}] (${String(c?.name ?? c?.domain ?? '?').slice(0, 40)}): ${err.message}`);
        return [];
      }
    });
    if (problems.length) return invalid(problems.join(' | '));
    return { ok: true, value: { context, segment, prospects } };
  },
  summarize: (payload) => `${Array.isArray(payload?.companies) ? payload.companies.length : 0} prospect(s) for ${payload?.segment ?? '?'}`,
  execute: async ({ context, segment, prospects }) => {
    const { added, refused } = await addProspects(context.wallet, prospects);
    const lines = [
      `${added.length} added to "${segment.name}": ${added.map((p) => `[${p.id}] ${p.name} (${MATCH_WORDS[p.match]})`).join(', ') || 'none'}.`,
      ...refused.map((r) => `Refused ${r.domain}: ${r.reason}.`),
    ];
    return { ok: true, detail: lines.join(' ') };
  },
});

const salesDropIntent = Object.freeze({
  name: 'sales/drop',
  policyTool: 'sales.drop',
  fieldsForPrompt: '{id, reason}',
  descriptionForPrompt: 'THE LEAD ENGINE. Drop a prospect from the pool, with why (not a fit, closed down, a duplicate). It stays on record as dropped.',
  availableFor,
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    const reason = String(payload?.reason ?? '').trim().slice(0, 300);
    if (reason.length < 5) return invalid('reason: why it is dropped');
    return { ok: true, value: { context, id: String(payload?.id ?? '').trim(), reason } };
  },
  summarize: (payload) => `drop prospect ${payload?.id ?? '?'}`,
  execute: async ({ context, id, reason }) => {
    const settled = await settleProspect(context.wallet, id, { type: 'dropped', reason, by: context.laneId });
    return settled.ok ? { ok: true, detail: `Prospect [${id}] dropped: ${reason}.` } : { ok: false, reason: settled.reason };
  },
});

// pure — why this address may not join the ledger: already there, or a clear no resting at that company.
const ledgerRefusal = (leads, email, domain, now) => {
  if (leads.some((l) => normalizeEmail(l.contact) === email)) return `${email} is already on the lead ledger`;
  const atDomain = leads.filter((l) => normalizeEmail(l.contact).endsWith(`@${domain}`));
  if (atDomain.some((l) => !['won', 'lost'].includes(l.status))) return `someone at ${domain} is already being worked`;
  const rested = atDomain.find((l) => l.status === 'lost' && now - Date.parse(l.updatedAt) < THREAD_REST_DAYS * DAY_MS);
  return rested ? `${domain} said no within ${THREAD_REST_DAYS} days — a clear no ends the thread (MAKOTO)` : null;
};

const salesLeadIntent = Object.freeze({
  name: 'sales/lead',
  policyTool: 'sales.lead',
  fieldsForPrompt: '{id, person: number | {name, role}, email, emailSource, note?}',
  descriptionForPrompt: 'THE LEAD ENGINE. Put a prospect onto the house\'s lead ledger as cold, yours to work: person is the number of one of its people (from 0), or {name, role} for a person or team you read together with the address after scoring; email their address as published, emailSource the https page where you read it — never a guessed address. Only from an APPROVED segment, only a weak or strong match in one of its countries, never anyone on the do-not-contact list or already on the ledger.',
  availableFor,
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    const prospect = (await readProspects(context.wallet)).find((p) => p.id === String(payload?.id ?? '').trim());
    if (!prospect || prospect.stage !== 'found') return invalid(`"${payload?.id ?? ''}" is not a prospect in the pool`);
    const segment = (await readSegments(context.wallet)).find((s) => s.id === prospect.segmentId);
    if (segment?.state !== 'approved') return invalid(`segment [${prospect.segmentId}] is not approved — the operator approves the pitch before anyone is contacted`);
    if (prospect.match < 2) return invalid(`[${prospect.id}] ${prospect.name} is no match — drop it, or rescore it as a new filing`);
    if (!prospect.country) return invalid(`[${prospect.id}] has no country — file it again with the ISO code of where the company is, from its own pages`);
    if (!segment.countries.includes(prospect.country)) return invalid(`[${prospect.id}] is in ${prospect.country}, and "${segment.name}" may only be sent to ${segment.countries.join(', ')}`);
    const email = normalizeEmail(payload?.email);
    if (!email) return invalid('email: their address as published');
    if (!/^https:\/\/\S+$/.test(String(payload?.emailSource ?? ''))) return invalid('emailSource: the https page where the address is published — an address is never guessed');
    // The person: one already filed on the prospect (its number), or one read now with the address ({name, role}).
    const fresh = payload?.person && typeof payload.person === 'object' ? { name: String(payload.person.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120), role: String(payload.person.role ?? '').replace(/\s+/g, ' ').trim().slice(0, 120), sourceUrl: String(payload.emailSource) } : null;
    if (fresh && (fresh.name.length < 2 || fresh.role.length < 2)) return invalid('person: {name, role} — who the address belongs to, as its page says (a team address: name "Venice support team", role "support")');
    const person = fresh ?? prospect.people[Number(payload?.person)];
    if (!person) return invalid(prospect.people.length ? `person: the number of one of [${prospect.id}]'s people (0 to ${prospect.people.length - 1}), or {name, role} for one you read with the address` : `person: [${prospect.id}] has no person filed yet — give {name, role}: who the address belongs to, as the page you read it on says`);
    if (suppressionMatcher(await readSuppressions(context.wallet)).email(email)) return invalid(`${email} is on the do-not-contact list`);
    const addressCountry = countryOfAddress(email);
    if (addressCountry && !segment.countries.includes(addressCountry)) return invalid(`${email} is a ${addressCountry} address, and "${segment.name}" may only be sent to ${segment.countries.join(', ')}`);
    const ledger = await leadLedgerFor(context.wallet);
    const refusal = ledgerRefusal(await ledger.load(), email, prospect.domain, Date.now());
    if (refusal) return invalid(refusal);
    return { ok: true, value: { context, ledger, prospect, segment, person, fresh: Boolean(fresh), email, emailSource: String(payload.emailSource), note: String(payload?.note ?? '').trim() } };
  },
  summarize: (payload) => `lead from prospect ${payload?.id ?? '?'}`,
  execute: async ({ context, ledger, prospect, segment, person, fresh, email, emailSource, note }) => {
    if (fresh) await addProspectPerson(context.wallet, prospect.id, person, context.laneId);
    const lead = await ledger.add({
      name: `${person.name}, ${person.role} at ${prospect.name}`,
      contact: email,
      channelId: 'email',
      kind: 'buyer', // a company scored against an audience is someone the house sells to
      source: `lead engine [${segment.id}] ${segment.name} · address: ${emailSource}`,
      status: 'cold',
      ownerNeumaId: context.laneId,
      addedBy: context.laneId,
      note: [`[${prospect.id}] ${MATCH_WORDS[prospect.match]} match`, note].filter(Boolean).join(' — '),
    });
    const settled = await settleProspect(context.wallet, prospect.id, { type: 'promoted', leadId: lead.id, by: context.laneId });
    if (!settled.ok) return { ok: false, reason: settled.reason };
    return { ok: true, detail: `Lead [${lead.id.slice(0, 8)}] ${lead.name} is on the ledger, cold, yours. Write with email/send — the mailbox records each email on the lead itself.` };
  },
});

const salesSuppressIntent = Object.freeze({
  name: 'sales/suppress',
  policyTool: 'sales.suppress',
  fieldsForPrompt: `{target, reason, note?}`,
  descriptionForPrompt: 'THE LEAD ENGINE. Never write to this person (an email address) or company (its domain) again — reason asked, unsubscribed, bounced, customer, competitor or other. Do it the moment someone asks to be left alone.',
  availableFor,
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    try {
      return { ok: true, value: { context, entry: makeSuppression({ ...payload, by: context.laneId, now: new Date().toISOString() }) } };
    } catch (err) {
      return invalid(err.message);
    }
  },
  summarize: (payload) => `do not contact ${String(payload?.target ?? '?').slice(0, 80)}`,
  execute: async ({ context, entry }) => {
    const { already } = await addSuppression(context.wallet, entry);
    return { ok: true, detail: already ? `${entry.value} was already on the do-not-contact list.` : `${entry.value} is on the do-not-contact list (${entry.reason}).` };
  },
});

const salesFactsIntent = Object.freeze({
  name: 'sales/facts',
  policyTool: 'sales.facts',
  fieldsForPrompt: '{facts: [{company, claim, figure?: {value, unit}, source}]}',
  descriptionForPrompt: `THE LEAD ENGINE. File the facts a buyer may be told, each under the company it is true of (company: its id; one sheet holds every company's facts, and an email is checked only against its own company's), from its own site and records: each claim true today, a figure only where there is one, and its source (an https page, a repos/ path, or "customer: who, when"). It replaces the last sheet and waits for the operator's approval. No email reaches a lead before a sheet is approved; every number in one must stand on it, and it carries this line above your name: "${SALES_DISCLOSURE}"`,
  availableFor,
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    try {
      const sheet = makeSalesSheet({ facts: payload?.facts, by: context.laneId, now: new Date().toISOString() });
      const stranger = await companyRefusal(context.wallet, sheet.facts.map((f) => f.company));
      return stranger ? invalid(stranger) : { ok: true, value: { context, sheet } };
    } catch (err) {
      return invalid(err.message);
    }
  },
  summarize: (payload) => `facts sheet (${Array.isArray(payload?.facts) ? payload.facts.length : 0} facts)`,
  execute: async ({ context, sheet }) => {
    await fileSalesFacts(context.wallet, sheet);
    return { ok: true, detail: `Facts sheet [${sheet.id}] with ${sheet.facts.length} facts is filed; it waits for the operator's approval.` };
  },
});

export const salesIntents = Object.freeze([salesSegmentIntent, salesProspectIntent, salesDropIntent, salesLeadIntent, salesSuppressIntent, salesFactsIntent, ...salesGatherIntents, ...campaignManageIntents, companyModelIntent, ...salesInboundIntents]);
