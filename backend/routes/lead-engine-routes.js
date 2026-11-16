/**
 * Lead engine routes — the operator's hand on the Mercator's lead engine,
 * mounted inside the revenue router (/api/v1/revenue/lead-engine), behind its
 * Bearer auth, on the signed-in wallet's OWN house. The operator reads the
 * whole engine, approves (or pauses, or retires) a segment's pitch — nothing
 * from a segment reaches the ledger until it is approved — approves an
 * approved segment's list once (its leads' emails then go within the sales
 * cover, sales-cover.js), approves or returns the sales facts sheet, and puts
 * a person or company on the do-not-contact list, and says when paid lead
 * data may be spent (POST /spend {mode, cap}).
 */

import express from 'express';
import { readSegments, readProspects, readSuppressions, setSegmentState, addSuppression, approveList, readSalesFacts, reviewSalesFacts, editSalesFact, readCandidates, readContactPeople, readCampaigns, openCampaign, closeCampaign, moveCampaign, setSegmentCampaign } from '../services/sales/sales-store.js';
import { makeSuppression, suppressionMatcher } from '../services/sales/suppress-shape.js';
import { upkeepDue } from '../services/sales/lead-upkeep.js';
import { makeCampaign, campaignBoard } from '../services/sales/campaign-shape.js';
import { listCompanies } from '../services/marketing/companies.js';
import { leadLedgerFor, LEAD_KINDS, kindOf, sourceOf } from '../services/leads/lead-ledger.js';
import { spendState, setSpend, SPEND_MODES } from '../services/sales/lead-spend.js';
import { foldContacts, contactStats } from '../services/sales/contact-book.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('LeadEngine');
const OPERATOR_STATES = new Set(['approved', 'paused', 'retired']);

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    const [segments, prospects, suppressions, leads, facts, candidates] = await Promise.all([
      readSegments(wallet), readProspects(wallet), readSuppressions(wallet), leadLedgerFor(wallet).then((l) => l.load()), readSalesFacts(wallet), readCandidates(wallet),
    ]);
    const [campaigns, companies] = await Promise.all([readCampaigns(wallet), listCompanies(wallet).catch(() => [])]);
    const upkeep = upkeepDue({ leads, now: Date.now(), suppressed: suppressionMatcher(suppressions).email });
    const spend = { ...(await spendState(wallet)), modes: SPEND_MODES };
    // The lead list itself, each lead under what it is to the house (a buyer, an applicant, a partner, …).
    const list = leads.map((l) => ({ id: l.id, name: l.name, contact: l.contact, kind: kindOf(l), channel: sourceOf(l), status: l.status, source: l.source, updatedAt: l.updatedAt, owner: l.ownerNeumaId ?? null, last: l.touches?.at(-1)?.note ?? null }));
    // The contact book: every person the house knows, one record each, read from the records above.
    const contacts = foldContacts({ leads, prospects, lookups: await readContactPeople(wallet), suppressions, segments, candidates });
    res.json({ segments, prospects, suppressions, upkeep, facts, candidates, spend, leads: list, leadKinds: LEAD_KINDS, contacts, contactStats: contactStats(contacts), ...campaignBoard({ campaigns, segments, candidates, prospects, leads }), companies: companies.map((c) => ({ id: c.id, name: c.name })) });
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

// The operator approves an approved audience's list as it stands; its leads' emails then go within the sales cover.
router.post('/segments/:id/list', async (req, res) => {
  try {
    const listed = await approveList(req.walletAddress, req.params.id, 'operator');
    if (!listed.ok) return res.status(listed.reason === 'no such segment' ? 404 : 409).json({ error: listed.reason });
    log.info('List approved by the operator', { id: req.params.id, count: listed.count });
    res.json(listed);
  } catch (error) {
    log.error('List approval failed', { error: error.message });
    res.status(500).json({ error: 'Could not approve the list' });
  }
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

export default router;
