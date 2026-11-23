/**
 * Lead engine routes — the operator's hand on the Mercator's lead engine,
 * mounted inside the revenue router (/api/v1/revenue/lead-engine), behind its
 * Bearer auth, on the signed-in wallet's OWN house. The operator reads the
 * whole engine, approves (or pauses, or retires) a segment's pitch — nothing
 * from a segment reaches the ledger until it is approved — approves an
 * approved segment's list once (its leads' emails then go within the sales
 * cover, sales-cover.js), approves or returns the sales facts sheet, and puts
 * a person or company on the do-not-contact list (or lifts one off it,
 * POST /suppress/lift {target}), and says when paid lead
 * data may be spent (POST /spend {mode, cap}).
 */

import express from 'express';
import { readSegments, noteShortlist, handProspect, readProspects, readSuppressions, setSegmentState, addSuppression, liftSuppression, approveList, readSalesFacts, reviewSalesFacts, editSalesFact, readCandidates, readContactPeople, readContactLookups, readCampaigns, openCampaign, closeCampaign, moveCampaign, setSegmentCampaign, readAddressChecks, readSearches, reviewEmailPlan } from '../services/sales/sales-store.js';
import { makeSuppression, suppressionMatcher, normalizeEmail } from '../services/sales/suppress-shape.js';
import { upkeepDue, bouncedLead } from '../services/sales/lead-upkeep.js';
import { readStandingReplies } from '../services/sales/mail-upkeep.js';
import { callOf, callOffOf } from '../services/sales/booked-calls.js';
import leadOwnRouter from './lead-own-routes.js';
import { wideSummary } from '../services/sales/wide-search.js';
import { readLeadCosts } from '../services/sales/lead-cost-read.js';
import { SAYS, cleanSaid, closes, saidOf, saidWords } from '../services/sales/reply-said.js';
import { checkBeforeSending, checkWithEvery, attachedCheckers } from '../services/sales/address-check.js';
import { confirmAddress } from '../services/sales/address-confirm.js';
import { peopleByCompany } from '../services/sales/top-first.js';
import { makeCampaign, campaignBoard, leadOrigins } from '../services/sales/campaign-shape.js';
import { listCompanies } from '../services/marketing/companies.js';
import { leadLedgerFor, LEAD_KINDS, kindOf, sourceOf } from '../services/leads/lead-ledger.js';
import { spendState, setSpend, SPEND_MODES } from '../services/sales/lead-spend.js';
import { foldContacts, contactStats } from '../services/sales/contact-book.js';
import { readAudienceSites } from '../services/sales/site-reads.js';
import { isConnectionOn } from '../services/connections/connection-switches.js';
import { readOutbox, setReview, sendDraft, returnDraft, editDraft, withdrawDrafts } from '../services/sales/email-outbox.js';
import { withFooters } from '../services/sales/opt-out.js';
import { createLogger } from '../services/logger.js';
import { recordNames } from '../services/sales/record-names.js';
import { parseLeadFile, planImport } from '../services/leads/lead-import.js';
import { leadThread } from '../services/sales/lead-thread.js';
import { readTheirEmail } from '../services/sales/their-email.js';
import { resolveEmailCredential } from '../services/email/email-credentials.js';
import { leadProvenance, spentByPartner } from '../services/sales/lead-provenance.js';

const log = createLogger('LeadEngine');
const OPERATOR_STATES = new Set(['approved', 'paused', 'retired']);

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    // A reply recorded before replies were read is read now, once (mail-upkeep.js): a no closes its lead, a request is marked.
    await readStandingReplies(wallet);
    const [segments, prospects, suppressions, leads, facts, candidates] = await Promise.all([
      readSegments(wallet), readProspects(wallet), readSuppressions(wallet), leadLedgerFor(wallet).then((l) => l.load()), readSalesFacts(wallet), readCandidates(wallet),
    ]);
    const [campaigns, companies] = await Promise.all([readCampaigns(wallet), listCompanies(wallet).catch(() => [])]);
    const lookups = await readContactPeople(wallet);
    // Which partner found each lead's company and gave its address, and what each partner's lookups spent.
    const provenance = leadProvenance({ leads, prospects, candidates, lookups });
    const spends = await readContactLookups(wallet);
    const spentBy = spentByPartner(spends);
    const upkeep = upkeepDue({ leads, now: Date.now(), suppressed: suppressionMatcher(suppressions).email, held: peopleByCompany(lookups) });
    const spend = { ...(await spendState(wallet)), modes: SPEND_MODES };
    // The lead list itself, each lead under what it is to the house (a buyer, an applicant, a partner, …).
    // …and tied to the campaign and the audience that found it, so the sheet says who is being written to for what.
    const origins = leadOrigins({ campaigns, segments, prospects, leads });
    const list = leads.map((l) => ({ id: l.id, name: l.name, contact: l.contact, kind: kindOf(l), channel: sourceOf(l), status: l.status, said: saidOf(l), call: callOf(l), callOff: callOffOf(l), source: l.source, updatedAt: l.updatedAt, owner: l.ownerNeumaId ?? null, last: l.touches?.at(-1)?.note ?? null, origin: origins.get(l.id) ?? null, thread: leadThread(l), foundBy: provenance.get(l.id) ?? null, bounced: bouncedLead(l), tags: l.tags ?? [], fields: l.fields ?? {}, about: l.about ?? '' }));
    // The contact book: every person the house knows, one record each, read from the records above.
    const contacts = foldContacts({ leads, prospects, lookups, suppressions, segments, candidates, checks: await readAddressChecks(wallet) });
    const outbox = await readOutbox(wallet).then(async (o) => ({ ...o, drafts: await withFooters(wallet, o.drafts) })); // each with the opt-out it carries
    // THE PIPELINE on the desk (lead-pipeline.js): each audience's searches, and the companies people were pulled at.
    const searches = await readSearches(wallet);
    const pulled = [...peopleByCompany(lookups).keys()];
    // What each address's check said (address-check.js), so the outbox shows it before anything is sent.
    // Each database's answer travels with it, and which confirmed it (address-verdict.js); `checkers` names every one attached.
    const checks = Object.fromEntries((await readAddressChecks(wallet)).map((c) => [c.email, {
      status: c.status, checker: c.checker ?? 'Hunter', at: c.at, confirmedBy: c.confirmedBy, checkedBy: c.checkedBy, live: c.live, foundBy: c.foundBy,
      checks: c.checks.map((x) => ({ checker: x.checker, status: x.status, at: x.at, ...(x.found ? { found: true } : {}) })), settled: c.settled,
    }]));
    const checkers = (await attachedCheckers()).map((h) => h.name);
    // A required sign that sends a failing company elsewhere names that audience in words, for the card.
    const named = segments.map((s) => (s.required?.length ? { ...s, required: s.required.map((r) => ({ ...r, otherwiseName: segments.find((o) => o.id === r.otherwise)?.name ?? null })) } : s));
    res.json({ segments: named, prospects, suppressions, upkeep, facts, candidates, spend, spentBy, costs: await readLeadCosts(wallet, { leads, provenance, lookups: spends }), wide: wideSummary(searches, candidates), searches, pulled, checks, checkers, outbox: { review: outbox.review, drafts: outbox.drafts }, leads: list, leadKinds: LEAD_KINDS, contacts, contactStats: contactStats(contacts), ...campaignBoard({ campaigns, segments, candidates, prospects, leads }), companies: companies.map((c) => ({ id: c.id, name: c.name })) });
  } catch (error) {
    log.error('Lead engine read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read the lead engine' });
  }
});

router.post('/segments/:id/state', async (req, res) => {
  const state = String(req.body?.state ?? '');
  if (!OPERATOR_STATES.has(state)) return res.status(400).json({ error: 'state is approved, paused or retired' });
  try {
    const moved = await setSegmentState(req.walletAddress, req.params.id, state, 'operator');
    if (!moved.ok) return res.status(moved.reason === 'no such segment' ? 404 : 409).json({ error: moved.reason });
    log.info('Segment moved by the operator', { id: req.params.id, state });
    res.json({ ok: true, segment: (await readSegments(req.walletAddress)).find((s) => s.id === req.params.id) });
  } catch (error) {
    log.error('Segment move failed', { error: error.message });
    res.status(500).json({ error: 'Could not move the segment' });
  }
});

// IMPORT (Design note, 2026-11-18: […]): people reached through another tool, onto the house's own lead list, each with
// every message that passed (leads/lead-import.js). The file comes as text — the import JSON, or any CSV with an email
// column — so a large one is not held to the JSON limit; ?dry=1 says what it would do and writes nothing.
router.post('/import', express.text({ type: 'text/*', limit: '16mb' }), async (req, res) => {
  try {
    const wallet = req.walletAddress;
    const parsed = parseLeadFile(typeof req.body === 'string' ? req.body : '');
    if (!parsed.ok) return res.status(400).json({ error: parsed.reason });
    const ledger = await leadLedgerFor(wallet);
    const onLedger = new Set((await ledger.load()).map((l) => normalizeEmail(l.contact)).filter(Boolean));
    const plan = planImport(parsed.people, { source: parsed.source, onLedger, suppressed: suppressionMatcher(await readSuppressions(wallet)).email, by: 'operator' });
    const preview = { source: parsed.source, counts: plan.counts, people: plan.add.map((a) => ({ name: a.name, email: a.contact, status: a.status, outcome: a.outcome, flags: a.flags, messages: a.history.length, source: a.source })), skipped: plan.skip };
    if (req.query.dry) return res.json({ ok: true, dry: true, ...preview });
    const written = plan.add.length ? await ledger.addMany(plan.add.map(({ outcome, flags, ...lead }) => lead)) : [];
    for (const s of plan.suppress) await addSuppression(wallet, makeSuppression({ ...s, by: 'operator', now: new Date().toISOString() }));
    log.info('Leads imported', { source: parsed.source, added: written.length, suppressed: plan.suppress.length, skipped: plan.skip.length });
    return res.json({ ok: true, dry: false, added: written.length, suppressed: plan.suppress.length, ...preview });
  } catch (err) {
    log.error('Lead import failed', { error: err.message });
    return res.status(500).json({ error: `Could not import the leads: ${err.message}` });
  }
});

// The names of the lead engine's records by id, so a door in a member's words reads as the thing it opens.
router.get('/names', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    const [segments, prospects, campaigns] = await Promise.all([readSegments(wallet), readProspects(wallet), readCampaigns(wallet)]);
    res.set('Cache-Control', 'no-store');
    res.json({ names: recordNames({ segments, prospects, campaigns }) });
  } catch (err) {
    log.error('Record names read failed', { error: err.message });
    res.status(500).json({ error: 'Could not read the record names' });
  }
});

// The operator approves an approved audience's list as it stands; its leads' emails then go within the sales cover.
router.post('/segments/:id/list', async (req, res) => {
  try {
    const listed = await approveList(req.walletAddress, req.params.id, 'operator', req.body?.ids);
    if (!listed.ok) return res.status(listed.reason === 'no such segment' ? 404 : 409).json({ error: listed.reason });
    log.info('List approved by the operator', { id: req.params.id, count: listed.count });
    res.json(listed);
  } catch (error) {
    log.error('List approval failed', { error: error.message });
    res.status(500).json({ error: 'Could not approve the list' });
  }
});

// The operator has the sites of an audience's gathered companies read (company-reader.js): alive or not, what each says it is, its published addresses.
// The operator's hands on the companies in VALIDATE (Design note, 2026-11-18: […]). A scored company: drop it (off the pool; one already on
// the lead list is closed there too and anything staged to it withdrawn), take it off the approved list, or move it
// under another audience. A company not scored yet: pass it over at the filter.
router.post('/prospects/:id/hand', async (req, res) => {
  const move = String(req.body?.move ?? '');
  const reason = String(req.body?.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || 'not a fit — removed by the operator';
  if (!['drop', 'unlist', 'move'].includes(move)) return res.status(400).json({ error: 'move is drop, unlist or move' });
  try {
    const wallet = req.walletAddress;
    const event = move === 'drop' ? { type: 'dropped', reason, by: 'operator' } : move === 'unlist' ? { type: 'unlisted', by: 'operator' } : { type: 'moved', segmentId: String(req.body?.segmentId ?? ''), by: 'operator' };
    const done = await handProspect(wallet, req.params.id, event);
    if (!done.ok) return res.status(409).json({ error: done.reason });
    let closed = null;
    if (move === 'drop' && done.prospect.leadId) {
      const ledger = await leadLedgerFor(wallet);
      const lead = (await ledger.load()).find((l) => l.id === done.prospect.leadId);
      if (lead && !['won', 'lost'].includes(lead.status)) await ledger.touch(lead.id, { status: 'lost', note: `removed by the operator: ${reason}`, by: 'operator' });
      const address = normalizeEmail(lead?.contact);
      closed = { lead: lead?.id ?? null, withdrawn: address ? (await withdrawDrafts(wallet, { to: (a) => a === address, why: `${done.prospect.name} was removed by the operator`, by: 'operator' })).ids : [] };
    }
    return res.json({ ok: true, move, prospect: done.prospect.id, ...(closed ? { closed } : {}) });
  } catch (err) {
    log.error('Prospect hand failed', { error: err.message });
    return res.status(500).json({ error: 'Could not change the company' });
  }
});

router.post('/candidates/pass', async (req, res) => {
  const segmentId = String(req.body?.segmentId ?? ''); const domain = String(req.body?.domain ?? '').trim().toLowerCase();
  if (!segmentId || !domain) return res.status(400).json({ error: 'name the audience and the domain: {segmentId, domain}' });
  try {
    await noteShortlist(req.walletAddress, { segmentId, domains: [domain], verdict: 'passed', why: String(req.body?.why ?? '').trim() || 'removed by the operator', by: 'operator' });
    return res.json({ ok: true, passed: domain });
  } catch (err) {
    log.error('Candidate pass failed', { error: err.message });
    return res.status(500).json({ error: 'Could not pass over the company' });
  }
});

router.post('/segments/:id/read-sites', async (req, res) => {
  if (!isConnectionOn('lead-sources')) return res.status(409).json({ error: 'LEAD SOURCES is off — turn it on in POSITIONS, CHIEF REVENUE OFFICER, SETTINGS' });
  try {
    const done = await readAudienceSites(req.walletAddress, req.params.id, { count: req.body?.count, by: 'operator' });
    if (!done.ok) return res.status(409).json({ error: done.reason });
    log.info('Company sites read at the operator\'s press', { id: req.params.id, read: done.read.length });
    return res.json({ ok: true, read: done.read.length, alive: done.read.filter((r) => r.site.alive).length, left: done.left });
  } catch (error) {
    log.error('Company sites could not be read', { error: error.message });
    return res.status(500).json({ error: 'Could not read the sites' });
  }
});

// THE OUTBOX (sales/email-outbox.js): emails the sales seat staged. The operator sends, changes or returns each; nothing leaves before.
router.post('/outbox/review', async (req, res) => {
  if (typeof req.body?.on !== 'boolean') return res.status(400).json({ error: 'send {on: true} or {on: false}' });
  log.info('REVIEW FIRST set by the operator', { on: req.body.on });
  return res.json(await setReview(req.walletAddress, req.body.on));
});

router.post('/outbox/send', async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).slice(0, 100);
  if (!ids.length) return res.status(400).json({ error: 'name the emails to send: {ids: [...]}' });
  try {
    // One after another: each is its own send from the house mailbox, and one that is refused stops only itself.
    const results = [];
    // acceptRisk: the operator's SEND ANYWAY on an email whose address no database confirmed live (one email at a time).
    const acceptRisk = req.body?.acceptRisk === true && ids.length === 1;
    for (const id of ids) results.push(await sendDraft(req.walletAddress, id, { acceptRisk }));
    log.info('Outbox emails sent by the operator', { asked: ids.length, sent: results.filter((r) => r.ok).length });
    return res.json({ ok: true, sent: results.filter((r) => r.ok).map((r) => ({ id: r.id, to: r.to, from: r.from })), refused: results.filter((r) => !r.ok).map((r) => ({ id: r.id, reason: r.reason })) });
  } catch (error) {
    log.error('Outbox send failed', { error: error.message });
    return res.status(500).json({ error: 'Could not send from the outbox' });
  }
});

// THEIR REPLY, WORD FOR WORD (Design note, 2026-11-19: […]): a message the mailbox watch recorded on a lead before it kept the words, read
// again from the house mailbox. Only a message a lead's history names — this is no general reader of the mailbox.
router.get('/mail/:uid', async (req, res) => {
  const uid = Number(req.params.uid);
  if (!Number.isInteger(uid) || uid <= 0) return res.status(400).json({ error: 'name the message by its number' });
  try {
    const ledger = await leadLedgerFor(req.walletAddress);
    const said = (l) => leadThread(l).find((m) => m.way === 'in' && m.uid === uid);
    const lead = (await ledger.load()).find(said);
    if (!lead) return res.status(404).json({ error: 'no lead\'s history names that message' });
    const credentials = await resolveEmailCredential(req.walletAddress).catch(() => null);
    if (!credentials) return res.status(409).json({ error: 'the house mailbox is not connected' });
    const read = await readTheirEmail(credentials, { uid, from: lead.contact, near: said(lead).at });
    if (!read.ok) return res.status(502).json({ error: read.detail });
    const m = read.message;
    // Read once, kept on the lead: from now on it opens from the ledger at once, whatever becomes of the email.
    await ledger.keepWords(lead.id, `mail #${uid}`, { subject: m.subject, text: m.words });
    return res.json({ uid, from: m.from, subject: m.subject, date: m.date, words: m.words, text: String(m.text ?? '').slice(0, 20000), truncated: Boolean(m.truncated), folder: m.folder });
  } catch (err) {
    log.error('Reading a lead\'s email failed', { error: err.message });
    return res.status(500).json({ error: 'Could not read that email' });
  }
});

// The operator deletes staged emails (Design note, 2026-11-18: […]):
// each is withdrawn — it never goes and it leaves the list; the record keeps that it was deleted, and by whom.
// CHECK THE ADDRESSES of staged emails now (Design note, 2026-11-19: […]): each
// address once, with the house's checker (address-check.js) — what the outbox shows before anything is sent.
// {every: true} — LOCK IT IN (Design note, 2026-11-19: […]): every attached database not yet
// asked checks each address, and each answer is kept.
router.post('/outbox/check', async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).slice(0, 100);
  if (!ids.length) return res.status(400).json({ error: 'name the emails whose addresses to check: {ids: [...]}' });
  try {
    const drafts = (await readOutbox(req.walletAddress)).drafts.filter((d) => ids.includes(d.id) && d.state === 'waiting');
    if (req.body?.every === true) {
      const out = await checkWithEvery(req.walletAddress, drafts.flatMap((d) => d.to), { by: 'operator' });
      return res.json({ ok: true, every: true, ...out });
    }
    const results = [];
    for (const d of drafts) {
      const out = await checkBeforeSending(req.walletAddress, d.to, { by: 'operator' });
      results.push({ id: d.id, to: d.to, refusal: out.refusal, notes: out.notes });
    }
    return res.json({ ok: true, checked: results.filter((r) => !r.refusal).length, refused: results.filter((r) => r.refusal).map((r) => ({ id: r.id, reason: r.refusal })) });
  } catch (err) {
    log.error('Checking the outbox addresses failed', { error: err.message });
    return res.status(500).json({ error: 'Could not check the addresses' });
  }
});

// FIND CONFIRMED ADDRESSES (Design note, 2026-11-19: […]): each staged email's address no database confirmed — every database asked, then the person looked
// for; moved when one is confirmed, settled when nothing is (address-confirm.js).
router.post('/outbox/confirm', async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).slice(0, 100);
  if (!ids.length) return res.status(400).json({ error: 'name the emails whose addresses to confirm: {ids: [...]}' });
  try {
    const drafts = (await readOutbox(req.walletAddress)).drafts.filter((d) => ids.includes(d.id) && d.state === 'waiting');
    const results = [];
    for (const email of [...new Set(drafts.flatMap((d) => d.to))]) results.push(await confirmAddress(req.walletAddress, { email, by: 'operator' }));
    return res.json({ ok: true, results: results.map((r) => ({ email: r.email, outcome: r.outcome, ...(r.to ? { to: r.to } : {}), words: r.words })) });
  } catch (err) {
    log.error('Confirming the outbox addresses failed', { error: err.message });
    return res.status(500).json({ error: 'Could not confirm the addresses' });
  }
});

router.post('/outbox/delete', async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: 'name the emails to delete: {ids: [...]}' });
  try {
    const deleted = [];
    for (const id of ids) {
      const out = await withdrawDrafts(req.walletAddress, { id, why: 'deleted by the operator', by: 'operator' });
      if (out.ok) deleted.push(id);
    }
    return res.json({ ok: true, deleted, missing: ids.filter((id) => !deleted.includes(id)) });
  } catch (err) {
    log.error('Outbox delete failed', { error: err.message });
    return res.status(500).json({ error: 'Could not delete the emails' });
  }
});

router.post('/outbox/:id/return', async (req, res) => {
  const note = String(req.body?.note ?? '').trim();
  if (note.length < 5) return res.status(400).json({ error: 'say what should change' });
  const back = await returnDraft(req.walletAddress, req.params.id, note);
  return back.ok ? res.json(back) : res.status(404).json({ error: back.reason });
});

router.post('/outbox/:id', async (req, res) => {
  const changed = await editDraft(req.walletAddress, req.params.id, { subject: req.body?.subject, text: req.body?.text });
  return changed.ok ? res.json(changed) : res.status(changed.reason.startsWith('no such') ? 404 : 400).json({ error: changed.reason });
});

// The operator approves or returns the latest facts sheet: no email reaches a lead before one is approved.
router.post('/facts/:sheetId', async (req, res) => {
  try {
    const reviewed = await reviewSalesFacts(req.walletAddress, { sheetId: req.params.sheetId, verdict: req.body?.verdict, note: req.body?.note, only: req.body?.only });
    if (!reviewed.ok) return res.status(409).json({ error: reviewed.reason });
    log.info('Sales facts reviewed by the operator', { sheetId: req.params.sheetId, verdict: req.body?.verdict });
    res.json({ ok: true, facts: await readSalesFacts(req.walletAddress) });
  } catch (error) {
    log.error('Facts review failed', { error: error.message });
    res.status(500).json({ error: 'Could not record the review' });
  }
});

// The operator opens a campaign: a name, the company it is for, and what it is meant to bring in.
router.post('/campaigns', async (req, res) => {
  let campaign;
  try {
    campaign = makeCampaign({ name: req.body?.name, company: req.body?.company, goal: req.body?.goal, by: 'operator', now: new Date().toISOString() });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    if (!(await listCompanies(req.walletAddress)).some((c) => c.id === campaign.company)) return res.status(400).json({ error: `"${campaign.company}" is not a company of this house` });
    const opened = await openCampaign(req.walletAddress, campaign);
    if (!opened.ok) return res.status(409).json({ error: opened.reason });
    log.info('Sales campaign opened', { id: campaign.id, name: campaign.name });
    return res.json(opened);
  } catch (error) {
    log.error('Campaign open failed', { error: error.message });
    return res.status(500).json({ error: 'Could not open the campaign' });
  }
});

router.post('/campaigns/:id/close', async (req, res) => {
  try {
    const closed = await closeCampaign(req.walletAddress, req.params.id, 'operator');
    return closed.ok ? res.json(closed) : res.status(closed.reason === 'no such campaign' ? 404 : 409).json({ error: closed.reason });
  } catch (error) {
    log.error('Campaign close failed', { error: error.message });
    return res.status(500).json({ error: 'Could not close the campaign' });
  }
});

// The operator locks a campaign's email plan in, or sends it back: {verdict: 'approved'|'returned', note} (email-formula.js).
router.post('/campaigns/:id/email-plan', async (req, res) => {
  try {
    const out = await reviewEmailPlan(req.walletAddress, req.params.id, { verdict: String(req.body?.verdict ?? ''), note: req.body?.note, by: 'operator' });
    if (!out.ok) return res.status(409).json({ error: out.reason });
    log.info('Campaign email plan reviewed by the operator', { id: req.params.id, verdict: req.body?.verdict });
    return res.json({ ok: true, emailPlan: out.campaign?.emailPlan ?? null });
  } catch (error) {
    log.error('Email plan review failed', { error: error.message });
    return res.status(500).json({ error: 'Could not review the email plan' });
  }
});

// The operator archives, reopens, edits or deletes a campaign: {move, name?, goal?}.
router.post('/campaigns/:id', async (req, res) => {
  try {
    const moved = await moveCampaign(req.walletAddress, req.params.id, { move: String(req.body?.move ?? ''), name: req.body?.name, goal: req.body?.goal, by: 'operator' });
    if (!moved.ok) return res.status(moved.reason === 'no such campaign' ? 404 : 409).json({ error: moved.reason });
    log.info('Sales campaign moved by the operator', { id: req.params.id, move: req.body?.move });
    return res.json(moved);
  } catch (error) {
    log.error('Campaign move failed', { error: error.message });
    return res.status(500).json({ error: 'Could not change the campaign' });
  }
});

// The operator puts an audience under a campaign, or takes it out (campaign: null).
router.post('/segments/:id/campaign', async (req, res) => {
  try {
    const set = await setSegmentCampaign(req.walletAddress, req.params.id, req.body?.campaign ?? null, 'operator');
    return set.ok ? res.json(set) : res.status(set.reason === 'no such segment' ? 404 : 409).json({ error: set.reason });
  } catch (error) {
    log.error('Audience campaign move failed', { error: error.message });
    return res.status(500).json({ error: 'Could not move the audience' });
  }
});

// The operator rewrites one fact of the sheet on screen, or takes it off: {n, claim?, source?, figure?} or {n, remove: true}.
router.post('/facts/:sheetId/fact', async (req, res) => {
  try {
    const { n, remove, claim, source, figure } = req.body ?? {};
    const edited = await editSalesFact(req.walletAddress, { sheetId: req.params.sheetId, n, remove: remove === true, claim, source, figure });
    if (!edited.ok) return res.status(409).json({ error: edited.reason });
    log.info('A sales fact was changed by the operator', { sheetId: req.params.sheetId, n, remove: remove === true });
    return res.json({ ok: true, facts: await readSalesFacts(req.walletAddress) });
  } catch (error) {
    log.error('The fact could not be changed', { error: error.message });
    return res.status(500).json({ error: 'Could not change the fact' });
  }
});

// The operator re-files one lead under what it is to the house: {kind}.
router.post('/leads/:id/kind', async (req, res) => {
  try {
    if (!LEAD_KINDS.includes(req.body?.kind)) return res.status(400).json({ error: `kind is one of: ${LEAD_KINDS.join(', ')}` });
    const moved = await (await leadLedgerFor(req.walletAddress)).touch(req.params.id, { kind: req.body.kind, note: `re-filed as ${req.body.kind} by the operator`, by: 'operator' });
    if (!moved.ok) return res.status(404).json({ error: moved.error });
    log.info('A lead was re-filed by the operator', { id: req.params.id, kind: req.body.kind });
    return res.json({ ok: true, lead: { id: moved.lead.id, kind: kindOf(moved.lead) } });
  } catch (error) {
    log.error('The lead could not be re-filed', { error: error.message });
    return res.status(500).json({ error: 'Could not re-file the lead' });
  }
});

router.use(leadOwnRouter); // a call on a lead, the lead-data plans, what too-wide searches brought (lead-own-routes.js)

// The operator says what a reply says, when the rules read it wrong or could not tell: {says, want?}. A no, or a
// person who has left, closes the lead (the contact stays on the ledger); anything else opens it again as replied.
router.post('/leads/:id/said', async (req, res) => {
  try {
    const said = cleanSaid({ says: req.body?.says, want: req.body?.want, why: 'said by the operator' }, 'operator');
    if (!said) return res.status(400).json({ error: `says is one of: ${SAYS.join(', ')}` });
    const ledger = await leadLedgerFor(req.walletAddress);
    const lead = (await ledger.load()).find((l) => l.id === req.params.id);
    if (!lead) return res.status(404).json({ error: 'no such lead' });
    const status = closes(said) ? 'lost' : lead.status === 'lost' ? 'replied' : lead.status;
    const moved = await ledger.touch(lead.id, { said, status, note: `the operator read their reply: ${saidWords(said)}`, by: 'operator' });
    if (!moved.ok) return res.status(400).json({ error: moved.error });
    log.info('A reply was read by the operator', { id: lead.id, says: said.says });
    return res.json({ ok: true, lead: { id: moved.lead.id, status: moved.lead.status, said: saidOf(moved.lead) } });
  } catch (error) {
    log.error('The reply could not be re-read', { error: error.message });
    return res.status(500).json({ error: 'Could not change what the reply says' });
  }
});

// When paid lead data may be spent: the operator's one choice, and the month's cap (lead-spend.js).
router.post('/spend', async (req, res) => {
  try {
    const set = await setSpend(req.walletAddress, { mode: req.body?.mode, cap: req.body?.cap });
    if (!set.ok) return res.status(400).json({ error: set.reason });
    log.info('The paid lead data rule was set by the operator', { mode: set.rule.mode, cap: set.rule.cap });
    return res.json({ ok: true, rule: set.rule });
  } catch (error) {
    log.error('The paid lead data rule could not be set', { error: error.message });
    return res.status(500).json({ error: 'Could not set the paid lead data rule' });
  }
});

router.post('/suppress', async (req, res) => {
  let entry;
  try {
    entry = makeSuppression({ target: req.body?.target, reason: req.body?.reason, note: req.body?.note, by: 'operator', now: new Date().toISOString() });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    res.json({ ...(await addSuppression(req.walletAddress, entry)), entry });
  } catch (error) {
    log.error('Suppression failed', { error: error.message });
    res.status(500).json({ error: 'Could not add to the do-not-contact list' });
  }
});

router.post('/suppress/lift', async (req, res) => {
  try {
    const lifted = await liftSuppression(req.walletAddress, req.body?.target, 'operator');
    if (!lifted.ok) return res.status(404).json({ error: lifted.reason });
    return res.json(lifted);
  } catch (error) {
    log.error('Lifting a do-not-contact entry failed', { error: error.message });
    return res.status(500).json({ error: 'Could not lift the do-not-contact entry' });
  }
});

export default router;
