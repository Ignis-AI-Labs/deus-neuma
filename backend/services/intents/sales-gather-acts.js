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
import { DISCOVER_MAX, previewDiscover, industryRefusal, heldWords } from '../sales/hunter-discover.js';
import { topFirst } from '../sales/top-first.js';
import { readAudienceSites } from '../sales/site-reads.js';
import { READ_MAX, siteLine } from '../sales/company-reader.js';
import { SIZES, trafficOf, trafficLoaded, trafficWords } from '../sales/company-index.js';
import { readSegments, readProspects, readCandidates, addCandidates, noteContacts, readContactLookups, noteSearch } from '../sales/sales-store.js';
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
const strings = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 12);
// pure — what a gather or a look asks for, from the act's fields.
const queryOf = (payload) => ({
  words: String(payload?.words ?? '').slice(0, 200), industries: strings(payload?.industries), sizes: strings(payload?.sizes),
  keywords: strings(payload?.keywords).map((k) => k.slice(0, 60)), exclude: strings(payload?.exclude).map((k) => k.slice(0, 60)),
  match: payload?.match === 'all' ? 'all' : 'any', foundedFrom: parseInt(payload?.foundedFrom, 10) || null, live: payload?.live === true,
});
// pure — why a Hunter search cannot be asked as given: nothing to search for, or industries Hunter does not have.
// Left without words, the search reads the audience's own signs of fit (hunter-discover.js audienceWords).
const discoverRefusal = (query) => {
  if (query.words.trim() && query.words.trim().length < 8 && !query.industries.length && !query.keywords.length) return 'words are one plain sentence saying what kind of company you are after (or leave them out: the audience\'s own signs of fit are read), and keywords and industries aim it';
  return industryRefusal(query.industries);
};
const PEOPLE_SOURCES = Object.entries(LEAD_SOURCES).filter(([, s]) => s.kind === 'people');

const salesGatherIntent = Object.freeze({
  name: 'sales/gather',
  policyTool: 'sales.gather',
  fieldsForPrompt: `{segment, source: ${COMPANY_SOURCES.map(([id]) => `"${id}"`).join(' | ')}, count?, words?, industries?: [name], keywords?: [phrase], exclude?: [word], match?: "any" | "all", sizes?: [${SIZES.map((s) => `"${s}"`).join(' | ')}], foundedFrom?: year, live?: boolean}`,
  descriptionForPrompt: `THE LEAD ENGINE. Gather companies for an audience in bulk from a public list (new ones only; count caps how many: at most ${GATHER_MAX} from base-protocols or base-tokens, ${INDEX_GATHER_MAX} from company-index, ${DISCOVER_MAX} from hunter-discover): ${COMPANY_SOURCES.map(([id, s]) => `${id} = ${s.label}`).join('; ')}. hunter-discover is free with your operator's Hunter key and is THE FIRST STEP, A WIDE NET: leave count out and one gather pulls everything Hunter answers for free — its own ranked list (exactly what its screen shows), then every size, then each of the audience's countries by size, each its own first hundred — up to ${DISCOVER_MAX} companies, the most addresses first, each with the count Hunter's screen shows. Then filter down: sales/read-sites, then score. Aim the net with keywords (phrases; match any or all — the operator's own Hunter search is a good start), industries (Hunter's own names, e.g. Blockchain Services, Financial Services, Venture Capital and Private Equity Principals, Software Development; a wrong one is answered with the nearest) and exclude; with those, Hunter's guess at your words is not used. Words alone are read by Hunter's assistant, loosely (it once took the chain Base for the word base). sales/discover shows what a search reads as before you gather it. company-index is the big one: it takes a SEARCH (words: matched in a company's name, industry and city; industries: exact names, a wrong one is answered with the right ones; sizes; foundedFrom; live: true keeps only companies whose site is among the million most visited, which drops dead ones) and returns up to ${INDEX_GATHER_MAX} a call, most visited first, in the audience's own countries. Gather wide there, then read and score. They land as CANDIDATES in your briefing with what the list says about each. Score the ones that fit with sales/prospect; a candidate is nobody's lead until you have.`,
  availableFor,
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    if (!isConnectionOn('lead-sources')) return offRefusal;
    const source = COMPANY_SOURCES.find(([id]) => id === String(payload?.source ?? ''));
    if (!source) return invalid(`source is one of: ${COMPANY_SOURCES.map(([id, s]) => `${id} (${s.label})`).join('; ')}`);
    const segment = (await readSegments(context.wallet)).find((s) => s.id === String(payload?.segment ?? '').trim());
    if (!segment || segment.state === 'retired') return invalid(`"${payload?.segment ?? ''}" is not one of your audiences — file it with sales/segment first`);
        const query = queryOf(payload);
    if (source[1].local && !query.words && !query.industries.length) return invalid('a search of the company index needs words or industries (what kind of company), or it would return the whole world');
    if (source[0] === 'hunter-discover') {
      const refusal = discoverRefusal(query);
      if (refusal) return invalid(refusal);
    }
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
    // THE PIPELINE'S FIRST STEP, on record: this audience's own search (lead-pipeline.js).
    await noteSearch(context.wallet, { segmentId: segment.id, source: sourceId, asked: found.asked ?? [query.words, ...query.keywords, ...query.industries].filter(Boolean).join(', '), matched: found.matched, gathered: added.length, by: context.laneId })
      .catch(() => {});
    if (!added.length) return { ok: false, reason: `Nothing new was gathered from ${sourceId}${found.stopped ? `: ${found.stopped}` : ' — the house already holds every company it returned'}.` };
    return { ok: true, detail: [`${added.length} new candidate(s) for "${segment.name}" from ${sourceId}${found.asked ? ` (asked as ${found.asked})` : ''}${found.stopped ? ` (it stopped early: ${found.stopped})` : ''}:`, ...added.slice(0, SHOWN_GATHERED).map((c) => `- [${c.id}] ${candidateLine(c)}`), ...(added.length > SHOWN_GATHERED ? [`… and ${added.length - SHOWN_GATHERED} more, all in your briefing and on the campaign's screen.`] : []), 'Read the ones that could fit, then score them with sales/prospect (source: the candidate\'s own page).'].join('\n') };
  },
});

// DISCOVER LOOKS FIRST (Design note, 2026-11-16: […]): one free
// Hunter call showing what a gather would bring — nothing kept — so the search is aimed before the pool fills.
const salesDiscoverIntent = Object.freeze({
  name: 'sales/discover',
  policyTool: 'sales.discover',
  fieldsForPrompt: `{segment, industries?: [Hunter industry], keywords?: [phrase], exclude?: [word], match?: "any" | "all", words?, sizes?: [${SIZES.map((s) => `"${s}"`).join(' | ')}]}`,
  descriptionForPrompt: 'THE LEAD ENGINE, FIRST STEP. Look before you gather (free, with your operator\'s Hunter key; nothing is kept): how the search is asked of Hunter, how many companies match in the audience\'s countries, and the first 15 with how many named people Hunter holds at each. Aim it with industries (Hunter\'s own names, e.g. Blockchain Services; a wrong one is answered with the nearest), keywords (phrases; match any or all) and exclude. When the first companies are the audience, gather them with sales/gather, source hunter-discover, the same fields. When they are not, sharpen and look again.',
  availableFor,
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    if (!isConnectionOn('lead-sources')) return offRefusal;
    const segment = (await readSegments(context.wallet)).find((s) => s.id === String(payload?.segment ?? '').trim());
    if (!segment || segment.state === 'retired') return invalid(`"${payload?.segment ?? ''}" is not one of your audiences — file it with sales/segment first`);
    const query = queryOf(payload);
    const refusal = discoverRefusal(query);
    if (refusal) return invalid(refusal);
    const apiKey = (await resolveUsableCredential('hunter').catch(() => null))?.apiKey ?? null;
    if (!apiKey) return { ok: false, status: 'denied', reason: 'no hunter key is attached — the operator adds one in SETTINGS, API, Lead data (a free account is enough: this search spends no credits)' };
    return { ok: true, value: { segment, query, apiKey } };
  },
  summarize: (payload) => `look at what Hunter holds for audience ${payload?.segment ?? '?'}`,
  execute: async ({ segment, query, apiKey }, { signal } = {}) => {
    const look = await previewDiscover({ query, segment, apiKey, signal });
    if (!look.ok) return { ok: false, reason: `Hunter could not be asked: ${look.reason}.` };
    return { ok: true, detail: [
      `Hunter, asked as ${look.asked} (its assistant's reading of ${query.words.trim() ? 'your words' : 'the audience\'s signs of fit'}${query.keywords.length || query.industries.length ? ', sharpened by your keywords and industries' : ' — sharpen it with keywords and industries'}): ${look.matched.toLocaleString('en-US')} compan${look.matched === 1 ? 'y matches' : 'ies match'} in the countries of "${segment.name}". Nothing was kept or spent.`,
      ...look.sample.map((c) => `- ${c.name} — ${c.domain}${c.size ? ` — ${c.size} people` : ''} — ${heldWords(c.hunterEmails)}`),
      look.sample.length ? 'Are these the audience? Then sales/gather, source hunter-discover, with the same fields. If not, sharpen (industries, keywords, exclude) and look again.' : 'Nothing matches: loosen the search (fewer keywords, match any, another industry) and look again.',
    ].join('\n') };
  },
});

// One person as the seat reads them: rank, name, role, address, and where the address stands.
const personLine = (p, i, by) => `- ${i}. ${p.name}, ${p.role}${p.seniority ? ` (${p.seniority}${p.department ? `, ${p.department}` : ''})` : ''} — ${p.email}${p.checked === 'valid' ? ' (the address exists: checked)' : p.checked ? ` (${p.checked})` : ''} — ${p.basis === 'verified' ? `verified by ${by}; their profile: ${p.sourceUrl}` : `found on ${p.sourceUrl}`}`;
const CONTACTS_MAX = 10;

const salesContactsIntent = Object.freeze({
  name: 'sales/contacts',
  policyTool: 'sales.contacts',
  fieldsForPrompt: `{domain | domains: [up to ${CONTACTS_MAX}], source?: ${PEOPLE_SOURCES.map(([id]) => `"${id}"`).join(' | ')}}`,
  descriptionForPrompt: `THE LEAD ENGINE. The people at companies you gathered or pooled (one, or up to ${CONTACTS_MAX} at once: domains), each with their address and where it comes from, TOP FIRST: the company's decision makers are asked for first, and each list starts with the founder or chief executive. From a contact-data provider your operator attached (${PEOPLE_SOURCES.map(([id, s]) => `${id} = ${s.label}`).join('; ')}). IT SPENDS YOUR OPERATOR'S CREDITS (one a company that has somebody), so it runs only while your briefing's PAID LEAD DATA line says ON, and within the month's limit. Pull the companies Hunter's search says hold people (it counts them for free). source: which attached provider to ask (left out: the cheapest attached; when one holds nobody, try the next). Use a returned address in sales/lead with its page as emailSource — the top person first. With no provider attached, read the address on the company's own pages.`,
  availableFor,
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    if (!isConnectionOn('lead-sources')) return offRefusal;
    const asked = [...new Set([payload?.domain, ...(Array.isArray(payload?.domains) ? payload.domains : [])].map((d) => String(d ?? '').trim().toLowerCase()).filter(Boolean))];
    if (!asked.length) return invalid(`domain: the company to look up (or domains: up to ${CONTACTS_MAX})`);
    if (asked.length > CONTACTS_MAX) return invalid(`at most ${CONTACTS_MAX} companies a lookup — ${asked.length} were named`);
    const [candidates, prospects] = await Promise.all([readCandidates(context.wallet), readProspects(context.wallet)]);
    const strangers = asked.filter((d) => !candidates.some((c) => c.domain === d) && !prospects.some((p) => p.domain === d));
    if (strangers.length) return invalid(`${strangers.map((d) => `"${d}"`).join(', ')} ${strangers.length === 1 ? 'is not a company' : 'are not companies'} you gathered or pooled — contacts are looked up only for the house's own candidates`);
    // THE PIPELINE: people come after the research — only at a company scored as a fit (lead-pipeline.js).
    const unfit = asked.filter((d) => !prospects.some((p) => p.domain === d && p.match >= 2 && p.stage !== 'dropped'));
    if (unfit.length) return invalid(`THE PIPELINE: people are pulled only at a company scored as a fit — ${unfit.map((d) => `"${d}"`).join(', ')} ${unfit.length === 1 ? 'is' : 'are'} not (read its site with sales/read-sites, research it, score it with sales/prospect; a weak or strong match comes here)`);
    // Hunter already said (for free) where it holds nobody with a name: those cost nothing and are not asked.
    const byHunter = !payload?.source || payload.source === 'hunter';
    const empty = byHunter ? asked.filter((d) => { const held = candidates.find((c) => c.domain === d)?.hunterEmails; return held && !held.personal; }) : [];
    const domains = asked.filter((d) => !empty.includes(d));
    const emptyWords = (d) => { const held = candidates.find((c) => c.domain === d).hunterEmails; return `${d} (${held.generic} general address${held.generic === 1 ? '' : 'es'})`; };
    if (!domains.length) return { ok: false, status: 'denied', reason: `Hunter already said it holds no named person at ${empty.map(emptyWords).join(', ')} — no credit was spent. Read the company's own pages with sales/read-sites, or name another provider.` };
    const all = await attachedProviders();
    if (!all.length) return { ok: false, status: 'denied', reason: `no contact-data provider is attached — the operator adds a key (${PEOPLE_SOURCES.map(([, s]) => s.label).join('; ')}) in SETTINGS, API, Service keys; until then read the address on the company's own pages` };
    const named = String(payload?.source ?? '').trim();
    const attached = named ? all.find((a) => a.id === named) : all[0];
    if (!attached) return invalid(`source: one of the providers your operator attached (${all.map((a) => a.id).join(', ')})`);
    // Money: nothing paid runs until the operator has said when it may, and never past the month's cap.
    const [rule, lookups] = await Promise.all([readSpend(context.wallet), readContactLookups(context.wallet)]);
    const refusal = spendRefusal({ rule, spent: spentThisMonth(lookups, Date.now()), cost: attached.source.cost * domains.length });
    if (refusal) return { ok: false, status: 'denied', reason: refusal };
    return { ok: true, value: { context, domains, empty: empty.map(emptyWords), attached } };
  },
  summarize: (payload) => `contacts at ${payload?.domain ?? (Array.isArray(payload?.domains) ? payload.domains.join(', ') : '?')}${payload?.source ? ` from ${payload.source}` : ''}`,
  execute: async ({ context, domains, empty = [], attached }, { signal } = {}) => {
    const blocks = [];
    let spent = 0;
    for (const domain of domains) {
      const found = await attached.source.contacts({ domain, apiKey: attached.apiKey, signal });
      // One company that could not be read is the act's failure; among several, it is one line.
      if (!found.ok && domains.length === 1) return { ok: false, reason: `The contacts could not be read from ${attached.id}: ${found.detail}.` };
      if (!found.ok) { blocks.push(`${domain}: could not be read from ${attached.id}: ${found.detail}.`); continue; }
      await noteContacts(context.wallet, domain, attached.id, found.people, context.laneId, found.spent);
      spent += found.spent;
      const people = topFirst(found.people);
      blocks.push(people.length
        ? [`People at ${domain} (${attached.id}, ${found.spent} credit(s) spent), top first:`, ...people.map((p, i) => personLine(p, i, attached.id))].join('\n')
        : `${attached.id} holds nobody at ${domain} with a role and an address it can stand behind (${found.spent} credit(s) spent). Read the company's own pages, or ask another attached provider with source.`);
    }
    return { ok: true, detail: [
      ...(domains.length > 1 ? [`${domains.length} companies looked up, ${spent} credit(s) spent.`] : []),
      ...blocks,
      ...(empty.length ? [`Not asked (Hunter holds no named person there, no credit spent): ${empty.join(', ')}.`] : []),
      'Write to the top person first: file them under people in sales/prospect, then sales/lead with the address and the page above as emailSource. If they never answer, the upkeep names the next one at the company.',
    ].join('\n') };
  },
});

const salesReadSitesIntent = Object.freeze({
  name: 'sales/read-sites',
  policyTool: 'sales.read-sites',
  fieldsForPrompt: `{segment, count?}`,
  descriptionForPrompt: `THE LEAD ENGINE, STEP 3 — VERIFY. Read the own sites of an audience's SHORTLISTED companies in bulk (count: 1 to ${READ_MAX}; the next shortlisted ones not yet read, the most addresses first — shortlist with sales/shortlist first). For each: whether the site is ALIVE, what the company says it is, the addresses it publishes with the page each stands on, and its own social links. A company with NO SITE is a dead end: do not score it. Do this after a gather and before scoring, so you score from what each company says about itself; open a company's pages yourself only where this leaves a question.`,
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
    const done = await readAudienceSites(context.wallet, segment.id, { count, by: context.laneId, signal, shortlistOnly: true, onProgress: saying(emit, 'sales.read-sites', 'reading sites') });
    if (!done.ok) return { ok: false, reason: done.reason };
    const dead = done.read.filter((r) => !r.site.alive).length;
    return { ok: true, detail: [`${done.read.length} site(s) read for "${segment.name}": ${done.read.length - dead} alive, ${dead} with no site. ${done.left} shortlisted compan${done.left === 1 ? 'y is' : 'ies are'} still unread.`, ...done.read.map((r) => `- ${siteLine(r.domain, r.site)}`), done.read.length > dead ? `NEXT — SCORE the ${done.read.length - dead} alive now: research each against the signs of fit and file it with sales/prospect (every sign scored, with the reason you read). A verified company is never left unscored.` : 'None was alive: filter the next most reasonable ones (sales/shortlist).'].join('\n') };
  },
});

export const salesGatherIntents = Object.freeze([salesDiscoverIntent, salesGatherIntent, salesContactsIntent, salesReadSitesIntent]);
