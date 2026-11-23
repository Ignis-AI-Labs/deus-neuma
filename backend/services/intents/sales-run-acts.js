/**
 * sales/run — the seat starts a LEAD RUN for one of its audiences (sales/lead-run.js): the house reads, screens and
 * files that audience's gathered companies as a machine job, several at once, until the number of leads asked for
 * each stands on the ledger with a confirmed address. Design note, 2026-11-21: […]
 *
 * The seat does not work companies one by one any more: it gathers (narrow searches), starts a run, and then gives
 * its own turns to what a machine cannot do — the research and the email for each lead the run filed.
 *
 * THE OFFICE LAW holds: only the seated Mercator starts one. Tier `allowed`: every step of a run goes through the
 * seat's own acts, each with its own checks and the operator's spending rule.
 */
import { officeContext } from './revenue-acts.js';
import { readProspects, readSegments, noteProspectCountry } from '../sales/sales-store.js';
import { readRunStanding } from '../sales/lead-run-standing.js';
import { startLeadRun, stopLeadRun, leadRunsOf, runRoom, RUN_MAX } from '../sales/lead-run.js';
import { readPipelineReview } from '../sales/pipeline-review-read.js';
import { startAudienceTest } from '../sales/audience-test.js';
import { reviewWords, BATCH_DEFAULT } from '../sales/pipeline-review.js';

const officerRefusal = { ok: false, status: 'denied', reason: 'the lead engine is the Mercator office\'s — only the seated Mercator files to it (house/post reaches them; the operator seats the office)' };
const seated = async (connection) => (await officeContext(connection).catch(() => null)) || null;

const salesRunIntent = Object.freeze({
  name: 'sales/run',
  policyTool: 'sales.run',
  fieldsForPrompt: '{segment, leads?: number, credits?: number} | {segment, examples: [site]} | {stop: true, segment?} | {status: true}',
  descriptionForPrompt: `THE LEAD ENGINE, THE FAST WAY. BEFORE YOU TRUST AN AUDIENCE WITH A SEARCH, TEST IT: sales/run {segment, examples: ["radical.vc", "airstreet.com", …]} screens three or more companies you KNOW are that audience (free, a draft audience too) and status then says how many it kept — an audience that loses its own examples is too narrow, and each lost one says which part of the first sign to widen. Start a LEAD RUN for one audience: the house itself reads each gathered company's site, screens it against the audience from its own page, files the fits, finds the person to write to (the company's own pages, then your operator's lead-data provider under their spending rule), confirms one address a company, and files the lead — several companies at once, until \`leads\` leads (default 100, at most ${RUN_MAX}) stand on the ledger, cold, each with a confirmed address. SEVERAL RUNS CAN WORK AT ONCE, one an audience: start one for each audience that has gathered companies waiting ({status: true} says how many may work together). It returns at once; the run reports to your operator when it ends, and {status: true} shows every run AND where every audience stands with its one next step (start a run, gather first, or few are a fit and why): read it whenever you wake and do each next step. DO NOT work gathered companies one at a time with sales/read-sites, sales/prospect, sales/contacts and sales/lead when a run can: gather with narrow searches, start a run, and spend your own turns on the research and the email for each lead it files. credits caps what THIS run may spend on lookups and checks (your operator's monthly rule holds either way). One run a house at a time; {stop: true} ends it.`,
  availableFor: async ({ connection }) => ((await seated(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    return { ok: true, value: { context, payload } };
  },
  summarize: (payload) => (payload?.stop ? 'stop the lead run' : payload?.status ? 'where the lead run stands' : `start a lead run for audience ${payload?.segment ?? '?'}`),
  execute: async ({ context, payload }) => {
    const standing = leadRunsOf(context.wallet);
    const one = (r) => `Lead run for "${r.segment}" [${r.segmentId}] — ${r.active ? 'WORKING' : `ended (${r.ended})`}: ${r.words}.`;
    if (payload?.status) {
      // WHERE EVERY AUDIENCE STANDS and its one next step (lead-run-standing.js): what the operator's panel shows, in words.
      const audiences = await readRunStanding(context.wallet, { running: new Set(standing.filter((r) => r.active).map((r) => r.segmentId)) }).catch(() => []);
      const rows = audiences.map((a) => `- [${a.id}] ${a.name}: ${a.waiting} wait to be screened (${a.likely} look likely), ${a.screened} screened, ${a.fit} a fit${a.inHundred === null ? '' : ` (${a.inHundred} in 100)`}, ${a.leads} lead(s). NEXT: ${a.next.words}${a.examples ? ` YOUR EXAMPLES: ${a.examples.words}${a.examples.lost.length ? ` LOST: ${a.examples.lost.map((c) => `${c.domain} (${c.why})`).join(' | ')}` : ''}` : ''}${a.misses.length ? ` THE LAST MISSES: ${a.misses.slice(0, 4).map((m) => `${m.domain} — ${m.why.slice(0, 110)}`).join(' | ')}` : ''}`);
      return { ok: true, detail: [standing.length ? `${standing.map(one).join('\n')}\n${standing[0].last.slice(-12).join('\n')}` : 'No lead run has been started since the house last started.', `Up to ${runRoom()} run(s) can work at once, one an audience.`, 'WHERE EACH AUDIENCE STANDS:', ...rows].join('\n') };
    }
    if (payload?.stop) {
      const which = payload?.segment ? standing.find((r) => r.active && r.segmentId === String(payload.segment).trim()) : null;
      if (payload?.segment && !which) return { ok: false, reason: `no lead run is working audience "${payload.segment}"` };
      return stopLeadRun(context.wallet, which?.id ?? null) ? { ok: true, detail: `${which ? `The run for "${which.segment}" stops` : 'Every run stops'} after the companies in hand.` } : { ok: false, reason: 'no lead run is working' };
    }
    // The seat's acts are handed to the run here: the run files through them and imports none (no cycle).
    const { salesIntents } = await import('./sales-acts.js');
    // TEST THE AUDIENCE against companies that ARE it (audience-test.js): exactly those are screened, free, and status then says how many it kept.
    if (payload?.examples !== undefined) {
      const tested = await startAudienceTest(context.wallet, { segmentId: String(payload?.segment ?? '').trim(), domains: payload.examples, by: context.laneId }, { start: (wallet, ask) => startLeadRun(wallet, ask, { intents: salesIntents }) });
      return tested.ok ? { ok: true, detail: `Testing "${tested.run.segment}" against ${tested.domains.length} companies that should be it: ${tested.domains.join(', ')}. They are screened now from their own pages (nothing is spent). sales/run {status: true} then says how many it KEPT: most kept, the audience says what you mean; many lost, its first sign is too narrow — each lost one says which part its page did not show, and that is the part to widen (file the audience again with a wider first sign for your operator to approve).` } : { ok: false, reason: tested.reason };
    }
    const started = await startLeadRun(context.wallet, { segmentId: payload?.segment, want: payload?.leads, credits: payload?.credits }, { intents: salesIntents });
    if (!started.ok) return { ok: false, reason: started.reason };
    return { ok: true, detail: `A lead run is working "${started.run.segment}" toward ${started.run.want} lead(s) with a confirmed address. It runs beside you — do not wait on it and do not work its companies yourself. Your operator is told when it ends; sales/run {status: true} shows where it stands. It also writes the research and the first email of each lead it files, and of the leads already waiting, staged for your operator; the ones it could not write are named in its lines and are yours.` };
  },
});

// sales/country — where a scored company is, once found. A fit whose pages named no country is still filed as a lead
// (Design note, 2026-11-21: […]); no email is written to it until this stands (lead-screen.js). It only ever fills an empty one.
const salesCountryIntent = Object.freeze({
  name: 'sales/country',
  policyTool: 'sales.country',
  fieldsForPrompt: '{id, country, source}',
  descriptionForPrompt: 'THE LEAD ENGINE. Say WHERE a scored company is, for one filed with its country still open (a lead marked COUNTRY TO FIND): id its prospect id, country the ISO code (e.g. "US"), source the https page that says so (its contact, about, legal or registry page — never a guess from its name or its address ending). Until it stands no email is written to that lead; if the country is outside the audience\'s, it is never written to for it.',
  availableFor: async ({ connection }) => ((await seated(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    const prospect = (await readProspects(context.wallet)).find((p) => p.id === String(payload?.id ?? '').trim());
    if (!prospect) return { ok: false, status: 'invalid', reason: `"${payload?.id ?? ''}" is not a company on record — sales/pipeline lists each by its id` };
    if (prospect.country) return { ok: false, status: 'invalid', reason: `[${prospect.id}] ${prospect.name} is already on record in ${prospect.country}` };
    const country = String(payload?.country ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) return { ok: false, status: 'invalid', reason: 'country: the two-letter ISO code of where the company is (e.g. "US")' };
    if (!/^https:\/\/\S+$/.test(String(payload?.source ?? ''))) return { ok: false, status: 'invalid', reason: 'source: the https page that says where the company is — a country is never guessed' };
    return { ok: true, value: { context, prospect, country, source: String(payload.source) } };
  },
  summarize: (payload) => `${payload?.id ?? '?'} is in ${payload?.country ?? '?'}`,
  execute: async ({ context, prospect, country, source }) => {
    await noteProspectCountry(context.wallet, prospect.id, country, context.laneId, source);
    const segment = (await readSegments(context.wallet)).find((s) => s.id === prospect.segmentId);
    const allowed = !segment?.countries?.length || segment.countries.includes(country);
    return { ok: true, detail: `[${prospect.id}] ${prospect.name} is on record in ${country} (${source}). ${allowed ? 'Its lead may be written to now: the research, then its first email.' : `"${segment.name}" may only be sent to ${segment.countries.join(', ')} — it is not written to for this audience; it stays on record as a contact.`}` };
  },
});

// sales/review — the seat reads how its own pipeline grades (pipeline-review.js). Design note, 2026-11-22: […]
// It reads the records only: nothing is written, asked of a model, or spent.
const pctOf = (s) => (s.reached ? `${Math.round(s.rate * 100)}%` : 'none yet');
const salesReviewIntent = Object.freeze({
  name: 'sales/review',
  policyTool: 'sales.review',
  fieldsForPrompt: '{segment?, size?: number, run?}',
  descriptionForPrompt: `THE LEAD ENGINE. THE PIPELINE REVIEW: your leads graded at every stage against the written standard, from the records (free, instant, nothing spent). With segment: that audience's newest leads (size, default ${BATCH_DEFAULT}; or the leads of one run) — DISCOVERY (what share of each source's companies were a fit), FILTER, ADDRESS, VALIDATION, RESEARCH, EMAIL: how many MEET the standard, are WEAK, or FAIL, every failed check named with the companies it failed on and why, and how long each step took. Without segment: one line an audience. A MUST that failed is a lead that should not have got through: fix that lead first (move it, find the named person, research again, stage the email again), then fix what let it through. Read it after every run and before you say a batch is ready; the aim is every stage at 100%.`,
  availableFor: async ({ connection }) => ((await seated(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    return { ok: true, value: { context, segmentId: payload?.segment ? String(payload.segment).trim() : null, size: payload?.size, run: payload?.run ? String(payload.run).trim() : null } };
  },
  summarize: (payload) => `how the pipeline grades${payload?.segment ? ` for audience ${payload.segment}` : ''}`,
  execute: async ({ context, segmentId, size, run }) => {
    const reviews = await readPipelineReview(context.wallet, { segmentId, size, run });
    if (segmentId) return reviews.length ? { ok: true, detail: reviewWords(reviews[0], { examples: 12 }) } : { ok: false, reason: `"${segmentId}" is not one of this house's audiences` };
    const graded = reviews.filter((r) => r.size);
    if (!graded.length) return { ok: true, detail: 'No approved audience has a lead on the ledger yet: there is nothing to grade.' };
    return { ok: true, detail: ['THE PIPELINE REVIEW — the share of each audience\'s newest leads that MEET the standard at each stage (sales/review {segment} names every failed check and its companies):',
      ...graded.map((r) => `- [${r.segment.id}] ${r.segment.name}: ${r.size} graded · ${r.stages.map((s) => `${s.name} ${pctOf(s)}${s.fails ? ` (${s.fails} FAIL)` : ''}`).join(' · ')} · ${r.whole.clean} clean end to end${r.findings.length ? ` · SETUP: ${r.findings.join('; ')}` : ''}`)].join('\n') };
  },
});

export const salesRunIntents = Object.freeze([salesRunIntent, salesCountryIntent, salesReviewIntent]);
