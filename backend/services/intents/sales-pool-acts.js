// sales-pool-acts.js — THE POOL, SEEN WHOLE: the sales seat's way through every company it gathered
// (sales/pool-view.js). Design note, 2026-11-16: […] A wide net fills the pool with thousands
// and the briefing names eight; this reads any slice of it — filtered by addresses at Hunter, named
// people, size, words, whether the site was read and lived, whether its people were pulled — a page
// at a time, under counts of the whole. It reads only the house's own records: nothing is asked of
// anyone and nothing is spent, so it carries no card.

import { officeContext } from './revenue-acts.js';
import { readCandidates, readSegments, readContactPeople, readProspects, readSearches, noteShortlist } from '../sales/sales-store.js';
import { SIZES } from '../sales/company-index.js';
import { peopleByCompany } from '../sales/top-first.js';
import { poolFilter, filterPool, poolCounts, poolLine, POOL_PAGE, POOL_PAGE_MAX } from '../sales/pool-view.js';
import { audiencePipeline, pipelineLine, stepItems, STEPS } from '../sales/lead-pipeline.js';
import { MATCH_WORDS } from '../sales/prospect-shape.js';
import { readOutbox } from '../sales/email-outbox.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';

const seated = async (connection) => (await officeContext(connection).catch(() => null)) || null;
const officerRefusal = { ok: false, status: 'denied', reason: 'the lead engine is the Mercator office\'s — only the seated Mercator reads its pool' };

const salesPoolIntent = Object.freeze({
  name: 'sales/candidates',
  policyTool: 'sales.candidates',
  fieldsForPrompt: `{segment?, state?: "waiting" | "scored" | "all", minAddresses?, minPeople?, sizes?: [${SIZES.map((s) => `"${s}"`).join(' | ')}], words?, site?: "unread" | "alive" | "dead", pulled?: boolean, source?, sort?: "addresses" | "people" | "traffic" | "newest", offset?, limit?}`,
  descriptionForPrompt: `THE LEAD ENGINE. See your whole pool of gathered companies and filter it down (free; reads only your own records). Each company with everything known: size, the addresses Hunter holds there (total, named people, general — the count Hunter's own screen shows), how busy its site is, what its site said when read, whether it is scored, and the people already pulled (top first). Filter by audience (segment), state (waiting to be scored — the default — scored, or all), minAddresses, minPeople (named people at Hunter), sizes, words (in its name, domain or description), site (unread, alive, dead), pulled (people already looked up or not), source; sort by addresses (default), people, traffic or newest; ${POOL_PAGE} a page (limit up to ${POOL_PAGE_MAX}, offset for the next). Narrow the net here, read the sites of the ones worth it (sales/read-sites), score them, then pull the people at the best (sales/contacts, up to ten at once).`,
  availableFor: async ({ connection }) => ((await seated(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    const filter = poolFilter(payload);
    if (filter.segment && !(await readSegments(context.wallet)).some((s) => s.id === filter.segment)) return { ok: false, status: 'invalid', reason: `"${filter.segment}" is not one of your audiences` };
    const badSize = filter.sizes.find((s) => !SIZES.includes(s));
    if (badSize) return { ok: false, status: 'invalid', reason: `"${badSize}" is not a size — sizes are: ${SIZES.join(', ')}` };
    return { ok: true, value: { context, filter } };
  },
  summarize: (payload) => `look through the gathered companies${payload?.segment ? ` of audience ${payload.segment}` : ''}`,
  execute: async ({ context, filter }) => {
    const [all, lookups] = await Promise.all([readCandidates(context.wallet), readContactPeople(context.wallet)]);
    const held = peopleByCompany(lookups);
    const pool = filter.segment ? all.filter((c) => c.segmentId === filter.segment) : all;
    const n = poolCounts(pool, held);
    const { matched, page } = filterPool(pool, filter, held);
    const shown = page.length ? `${filter.offset + 1}–${filter.offset + page.length} of ${matched.toLocaleString('en-US')}` : `none of ${matched.toLocaleString('en-US')}`;
    return { ok: true, detail: [
      `The pool${filter.segment ? ' of this audience' : ''}: ${n.all.toLocaleString('en-US')} companies — ${n.waiting.toLocaleString('en-US')} waiting to be scored, ${n.withAddresses.toLocaleString('en-US')} with addresses at Hunter (${n.withPeople.toLocaleString('en-US')} with named people), ${n.read.toLocaleString('en-US')} sites read (${n.dead.toLocaleString('en-US')} dead), ${n.pulled.toLocaleString('en-US')} with people pulled.`,
      `Matching your filter, sorted by ${filter.sort}: ${shown}.`,
      ...page.map((c) => `- ${poolLine(c, held)}`),
      ...(matched > filter.offset + page.length ? [`More: offset ${filter.offset + page.length}.`] : []),
    ].join('\n') };
  },
});

// THE FILTER (lead-pipeline.js step 2; Design note, 2026-11-17: […]): the pool narrowed before a single site is read — the most reasonable kept on the shortlist, or
// the unreasonable passed over, with why. Only a shortlisted company's site is read next.
const SHORTLIST_MAX = 200;
const salesShortlistIntent = Object.freeze({
  name: 'sales/shortlist',
  policyTool: 'sales.shortlist',
  fieldsForPrompt: `{segment, why, pass?: boolean, domains?: [domain], minAddresses?, minPeople?, sizes?, words?, source?, sort?, limit?}`,
  descriptionForPrompt: `THE LEAD ENGINE, STEP 2 — FILTER. Narrow an audience's gathered pool to the most reasonable prospects before any site is read (free). Keep the ones that look right on what is known — the addresses and named people Hunter holds there, size, its name and words — on the shortlist; or, with pass: true, pass over the ones that plainly are not (an exchange, a bank, a media site), so they leave the road. Name them (domains) or take a filter of the pool (the same fields as sales/candidates; the most addresses first; limit up to ${SHORTLIST_MAX}). why: what made them reasonable, or not. Only shortlisted companies are verified next (sales/read-sites), then scored.`,
  availableFor: async ({ connection }) => ((await seated(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    const segment = (await readSegments(context.wallet)).find((s) => s.id === String(payload?.segment ?? '').trim());
    if (!segment) return { ok: false, status: 'invalid', reason: `"${payload?.segment ?? ''}" is not one of your audiences` };
    const why = String(payload?.why ?? '').trim();
    if (why.length < 5) return { ok: false, status: 'invalid', reason: 'why: what makes them reasonable prospects (or, passing them over, why not)' };
    return { ok: true, value: { context, segment, why, pass: payload?.pass === true, domains: Array.isArray(payload?.domains) ? payload.domains.map((d) => String(d).trim().toLowerCase()).filter(Boolean) : null, filter: { ...poolFilter({ ...payload, segment: segment.id, state: 'waiting', shortlist: 'unsorted' }), limit: Math.min(Math.max(parseInt(payload?.limit, 10) || 50, 1), SHORTLIST_MAX), offset: 0 } } };
  },
  summarize: (payload) => `${payload?.pass === true ? 'pass over' : 'shortlist'} companies of audience ${payload?.segment ?? '?'}`,
  execute: async ({ context, segment, why, pass, domains, filter }) => {
    const pool = (await readCandidates(context.wallet)).filter((c) => c.segmentId === segment.id);
    const chosen = domains ? pool.filter((c) => domains.includes(c.domain)) : filterPool(pool, filter).page;
    if (!chosen.length) return { ok: false, reason: domains ? 'none of those domains is a gathered company of this audience' : 'nothing in the pool matches that filter and is still to be filtered' };
    await noteShortlist(context.wallet, { segmentId: segment.id, domains: chosen.map((c) => c.domain), verdict: pass ? 'passed' : 'kept', why, by: context.laneId });
    const left = pool.filter((c) => !c.shortlist && !c.siteRead && !chosen.some((x) => x.domain === c.domain) && c.state === 'waiting').length;
    return { ok: true, detail: [
      `${chosen.length} compan${chosen.length === 1 ? 'y' : 'ies'} of "${segment.name}" ${pass ? 'passed over' : 'kept on the shortlist'}: ${why}.`,
      ...chosen.slice(0, 40).map((c) => `- ${c.name} — ${c.domain}`),
      ...(chosen.length > 40 ? [`… and ${chosen.length - 40} more.`] : []),
      `${left.toLocaleString('en-US')} still to be filtered.${pass ? '' : ' NEXT: verify them — sales/read-sites reads the shortlisted sites, then score every live one.'}`,
    ].join('\n') };
  },
});

// WHAT STANDS AT ANY STEP, BY ID (Design note, 2026-11-17: […]). Free; reads only the house's own
// records. Without a step: every audience's road. With one: each thing at it, a page at a time.
const VIEWS = Object.freeze([...STEPS.map((s) => s.id).filter((id) => id !== 'discover'), 'outbox']);
const OUTBOX_PAGE = 10; // whole emails a page
const salesPipelineIntent = Object.freeze({
  name: 'sales/pipeline',
  policyTool: 'sales.pipeline',
  fieldsForPrompt: `{segment?, step?: ${VIEWS.map((v) => `"${v}"`).join(' | ')}, id?, offset?, limit?}`,
  descriptionForPrompt: `THE LEAD ENGINE. See the pipeline whole, and exactly what stands at any step — each thing by its id, a page at a time (free). Without step: every audience's road with its NEXT step. With step (for one audience with segment, else across every audience at once): filter = the companies still to filter; verify = shortlisted sites not yet read; score = companies read alive, to research and score; contacts = fits with no person yet; leads = fits ready to file, each with its top person (name, role, address, page) — file it with sales/lead; approve = what waits for the operator's list approval; outreach = the leads to write (each by its lead id), and the id of the email staged to it if one waits — staging again replaces it. step outbox (no segment needed) = EVERY email you staged, each WHOLE — its id, to, subject, the full text, the promise, and where it stands (waiting for your operator, returned with their note, sent) — ${OUTBOX_PAGE} a page; with id, that one email whole. Everything else: ${POOL_PAGE} a page, limit up to ${POOL_PAGE_MAX}, offset for the next.`,
  availableFor: async ({ connection }) => ((await seated(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    const step = payload?.step ? String(payload.step) : null;
    if (step && !VIEWS.includes(step)) return { ok: false, status: 'invalid', reason: `step is one of: ${VIEWS.join(', ')}` };
    const segments = await readSegments(context.wallet);
    const segment = payload?.segment ? segments.find((s) => s.id === String(payload.segment).trim()) : null;
    if (payload?.segment && !segment) return { ok: false, status: 'invalid', reason: `"${payload.segment}" is not one of your audiences` };
    const offset = Math.max(0, parseInt(payload?.offset, 10) || 0);
    const limit = Math.min(Math.max(parseInt(payload?.limit, 10) || (step === 'outbox' ? OUTBOX_PAGE : POOL_PAGE), 1), POOL_PAGE_MAX);
    return { ok: true, value: { context, segments, segment, step, offset, limit, id: payload?.id ? String(payload.id).trim() : null } };
  },
  summarize: (payload) => `read the pipeline${payload?.step ? `, step ${payload.step}` : ''}${payload?.segment ? ` of ${payload.segment}` : ''}`,
  execute: async ({ context, segments, segment, step, offset, limit, id }) => {
    const [candidates, prospects, lookups, searches, outbox, leads] = await Promise.all([
      readCandidates(context.wallet), readProspects(context.wallet), readContactPeople(context.wallet), readSearches(context.wallet),
      readOutbox(context.wallet).catch(() => ({ drafts: [] })), leadLedgerFor(context.wallet).then((l) => l.load()).catch(() => []),
    ]);
    const held = peopleByCompany(lookups);
    const of = (s) => ({ segment: s, candidates: candidates.filter((c) => c.segmentId === s.id), prospects: prospects.filter((p) => p.segmentId === s.id), leads, searches: searches.filter((x) => x.segmentId === s.id), held, drafts: outbox.drafts });
    const page = (rows, line) => [
      ...rows.slice(offset, offset + limit).map(line),
      rows.length ? `Shown ${offset + 1}–${Math.min(rows.length, offset + limit)} of ${rows.length}.${rows.length > offset + limit ? ` More: offset ${offset + limit}.` : ''}` : 'Nothing stands here.',
    ];
    if (step === 'outbox') {
      // Each email whole: the seat reads what it wrote, never a cut of it.
      const rows = outbox.drafts.filter((d) => d.state !== 'withdrawn');
      const word = { waiting: 'WAITING for your operator', returned: 'RETURNED', sent: 'SENT' };
      const whole = (d) => [
        `- [${d.id}] to ${(d.to ?? []).join(', ')} — ${word[d.state] ?? d.state}${d.state === 'returned' ? ` — their note: ${d.note || 'none'} — rewrite it and stage it again` : ''}${d.state === 'sent' && d.sentAt ? ` ${d.sentAt.slice(0, 10)}` : ''}${d.edited ? ' — your operator edited it' : ''}`,
        `  Subject: ${d.subject}`,
        ...String(d.text ?? '').split('\n').map((l) => `  | ${l}`),
        ...(d.promise ? [`  Promise kept on the lead: ${d.promise}`] : []),
      ].join('\n');
      if (id) {
        const one = rows.find((d) => d.id === id);
        return one ? { ok: true, detail: whole(one) } : { ok: false, reason: `no email [${id}] in your outbox — sales/pipeline {step: "outbox"} lists every one` };
      }
      return { ok: true, detail: [`Every email you staged (${rows.filter((d) => d.state === 'waiting').length} waiting, ${rows.filter((d) => d.state === 'returned').length} returned, ${rows.filter((d) => d.state === 'sent').length} sent), each whole, newest first:`,
        ...page(rows, whole)].join('\n') };
    }
    if (!step) {
      const roads = (segment ? [segment] : segments.filter((s) => ['approved', 'draft'].includes(s.state))).map((s) => audiencePipeline(of(s)));
      return { ok: true, detail: ['The pipeline, every audience (sales/pipeline {segment, step} lists what stands at a step):', ...roads.map((r) => `- ${pipelineLine(r)}`)].join('\n') };
    }
    // One audience, or every audience at once with each item marked by its audience.
    const audiences = segment ? [segment] : segments.filter((s) => ['approved', 'draft'].includes(s.state));
    const items = audiences.flatMap((s) => stepItems(of(s), step).map((item) => ({ ...item, audience: s })));
    const line = {
      filter: (c) => `- ${poolLine(c, held)}`, verify: (c) => `- ${poolLine(c, held)}`, score: (c) => `- ${poolLine(c, held)}`,
      contacts: (p) => `- [${p.id}] ${p.name} (${p.domain}) — ${MATCH_WORDS[p.match]} — no person with an address yet (sales/contacts)`,
      leads: (p) => `- [${p.id}] ${p.name} (${p.domain}) — ${MATCH_WORDS[p.match]} — top person: ${p.top.name}, ${p.top.role} — ${p.top.email}${p.top.sourceUrl ? ` (found on ${p.top.sourceUrl})` : ''} — file: sales/lead {id: "${p.id}", person: {name, role}, email, emailSource}`,
      approve: (p) => `- [${p.id}] ${p.name} (${p.domain}) — ${p.stage === 'promoted' ? 'on the lead list' : 'scored a fit'} — waits for the operator's APPROVE THE LIST`,
      outreach: (l) => `- lead [${l.id}] ${l.name || l.contact} <${l.contact}> (${l.domain})${l.draft ? ` — email [${l.draft}] STAGED for your operator (sales/pipeline {step: "outbox", id: "${l.draft}"} reads it; staging again to them replaces it)` : ' — to write: sales/draft-email'}`,
    }[step];
    const marked = segment ? line : (item) => line(item).replace(/^- /, `- (${item.audience.id} ${item.audience.name}) `);
    const stepWords = STEPS.find((s) => s.id === step);
    return { ok: true, detail: [`${segment ? `"${segment.name}"` : `Every audience (${audiences.length})`} — step ${stepWords.label}: ${stepWords.does}.`, ...page(items, marked)].join('\n') };
  },
});

export const salesPoolIntents = Object.freeze([salesPoolIntent, salesShortlistIntent, salesPipelineIntent]);
