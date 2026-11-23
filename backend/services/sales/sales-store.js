// The lead engine's office files — the Mercator's segments, its prospect pool,
// the do-not-contact list, when each sending address first wrote to a lead,
// and the sales facts sheet, each append-only events in the house's revenue
// office (`<realm>/<wallet>/offices/revenue/`), folded by their shapes. Every
// write re-judges under one write chain, so two filings racing land once.
// impure.

import { officeFile } from '../house-office.js';
import { createWriteChain } from '../write-chain.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';
import { foldSegments, judgeState, judgeRefile } from './segment-shape.js';
import { requiredSigns } from './required-signs.js';
import { foldProspects, poolRefusal, listable } from './prospect-shape.js';
import { foldSuppressions, suppressionMatcher } from './suppress-shape.js';
import { foldSalesFacts, judgeSheetReview, editSheetFact } from './sales-facts.js';
import { foldCampaigns, openRefusal, judgeMove } from './campaign-shape.js';
import { verdictOf } from './address-verdict.js';
import { partnerOf } from './lead-provenance.js';

const serialize = createWriteChain();
const SEGMENTS = 'segments.jsonl';
const PROSPECTS = 'prospects.jsonl';
const SUPPRESS = 'suppress.jsonl';
const SENDERS = 'senders.jsonl';
const FACTS = 'sales-facts.jsonl';
const CANDIDATES = 'candidates.jsonl';
const CAMPAIGNS = 'campaigns.jsonl';
const fileOf = (wallet, name) => officeFile(wallet, 'revenue', name);
const events = async (wallet, name) => (await readJsonLines(fileOf(wallet, name))).records;

/** The house's segments, oldest first. */
export const readSegments = async (wallet) => foldSegments(await events(wallet, SEGMENTS));
/** The house's prospect pool, oldest first, every stage. */
export const readProspects = async (wallet) => foldProspects(await events(wallet, PROSPECTS));
/** The do-not-contact entries. */
export const readSuppressions = async (wallet) => foldSuppressions(await events(wallet, SUPPRESS));

/** File a new segment, or refile one (same id). @returns {Promise<{ok: true, segment: object} | {ok: false, reason: string}>} */
export const fileSegment = (wallet, segment) => serialize(async () => {
  const judged = judgeRefile((await readSegments(wallet)).find((s) => s.id === segment.id));
  if (!judged.ok) return judged;
  await appendJsonLine(fileOf(wallet, SEGMENTS), { type: 'filed', segment, at: segment.filedAt });
  return { ok: true, segment: (await readSegments(wallet)).find((s) => s.id === segment.id) };
});

/** Move a segment to a state (the operator's approve, pause, retire). */
export const setSegmentState = (wallet, id, state, by) => serialize(async () => {
  const judged = judgeState((await readSegments(wallet)).find((s) => s.id === id), state);
  if (!judged.ok) return judged;
  await appendJsonLine(fileOf(wallet, SEGMENTS), { type: 'state', id, state, by, at: new Date().toISOString() });
  return { ok: true };
});

/**
 * The operator says what an audience REQUIRES of a company (required-signs.js): [{sign, evidence: [words],
 * otherwise?: another audience's id}], or [] for nothing. It stands at once — the operator's own word needs no
 * approval — and every company already filed is proved against it by the next lead run.
 * @returns {Promise<{ok: true, required: object[]} | {ok: false, reason: string}>}
 */
export const setSegmentRequired = (wallet, id, given, by) => serialize(async () => {
  const segments = await readSegments(wallet);
  const segment = segments.find((s) => s.id === id);
  if (!segment) return { ok: false, reason: 'no such segment' };
  const { problems, required } = requiredSigns(given ?? []);
  if (problems.length) return { ok: false, reason: problems.join('; ') };
  const lost = required.find((r) => r.otherwise && (r.otherwise === id || !segments.some((s) => s.id === r.otherwise)));
  if (lost) return { ok: false, reason: `"${lost.otherwise}" is not another audience of this house — choose the audience a company that fails this belongs to, or none` };
  await appendJsonLine(fileOf(wallet, SEGMENTS), { type: 'required', id, required, by, at: new Date().toISOString() });
  return { ok: true, required };
});

/**
 * Add prospects to the pool, each judged against the pool and the
 * do-not-contact list as it stands (a batch never holds one company twice).
 * @returns {Promise<{added: object[], refused: Array<{domain: string, reason: string}>}>}
 */
export const addProspects = (wallet, prospects) => serialize(async () => {
  const pool = await readProspects(wallet);
  const blocked = suppressionMatcher(await readSuppressions(wallet));
  const added = [];
  const refused = [];
  for (const prospect of prospects) {
    // A lead put under this audience and never scored for it (sales/place) is scored by this very filing: its own
    // record takes the scores, so no rule sends the seat to an act another rule refuses.
    const placed = pool.find((p) => p.placed && !p.fit?.length && p.segmentId === prospect.segmentId && p.domain === prospect.domain && p.stage !== 'dropped');
    if (placed && !blocked.domain(prospect.domain)) {
      await appendJsonLine(fileOf(wallet, PROSPECTS), { type: 'scored', id: placed.id, prospect, at: prospect.foundAt });
      added.push({ ...prospect, id: placed.id });
      continue;
    }
    const reason = poolRefusal(prospect, [...pool, ...added.map((p) => ({ ...p, stage: 'found' }))], blocked.domain);
    if (reason) {
      refused.push({ domain: prospect.domain, reason });
      continue;
    }
    await appendJsonLine(fileOf(wallet, PROSPECTS), { type: 'found', prospect, at: prospect.foundAt });
    added.push(prospect);
  }
  return { added, refused };
});

/** A person read on a company's pages after it was scored joins that prospect's people. */
export const addProspectPerson = (wallet, id, person, by) => serialize(() =>
  appendJsonLine(fileOf(wallet, PROSPECTS), { type: 'people', id, people: [person], by, at: new Date().toISOString() }));

/**
 * The operator's hands on one scored company (Design note, 2026-11-18: […]): dropped (off the pool, or off the lead list — the caller closes its lead), unlisted (off
 * the approved list), or moved under another audience of this house. One event, the fold says the rest.
 * @param {{type: 'dropped'|'unlisted'|'moved', reason?: string, segmentId?: string, by: string}} event
 * @returns {Promise<{ok: true, prospect: object} | {ok: false, reason: string}>}
 */
export const handProspect = (wallet, id, event) => serialize(async () => {
  const prospect = (await readProspects(wallet)).find((p) => p.id === id);
  if (!prospect) return { ok: false, reason: `"${id}" is not a scored company of this house` };
  if (prospect.stage === 'dropped') return { ok: false, reason: `${prospect.name} was already taken off` };
  if (event.type === 'unlisted' && !prospect.listApproved) return { ok: false, reason: `${prospect.name} is not on an approved list` };
  if (event.type === 'moved') {
    if (event.segmentId === prospect.segmentId) return { ok: false, reason: `${prospect.name} already stands under that audience` };
    if (!(await readSegments(wallet)).some((s) => s.id === event.segmentId)) return { ok: false, reason: `"${event.segmentId}" is not an audience of this house` };
  }
  await appendJsonLine(fileOf(wallet, PROSPECTS), { ...event, id, at: new Date().toISOString() });
  return { ok: true, prospect };
});

/** Mark a prospect dropped (with why) or promoted (with its lead). Only a prospect still in the pool moves. */
export const settleProspect = (wallet, id, event) => serialize(async () => {
  const prospect = (await readProspects(wallet)).find((p) => p.id === id);
  if (!prospect) return { ok: false, reason: `prospect "${id}" is not in the pool` };
  if (prospect.stage !== 'found') return { ok: false, reason: `prospect [${id}] is already ${prospect.stage}` };
  await appendJsonLine(fileOf(wallet, PROSPECTS), { ...event, id, at: new Date().toISOString() });
  return { ok: true, prospect };
});

/** Keep a company's proofs for what its audience requires (required-signs.js), whatever its stage. impure. */
export const proveProspect = (wallet, id, proofs, by) => serialize(async () => {
  if (!(await readProspects(wallet)).some((p) => p.id === id)) return { ok: false, reason: `prospect "${id}" is not in the pool` };
  await appendJsonLine(fileOf(wallet, PROSPECTS), { type: 'proved', id, proofs, by, at: new Date().toISOString() });
  return { ok: true };
});

/**
 * Put a lead already on the ledger under an audience (prospect-shape.js `placed`): the lead and the emails
 * staged to it read that audience's campaign from then on. Refused when the audience is not this house's, or
 * the lead already stands under it.
 * @returns {Promise<{ok: true} | {ok: false, reason: string}>}
 */
export const placeLead = (wallet, { leadId, segmentId, name, domain, by }) => serialize(async () => {
  if (!(await readSegments(wallet)).some((s) => s.id === segmentId)) return { ok: false, reason: `audience "${segmentId}" is not in this house` };
  if ((await readProspects(wallet)).some((p) => p.leadId === leadId && p.segmentId === segmentId)) return { ok: false, reason: `that lead already stands under audience [${segmentId}]` };
  await appendJsonLine(fileOf(wallet, PROSPECTS), { type: 'placed', leadId, segmentId, name: String(name ?? '').slice(0, 120), domain: domain || null, by, at: new Date().toISOString() });
  return { ok: true };
});

/**
 * The operator approves an approved segment's list as it stands: every weak or
 * strong match in its pool not yet on the list. Its leads' emails may then go
 * within the sales cover (sales-cover.js) without a card each.
 * @returns {Promise<{ok: true, count: number} | {ok: false, reason: string}>}
 */
export const approveList = (wallet, segmentId, by, expectedIds) => serialize(async () => {
  const segment = (await readSegments(wallet)).find((s) => s.id === segmentId);
  if (!segment) return { ok: false, reason: 'no such segment' };
  if (segment.state !== 'approved') return { ok: false, reason: 'approve the pitch first — a list is approved only under an approved pitch' };
  const ids = listable(await readProspects(wallet), segmentId).map((p) => p.id);
  const asked = Array.isArray(expectedIds) ? expectedIds.map(String) : [];
  if (!ids.length) return { ok: false, reason: 'nothing new to approve on this list' };
  if (!asked.length || asked.length !== ids.length || new Set(asked).size !== asked.length || asked.some((id) => !ids.includes(id))) {
    return { ok: false, reason: 'the list changed — read it again and approve exactly the companies on screen' };
  }
  await appendJsonLine(fileOf(wallet, PROSPECTS), { type: 'listed', segmentId, ids, by, at: new Date().toISOString() });
  return { ok: true, count: ids.length };
});

/**
 * Companies a LEAD RUN screened as what their audience is go onto its approved list by themselves (Design note, 2026-11-21:
 * […]). Only under an approved audience, only companies that are listable; said as the run's.
 * The emails to them still wait for the operator in EMAILS. @returns {Promise<number>} how many were listed
 */
export const listScreened = (wallet, segmentId, ids, by) => serialize(async () => {
  const segment = (await readSegments(wallet)).find((s) => s.id === segmentId);
  if (segment?.state !== 'approved') return 0;
  const open = new Set(listable(await readProspects(wallet), segmentId).map((p) => p.id));
  const mine = [...new Set(ids.map(String))].filter((id) => open.has(id));
  if (mine.length) await appendJsonLine(fileOf(wallet, PROSPECTS), { type: 'listed', segmentId, ids: mine, by, screened: true, at: new Date().toISOString() });
  return mine.length;
});

/**
 * A scored company read again and scored afresh by the house's screening (lead-run.js validation): its record takes
 * the new scores, so what stands on it is what the page shows — and keeps its id, its audience, its people and its place.
 */
export const rescoreProspect = (wallet, id, prospect, by) => serialize(async () => {
  if (!(await readProspects(wallet)).some((p) => p.id === id)) return { ok: false, reason: `prospect "${id}" is not in the pool` };
  await appendJsonLine(fileOf(wallet, PROSPECTS), { type: 'scored', id, prospect, by, validated: true, at: new Date().toISOString() });
  return { ok: true };
});

/** A scored company's country, read from its own pages after it was scored: kept only where none stood. */
export const noteProspectCountry = (wallet, id, country, by, source = null) => serialize(() =>
  appendJsonLine(fileOf(wallet, PROSPECTS), { type: 'country', id, country: String(country).toUpperCase(), ...(source ? { source } : {}), by, at: new Date().toISOString() }));

/** Put one entry on the do-not-contact list. */
export const addSuppression = (wallet, entry) => serialize(async () => {
  const known = (await readSuppressions(wallet)).some((e) => e.kind === entry.kind && e.value === entry.value);
  if (!known) await appendJsonLine(fileOf(wallet, SUPPRESS), { type: 'suppressed', entry, at: entry.at });
  return { ok: true, already: known };
});

/**
 * The operator takes one entry off the do-not-contact list. The leads it closed stay closed until reopened.
 * @returns {Promise<{ok: true, entry: object} | {ok: false, reason: string}>}
 */
export const liftSuppression = (wallet, value, by) => serialize(async () => {
  const key = String(value ?? '').trim().toLowerCase();
  const entry = (await readSuppressions(wallet)).find((e) => e.value === key);
  if (!entry) return { ok: false, reason: `${key || 'that'} is not on the do-not-contact list` };
  await appendJsonLine(fileOf(wallet, SUPPRESS), { type: 'lifted', kind: entry.kind, value: entry.value, by, at: new Date().toISOString() });
  return { ok: true, entry };
});

/** Each sending address and the first time it wrote to a lead: { address: iso }. */
export const readSenders = async (wallet) => Object.fromEntries((await events(wallet, SENDERS))
  .filter((e) => e?.type === 'first' && e.address).map((e) => [e.address, e.at]).reverse());

/** Note the first time `address` wrote to a lead; a later send changes nothing. */
export const markSender = (wallet, address) => serialize(async () => {
  const key = String(address ?? '').trim().toLowerCase();
  if (!key || (await readSenders(wallet))[key]) return;
  await appendJsonLine(fileOf(wallet, SENDERS), { type: 'first', address: key, at: new Date().toISOString() });
});

/** The sales facts: the latest sheet, its review, and the approved sheet. */
export const readSalesFacts = async (wallet) => foldSalesFacts(await events(wallet, FACTS));

/** File a new facts sheet (it replaces the latest; the approved one stands until the new one is approved). */
export const fileSalesFacts = (wallet, sheet) => serialize(async () => {
  await appendJsonLine(fileOf(wallet, FACTS), { type: 'facts', sheet, at: sheet.filedAt });
  return { ok: true };
});

/** The operator rewrites or removes one fact of the latest sheet: a new sheet, waiting for their approval. */
export const editSalesFact = (wallet, change) => serialize(async () => {
  const judged = editSheetFact(await readSalesFacts(wallet), { ...change, now: new Date().toISOString() });
  if (!judged.ok) return judged;
  await appendJsonLine(fileOf(wallet, FACTS), { type: 'facts', sheet: judged.sheet, at: judged.sheet.filedAt });
  return { ok: true, sheet: judged.sheet };
});

/** The operator approves or returns the latest sheet. */
export const reviewSalesFacts = (wallet, review) => serialize(async () => {
  const judged = judgeSheetReview(await readSalesFacts(wallet), { ...review, now: new Date().toISOString() });
  if (!judged.ok) return judged;
  await appendJsonLine(fileOf(wallet, FACTS), judged.event);
  return { ok: true };
});

// ── CANDIDATES — companies gathered in bulk from a lead source (lead-sources.js),
// waiting for the seat to score them. A candidate whose company reached the
// prospect pool is SCORED; nothing else moves it.

/** Every candidate, oldest first, each `waiting` or `scored`. */
export const readCandidates = async (wallet) => {
  const scored = new Set((await readProspects(wallet)).map((p) => p.domain));
  const all = await events(wallet, CANDIDATES);
  // What the company's own site said when it was last read (company-reader.js): its words fill an empty description.
  const sites = new Map(all.filter((e) => e?.type === 'site' && e.domain && e.site).map((e) => [e.domain, e.site]));
  // THE FILTER (lead-pipeline.js): kept on the shortlist, or passed over, per audience — the latest word stands.
  const sorted = new Map();
  for (const e of all) if (e?.type === 'shortlist' && Array.isArray(e.domains)) for (const d of e.domains) sorted.set(`${e.segmentId}\u0000${d}`, { verdict: e.verdict, why: e.why ?? null });
  // A company found for one audience that fits another is MOVED to it (lead-run.js): the latest move stands.
  const movedTo = new Map(all.filter((e) => e?.type === 'moved' && e.domain && e.segmentId).map((e) => [e.domain, e.segmentId]));
  return all.filter((e) => e?.type === 'gathered' && e.candidate?.domain)
    .map((e) => (movedTo.has(e.candidate.domain) ? { ...e, segmentId: movedTo.get(e.candidate.domain) } : e))
    .map((e) => {
      const site = sites.get(e.candidate.domain) ?? null;
      // Kept as `siteRead`: `site` is the company's own web address, which every list source already sets
      // (2026-11-16: both under one name made every company with an address look already read).
      const shortlist = sorted.get(`${e.segmentId}\u0000${e.candidate.domain}`) ?? null;
      return { ...e.candidate, ...(site ? { siteRead: site, description: e.candidate.description || site.description || '' } : {}), ...(shortlist ? { shortlist: shortlist.verdict, shortlistWhy: shortlist.why } : {}), id: e.id, segmentId: e.segmentId, gatheredAt: e.at, state: scored.has(e.candidate.domain) ? 'scored' : 'waiting' };
    });
};

/** Keep what each company's own site said (or that it could not be read, and why). */
export const noteSites = (wallet, rows, by) => serialize(async () => {
  for (const { domain, site } of rows) await appendJsonLine(fileOf(wallet, CANDIDATES), { type: 'site', domain, site, by, at: new Date().toISOString() });
});

/**
 * Add gathered candidates for a segment; a company already gathered, pooled
 * or on the do-not-contact list is left out.
 * @returns {Promise<object[]>} the ones added
 */
export const addCandidates = (wallet, segmentId, rows, by) => serialize(async () => {
  const have = new Set([...(await readCandidates(wallet)).map((c) => c.domain), ...(await readProspects(wallet)).map((p) => p.domain)]);
  const blocked = suppressionMatcher(await readSuppressions(wallet));
  const added = [];
  for (const candidate of rows) {
    if (have.has(candidate.domain) || blocked.domain(candidate.domain)) continue;
    have.add(candidate.domain);
    const event = { type: 'gathered', id: `c-${Date.now().toString(36)}${added.length.toString(36)}`, segmentId, candidate, by, at: new Date().toISOString() };
    await appendJsonLine(fileOf(wallet, CANDIDATES), event);
    added.push({ ...candidate, id: event.id });
  }
  return added;
});

/** A gathered company belongs to another audience of the house: it is moved there, with why. */
export const moveCandidate = (wallet, { domain, segmentId, why, by }) => serialize(() =>
  appendJsonLine(fileOf(wallet, CANDIDATES), { type: 'moved', domain, segmentId, why: String(why ?? '').slice(0, 300), by, at: new Date().toISOString() }));

/** The pipeline's FILTER: these companies of an audience are kept on its shortlist, or passed over, with why. */
export const noteShortlist = (wallet, { segmentId, domains, verdict, why, by }) => serialize(() =>
  appendJsonLine(fileOf(wallet, CANDIDATES), { type: 'shortlist', segmentId, domains, verdict: verdict === 'passed' ? 'passed' : 'kept', why: String(why ?? '').slice(0, 300), by, at: new Date().toISOString() }));

/** Keep one search run for an audience (the pipeline's DISCOVER step, lead-pipeline.js): where, how it was asked, what it found. */
export const noteSearch = (wallet, { segmentId, source, asked, matched, gathered, spent = 0, pages = null, fromPage = null, by }) => serialize(() =>
  appendJsonLine(fileOf(wallet, CANDIDATES), { type: 'searched', segmentId, source, asked: String(asked ?? '').slice(0, 400), matched: Number(matched) || 0, gathered: Number(gathered) || 0, ...(Number(spent) > 0 ? { spent: Number(spent) } : {}), ...(Number(pages) > 0 ? { pages: Number(pages), fromPage: Number(fromPage) || 1 } : {}), by, at: new Date().toISOString() }));

/** Every search run, oldest first: { segmentId, source, asked, matched, gathered, at }. */
export const readSearches = async (wallet) => (await events(wallet, CANDIDATES)).filter((e) => e?.type === 'searched')
  .map((e) => ({ segmentId: e.segmentId, source: e.source, asked: e.asked, matched: e.matched, gathered: e.gathered, spent: e.spent ?? 0, pages: e.pages ?? null, fromPage: e.fromPage ?? null, at: e.at }));

/** Keep what a contact-data provider returned for a company (the people, each with the page its address was found on). */
export const noteContacts = (wallet, domain, source, people, by, spent = 1) => serialize(() =>
  appendJsonLine(fileOf(wallet, CANDIDATES), { type: 'contacts', domain, source, people, spent, by, at: new Date().toISOString() }));

/** Keep what Hunter's verifier said about one address (address-check.js); its cost counts toward the month like any lookup. */
const VERIFY_SOURCE = Object.freeze({ Tomba: 'tomba-verify', Apollo: 'apollo-verify' });
export const noteAddressCheck = (wallet, { email, check, spent, by }) => serialize(() =>
  appendJsonLine(fileOf(wallet, CANDIDATES), { type: 'contacts', domain: String(email).split('@')[1] ?? '', source: VERIFY_SOURCE[check?.checker] ?? 'hunter-verify', people: [], spent, check: { email, ...check }, by, at: new Date().toISOString() }));

/**
 * Every address check on record, one row an address: each database's latest answer (`checks`), and what they add up to
 * (address-verdict.js) — status, the checker it stands on, which databases confirmed it and which were asked.
 * @returns {Promise<Array<{email: string, status: string, checker: string, confirmedBy: string[], checkedBy: string[], checks: object[], at: string}>>}
 */
export const readAddressChecks = async (wallet) => {
  const byEmail = new Map();
  const settled = new Map();
  const keep = (email, key, check) => {
    const each = byEmail.get(email) ?? new Map();
    each.delete(key); // the latest answer of each database, in the order they came
    each.set(key, check);
    byEmail.set(email, each);
  };
  for (const e of await events(wallet, CANDIDATES)) {
    if (e?.type === 'address-settled' && e.email) { settled.set(e.email, e); continue; }
    if (e?.type !== 'contacts') continue;
    if (e.check?.email) { const checker = e.check.checker ?? 'Hunter'; keep(e.check.email, checker, { ...e.check, checker, at: e.at }); continue; }
    // VERIFIED WHEN FOUND (2026-11-19: 195 addresses a provider handed over verified, re-asked live and refused): an
    // address a provider gave as one it verified is that database's confirmation, kept beside any later live answer —
    // a later "could not confirm" never erases it (a "will bounce" still wins, address-verdict.js).
    const checker = partnerOf(e.source);
    for (const p of checker ? (e.people ?? []) : []) {
      const email = String(p?.email ?? '').trim().toLowerCase();
      if (email && p.checked === 'valid') keep(email, `${checker}|found`, { email, status: 'valid', checker, found: true, at: e.at });
    }
  }
  return [...byEmail].map(([email, each]) => {
    const checks = [...each.values()];
    const verdict = verdictOf(checks);
    // SETTLED (address-confirm.js): no database could confirm it and no other address for them was found — until one
    // confirms it after all.
    const mark = verdict.status !== 'valid' ? settled.get(email) : null;
    return { ...checks.find((c) => c.checker === verdict.checker), email, ...verdict, checks, at: checks.at(-1).at,
      settled: mark ? { outcome: mark.outcome, checkedBy: mark.checkedBy ?? [], findersAsked: mark.findersAsked ?? [], tried: mark.tried ?? [], why: mark.why ?? null, at: mark.at } : null };
  });
};

/** Keep that an address is SETTLED (address-confirm.js): every database was asked and none could confirm it, and no
 *  other address for the person confirmed either — so nobody asks again. */
export const noteAddressSettled = (wallet, { email, outcome, checkedBy, findersAsked, tried, why, by }) => serialize(() =>
  appendJsonLine(fileOf(wallet, CANDIDATES), { type: 'address-settled', email, outcome, checkedBy, findersAsked, tried, why: why ? String(why).slice(0, 300) : null, by, at: new Date().toISOString() }));

/** Every paid lookup on record: which provider, for which company, what it spent and when (lead-spend.js counts the month).
 * A paid company search (Tomba's, Apollo's) is one too: no company, the companies it gathered as found. */
export const readContactLookups = async (wallet) => (await events(wallet, CANDIDATES))
  .filter((e) => e?.type === 'contacts' || (e?.type === 'searched' && Number(e.spent) > 0))
  .map((e) => (e.type === 'searched' ? { domain: null, source: e.source, spent: Number(e.spent), found: Number(e.gathered) || 0, at: e.at } : { domain: e.domain, source: e.source, spent: e.spent, found: (e.people ?? []).length, at: e.at }));

/** The people each lookup returned, with the company's domain and the provider (the contact book reads them). */
export const readContactPeople = async (wallet) => (await events(wallet, CANDIDATES)).filter((e) => e?.type === 'contacts').map((e) => ({ domain: e.domain, source: e.source, people: e.people ?? [], at: e.at }));

// ── CAMPAIGNS — the operator's pushes, each holding the audiences that serve it (campaign-shape.js).

/** The house's sales campaigns, oldest first. */
export const readCampaigns = async (wallet) => foldCampaigns(await events(wallet, CAMPAIGNS));

/** Open a campaign. @returns {Promise<{ok: true, campaign: object} | {ok: false, reason: string}>} */
export const openCampaign = (wallet, campaign) => serialize(async () => {
  const reason = openRefusal(campaign, await readCampaigns(wallet));
  if (reason) return { ok: false, reason };
  await appendJsonLine(fileOf(wallet, CAMPAIGNS), { type: 'opened', campaign, at: campaign.openedAt });
  return { ok: true, campaign };
});

/**
 * Move a campaign: archive it (its audiences and records stand; it takes no
 * new audience), reopen it, edit its name or goal, or delete one that holds
 * no audience.
 * @param {{move: string, name?: unknown, goal?: unknown, by: string}} change
 */
/** A campaign's email variables, proposed (email-formula.js makeEmailPlan shaped them); they wait for the operator. */
export const fileEmailPlan = (wallet, id, plan, by) => serialize(async () => {
  const campaign = (await readCampaigns(wallet)).find((c) => c.id === id);
  if (!campaign) return { ok: false, reason: `no campaign [${id}]` };
  await appendJsonLine(fileOf(wallet, CAMPAIGNS), { type: 'email-plan', id, plan, by, at: new Date().toISOString() });
  return { ok: true };
});

/** The operator locks a campaign's proposed email variables in, or sends them back with what should change. */
export const reviewEmailPlan = (wallet, id, { verdict, note, by }) => serialize(async () => {
  const campaign = (await readCampaigns(wallet)).find((c) => c.id === id);
  if (!campaign?.emailPlan?.proposed) return { ok: false, reason: 'this campaign has no email plan waiting for you' };
  if (!['approved', 'returned'].includes(verdict)) return { ok: false, reason: 'verdict is approved or returned' };
  if (verdict === 'returned' && String(note ?? '').trim().length < 5) return { ok: false, reason: 'say what should change' };
  await appendJsonLine(fileOf(wallet, CAMPAIGNS), { type: 'email-plan-review', id, verdict, note: String(note ?? '').trim().slice(0, 600), by, at: new Date().toISOString() });
  return { ok: true, campaign: (await readCampaigns(wallet)).find((c) => c.id === id) };
});

export const moveCampaign = (wallet, id, { move, name, goal, by }) => serialize(async () => {
  const campaigns = await readCampaigns(wallet);
  const audiences = (await readSegments(wallet)).filter((s) => s.campaign === id && s.state !== 'retired').length;
  const judged = judgeMove(campaigns.find((c) => c.id === id), { move, name, goal, audiences, others: campaigns.filter((c) => c.id !== id), by, now: new Date().toISOString() });
  if (!judged.ok) return judged;
  await appendJsonLine(fileOf(wallet, CAMPAIGNS), judged.event);
  return { ok: true, campaign: (await readCampaigns(wallet)).find((c) => c.id === id) ?? null };
});

/** Archive a campaign (kept for the callers that close one). */
export const closeCampaign = (wallet, id, by) => moveCampaign(wallet, id, { move: 'archive', by });

/** Put an audience under a campaign (null: under none). The campaign must be open and for the audience's own company. */
export const setSegmentCampaign = (wallet, segmentId, campaignId, by) => serialize(async () => {
  const segment = (await readSegments(wallet)).find((s) => s.id === segmentId);
  if (!segment) return { ok: false, reason: 'no such segment' };
  if (campaignId) {
    const campaign = (await readCampaigns(wallet)).find((c) => c.id === campaignId);
    if (!campaign || campaign.state !== 'open') return { ok: false, reason: 'no such open campaign' };
    if (campaign.company !== segment.company) return { ok: false, reason: `"${campaign.name}" is a campaign for ${campaign.company}, and this audience sells ${segment.company}` };
  }
  await appendJsonLine(fileOf(wallet, SEGMENTS), { type: 'campaign', id: segmentId, campaign: campaignId || null, by, at: new Date().toISOString() });
  return { ok: true };
});
