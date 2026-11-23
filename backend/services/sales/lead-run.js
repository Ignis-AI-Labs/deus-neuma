// THE LEAD RUN — the pipeline from a gathered company to a lead with a confirmed address, run as a machine job
// (lead-run-shape.js says why, and holds the pure parts). One run works ONE audience toward a number of leads:
//
//   0 VALIDATE  first, everything already waiting: every company scored a fit that no screening has confirmed — for
//               EVERY approved audience of the house, not only the one being worked (Design note, 2026-11-21: […]).
//               Each is read again and screened from its own page: it HOLDS (onto the approved list, with what it is
//               and where it is on record), it is OUT (taken off, with why; its people stay in the contact book), it
//               belongs to another audience (moved), or its page could not be read (left exactly as it stood).
//   then, for each company not yet worked (the ones already read and kept first), several at once:
//     1 READ     its own site (company-reader.js). Dead or unreadable: said, and left.
//     2 SCREEN   one question to the house's model, answered from the page alone; what the audience REQUIRES and what
//                the company IS are proved from the page's own sentences. Filed through sales/prospect — the seat's
//                own act, with every check it makes. A company that is no fit here and fits ANOTHER audience of the
//                house is moved to that audience and screened there, in this same run.
//     3 PEOPLE   at a fit: the addresses on its own pages, then the attached provider (sales/contacts, under the
//                operator's spending rule). The person to write to first is chosen by rule (firstToWrite).
//     4 CONFIRM  the address is confirmed by a checker before it counts — one confirmed address a company.
//     5 FILE     the lead, through sales/lead.
//
// Nothing is emailed: a run ends with leads, cold, each with a confirmed address. Research and the email are the
// seat's next step on each. A run is the seat's work done by the house: every record names the seat as its author.
// impure (the network, the model, the house's records). One run a house at a time; STOP ends it after the companies
// in flight.
import { createLogger } from '../logger.js';
import { createStreamRequest, consumeStream } from '../llm-provider.js';
import { resolveNeumaRoute } from '../neuma-route-resolver.js';
import { withLineKind, lineWidth } from '../substrate-lease.js';
import { croDesignation } from '../revenue/cro-designation.js';
import { notifyOperator } from '../notification-bus.js';
import { signalWake } from '../house-clock/wake-signal.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { noteRunStarted, noteRunLine, noteRunEnded } from './lead-run-record.js';
import { readCompanySite, guardedPage, describedAs } from './company-reader.js';
import { extractTitle } from '../html-to-text.js';
import { isFundingCampaign } from './company-entity.js';
import { readCandidates, readProspects, readSegments, readCampaigns, readSearches, readContactPeople, noteSites, noteShortlist, moveCandidate, listScreened, noteProspectCountry, settleProspect, handProspect, rescoreProspect } from './sales-store.js';
import { makeProspect, countryOfAddress } from './prospect-shape.js';
import { requiredState } from './required-signs.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { readResearch } from './research-store.js';
import { readAddressChecks, readContactLookups } from './sales-store.js';
import { confirmWithAny } from './address-check.js';
import { attachedProviders } from './lead-spend.js';
import { wideFinds } from './wide-search.js';
import { makeWriter } from './lead-run-write.js';
import { readLegalPages } from './where-pages.js';
import { neverSign } from './never-countries.js';
import { readNeverList } from '../legal/never-list.js';
import { pageWords, screenMessages, whereMessages, readWhere, readAnswer, filingOf, firstToWrite, runWords, definingFit, belongsElsewhere, sourceYield, screenable, sound, signWords, leanOf, sentenceWith, whereScored, DEFINING_MIN, TEXT_MAX } from './lead-run-shape.js';

const log = createLogger('LeadRun');
export const RUN_MAX = 1000;
export const RUN_WIDTH = 4;       // companies worked at once
// A POOL THAT HAS RUN THIN IS LEFT (found 2026-11-21: a run read 921 companies for 17 fits, forty minutes, because
// nothing told it to stop): once this many have been screened in a row with almost no fit, the rest are not read.
const THIN_AFTER = 150;           // companies screened in a row…
const THIN_FITS = 2;              // …with no more fits than this
const LOOK_FACTOR = 12;           // at most this many companies looked at per lead asked for
const THIN_PAGE = 40;           // fewer characters than this of its own words (body, title, description), and a page says nothing to screen
const CHECKS_A_COMPANY = 3;       // addresses asked of a checker before a company is left for the seat
const runs = new Map();           // house → audience → its run (running, or the last one finished)
const finished = new Map();       // house → "audience:domain" → when a run last finished working it
const claimed = new Map();        // house → the companies being worked right now, by any run (no company is worked twice at once)
const ofHouse = (wallet) => [...(runs.get(String(wallet).toLowerCase())?.values() ?? [])];
// SEVERAL RUNS AT ONCE (Design note, 2026-11-21: […]): one an audience, and as many as the model answers at once less the one kept for the operator's
// own chat (substrate-line.js keeps that place whatever runs here).
export const runRoom = () => Math.max(1, lineWidth() - 1);

const emptyCounts = () => ({ checked: 0, held: 0, out: 0, left: 0, looked: 0, dead: 0, screened: 0, fit: 0, weak: 0, nofit: 0, moved: 0, unclear: 0, people: 0, noAddress: 0, leads: 0, countryOpen: 0, spentStop: null });
const view = (run) => (run ? { id: run.id, segmentId: run.segmentId, segment: run.segment, want: run.want, credits: run.credits ?? null, spent: run.spent ?? 0, active: run.active, startedAt: run.startedAt, endedAt: run.endedAt ?? null, stopped: run.stopped, counts: { ...run.counts }, words: runWords(run.counts), last: run.lines.slice(-60), ended: run.ended ?? null } : null);

/** Every run standing for a house — the working ones first, then the last finished of each audience, newest first. */
export const leadRunsOf = (wallet) => ofHouse(wallet).sort((a, b) => Number(b.active) - Number(a.active) || String(b.startedAt).localeCompare(String(a.startedAt))).map(view);
/** The one to show when one is asked for: the newest working, else the newest ended. */
export const leadRunOf = (wallet) => leadRunsOf(wallet)[0] ?? null;

/**
 * Clear a finished run off the desk (one by its id, or every finished one). Only the desk's copy goes: the run's
 * record stays whole on disk (lead-run-record.js). A working run is never cleared. Returns how many were cleared.
 */
export const clearLeadRun = (wallet, id = null) => {
  const mine = runs.get(String(wallet).toLowerCase());
  let cleared = 0;
  for (const [audience, run] of mine ?? []) if (!run.active && (!id || run.id === id)) { mine.delete(audience); cleared += 1; }
  return cleared;
};

/** Stop one run (by its id), or every run of the house, after the companies in flight. False when none was working. */
export const stopLeadRun = (wallet, id = null) => {
  const going = ofHouse(wallet).filter((r) => r.active && (!id || r.id === id));
  for (const run of going) { run.stopped = true; run.abort.abort(); }
  return going.length > 0;
};

// impure — the house's model, asked once, on the seat's own route (read once a lane), taking its place in the line as a member's work.
const routes = new Map();
// A SCREENING ASKED TWICE GIVES THE SAME ANSWER (Design note, 2026-11-22: […]): no
// chance in the choosing of words (temperature 0) and a fixed seed, so a company's verdict moves only when its page or
// the audience does. The writer alone asks for more room, and only when an answer of its was refused.
const askModel = (lane, messages, signal, { temperature = 0, seed = 1 } = {}) => withLineKind('member', async () => {
  if (!routes.has(lane)) routes.set(lane, resolveNeumaRoute(lane, null));
  const route = await routes.get(lane).catch((err) => { routes.delete(lane); throw err; });
  const stream = await createStreamRequest(messages.map((m) => ({ ...m, content: sound(m.content) })), { route, temperature, seed, maxTokens: 900, noThink: true, signal });
  return consumeStream(stream, () => {}, { signal });
});

/**
 * Start a run. Refused in words when the audience may not be worked, the seat is empty, or one already runs.
 * @param {string} wallet
 * @param {{segmentId: string, want?: number, screenOnly?: boolean, credits?: ?number}} ask - credits: the most lookup and
 *   check credits THIS run may spend (beside the operator's monthly rule); reached, it stops looking people up
 * @param {{intents: object[], fetchPage?: Function, ask?: Function, width?: number, by?: string}} deps - intents: the
 *   seat's own acts (sales/prospect, sales/contacts, sales/lead), handed in by the caller so this file imports no act
 * @returns {Promise<{ok: true, run: object, done: Promise<object>} | {ok: false, reason: string}>}
 */
export const startLeadRun = async (wallet, { segmentId, want = 100, screenOnly = false, credits = null, only = null }, { intents, fetchPage = guardedPage, ask = askModel, width = RUN_WIDTH } = {}) => {
  const house = String(wallet).toLowerCase();
  const officer = await croDesignation.getOfficer(wallet).catch(() => null);
  if (!officer?.laneId) return { ok: false, reason: 'no one is seated as the sales member: a run files as the seat, and the seat is empty' };
  const segments = await readSegments(wallet);
  const segment = segments.find((s) => s.id === String(segmentId ?? '').trim());
  if (!segment) return { ok: false, reason: 'that is not one of this house\'s audiences' };
  // An audience TEST screens the operator's own examples and nothing else: it is how an audience is checked BEFORE it is approved.
  if (segment.state !== 'approved' && !only) return { ok: false, reason: `"${segment.name}" is ${segment.state}, not approved — the operator approves an audience before a run works it` };
  if (runs.get(house)?.get(segment.id)?.active) return { ok: false, reason: `a lead run is already working "${segment.name}" — stop it, or wait for it to finish; another audience can run beside it` };
  const working = ofHouse(wallet).filter((r) => r.active).length;
  if (working >= runRoom()) return { ok: false, reason: `${working} lead run(s) are working, and that is every place your model has for them (it answers ${lineWidth()} at once; one is kept for your own chat) — stop one, or wait for one to finish` };
  const number = Math.min(Math.max(parseInt(want, 10) || 100, 1), RUN_MAX);
  const act = (name) => intents.find((i) => i.name === name);
  if (!act('sales/prospect') || !act('sales/contacts') || !act('sales/lead')) return { ok: false, reason: 'the run was not handed the seat\'s acts' };
  // screenOnly: read and screen, and stop there — no lookup, no check, no lead: nothing that spends a credit.
  const run = { id: `run-${Date.now().toString(36)}`, segmentId: segment.id, segment: segment.name, want: number, screenOnly: Boolean(screenOnly) || Boolean(only), only: Array.isArray(only) && only.length ? new Set(only) : null, credits: Number(credits) > 0 ? Math.floor(Number(credits)) : null, active: true, stopped: false, startedAt: new Date().toISOString(), counts: emptyCounts(), lines: [], domains: new Set(), abort: new AbortController() };
  if (!runs.has(house)) runs.set(house, new Map());
  runs.get(house).set(segment.id, run);
  const connection = { walletAddress: wallet, companion: { neumaId: officer.laneId, name: officer.laneId } };
  // The desk shows the last lines; EVERY line is kept on the run's record (lead-run-record.js).
  const say = (line) => { const at = new Date().toISOString(); run.lines.push(`${at.slice(11, 19)} ${line}`); if (run.lines.length > 200) run.lines.shift(); noteRunLine(wallet, run.id, line, at); };
  noteRunStarted(wallet, run, officer.laneId);
  const done = work({ wallet, run, segment, segments, connection, act, fetchPage, ask, width, say })
    .catch((err) => { run.ended = `it failed: ${err.message}`; log.error('A lead run failed', { run: run.id, error: err.message }); })
    .then(async () => {
      run.active = false;
      run.endedAt = new Date().toISOString();
      run.ended ??= run.stopped ? 'stopped' : run.thin && run.counts.leads < run.want ? `the companies left are not this audience: only ${run.thin.fits} of the last ${THIN_AFTER} screened were a fit, so it stopped rather than read ${run.thin.left + (run.waiting ?? 0)} more like them — gather narrower for this audience, then run it again` : run.counts.leads >= run.want ? 'it reached the number asked for' : run.counts.spentStop ? `the spending rule stopped the lookups: ${run.counts.spentStop}` : run.waiting > 0 ? `it looked at ${run.counts.looked} companies, the most one run looks at for ${run.want} lead(s) — ${run.waiting} more wait: start another run to go on` : 'every company gathered for this audience has been worked — gather more to go on';
      await noteRunEnded(wallet, run, officer.laneId);
      // The seat is woken to carry on: the research and first email for each new lead, then the next run or gather
      // (the house clock decides whether it may wake: its charter, its caps, its quiet hours).
      signalWake({ seat: officer.laneId, reason: 'lead-run-ended', ref: run.id, detail: { segment: segment.name, segmentId: segment.id, ended: run.ended, leads: run.counts.leads, written: run.counts.written ?? 0, unwritten: run.counts.unwritten ?? 0 } });
      await notifyOperator({ wallet, kind: KIND.companyLine, standing: STANDING.system, actor: { id: 'lead-run', name: 'lead run' }, ref: { run: run.id },
        title: `Lead run for "${segment.name}": ${run.counts.leads} lead(s) with a confirmed address${run.counts.written ? `, ${run.counts.written} email(s) staged for your review` : ''} — ${run.ended}`.slice(0, 200), detail: runWords(run.counts) }).catch(() => {});
      return view(run);
    });
  return { ok: true, run: view(run), done };
};

// impure — one act of the seat's, run as the seat: its own validation, then its own execution.
const file = async (intent, payload, connection, signal) => {
  const checked = await intent.validate(payload, { connection });
  if (!checked.ok) return { ok: false, reason: checked.reason, status: checked.status ?? 'invalid' };
  const out = await intent.execute(checked.value, { signal, emit: () => {} });
  return out.ok ? { ok: true, detail: out.detail ?? '' } : { ok: false, reason: out.reason ?? 'it did not land', status: 'failed' };
};

const work = async ({ wallet, run, segment, segments, connection, act, fetchPage, ask, width, say }) => {
  const { signal } = run.abort;
  const by = connection.companion.neumaId;
  const campaigns = await readCampaigns(wallet);
  const fundingOf = (seg) => isFundingCampaign(campaigns.find((c) => c.id === seg.campaign));
  const others = segments.filter((s) => s.id !== segment.id && s.state === 'approved').map((s) => ({ ...s, campaignName: campaigns.find((c) => c.id === s.campaign)?.name ?? '' }));
  const [candidates, searches] = await Promise.all([readCandidates(wallet), readSearches(wallet)]);
  const tooWide = new Set(wideFinds(searches, candidates).flatMap((f) => f.companies.map((c) => c.domain)));
  // What a run takes up: first the fits that only lack a lead, then the companies the seat kept or read, then the rest.
  const pool = await readProspects(wallet);
  const fits = pool.filter((p) => p.segmentId === segment.id && p.stage === 'found' && definingFit(p));
  const yields = sourceYield(candidates, pool, segment.id);
  const tellWords = signWords(segment);
  const funds = fundingOf(segment);
  // AN AUDIENCE TEST (audience-test.js) screens exactly the companies named, and nothing else waits on it.
  const queue = candidates.filter((c) => (run.only ? c.segmentId === segment.id && run.only.has(c.domain) && c.state === 'waiting' : screenable(c, segment.id, tooWide)))
    // …and among the rest, the source whose companies have been fits most often goes first (lead-run-shape.js sourceYield).
    // The likeliest first: what was gathered about a company already says much about whether its page will fit (leanOf).
    .map((c) => ({ c, lean: leanOf(c, tellWords, funds) }))
    .sort((a, b) => Number(Boolean(b.c.shortlist === 'kept')) - Number(Boolean(a.c.shortlist === 'kept')) || b.lean - a.lean || (yields.get(b.c.source)?.rate ?? 0) - (yields.get(a.c.source)?.rate ?? 0)
      || Number(Boolean(b.c.siteRead)) - Number(Boolean(a.c.siteRead)) || (Number(b.c.hunterEmails?.personal) || 0) - (Number(a.c.hunterEmails?.personal) || 0))
    .map((x) => x.c);
  const limit = run.want * LOOK_FACTOR;
  run.waiting = Math.max(0, queue.length - limit); // what this run will not reach: said when it ends
  say(`${fits.length} fit(s) wait for a person; ${queue.length} gathered companies wait to be screened`);
  const likely = queue.filter((c) => leanOf(c, tellWords, funds) > 0).length;
  if (queue.length) say(`the likeliest are read first: ${likely} of the ${queue.length} waiting say something of what this audience is in what was gathered about them${funds ? ' (an investor\'s words, or the first sign\'s)' : ''}; the other ${queue.length - likely} come after`);
  const waitingBy = queue.reduce((m, c) => m.set(c.source, (m.get(c.source) ?? 0) + 1), new Map());
  const order = [...waitingBy.keys()].sort((a, b) => (yields.get(b)?.rate ?? 0) - (yields.get(a)?.rate ?? 0));
  if (order.length > 1) say(`worked in this order, the source that has given the most fits first: ${order.map((src) => { const y = yields.get(src); return `${src} (${waitingBy.get(src)} waiting; ${y?.scored ? `${y.fit} of ${y.scored} screened so far were a fit` : 'none screened yet'})`; }).join(', then ')}`);
  // Once lookups have stopped (a limit reached), screening more companies cannot make a lead: the run ends.
  const going = () => !signal.aborted && !run.thin && !(run.counts.spentStop && !run.screenOnly) && (run.screenOnly ? run.counts.fit : run.counts.leads) < run.want;
  // Validation is owed whatever the lead count: it runs to its end unless the run is stopped.

  // 3–5: the person, the confirmed address, the lead.
  const ORDER = ['apollo', 'tomba', 'hunter'];
  const providers = (await attachedProviders().catch(() => [])).map((a) => a.id).sort((a, b) => (ORDER.indexOf(a) + 1 || 9) - (ORDER.indexOf(b) + 1 || 9));
  const spentOut = new Set(); // providers that said they are out of credits, for this run
  // THE NEVER-LIST (legal/never-list.js): the places this house never writes to, read from its legal office's record.
  const neverList = await readNeverList(wallet);
  say(`never written to, by the house's never-list${neverList.reviewed ? '' : ' (the baseline: this house\'s legal member has not set its own yet)'}: ${neverList.countries.map((c) => c.name).join(', ')}`);
  // 6–7 RESEARCH AND EMAIL (lead-run-write.js): written the moment a lead is filed, from the page already read.
  const writer = run.screenOnly ? null : await makeWriter({ wallet, run, segment, connection, act, file, ask, fetchPage, say, signal });
  if (writer && !writer.ok) say(`research and emails are not written by this run: ${writer.why} — its leads end cold, for the sales member`);
  const pagesRead = new Map(); // domain → the page this run read, for the writer
  const keep = (domain, text, url) => { pagesRead.set(domain, { text, url }); if (pagesRead.size > 400) pagesRead.delete(pagesRead.keys().next().value); };
  say(`people are looked for at: ${providers.join(', then ') || 'no provider attached — the company\'s own pages only'}`);
  // What this run has spent so far: every lookup and check on record since it began.
  const spentNow = async () => { run.spent = Math.round((await readContactLookups(wallet)).filter((l) => String(l.at) >= run.startedAt && run.domains.has(l.domain)).reduce((n, l) => n + (Number.isFinite(Number(l.spent)) ? Number(l.spent) : 1), 0) * 10) / 10; return run.spent; };
  const lead = async (prospect, site, askedWhere = false) => {
    if (!going() || run.screenOnly) return;
    if (run.credits && !run.counts.spentStop && await spentNow() >= run.credits) { run.counts.spentStop = `this run's own limit of ${run.credits} credits was reached`; say(`lookups stopped: ${run.counts.spentStop}`); }
    if (run.counts.spentStop) { run.counts.noAddress += 1; return; }
    // A company known to be OUTSIDE the audience's countries is never written to for it, so nobody is looked up there
    // (seen live 2026-11-21: every run asked again for the same fits in India and elsewhere, then was refused the lead).
    if (neverSign({ country: prospect.country, domain: prospect.domain }, neverList.codes)) { run.counts.never = (run.counts.never ?? 0) + 1; return; }
    const where = prospect.country ?? countryOfAddress(`x@${prospect.domain}`);
    if (where && segment.countries?.length && !segment.countries.includes(where)) { run.counts.elsewhere = (run.counts.elsewhere ?? 0) + 1; return; }
    // A fit scored with no country (an earlier run's, or the seat's) is asked where it is, from its own pages, before anyone is looked up.
    let open = false;
    if (!prospect.country && askedWhere) { open = true; say(`${prospect.name}: a fit, and none of its pages says where it is — its person is still found and filed, marked COUNTRY TO FIND`); }
    else if (!prospect.country) {
      const pages = [];
      await readCompanySite(prospect.domain, { signal, fetchPage: async (target, o) => { const got = await fetchPage(target, o); if (got?.ok) pages.push(got); return got; } });
      const where = pages.length ? readWhere(await ask(by, whereMessages({ company: prospect, text: pages.slice().reverse().map((p) => pageWords(p.html)).join('\n') }), signal).catch(() => null)) : null;
      // No country never stops a lead (Design note, 2026-11-21: it is filed with its country open, and held from email until one stands.
      if (where) { await noteProspectCountry(wallet, prospect.id, where, by); prospect = { ...prospect, country: where }; }
      else { open = true; say(`${prospect.name}: a fit, and none of its pages says where it is — its person is still found and filed, marked COUNTRY TO FIND`); }
    }
    const own = (site?.emails ?? []).map((e) => (typeof e === 'string' ? { email: e } : e)).filter((e) => e.email)
      .map((e) => ({ name: `${prospect.name} team`, role: 'general address', email: e.email, sourceUrl: e.page && /^https:/.test(e.page) ? e.page : `https://${prospect.domain}/`, general: true }));
    const filed = (prospect.people ?? []).filter((p) => p.email);
    let held = (await readContactPeople(wallet)).filter((l) => l.domain === prospect.domain).flatMap((l) => l.people ?? []);
    // The decision maker is looked for at EVERY attached provider in turn, the one with the widest database first,
    // until one returns a person with an address. (The first live run asked only the first provider attached — one
    // that was out of credits — and so filed general mailboxes for funds whose partners another provider held.)
    for (const source of providers) {
      if (filed.length || held.some((p) => p.email) || run.counts.spentStop || spentOut.has(source) || !going()) break;
      run.domains.add(prospect.domain);
      const asked = await file(act('sales/contacts'), { domain: prospect.domain, source, people: 1 }, connection, signal);
      if (!asked.ok && asked.status === 'denied' && /PAID LEAD DATA|the month|cap\b/i.test(asked.reason)) { run.counts.spentStop = asked.reason.slice(0, 160); say(`lookups stopped: ${run.counts.spentStop}`); }
      else if (!asked.ok && /out of credits|quota|limit for now|plan may not|refused the key/i.test(asked.reason)) { spentOut.add(source); say(`${source} is not answering lookups (${asked.reason.slice(0, 100)}): the next provider is asked from here on`); }
      held = (await readContactPeople(wallet)).filter((l) => l.domain === prospect.domain).flatMap((l) => l.people ?? []);
    }
    const order = firstToWrite([...filed, ...held, ...own], segment.targetRole);
    if (order.length) run.counts.people += 1;
    let asked = 0;
    for (const person of order) {
      if (!going()) return;
      let confirmed = person.checked === 'valid';
      if (!confirmed) {
        const known = (await readAddressChecks(wallet)).find((c) => c.email === person.email);
        if (known?.status === 'valid') confirmed = true;
        else if (known && known.status !== 'unknown') continue; // already asked and not confirmed: the next person
        else if (asked < CHECKS_A_COMPANY) { asked += 1; confirmed = (await confirmWithAny(wallet, person.email, { by, signal })).check?.status === 'valid'; }
      }
      if (!confirmed) continue;
      const source = /^https:\/\/\S+$/.test(String(person.sourceUrl ?? '')) ? person.sourceUrl : `https://${prospect.domain}/`;
      const put = await file(act('sales/lead'), { id: prospect.id, person: { name: person.name || `${prospect.name} team`, role: person.role || 'general address' }, email: person.email, emailSource: source, note: `filed by lead run ${run.id}` }, connection, signal);
      if (put.ok) {
        run.counts.leads += 1; if (open) run.counts.countryOpen += 1; say(`LEAD ${prospect.name} — ${person.name || 'team'} <${person.email}>${open ? ' · COUNTRY TO FIND' : ''}`);
        if (writer?.ok) await writer.write({ prospect, email: person.email, person: { name: person.name || `${prospect.name} team`, role: person.role || 'general address' }, page: pagesRead.get(prospect.domain) ?? null }).catch((err) => say(`${prospect.name}: its research and email were not written (${err.message})`));
        return;
      }
      say(`${prospect.name}: ${person.email} was not filed — ${put.reason.slice(0, 140)}`);
      if (/country|not approved|no match|REQUIRED|investor|never written/i.test(put.reason)) break; // the company itself is held, not the person
    }
    run.counts.noAddress += 1;
  };

  // Each page read, with its own words and its own description of itself: where a required sign may be proved from.
  // A PAGE'S OWN WORDS are what it shows a reader AND how it describes itself to one (its title and description). An
  // app drawn in the browser shows almost nothing unrendered, and its description is then all it says of itself:
  // found on the sales bench, where Moonwell ([…]), Aerodrome and Seamless were each
  // counted unreadable for want of eighty characters of body, with what they are standing in their own description.
  const ownWords = (p) => { const shown = pageWords(p.html); const said = [extractTitle(p.html), describedAs(p.html)].filter((x) => x && !shown.includes(x)).join('\n'); return said ? `${shown}\n${said}`.trim() : shown; };
  const proofPages = (pages, first) => pages.map((p, i) => ({ url: i === 0 ? first : (/^https:/.test(p.url) ? p.url : first), text: ownWords(p) }));
  const recent = []; // each company this run screened, in order: was it a fit
  // 1–2 for one company; a no-fit that reads as another audience of the house is moved there, for that audience's run.
  const screen = async (company, seg) => {
    const pages = [];
    const site = await readCompanySite(company.domain, { signal, fetchPage: async (target, o) => { const got = await fetchPage(target, o); if (got?.ok) pages.push(got); return got; } });
    await noteSites(wallet, [{ domain: company.domain, site }], by);
    // Dead, walled, or answering from another company's address (sold, parked, folded into someone else): left.
    if (!site.alive || site.blocked || site.movedTo || !pages.length) { run.counts.dead += 1; return; }
    const url = /^https:/.test(pages[0].url) ? pages[0].url : `https://${company.domain}/`;
    // Every quote comes from the first page (so it stands when that page is read again); the screener reads them all.
    const text = ownWords(pages[0]);
    const all = pages.map(ownWords).join('\n\n');
    if (text.length < THIN_PAGE) { run.counts.dead += 1; return; }
    keep(company.domain, all, url);
    const funding = fundingOf(seg);
    const answer = readAnswer(await ask(by, screenMessages({ segment: seg, company, text: `${text.slice(0, TEXT_MAX - 1500)}\n${all.slice(text.length, text.length + 1500)}`, funding }), signal).catch((err) => { if (!signal.aborted) say(`${company.domain}: the screener did not answer (${err.message})`); return null; }));
    if (signal.aborted) { run.counts.looked -= 1; return; } // stopped mid-question: this company was not worked, and waits for the next run
    const made = answer ? filingOf({ segment: seg, company, answer, text, url, funding, all, pages: proofPages(pages, url) }) : { ok: false, why: 'the screener gave no answer that could be read' };
    if (!made.ok) { run.counts.unclear += 1; say(`${company.domain}: left for the seat — ${made.why}`); return; }
    // A fit with no country cannot be written to: one narrow question more, from its contact and about pages first.
    if (!made.company.country && (made.company.scores[0]?.score ?? 0) >= DEFINING_MIN) {
      let where = readWhere(await ask(by, whereMessages({ company, text: `${all.slice(text.length)}\n${text}` }), signal).catch(() => null));
      // Its legal pages name the entity and the law it stands under, when nothing else says where it is (where-pages.js).
      if (!where) { const legal = await readLegalPages(company.domain, { fetchPage, signal, homeHtml: pages[0].html, words: pageWords }); if (legal) where = readWhere(await ask(by, whereMessages({ company, text: legal }), signal).catch(() => null)); }
      if (where) made.company.country = where;
    }
    // A sign that it is in a place the house never writes to outranks whatever else its pages say of where it is.
    const never = neverSign({ country: made.company.country, domain: company.domain, emails: site.emails ?? [], text: all }, neverList.codes);
    if (never) { made.company.country = never.code; say(`NEVER ${company.domain}: ${never.why} — screened and kept on record, nobody there is written to`); }
    const put = await file(act('sales/prospect'), { segment: seg.id, companies: [whereScored(made.company, seg)] }, connection, signal);
    if (!put.ok) { run.counts.unclear += 1; say(`${company.domain}: not filed — ${put.reason.slice(0, 160)}`); return; }
    run.counts.screened += 1;
    const prospect = (await readProspects(wallet)).find((p) => p.domain === made.company.domain && p.segmentId === seg.id && p.stage === 'found');
    // A company the page shows to be what the audience IS is on its approved list by this screening: no list for the operator to read.
    // Has the pool run thin? The last THIN_AFTER screened, counted as they come.
    recent.push(definingFit(prospect));
    if (!run.thin && recent.length >= THIN_AFTER && recent.slice(-THIN_AFTER).filter(Boolean).length <= THIN_FITS) {
      run.thin = { fits: recent.slice(-THIN_AFTER).filter(Boolean).length, left: Math.max(0, Math.min(queue.length, limit) - run.counts.looked) };
      say(`THE POOL HAS RUN THIN: only ${run.thin.fits} of the last ${THIN_AFTER} companies screened were a fit — the rest are not read`);
    }
    if (definingFit(prospect)) { run.counts.fit += 1; await listScreened(wallet, seg.id, [prospect.id], `lead-run:${by}`).catch(() => 0); await lead(prospect, site); return; }
    // A fit by the audience's average that the page does not show to be what the audience IS: scored, never pursued by a run.
    // It was just read from its own page, so it does not wait to be validated: it is settled here, the way validation
    // settles it (found 2026-11-21 in the live records: every run left about 110 of these standing, and the next run
    // read each one a second time only to put it out).
    if (prospect?.match >= 2) {
      run.counts.weak += 1;
      const own = others.find((o) => o.id === prospect.belongsTo) ?? belongsElsewhere(prospect, others);
      if (own) { await handProspect(wallet, prospect.id, { type: 'moved', segmentId: own.id, by: `lead-run:${by}` }); run.counts.moved += 1; say(`MOVED ${prospect.name}: it belongs to "${own.name}"`); return; }
      await settleProspect(wallet, prospect.id, { type: 'dropped', reason: `screened from its own page: ${prospect.fit?.[0]?.reasoning ?? 'it does not show what this audience is'}`.slice(0, 300), by: `lead-run:${by}` });
      return;
    }
    run.counts.nofit += 1;
    // Where it belongs instead: where the audience's required sign sends it, or the audience its own disqualifier names.
    const home = others.find((o) => o.id === prospect?.belongsTo) ?? belongsElsewhere(prospect, others);
    if (!home) return;
    run.counts.moved += 1;
    say(`${company.domain}: no fit here — it belongs to "${home.name}", moved there`);
    await moveCandidate(wallet, { domain: company.domain, segmentId: home.id, why: `no fit for "${seg.name}", which sends such a company here`, by });
  };

  // 0 VALIDATE: one company already scored a fit, read again and screened from its own page.
  const validate = async (prospect, seg, pursue) => {
    if (signal.aborted) return;
    run.counts.checked += 1;
    const pages = [];
    const site = await readCompanySite(prospect.domain, { signal, fetchPage: async (target, o) => { const got = await fetchPage(target, o); if (got?.ok) pages.push(got); return got; } });
    const text = pages.length ? ownWords(pages[0]) : '';
    // A page that cannot be read proves nothing either way: the company stays as it stood.
    if (!site.alive || site.blocked || site.movedTo || text.length < THIN_PAGE) { run.counts.left += 1; say(`${prospect.name}: its site could not be read — left as it stood`); return; }
    const url = /^https:/.test(pages[0].url) ? pages[0].url : `https://${prospect.domain}/`;
    const all = pages.map(ownWords).join('\n\n');
    keep(prospect.domain, all, url);
    const funding = fundingOf(seg);
    const answer = readAnswer(await ask(by, screenMessages({ segment: seg, company: prospect, text: `${text.slice(0, TEXT_MAX - 1500)}\n${all.slice(text.length, text.length + 1500)}`, funding }), signal).catch(() => null));
    if (signal.aborted) { run.counts.checked -= 1; return; }
    const made = answer ? filingOf({ segment: seg, company: prospect, answer, text, url, funding, all, pages: proofPages(pages, url) }) : { ok: false };
    if (made.ok) made.company = whereScored({ ...made.company, country: made.company.country ?? prospect.country ?? undefined }, seg);
    if (!made.ok) { run.counts.left += 1; say(`${prospect.name}: the screening could not be read — left as it stood`); return; }
    const banned = neverSign({ country: prospect.country ?? made.company.country, domain: prospect.domain, emails: site.emails ?? [], text: all }, neverList.codes);
    if (banned) { await settleProspect(wallet, prospect.id, { type: 'dropped', reason: `never written to: ${banned.why}`.slice(0, 300), by: `lead-run:${by}` }); run.counts.out += 1; say(`NEVER ${prospect.name}: ${banned.why} — out`); return; }
    // What it IS, on record (a funding audience writes only to investors): sales/entity takes a company that is not one out by itself.
    if (funding && !(await readResearch(wallet)).entities.get(prospect.domain)) {
      const put = await file(act('sales/entity'), { domain: prospect.domain, name: prospect.name, entityType: made.company.entityType, quote: made.company.entityEvidence.quote, source: made.company.entityEvidence.source }, connection, signal);
      if (!put.ok) { run.counts.left += 1; say(`${prospect.name}: what it is could not be recorded (${put.reason.slice(0, 120)}) — left as it stood`); return; }
      if (!(await readProspects(wallet)).some((p) => p.id === prospect.id && p.stage === 'found')) { run.counts.out += 1; say(`OUT ${prospect.name}: its own page shows ${made.company.entityType}, not an investor`); return; }
    }
    // The record takes what this reading found: the scores that stand on a validated company are the ones its page gave.
    const fresh = (() => { try { return makeProspect({ ...made.company, segment: seg, by, now: new Date().toISOString() }); } catch { return null; } })();
    if (fresh) await rescoreProspect(wallet, prospect.id, fresh, `lead-run:${by}`);
    const scored = { ...prospect, match: fresh?.match ?? 2, fit: fresh?.fit ?? made.company.scores.slice(0, (seg.positiveCriteria ?? []).length), misfit: fresh?.misfit ?? made.company.scores.slice((seg.positiveCriteria ?? []).length) };
    if (!definingFit(scored)) {
      const home = belongsElsewhere(scored, others.filter((o) => o.id !== seg.id));
      if (home) { await handProspect(wallet, prospect.id, { type: 'moved', segmentId: home.id, by: `lead-run:${by}` }); run.counts.moved += 1; say(`MOVED ${prospect.name}: it belongs to "${home.name}"`); return; }
      await settleProspect(wallet, prospect.id, { type: 'dropped', reason: `screened from its own page: ${scored.fit[0]?.reasoning ?? 'it does not show what this audience is'}`.slice(0, 300), by: `lead-run:${by}` });
      run.counts.out += 1; say(`OUT ${prospect.name}: ${String(scored.fit[0]?.reasoning ?? '').slice(0, 110)}`); return;
    }
    if (!prospect.country && made.company.country) await noteProspectCountry(wallet, prospect.id, made.company.country, by);
    await listScreened(wallet, seg.id, [prospect.id], `lead-run:${by}`).catch(() => 0);
    run.counts.held += 1; say(`HOLDS ${prospect.name} — "${seg.name}"`);
    if (pursue) await lead({ ...prospect, country: prospect.country ?? made.company.country ?? null }, site, true);
  };
  // 0a PROVE: a company filed before its audience REQUIRED something has no proof of it — and may be the wrong
  // company for it altogether (found 2026-11-21: 37 of 255 leads of the crypto-funds audience were funds whose pages
  // name nothing crypto — Kleiner Perkins, GV, Bessemer — scored 5 for […]). Each is proved from
  // its own page, by the page's own words (never the model's say-so): met, it stays; not met, the seat's own act
  // moves it to the audience it belongs to and withdraws what was written for this one (sales/prove).
  const prove = async (prospect, seg) => {
    if (signal.aborted) return;
    const pages = [];
    const site = await readCompanySite(prospect.domain, { signal, fetchPage: async (target, o) => { const got = await fetchPage(target, o); if (got?.ok) pages.push(got); return got; } });
    const text = pages.length ? ownWords(pages[0]) : '';
    if (!site.alive || site.blocked || site.movedTo || text.length < THIN_PAGE) { run.counts.left += 1; return; } // unreadable proves nothing: it stays unproved, and no first email is written to it until it is
    const url = /^https:/.test(pages[0].url) ? pages[0].url : `https://${prospect.domain}/`;
    const proofs = seg.required.map((r) => { const quote = sentenceWith(text, r.evidence, prospect.name); return quote ? { sign: r.sign, met: true, quote, source: url } : { sign: r.sign, met: false, reasoning: `nothing on ${url} says it: none of its sentences holds ${r.evidence.map((w) => `"${w}"`).join(' or ')}` }; });
    const put = await file(act('sales/prove'), { segment: seg.id, companies: [{ id: prospect.id, proofs }] }, connection, signal);
    if (!put.ok) { run.counts.left += 1; say(`${prospect.name}: could not be proved against what "${seg.name}" requires — ${put.reason.slice(0, 140)}`); return; }
    run.counts.proved = (run.counts.proved ?? 0) + 1;
    if (/DOES NOT/.test(put.detail)) { run.counts.unmet = (run.counts.unmet ?? 0) + 1; say(`NOT THIS AUDIENCE ${prospect.name}: ${put.detail.replace(/^\[[^\]]+\]\s*[^:]+:\s*/, '').slice(0, 200)}`); }
  };
  const coldLeads = new Set((await (await leadLedgerFor(wallet)).load().catch(() => [])).filter((l) => l.status === 'cold').map((l) => l.id));
  const toProve = act('sales/prove') ? [segment, ...others].filter((seg) => seg.required?.length).flatMap((seg) => pool
    .filter((p) => p.segmentId === seg.id && !p.placed && (p.stage === 'found' || (p.stage === 'promoted' && coldLeads.has(p.leadId))) && requiredState(seg, p).state === 'unproved')
    .map((p) => ({ p, seg }))) : [];
  if (toProve.length) say(`${toProve.length} compan${toProve.length === 1 ? 'y was' : 'ies were'} filed before their audience required something: each is proved from its own page first`);
  // What sits waiting: scored a fit and never confirmed by a screening — for this audience (and then pursued), and for every other approved one.
  const entities = (await readResearch(wallet)).entities;
  const everyone = [segment, ...others];
  const waitingFor = (seg) => pool.filter((p) => p.segmentId === seg.id && p.stage === 'found' && p.match >= 2 && (!p.listApproved || (fundingOf(seg) && !entities.get(p.domain))));
  const toValidate = everyone.flatMap((seg) => waitingFor(seg).map((p) => ({ p, seg })));
  const validating = new Set(toValidate.map((x) => x.p.id));
  say(`${toValidate.length} compan${toValidate.length === 1 ? 'y waits' : 'ies wait'} to be validated across ${everyone.length} audience(s)`);
  // One company is worked by one run at a time: a run beside this one that already has it in hand keeps it.
  if (!claimed.has(String(wallet).toLowerCase())) claimed.set(String(wallet).toLowerCase(), new Set());
  const inHand = claimed.get(String(wallet).toLowerCase());
  // …and never a second time by a run working beside it: each run takes the same list of fits waiting for validation,
  // so what one has finished since this run began is not done again by this one.
  if (!finished.has(String(wallet).toLowerCase())) finished.set(String(wallet).toLowerCase(), new Map());
  const settled = finished.get(String(wallet).toLowerCase());
  const began = Date.parse(run.startedAt);
  const alone = (domain, job, audience = segment.id) => async () => {
    const key = `${audience}:${domain}`;
    if (inHand.has(domain) || (settled.get(key) ?? 0) >= began) { run.counts.beside = (run.counts.beside ?? 0) + 1; return; }
    inHand.add(domain);
    try { await job(); } finally { inHand.delete(domain); settled.set(key, Date.now()); if (settled.size > 20000) settled.clear(); }
  };
  // An audience with a run of its own is that run's to validate (it also files the lead); this one leaves it alone.
  const theirs = (audienceId) => ofHouse(wallet).some((r) => r.active && r !== run && r.segmentId === audienceId);
  // What was filed before and still waits for its research or its email (Design note, 2026-11-22: a lead typically waited 8.6 hours for it).
  const toWrite = writer?.ok ? await writer.waiting() : [];
  if (run.only) { toProve.length = 0; toValidate.length = 0; fits.length = 0; }
  if (toWrite.length) say(`${toWrite.length} lead(s) filed earlier still wait for their research or first email: each is written now`);
  const writeJobs = toWrite.map((w) => alone(w.prospect.domain, async () => { const p = (await readProspects(wallet)).find((x) => x.id === w.prospect.id); if (p?.segmentId === segment.id && p.stage === 'promoted') await writer.write({ ...w, prospect: p }); }, `write:${segment.id}`));
  const jobs = [...toProve.map(({ p, seg }) => alone(p.domain, () => prove(p, seg), `prove:${seg.id}`)), ...toValidate.map(({ p, seg }) => alone(p.domain, () => (seg.id !== segment.id && theirs(seg.id) ? (run.counts.beside = (run.counts.beside ?? 0) + 1) : validate(p, seg, seg.id === segment.id)), seg.id)), ...writeJobs, ...fits.filter((p) => !validating.has(p.id)).map((p) => alone(p.domain, () => lead(p, null))), ...queue.slice(0, limit).map((c) => alone(c.domain, async () => { run.counts.looked += 1; await screen(c, segment); }))];
  let next = 0;
  const worker = async () => { while ((going() || (next < toProve.length + toValidate.length + toWrite.length && !signal.aborted)) && next < jobs.length) { const job = jobs[next]; next += 1; await job().catch((err) => say(`a company failed: ${err.message}`)); } };
  await Promise.all(Array.from({ length: Math.max(1, width) }, worker));
  // The dead ends leave FILTER so the next run does not read them again.
  const dead = (await readCandidates(wallet)).filter((c) => c.segmentId === segment.id && c.siteRead && !c.siteRead.alive && !c.shortlist).map((c) => c.domain);
  if (dead.length) await noteShortlist(wallet, { segmentId: segment.id, domains: dead, verdict: 'passed', why: 'its site is dead or cannot be reached', by });
  await spentNow().catch(() => 0);
  say(`${runWords(run.counts)} · ${run.spent} credit(s) spent`);
};
