/**
 * sales/gather and sales/contacts — the lead engine's bulk hands (Founder,
 * 2026-11-15: […]), the Mercator's alone:
 *   sales/gather    pull companies for an audience from a lead source
 *                   (sales/lead-sources.js) into the candidate pool. A
 *                   candidate is not a prospect: the seat still scores it.
 *   sales/read-sites  each gathered company's own site, read in bulk: alive
 *                   or not, what it says it is, its published addresses.
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
import { LEAD_SOURCES, GATHER_MAX, INDEX_GATHER_MAX, candidateLine } from '../sales/lead-sources.js';
import { DISCOVER_MAX } from '../sales/hunter-discover.js';
import { readAudienceSites } from '../sales/site-reads.js';
import { READ_MAX, siteLine } from '../sales/company-reader.js';
import { SIZES, trafficOf, trafficLoaded, trafficWords } from '../sales/company-index.js';
import { readSegments, readProspects, readCandidates, addCandidates, noteContacts, readContactLookups } from '../sales/sales-store.js';
import { readSpend, spentThisMonth, spendRefusal, attachedProviders } from '../sales/lead-spend.js';

const SHOWN_GATHERED = 40;
// A gather is paced by the list it reads and can run for minutes (Design note, 2026-11-16: […]). Each step it reports becomes the act's own line in the chat, in place of a bare […].
const saying = (emit, policyTool, doing) => (words) => {
  try { emit?.({ tool: `intents/${policyTool}`, status: 'running', summary: `${doing} — ${words}` }); } catch { /* a closed stream must not end the work */ }
};
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
  fieldsForPrompt: `{segment, source: ${COMPANY_SOURCES.map(([id]) => `"${id}"`).join(' | ')}, count?, words?, industries?: [name], sizes?: [${SIZES.map((s) => `"${s}"`).join(' | ')}], foundedFrom?: year, live?: boolean}`,
  descriptionForPrompt: `THE LEAD ENGINE. Gather companies for an audience in bulk from a public list (count: 1 to ${GATHER_MAX}, new ones only): ${COMPANY_SOURCES.map(([id, s]) => `${id} = ${s.label}`).join('; ')}. hunter-discover is free with your operator's Hunter key: give words as one plain sentence saying what kind of company you want (Hunter turns it into a search) and optionally sizes; it returns up to ${DISCOVER_MAX} a call in the audience's countries, each with HOW MANY named people Hunter holds there, so you know where a paid lookup would find somebody before you spend one. company-index is the big one: it takes a SEARCH (words: matched in a company's name, industry and city; industries: exact names, a wrong one is answered with the right ones; sizes; foundedFrom; live: true keeps only companies whose site is among the million most visited, which drops dead ones) and returns up to ${INDEX_GATHER_MAX} a call, most visited first, in the audience's own countries. Gather wide there, then read and score. They land as CANDIDATES in your briefing with what the list says about each. Score the ones that fit with sales/prospect; a candidate is nobody's lead until you have.`,
  availableFor,
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    if (!isConnectionOn('lead-sources')) return offRefusal;
    const source = COMPANY_SOURCES.find(([id]) => id === String(payload?.source ?? ''));
    if (!source) return invalid(`source is one of: ${COMPANY_SOURCES.map(([id, s]) => `${id} (${s.label})`).join('; ')}`);
    const segment = (await readSegments(context.wallet)).find((s) => s.id === String(payload?.segment ?? '').trim());
    if (!segment || segment.state === 'retired') return invalid(`"${payload?.segment ?? ''}" is not one of your audiences — file it with sales/segment first`);
    const strings = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 12);
    const query = { words: String(payload?.words ?? '').slice(0, 200), industries: strings(payload?.industries), sizes: strings(payload?.sizes), foundedFrom: parseInt(payload?.foundedFrom, 10) || null, live: payload?.live === true };
    if (source[1].local && !query.words && !query.industries.length) return invalid('a search of the company index needs words or industries (what kind of company), or it would return the whole world');
    if (source[0] === 'hunter-discover' && query.words.trim().length < 8) return invalid('hunter-discover needs words: one plain sentence saying what kind of company you are after');
    // A source that rides the operator's own key needs that key attached; a free one spends nothing, so no spending rule applies.
    const apiKey = source[1].key ? (await resolveUsableCredential(source[1].key).catch(() => null))?.apiKey ?? null : null;
    if (source[1].key && !apiKey) return { ok: false, status: 'denied', reason: `no ${source[1].key} key is attached — the operator adds one in SETTINGS, API, Lead data${source[1].free ? ' (a free account is enough: this search spends no credits)' : ''}` };
    return { ok: true, value: { context, segment, sourceId: source[0], count: payload?.count, query, apiKey } };
  },
  summarize: (payload) => `gather companies from ${payload?.source ?? '?'} for audience ${payload?.segment ?? '?'}`,
  execute: async ({ context, segment, sourceId, count, query, apiKey }, { signal, emit } = {}) => {
    const [candidates, prospects] = await Promise.all([readCandidates(context.wallet), readProspects(context.wallet)]);
    const known = { domains: new Set([...candidates.map((c) => c.domain), ...prospects.map((p) => p.domain)]), tokens: new Set(candidates.map((c) => c.token).filter(Boolean)) };
    const found = await LEAD_SOURCES[sourceId].gather({ count, known, signal, segment, query, apiKey, onProgress: saying(emit, 'sales.gather', `gathering from ${sourceId}`) });
    // Every gathered company carries its traffic, whatever list it came from: the free answer to "is anybody there".
    const ranks = trafficLoaded() ? trafficOf(found.candidates.filter((c) => !('trafficRank' in c)).map((c) => c.domain)) : null;
    const rows = ranks ? found.candidates.map((c) => ('trafficRank' in c ? c : { ...c, trafficRank: ranks.get(c.domain) ?? null, signal: `${c.signal} · ${trafficWords(ranks.get(c.domain) ?? null)}` })) : found.candidates;
    const added = await addCandidates(context.wallet, segment.id, rows, context.laneId);
    if (!added.length) return { ok: false, reason: `Nothing new was gathered from ${sourceId}${found.stopped ? `: ${found.stopped}` : ' — the house already holds every company it returned'}.` };
    return { ok: true, detail: [`${added.length} new candidate(s) for "${segment.name}" from ${sourceId}${found.stopped ? ` (it stopped early: ${found.stopped})` : ''}:`, ...added.slice(0, SHOWN_GATHERED).map((c) => `- [${c.id}] ${candidateLine(c)}`), ...(added.length > SHOWN_GATHERED ? [`… and ${added.length - SHOWN_GATHERED} more, all in your briefing and on the campaign's screen.`] : []), 'Read the ones that could fit, then score them with sales/prospect (source: the candidate\'s own page).'].join('\n') };
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
    const held = candidates.find((c) => c.domain === domain)?.hunterEmails;
    if (held && !held.personal && (!payload?.source || payload.source === 'hunter')) return { ok: false, status: 'denied', reason: `Hunter already said it holds no named person at ${domain} (${held.generic} general address${held.generic === 1 ? '' : 'es'}) — no credit was spent. Read the company's own pages with sales/read-sites, or name another provider.` };
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
    return { ok: true, detail: [`People at ${domain} (${attached.id}, ${found.spent} credit(s) spent):`, ...found.people.map((p, i) => `- ${i}. ${p.name}, ${p.role}${p.seniority ? ` (${p.seniority}${p.department ? `, ${p.department}` : ''})` : ''} — ${p.email}${p.checked === 'valid' ? ' (the address exists: checked)' : p.checked ? ` (${p.checked})` : ''} — ${p.basis === 'verified' ? `verified by ${attached.id}; their profile: ${p.sourceUrl}` : `found on ${p.sourceUrl}`}`), 'File the ones you will write to under people in sales/prospect, then sales/lead with the address and the page above as emailSource.'].join('\n') };
  },
});

const salesReadSitesIntent = Object.freeze({
  name: 'sales/read-sites',
  policyTool: 'sales.read-sites',
  fieldsForPrompt: `{segment, count?}`,
  descriptionForPrompt: `THE LEAD ENGINE. Read the own sites of an audience's gathered companies in bulk (count: 1 to ${READ_MAX}; the next ones not yet read, most visited first). For each: whether the site is ALIVE, what the company says it is, the addresses it publishes with the page each stands on, and its own social links. A company with NO SITE is a dead end: do not score it. Do this after a gather and before scoring, so you score from what each company says about itself; open a company's pages yourself only where this leaves a question.`,
  availableFor,
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    if (!isConnectionOn('lead-sources')) return offRefusal;
    const segment = (await readSegments(context.wallet)).find((s) => s.id === String(payload?.segment ?? '').trim());
    if (!segment || segment.state === 'retired') return invalid(`"${payload?.segment ?? ''}" is not one of your audiences`);
    return { ok: true, value: { context, segment, count: payload?.count } };
  },
  summarize: (payload) => `read the sites of companies gathered for audience ${payload?.segment ?? '?'}`,
  execute: async ({ context, segment, count }, { signal, emit } = {}) => {
    const done = await readAudienceSites(context.wallet, segment.id, { count, by: context.laneId, signal, onProgress: saying(emit, 'sales.read-sites', 'reading sites') });
    if (!done.ok) return { ok: false, reason: done.reason };
    const dead = done.read.filter((r) => !r.site.alive).length;
    return { ok: true, detail: [`${done.read.length} site(s) read for "${segment.name}": ${done.read.length - dead} alive, ${dead} with no site. ${done.left} gathered compan${done.left === 1 ? 'y is' : 'ies are'} still unread.`, ...done.read.map((r) => `- ${siteLine(r.domain, r.site)}`)].join('\n').slice(0, 9000) };
  },
});

export const salesGatherIntents = Object.freeze([salesGatherIntent, salesContactsIntent, salesReadSitesIntent]);
