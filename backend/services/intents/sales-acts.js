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
 *                   with a real address read on a real page — never a guessed one; or a lead
 *                   already there moved to another person at its company (its address dead,
 *                   or the top one silent and the next one up named)
 *   sales/suppress  a person or company the house never writes to again
 *   sales/place     a lead already on the ledger put under an audience (sales-place-acts.js)
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
import { readSegments, fileSegment, readProspects, addProspects, settleProspect, readSuppressions, addSuppression, fileSalesFacts, readCampaigns, addProspectPerson, readCandidates } from '../sales/sales-store.js';
import { readResearch, noteEntity } from '../sales/research-store.js';
import { neverRefusal } from '../sales/never-countries.js';
import { readNeverList } from '../legal/never-list.js';
import { makeEntity, verifyQuote, isInvestor, isFundingCampaign, entityRefusal } from '../sales/company-entity.js';
import { evidenceEgressRefusal } from '../sales/evidence-egress.js';
import { makeSalesSheet } from '../sales/sales-facts.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { withdrawDrafts } from '../sales/email-outbox.js';
import { domainOfAddress } from '../sales/top-first.js';
import { bouncedLead } from '../sales/lead-upkeep.js';
import { atCompany } from '../sales/sales-cover.js';
import { listCompanies } from '../marketing/companies.js';
import { salesGatherIntents } from './sales-gather-acts.js';
import { salesPoolIntents } from './sales-pool-acts.js';
import { salesHunterIntents } from './sales-hunter-acts.js';
import { salesEmailIntents } from './sales-email-acts.js';
import { salesOutboxIntents } from './sales-outbox-acts.js';
import { campaignManageIntents } from './campaign-manage-acts.js';
import { companyModelIntent } from './company-model-act.js';
import { salesInboundIntents } from './sales-inbound-acts.js';
import { salesPlaceIntents } from './sales-place-acts.js';
import { salesProveIntents } from './sales-prove-acts.js';
import { salesCallIntents } from './sales-call-acts.js';
import { salesRunIntents } from './sales-run-acts.js';
import { requiredRefusal, requiredWords } from '../sales/required-signs.js';
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
  fieldsForPrompt: '{id?, name, company, campaign?, offer, customerProblem, targetRole, targetGeography, countries: ["US", ..], targetCompanySize?, positiveCriteria: [..], negativeCriteria?: [..], exampleClients?: [..], required?: [{sign, evidence: [..], otherwise?}], why}',
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
      // A required sign may send a company that fails it to another audience of this house: that audience must exist.
      const others = await readSegments(context.wallet);
      const lost = segment.required.filter((r) => r.otherwise && (r.otherwise === segment.id || !others.some((o) => o.id === r.otherwise)));
      if (lost.length) return invalid(`required: otherwise "${lost[0].otherwise}" is not another audience of this house — name one by its [id], or leave it out`);
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
    const must = requiredWords(segment, await readSegments(context.wallet));
    return { ok: true, detail: `Segment [${segment.id}] "${segment.name}" is ${filed.segment.state.toUpperCase()}${waits}.${must.length ? ` It REQUIRES — ${must.join(' · ')}. Every company scored for it carries a proof for each, and companies already in its pool are proved with sales/prove before anything more is done with them.` : ''}` };
  },
});

const salesProspectIntent = Object.freeze({
  name: 'sales/prospect',
  policyTool: 'sales.prospect',
  fieldsForPrompt: '{segment, companies: [{domain, name, description?, country (ISO code, e.g. "US"), size?, scores: [{criterion, score, reasoning}], people?: [{name, role, sourceUrl, email?}], source, proofs?: [{sign, met, quote?, source?, reasoning?}], entityType?, entityEvidence?: {quote, source}}]}',
  descriptionForPrompt: `THE LEAD ENGINE. File companies you found for a segment (up to ${BATCH_MAX} at a time). Read each company's own pages first. Score EVERY sign of fit the segment lists 0–5, and any sign of non-fit that applies, each with the reason you read; source is the https page where you found the company; people are the ones you read on its own pages, with that page. A company already in the pool or on the do-not-contact list is refused. An audience that serves a FUNDING campaign also needs what each company IS, from its own site, never its name: entityType and entityEvidence {quote, source} (as in sales/entity), unless it is on record already — anything but an investor is filed as NO FIT there, its research kept for other campaigns.`,
  availableFor,
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    const egress = evidenceEgressRefusal(payload);
    if (egress) return { ok: false, status: 'denied', reason: egress };
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
    // THE PIPELINE: a company gathered from a list is scored only once its own site was read and found alive
    // (lead-pipeline.js) — research reads a real, live company. One found by hand is scored on its own page.
    const gathered = new Map((await readCandidates(context.wallet)).filter((c) => c.segmentId === segment.id).map((c) => [c.domain, c]));
    const unverified = prospects.filter((p) => { const c = gathered.get(p.domain); return c && !c.siteRead?.alive; });
    if (unverified.length) return invalid(`THE PIPELINE: verify before you research — ${unverified.map((p) => { const c = gathered.get(p.domain); return `${p.domain} (${c.siteRead ? 'its site is dead: it is out of the pipeline' : 'its site was never read'})`; }).join(', ')}. Read the sites with sales/read-sites, then score the live ones.`);
    const funding = isFundingCampaign((await readCampaigns(context.wallet)).find((c) => c.id === segment.campaign));
    const entities = [];
    const known = funding ? (await readResearch(context.wallet)).entities : new Map();
    if (funding) {
      const owed = [];
      for (const [i, c] of companies.entries()) {
        const p = prospects[i];
        if (c?.entityType === undefined && c?.entityEvidence === undefined) {
          if (!known.get(p.domain)) owed.push(`companies[${i}] (${p.name}): this audience serves a FUNDING campaign — say what the company IS from its own site: entityType and entityEvidence {quote, source} (its name is not evidence)`);
          continue;
        }
        try {
          entities.push(makeEntity({ domain: p.domain, name: p.name, entityType: c.entityType, quote: c.entityEvidence?.quote, source: c.entityEvidence?.source }));
        } catch (err) { owed.push(`companies[${i}] (${p.name}): ${err.message}`); }
      }
      if (owed.length) return invalid(owed.join(' | '));
    }
    return { ok: true, value: { context, segment, prospects, entities, known, funding } };
  },
  summarize: (payload) => `${Array.isArray(payload?.companies) ? payload.companies.length : 0} prospect(s) for ${payload?.segment ?? '?'}`,
  execute: async ({ context, segment, prospects, entities = [], known, funding }, { signal } = {}) => {
    const problems = [];
    for (const p of prospects) {
      for (const proof of (p.proofs ?? []).filter((x) => x.met)) {
        const checked = await verifyQuote(proof, { signal });
        if (!checked.ok) problems.push(`${p.name}: REQUIRED "${proof.sign}": ${checked.why}`);
      }
    }
    const verifiedEntities = [];
    for (const entity of entities) {
      const checked = await verifyQuote(entity, { signal });
      if (checked.ok) verifiedEntities.push({ ...entity, verified: checked.verified, why: checked.why });
      else problems.push(`${entity.domain}: ${checked.why}`);
    }
    if (problems.length) return { ok: false, reason: problems.join(' | ') };
    const entityOf = (domain) => verifiedEntities.find((e) => e.domain === domain) ?? known.get(domain);
    const judged = funding ? prospects.map((p) => (isInvestor(entityOf(p.domain)) ? p : { ...p, match: 1, notInvestor: entityOf(p.domain).entityType })) : prospects;
    for (const e of verifiedEntities) await noteEntity(context.wallet, e, context.laneId);
    const { added, refused } = await addProspects(context.wallet, judged);
    const lines = [
      `${added.length} added to "${segment.name}": ${added.map((p) => `[${p.id}] ${p.name} (${p.failedRequired ? `NO FIT — it does not meet what this audience requires: ${p.failedRequired.join('; ')}${p.belongsTo ? `; it belongs to [${p.belongsTo}]: score it there` : ''}` : p.notInvestor ? `NO FIT — not an investor: ${p.notInvestor}; its research stays for a customer campaign` : MATCH_WORDS[p.match]})`).join(', ') || 'none'}.`,
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

// impure — a lead already on the ledger moved to another person at its company: the address found dead, or the top
// one silent and the next one up named (Design note, 2026-11-17. Same company only; the new address is checked as any is.
const movedLead = async (context, payload) => {
  const ledger = await leadLedgerFor(context.wallet);
  const leads = await ledger.load();
  const key = String(payload.lead).trim();
  const hits = leads.filter((l) => l.id === key || (key.length >= 8 && l.id.startsWith(key)));
  if (hits.length !== 1) return invalid(hits.length ? `"${key}" names ${hits.length} leads — give more of the id` : `"${key}" is not a lead on the ledger — sales/pipeline {step: "outreach", segment} lists each lead by its id`);
  const [lead] = hits;
  // A lead whose address BOUNCED was closed by the bounce, not by its person: it moves to the right address (lead-upkeep.js).
  if (!['cold', 'contacted'].includes(lead.status) && !bouncedLead(lead)) return invalid(`[${lead.id.slice(0, 8)}] is ${lead.status} — a lead that replied, or was closed, stays with its person`);
  const email = normalizeEmail(payload?.email);
  if (!email) return invalid('email: the new person\'s address as published');
  if (!/^https:\/\/\S+$/.test(String(payload?.emailSource ?? ''))) return invalid('emailSource: the https page where the address is published — an address is never guessed');
  const person = { name: String(payload?.person?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120), role: String(payload?.person?.role ?? '').replace(/\s+/g, ' ').trim().slice(0, 120), sourceUrl: String(payload.emailSource) };
  if (person.name.length < 2 || person.role.length < 2) return invalid('person: {name, role} — who the new address belongs to, as its page says');
  const prospect = (await readProspects(context.wallet)).find((p) => p.leadId === lead.id) ?? null;
  const domain = prospect?.domain ?? domainOfAddress(lead.contact);
  if (domainOfAddress(email) !== domain) return invalid(`${email} is not at ${domain} — a lead moves to another person at the SAME company; someone elsewhere is a new lead (sales/lead {id})`);
  if (normalizeEmail(lead.contact) === email) return invalid(`[${lead.id.slice(0, 8)}] already points at ${email}`);
  if (leads.some((l) => l !== lead && normalizeEmail(l.contact) === email)) return invalid(`${email} is already on the lead ledger`);
  if (suppressionMatcher(await readSuppressions(context.wallet)).email(email)) return invalid(`${email} is on the do-not-contact list`);
  const segment = prospect ? (await readSegments(context.wallet)).find((s) => s.id === prospect.segmentId) : null;
  const addressCountry = countryOfAddress(email);
  if (segment && addressCountry && !segment.countries.includes(addressCountry)) return invalid(`${email} is a ${addressCountry} address, and "${segment.name}" may only be sent to ${segment.countries.join(', ')}`);
  return { ok: true, value: { context, ledger, moving: { lead, prospect, person, email, note: String(payload?.note ?? '').trim() } } };
};

// impure — move the lead: its person and address change on one touch that keeps the old address; it is cold again,
// and an email staged to the old address is withdrawn (it was written to someone else).
const moveLead = async ({ context, ledger, moving: { lead, prospect, person, email, note } }) => {
  const from = lead.contact;
  const company = prospect?.name ?? domainOfAddress(from);
  if (prospect) await addProspectPerson(context.wallet, prospect.id, person, context.laneId);
  const moved = await ledger.touch(lead.id, { name: `${person.name}, ${person.role} at ${company}`, contact: email, status: 'cold', by: context.laneId, note: [`moved from ${from} to ${email} (found on ${person.sourceUrl})`, note].filter(Boolean).join(' — ') });
  if (!moved.ok) return { ok: false, reason: moved.error };
  const old = normalizeEmail(from);
  const back = await withdrawDrafts(context.wallet, { to: (a) => a === old, why: `the lead moved to ${email}`, by: context.laneId }).catch(() => ({ ids: [] }));
  return { ok: true, detail: `Lead [${lead.id.slice(0, 8)}] now points at ${person.name}, ${person.role} — ${email}; cold again, the first email to them still to write.${back.ids?.length ? ` The email staged to ${from} [${back.ids.join(', ')}] is withdrawn — stage the new one to ${email} with sales/draft-email.` : ''}` };
};

const salesLeadIntent = Object.freeze({
  name: 'sales/lead',
  policyTool: 'sales.lead',
  fieldsForPrompt: '{id, person: number | {name, role}, email, emailSource, note?} — or {lead, person: {name, role}, email, emailSource, note?}',
  descriptionForPrompt: 'THE LEAD ENGINE. Put a prospect onto the house\'s lead ledger as cold, yours to work: person is the number of one of its people (from 0), or {name, role} for a person or team you read together with the address after scoring; email their address as published, emailSource the https page where you read it — never a guessed address. Only from an APPROVED segment, only a weak or strong match, never in a country outside the audience\'s (one whose country is not known yet is filed and held from email until it is), never anyone on the do-not-contact list or already on the ledger. WITH lead (its id, or the first 8 characters) instead of id: MOVE a lead already on the ledger to another person at the same company — its address found dead, or the top one silent and the next one up named by the upkeep. The lead keeps its history and is cold again for the new person; an email staged to the old address is withdrawn — stage the new one to the new address.',
  availableFor,
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    if (payload?.lead) return movedLead(context, payload);
    const prospect = (await readProspects(context.wallet)).find((p) => p.id === String(payload?.id ?? '').trim());
    if (!prospect || prospect.stage !== 'found') return invalid(`"${payload?.id ?? ''}" is not a prospect in the pool`);
    const segment = (await readSegments(context.wallet)).find((s) => s.id === prospect.segmentId);
    if (segment?.state !== 'approved') return invalid(`segment [${prospect.segmentId}] is not approved — the operator approves the pitch before anyone is contacted`);
    if (prospect.match < 2) return invalid(`[${prospect.id}] ${prospect.name} is no match — drop it, or rescore it as a new filing`);
    // What the audience REQUIRES is proved met before anyone at the company is put on the ledger (required-signs.js).
    const unmet = requiredRefusal(segment, prospect, await readSegments(context.wallet));
    if (unmet) return invalid(unmet);
    // A funding campaign writes only to investors (company-entity.js): a company scored before that rule says what it is first.
    if (isFundingCampaign((await readCampaigns(context.wallet)).find((c) => c.id === segment.campaign))) {
      const notYet = entityRefusal((await readResearch(context.wallet)).entities.get(prospect.domain), prospect.domain);
      if (notYet) return invalid(notYet);
    }
    // A FIT WITH NO COUNTRY IS STILL A LEAD (Design note, 2026-11-21: it is filed with its country open, and the screen before
    // a first email (lead-screen.js) holds it until the country stands. A country that IS known must be one of the audience's.
    if (prospect.country && !segment.countries.includes(prospect.country)) return invalid(`[${prospect.id}] is in ${prospect.country}, and "${segment.name}" may only be sent to ${segment.countries.join(', ')}`);
    const email = normalizeEmail(payload?.email);
    if (!email) return invalid('email: their address as published');
    if (!/^https:\/\/\S+$/.test(String(payload?.emailSource ?? ''))) return invalid('emailSource: the https page where the address is published — an address is never guessed');
    // The person: one already filed on the prospect (its number), or one read now with the address ({name, role}).
    const fresh = payload?.person && typeof payload.person === 'object' ? { name: String(payload.person.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120), role: String(payload.person.role ?? '').replace(/\s+/g, ' ').trim().slice(0, 120), sourceUrl: String(payload.emailSource) } : null;
    if (fresh && (fresh.name.length < 2 || fresh.role.length < 2)) return invalid('person: {name, role} — who the address belongs to, as its page says (a team address: name "Venice support team", role "support")');
    const person = fresh ?? prospect.people[Number(payload?.person)];
    if (!person) return invalid(prospect.people.length ? `person: the number of one of [${prospect.id}]'s people (0 to ${prospect.people.length - 1}), or {name, role} for one you read with the address` : `person: [${prospect.id}] has no person filed yet — give {name, role}: who the address belongs to, as the page you read it on says`);
    if (suppressionMatcher(await readSuppressions(context.wallet)).email(email)) return invalid(`${email} is on the do-not-contact list`);
    // THE NEVER-LIST (legal/never-list.js): nobody is filed as a lead at a company, or at an address, in a place the house never writes to.
    const never = neverRefusal({ prospect, email }, (await readNeverList(context.wallet)).codes);
    if (never) return invalid(never);
    const addressCountry = countryOfAddress(email);
    if (addressCountry && !segment.countries.includes(addressCountry)) return invalid(`${email} is a ${addressCountry} address, and "${segment.name}" may only be sent to ${segment.countries.join(', ')}`);
    // The operator approves COMPANIES. A small business often publishes a mailbox elsewhere (a Gmail address), so such a
    // lead is filed — but no approved list ever covers it (sales-cover.js): every email to it asks the operator (audit P6-123).
    const elsewhere = !atCompany(email, prospect.domain);
    // EVERY LEAD IS VALIDATED BY THE PIPELINE (Design note, 2026-11-21: a company becomes a lead only once the house's screening confirmed it from its own page.
    if (!prospect.listApproved) return invalid(`[${prospect.id}] ${prospect.name} has not been VALIDATED yet — a company becomes a lead only once the house's screening has confirmed it from its own page. Start a lead run for this audience: sales/run {segment: "${prospect.segmentId}"} — it validates every fit waiting, finds the person, confirms the address and files the lead itself`);
    const ledger = await leadLedgerFor(context.wallet);
    const refusal = ledgerRefusal(await ledger.load(), email, prospect.domain, Date.now());
    if (refusal) return invalid(refusal);
    return { ok: true, value: { context, ledger, prospect, segment, person, fresh: Boolean(fresh), email, elsewhere, emailSource: String(payload.emailSource), note: String(payload?.note ?? '').trim() } };
  },
  summarize: (payload) => (payload?.lead ? `move lead ${payload.lead} to ${payload?.email ?? '?'}` : `lead from prospect ${payload?.id ?? '?'}`),
  execute: async (value) => {
    if (value.moving) return moveLead(value);
    const { context, ledger, prospect, segment, person, fresh, email, elsewhere, emailSource, note } = value;
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
      note: [`[${prospect.id}] ${MATCH_WORDS[prospect.match]} match`, !prospect.country && 'country not on its pages: nothing places it on the never-list', elsewhere && `address is not at ${prospect.domain}: every email to it asks the operator`, note].filter(Boolean).join(' — '),
    });
    const settled = await settleProspect(context.wallet, prospect.id, { type: 'promoted', leadId: lead.id, by: context.laneId });
    if (!settled.ok) return { ok: false, reason: settled.reason };
    return { ok: true, detail: `Lead [${lead.id.slice(0, 8)}] ${lead.name} is on the ledger, cold, yours. ${prospect.country ? 'Write with email/send — the mailbox records each email on the lead itself.' : `Its country is not on its pages, and nothing places it anywhere the house never writes to: write as for any lead. If you learn where ${prospect.name} is, file it (sales/country {id: "${prospect.id}", country, source}).`}${elsewhere ? ` ${email} is not at ${prospect.domain}, so no approved list covers it: every email to it waits for your operator's yes.` : ''}` };
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
    // What waits in the outbox for them goes nowhere: it is withdrawn now, not left for the operator to return.
    const hit = suppressionMatcher([entry]);
    const back = await withdrawDrafts(context.wallet, { to: (a) => hit.email(a), why: `${entry.value} is on the do-not-contact list`, by: context.laneId }).catch(() => ({ ids: [] }));
    const withdrawn = back.ids?.length ? ` The ${back.ids.length === 1 ? 'email' : `${back.ids.length} emails`} staged for them [${back.ids.join(', ')}] withdrawn.` : '';
    return { ok: true, detail: `${already ? `${entry.value} was already on the do-not-contact list.` : `${entry.value} is on the do-not-contact list (${entry.reason}).`}${withdrawn}` };
  },
});

const salesFactsIntent = Object.freeze({
  name: 'sales/facts',
  policyTool: 'sales.facts',
  fieldsForPrompt: '{facts: [{company, claim, figure?: {value, unit}, source}]}',
  descriptionForPrompt: `THE LEAD ENGINE. File the facts a buyer may be told, each under the company it is true of (company: its id; one sheet holds every company's facts, and an email is checked only against its own company's), from its own site and records: each claim true today, a figure only where there is one, and its source (an https page, a repos/ path, or "customer: who, when"). It replaces the last sheet and waits for the operator's approval. No email reaches a lead before a sheet is approved; every number in one must stand on it.`,
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

export const salesIntents = Object.freeze([...salesRunIntents, ...salesProveIntents, ...salesCallIntents, salesSegmentIntent, salesProspectIntent, salesDropIntent, salesLeadIntent, salesSuppressIntent, salesFactsIntent, ...salesGatherIntents, ...salesPoolIntents, ...salesHunterIntents, ...salesEmailIntents, ...salesOutboxIntents, ...campaignManageIntents, companyModelIntent, ...salesInboundIntents, ...salesPlaceIntents]);
