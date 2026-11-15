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
import { resolveUsableCredential } from '../oauth-token-broker.js';
import { LEAD_SOURCES, GATHER_MAX, candidateLine } from '../sales/lead-sources.js';
import { readSegments, readProspects, readCandidates, addCandidates, noteContacts } from '../sales/sales-store.js';

const officerRefusal = { ok: false, status: 'denied', reason: 'the lead engine is the Mercator office\'s — only the seated Mercator files to it (house/post reaches them; the operator seats the office)' };
const offRefusal = { ok: false, status: 'denied', reason: 'the LEAD SOURCES connection is off — the operator turns it on in POSITIONS, SALES, SWITCHES; until then find companies by reading the web yourself' };
const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const seated = async (connection) => (await officeContext(connection).catch(() => null)) || null;
const availableFor = async ({ connection }) => ((await seated(connection)) && isConnectionOn('lead-sources') ? {} : null);
const COMPANY_SOURCES = Object.entries(LEAD_SOURCES).filter(([, s]) => s.kind === 'companies');
const PEOPLE_SOURCES = Object.entries(LEAD_SOURCES).filter(([, s]) => s.kind === 'people');

// impure — the first people source whose key the operator attached, or null.
const attachedPeopleSource = async () => {
  for (const [id, source] of PEOPLE_SOURCES) {
    const credential = await resolveUsableCredential(source.key).catch(() => null);
    if (credential?.apiKey) return { id, source, apiKey: credential.apiKey };
  }
  return null;
};

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
  fieldsForPrompt: '{domain}',
  descriptionForPrompt: 'THE LEAD ENGINE. The people at one company you gathered or pooled, with each address and the page it was found on, from the contact-data provider your operator attached. Use a returned address in sales/lead with that page as emailSource. With no provider attached, read the address on the company\'s own pages.',
  availableFor,
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    if (!isConnectionOn('lead-sources')) return offRefusal;
    const domain = String(payload?.domain ?? '').trim().toLowerCase();
    const [candidates, prospects] = await Promise.all([readCandidates(context.wallet), readProspects(context.wallet)]);
    if (!candidates.some((c) => c.domain === domain) && !prospects.some((p) => p.domain === domain)) return invalid(`"${domain}" is not a company you gathered or pooled — contacts are looked up only for the house's own candidates`);
    const attached = await attachedPeopleSource();
    if (!attached) return { ok: false, status: 'denied', reason: `no contact-data provider is attached — the operator adds a key (${PEOPLE_SOURCES.map(([, s]) => s.label).join('; ')}) in SETTINGS, API, Service keys; until then read the address on the company's own pages` };
    return { ok: true, value: { context, domain, attached } };
  },
  summarize: (payload) => `contacts at ${payload?.domain ?? '?'}`,
  execute: async ({ context, domain, attached }, { signal } = {}) => {
    const found = await attached.source.contacts({ domain, apiKey: attached.apiKey, signal });
    if (!found.ok) return { ok: false, reason: `The contacts could not be read from ${attached.id}: ${found.detail}.` };
    await noteContacts(context.wallet, domain, attached.id, found.people, context.laneId);
    if (!found.people.length) return { ok: true, detail: `${attached.id} holds nobody at ${domain} with a role and a page for their address. Read the company's own pages.` };
    return { ok: true, detail: [`People at ${domain} (${attached.id}):`, ...found.people.map((p, i) => `- ${i}. ${p.name}, ${p.role} — ${p.email} — found on ${p.sourceUrl}`), 'File the ones you will write to under people in sales/prospect, then sales/lead with the address and its page as emailSource.'].join('\n') };
  },
});

export const salesGatherIntents = Object.freeze([salesGatherIntent, salesContactsIntent]);
