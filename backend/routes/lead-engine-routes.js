/**
 * Lead engine routes — the operator's hand on the Mercator's lead engine,
 * mounted inside the revenue router (/api/v1/revenue/lead-engine), behind its
 * Bearer auth, on the signed-in wallet's OWN house. The operator reads the
 * whole engine, approves (or pauses, or retires) a segment's pitch — nothing
 * from a segment reaches the ledger until it is approved — approves an
 * approved segment's list once (its leads' emails then go within the sales
 * cover, sales-cover.js), approves or returns the sales facts sheet, and puts
 * a person or company on the do-not-contact list.
 */

import express from 'express';
import { readSegments, readProspects, readSuppressions, setSegmentState, addSuppression, approveList, readSalesFacts, reviewSalesFacts } from '../services/sales/sales-store.js';
import { makeSuppression, suppressionMatcher } from '../services/sales/suppress-shape.js';
import { upkeepDue } from '../services/sales/lead-upkeep.js';
import { leadLedgerFor } from '../services/leads/lead-ledger.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('LeadEngine');
const OPERATOR_STATES = new Set(['approved', 'paused', 'retired']);

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    const [segments, prospects, suppressions, leads, facts] = await Promise.all([
      readSegments(wallet), readProspects(wallet), readSuppressions(wallet), leadLedgerFor(wallet).then((l) => l.load()), readSalesFacts(wallet),
    ]);
    const upkeep = upkeepDue({ leads, now: Date.now(), suppressed: suppressionMatcher(suppressions).email });
    res.json({ segments, prospects, suppressions, upkeep, facts });
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
    const reviewed = await reviewSalesFacts(req.walletAddress, { sheetId: req.params.sheetId, verdict: req.body?.verdict, note: req.body?.note });
    if (!reviewed.ok) return res.status(409).json({ error: reviewed.reason });
    log.info('Sales facts reviewed by the operator', { sheetId: req.params.sheetId, verdict: req.body?.verdict });
    res.json({ ok: true, facts: await readSalesFacts(req.walletAddress) });
  } catch (error) {
    log.error('Facts review failed', { error: error.message });
    res.status(500).json({ error: 'Could not record the review' });
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
