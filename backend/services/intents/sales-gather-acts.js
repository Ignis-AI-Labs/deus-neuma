/**
 * sales/gather and sales/contacts — the lead engine's bulk hands (Founder,
 * 2026-11-15: […]), the Mercator's alone:
 *   sales/gather    pull companies for an audience from a lead source
 *                   (sales/lead-sources.js) into the candidate pool. A
 *                   candidate is not a prospect: the seat still scores it.
 *   sales/contacts  the people and published addresses at one gathered
 *                   company, from the contact-data provider the operator
 *                   attached with their own key. No key: the seat is told to
 *                   read the company's own pages, as before.
 *
 * Both leave the machine (a public list, or the provider), so both stand
 * behind the `lead-sources` connection switch: off until the operator turns it
 * on. Tier `allowed` once on: a read of public lists into the house's own
 * office; the operator's key never reaches the being.
 */
import { officeContext } from './revenue-acts.js';
import { isConnectionOn } from '../connections/connection-switches.js';
import { LEAD_SOURCES, GATHER_MAX, candidateLine } from '../sales/lead-sources.js';
import { readSegments, readProspects, readCandidates, addCandidates, noteContacts, readContactLookups } from '../sales/sales-store.js';
import { readSpend, spentThisMonth, spendRefusal, attachedProviders } from '../sales/lead-spend.js';

const officerRefusal = { ok: false, status: 'denied', reason: 'the lead engine is the Mercator office\'s — only the seated Mercator files to it (house/post reaches them; the operator seats the office)' };
const offRefusal = { ok: false, status: 'denied', reason: 'the LEAD SOURCES connection is off — the operator turns it on in POSITIONS, CHIEF REVENUE OFFICER, SETTINGS; until then find companies by reading the web yourself' };
const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const seated = async (connection) => (await officeContext(connection).catch(() => null)) || null;
const availableFor = async ({ connection }) => ((await seated(connection)) && isConnectionOn('lead-sources') ? {} : null);
const COMPANY_SOURCES = Object.entries(LEAD_SOURCES).filter(([, s]) => s.kind === 'companies');
const PEOPLE_SOURCES = Object.entries(LEAD_SOURCES).filter(([, s]) => s.kind === 'people');

const salesGatherIntent = Object.freeze({
  name: 'sales/gather',
  policyTool: 'sales.gather',
  fieldsForPrompt: `{segment, source: ${COMPANY_SOURCES.map(([id]) => `"${id}"`).join(' | ')}, count?}`,
  descriptionForPrompt: `THE LEAD ENGINE. Gather companies for an audience in bulk from a public list (count: 1 to ${GATHER_MAX}, new ones only): ${COMPANY_SOURCES.map(([id, s]) => `${id} = ${s.label}`).join('; ')}. They land as CANDIDATES in your briefing with what the list says about each. Score the ones that fit with sales/prospect; a candidate is nobody's lead until you have.`,
  availableFor,
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    if (!isConnectionOn('lead-sources')) return offRefusal;
    const source = COMPANY_SOURCES.find(([id]) => id === String(payload?.source ?? ''));
    if (!source) return invalid(`source is one of: ${COMPANY_SOURCES.map(([id, s]) => `${id} (${s.label})`).join('; ')}`);
    const segment = (await readSegments(context.wallet)).find((s) => s.id === String(payload?.segment ?? '').trim());
    if (!segment || segment.state === 'retired') return invalid(`"${payload?.segment ?? ''}" is not one of your audiences — file it with sales/segment first`);
    return { ok: true, value: { context, segment, sourceId: source[0], count: payload?.count } };
  },
  summarize: (payload) => `gather companies from ${payload?.source ?? '?'} for audience ${payload?.segment ?? '?'}`,
  execute: async ({ context, segment, sourceId, count }, { signal } = {}) => {
    const [candidates, prospects] = await Promise.all([readCandidates(context.wallet), readProspects(context.wallet)]);
    const known = { domains: new Set([...candidates.map((c) => c.domain), ...prospects.map((p) => p.domain)]), tokens: new Set(candidates.map((c) => c.token).filter(Boolean)) };
    const found = await LEAD_SOURCES[sourceId].gather({ count, known, signal });
    const added = await addCandidates(context.wallet, segment.id, found.candidates, context.laneId);
    if (!added.length) return { ok: false, reason: `Nothing new was gathered from ${sourceId}${found.stopped ? `: ${found.stopped}` : ' — the house already holds every company it returned'}.` };
    return { ok: true, detail: [`${added.length} new candidate(s) for "${segment.name}" from ${sourceId}${found.stopped ? ` (it stopped early: ${found.stopped})` : ''}:`, ...added.map((c) => `- [${c.id}] ${candidateLine(c)}`), 'Read the ones that could fit, then score them with sales/prospect (source: the candidate\'s own page).'].join('\n') };
  },
});

const salesContactsIntent = Object.freeze({
  name: 'sales/contacts',
  policyTool: 'sales.contacts',
  fieldsForPrompt: `{domain, source?: ${PEOPLE_SOURCES.map(([id]) => `"${id}"`).join(' | ')}}`,
  descriptionForPrompt: `THE LEAD ENGINE. The people at one company you gathered or pooled, each with their address and where it comes from, from a contact-data provider your operator attached (${PEOPLE_SOURCES.map(([id, s]) => `${id} = ${s.label}`).join('; ')}). IT SPENDS YOUR OPERATOR'S CREDITS, so it runs only while your briefing's PAID LEAD DATA line says ON, and within the month's limit. Use what is free first. source: which attached provider to ask (left out: the cheapest attached; when one holds nobody, try the next). Use a returned address in sales/lead with its page as emailSource. With no provider attached, read the address on the company's own pages.`,
  availableFor,
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    if (!isConnectionOn('lead-sources')) return offRefusal;
    const domain = String(payload?.domain ?? '').trim().toLowerCase();
    const [candidates, prospects] = await Promise.all([readCandidates(context.wallet), readProspects(context.wallet)]);
    const scored = prospects.some((p) => p.domain === domain);
    if (!candidates.some((c) => c.domain === domain) && !scored) return invalid(`"${domain}" is not a company you gathered or pooled — contacts are looked up only for the house's own candidates`);
    const all = await attachedProviders();
    if (!all.length) return { ok: false, status: 'denied', reason: `no contact-data provider is attached — the operator adds a key (${PEOPLE_SOURCES.map(([, s]) => s.label).join('; ')}) in SETTINGS, API, Service keys; until then read the address on the company's own pages` };
    const named = String(payload?.source ?? '').trim();
    const attached = named ? all.find((a) => a.id === named) : all[0];
    if (!attached) return invalid(`source: one of the providers your operator attached (${all.map((a) => a.id).join(', ')})`);
    // Money: nothing paid runs until the operator has said when it may, and never past the month's cap.
    const [rule, lookups] = await Promise.all([readSpend(context.wallet), readContactLookups(context.wallet)]);
    const refusal = spendRefusal({ rule, spent: spentThisMonth(lookups, Date.now()), cost: attached.source.cost });
    if (refusal) return { ok: false, status: 'denied', reason: refusal };
    return { ok: true, value: { context, domain, attached } };
  },
  summarize: (payload) => `contacts at ${payload?.domain ?? '?'}${payload?.source ? ` from ${payload.source}` : ''}`,
  execute: async ({ context, domain, attached }, { signal } = {}) => {
    const found = await attached.source.contacts({ domain, apiKey: attached.apiKey, signal });
    if (!found.ok) return { ok: false, reason: `The contacts could not be read from ${attached.id}: ${found.detail}.` };
    await noteContacts(context.wallet, domain, attached.id, found.people, context.laneId, found.spent);
    if (!found.people.length) return { ok: true, detail: `${attached.id} holds nobody at ${domain} with a role and an address it can stand behind (${found.spent} credit(s) spent). Read the company's own pages, or ask another attached provider with source.` };
    return { ok: true, detail: [`People at ${domain} (${attached.id}, ${found.spent} credit(s) spent):`, ...found.people.map((p, i) => `- ${i}. ${p.name}, ${p.role} — ${p.email} — ${p.basis === 'verified' ? `verified by ${attached.id}; their profile: ${p.sourceUrl}` : `found on ${p.sourceUrl}`}`), 'File the ones you will write to under people in sales/prospect, then sales/lead with the address and the page above as emailSource.'].join('\n') };
  },
});

export const salesGatherIntents = Object.freeze([salesGatherIntent, salesContactsIntent]);
