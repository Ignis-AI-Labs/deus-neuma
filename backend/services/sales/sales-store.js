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
import { foldProspects, poolRefusal, listable } from './prospect-shape.js';
import { foldSuppressions, suppressionMatcher } from './suppress-shape.js';
import { foldSalesFacts, judgeSheetReview, editSheetFact } from './sales-facts.js';
import { foldCampaigns, openRefusal, judgeMove } from './campaign-shape.js';

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

/** Mark a prospect dropped (with why) or promoted (with its lead). Only a prospect still in the pool moves. */
export const settleProspect = (wallet, id, event) => serialize(async () => {
  const prospect = (await readProspects(wallet)).find((p) => p.id === id);
  if (!prospect) return { ok: false, reason: `prospect "${id}" is not in the pool` };
  if (prospect.stage !== 'found') return { ok: false, reason: `prospect [${id}] is already ${prospect.stage}` };
  await appendJsonLine(fileOf(wallet, PROSPECTS), { ...event, id, at: new Date().toISOString() });
  return { ok: true, prospect };
});

/**
 * The operator approves an approved segment's list as it stands: every weak or
 * strong match in its pool not yet on the list. Its leads' emails may then go
 * within the sales cover (sales-cover.js) without a card each.
 * @returns {Promise<{ok: true, count: number} | {ok: false, reason: string}>}
 */
export const approveList = (wallet, segmentId, by) => serialize(async () => {
  const segment = (await readSegments(wallet)).find((s) => s.id === segmentId);
  if (!segment) return { ok: false, reason: 'no such segment' };
  if (segment.state !== 'approved') return { ok: false, reason: 'approve the pitch first — a list is approved only under an approved pitch' };
  const ids = listable(await readProspects(wallet), segmentId).map((p) => p.id);
  if (!ids.length) return { ok: false, reason: 'nothing new to approve on this list' };
  await appendJsonLine(fileOf(wallet, PROSPECTS), { type: 'listed', segmentId, ids, by, at: new Date().toISOString() });
  return { ok: true, count: ids.length };
});

/** Put one entry on the do-not-contact list. */
export const addSuppression = (wallet, entry) => serialize(async () => {
  const known = (await readSuppressions(wallet)).some((e) => e.kind === entry.kind && e.value === entry.value);
  if (!known) await appendJsonLine(fileOf(wallet, SUPPRESS), { type: 'suppressed', entry, at: entry.at });
  return { ok: true, already: known };
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
  return all.filter((e) => e?.type === 'gathered' && e.candidate?.domain)
    .map((e) => {
      const site = sites.get(e.candidate.domain) ?? null;
      // Kept as `siteRead`: `site` is the company's own web address, which every list source already sets
      // (2026-11-16: both under one name made every company with an address look already read).
      return { ...e.candidate, ...(site ? { siteRead: site, description: e.candidate.description || site.description || '' } : {}), id: e.id, segmentId: e.segmentId, gatheredAt: e.at, state: scored.has(e.candidate.domain) ? 'scored' : 'waiting' };
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

/** Keep what a contact-data provider returned for a company (the people, each with the page its address was found on). */
export const noteContacts = (wallet, domain, source, people, by, spent = 1) => serialize(() =>
  appendJsonLine(fileOf(wallet, CANDIDATES), { type: 'contacts', domain, source, people, spent, by, at: new Date().toISOString() }));

/** Keep what Hunter's verifier said about one address (address-check.js); its cost counts toward the month like any lookup. */
export const noteAddressCheck = (wallet, { email, check, spent, by }) => serialize(() =>
  appendJsonLine(fileOf(wallet, CANDIDATES), { type: 'contacts', domain: String(email).split('@')[1] ?? '', source: 'hunter-verify', people: [], spent, check: { email, ...check }, by, at: new Date().toISOString() }));

/** Every address check on record, the latest for each address: { email, status, score, at }. */
export const readAddressChecks = async (wallet) => [...new Map((await events(wallet, CANDIDATES)).filter((e) => e?.type === 'contacts' && e.check?.email).map((e) => [e.check.email, { ...e.check, at: e.at }])).values()];

/** Every paid lookup on record: which provider, for which company, what it spent and when (lead-spend.js counts the month). */
export const readContactLookups = async (wallet) => (await events(wallet, CANDIDATES)).filter((e) => e?.type === 'contacts').map((e) => ({ domain: e.domain, source: e.source, spent: e.spent, found: (e.people ?? []).length, at: e.at }));

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
