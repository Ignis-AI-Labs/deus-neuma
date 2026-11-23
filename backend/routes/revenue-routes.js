/**
 * Revenue routes — the operator's window onto the Mercator office, the
 * house's sales seat (Design note, 2026-10-29. Mounted at /api/v1/revenue. Every route
 * needs the operator's Bearer token and reads or moves only the signed-in
 * wallet's OWN house. Seating a Mercator seeds its playbook (MAKOTO) — fail
 * soft: a scaffold that cannot land never unseats the designation. Where
 * deliveries go (PUT /delivery-destination) is the operator's alone to set.
 * The lead engine's operator routes ride under /lead-engine (lead-engine-routes.js).
 */

import express from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { croDesignation } from '../services/revenue/cro-designation.js';
import { scaffoldRevenueWorkspace } from '../services/revenue/revenue-scaffold.js';
import { readDeals, moveDealAndLead, openDeal } from '../services/revenue/deal-store.js';
import { pipeline, idleDays, STALE_DAYS, CLOSE_REASONS, makeDeal } from '../services/revenue/deal-shape.js';
import { companiesOfHouse, companyOfHouse } from '../services/revenue/deal-company.js';
import { leadLedgerFor } from '../services/leads/lead-ledger.js';
import { readDeliveries, readDestination, setDestination } from '../services/delivery/delivery-store.js';
import leadEngineRouter from './lead-engine-routes.js';
import dealInvoiceRouter from './deal-invoice-routes.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Revenue');

const router = express.Router();
router.use(requireAuth);
router.use('/lead-engine', leadEngineRouter);
router.use(dealInvoiceRouter); // the operator's invoices for won deals (deal-invoice-routes.js)

router.get('/seat', async (req, res) => {
  try {
    res.json({ mercator: await croDesignation.getOfficer(req.walletAddress) });
  } catch (error) {
    log.error('Mercator designation read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the Mercator designation' });
  }
});

router.put('/seat', async (req, res) => {
  const laneId = typeof req.body?.laneId === 'string' ? req.body.laneId.trim() : '';
  if (!laneId) return res.status(400).json({ error: 'a Mercator designation needs a lane id' });
  if (!(await assertNeumaOwner(req, res, laneId))) return;
  try {
    const mercator = await croDesignation.designate(req.walletAddress, laneId);
    log.info('Mercator designated', { laneId, wallet: req.walletAddress });
    try {
      await scaffoldRevenueWorkspace(laneId);
    } catch (scaffoldError) {
      log.error('Mercator scaffold failed — the designation stands', { laneId, error: scaffoldError.message });
    }
    return res.json({ mercator });
  } catch (error) {
    if (/not a lane of this house/.test(error.message)) return res.status(403).json({ error: error.message });
    log.error('Mercator designation failed', { error: error.message });
    return res.status(500).json({ error: 'Failed to designate the Mercator' });
  }
});

router.delete('/seat', async (req, res) => {
  try {
    const officer = await croDesignation.getOfficer(req.walletAddress);
    if (officer?.laneId && !(await assertNeumaOwner(req, res, officer.laneId))) return;
    await croDesignation.clear(req.walletAddress);
    log.info('Mercator cleared', { wallet: req.walletAddress });
    res.json({ cleared: true });
  } catch (error) {
    log.error('Mercator clear failed', { error: error.message });
    res.status(500).json({ error: 'Failed to clear the Mercator designation' });
  }
});

// The sales board: the seat, the pipeline at a glance, every deal, where deliveries go and what was delivered.
router.get('/board', async (req, res) => {
  try {
    const [mercator, { deals, torn }, destination, deliveries, companies] = await Promise.all([
      croDesignation.getOfficer(req.walletAddress), readDeals(req.walletAddress), readDestination(req.walletAddress), readDeliveries(req.walletAddress), companiesOfHouse(req.walletAddress),
    ]);
    // Each open deal says how long it has stood without a move; one quiet for STALE_DAYS is marked.
    const now = Date.now();
    const shown = deals.map((d) => { const idle = idleDays(d, now); return { ...d, idleDays: idle, stale: idle !== null && idle >= STALE_DAYS }; });
    res.json({ mercator, pipeline: pipeline(deals), deals: shown, torn, destination, deliveries, staleDays: STALE_DAYS, reasons: CLOSE_REASONS, companies });
  } catch (error) {
    log.error('Revenue board read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read the sales board' });
  }
});

// THE OPERATOR OPENS A DEAL WITH THEIR OWN HAND — the same record the seat's act makes (deal-shape.js makeDeal), for
// any company of the house; from a lead on the ledger, that lead is marked qualified.
router.post('/deals', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    const company = await companyOfHouse(wallet, req.body?.company);
    if (!company) return res.status(400).json({ error: 'choose the company the deal is for' });
    const ledger = await leadLedgerFor(wallet);
    // The lead it came from, by its id or by its address as the operator typed it.
    const named = String(req.body?.leadId ?? req.body?.leadContact ?? '').trim().toLowerCase();
    const lead = named ? (await ledger.load()).find((l) => l.id === named || String(l.contact ?? '').toLowerCase() === named) ?? null : null;
    if (named && !lead) return res.status(400).json({ error: `nobody on the lead list has the address ${named} — leave it empty, or add the person under ALL PEOPLE first` });
    let deal;
    try {
      deal = makeDeal({ companyId: company.id, buyer: req.body?.buyer, leadId: lead?.id, value: req.body?.value, spin: req.body?.spin, nextStep: req.body?.nextStep, openedBy: 'operator', now: new Date().toISOString() });
    } catch (err) { return res.status(400).json({ error: err.message }); }
    const opened = await openDeal(wallet, deal);
    if (!opened.ok) return res.status(409).json({ error: opened.reason });
    if (lead) await ledger.touch(lead.id, { status: 'qualified', note: `deal [${deal.id}] opened by the operator`, by: 'operator' }).catch(() => {});
    log.info('A deal was opened by the operator', { id: deal.id, company: company.id });
    return res.json({ ok: true, deal: opened.deal });
  } catch (error) {
    log.error('Deal open failed', { error: error.message });
    return res.status(500).json({ error: 'Could not open the deal' });
  }
});

// THE OPERATOR MOVES A DEAL WITH THEIR OWN HAND (Design note, 2026-11-21: proposed, won or lost, with why — the same rule
// the seat's act keeps (deal-shape.js judgeMove), and a won or lost deal moves its lead the same way.
router.post('/deals/:id/move', async (req, res) => {
  try {
    const moved = await moveDealAndLead(req.walletAddress, String(req.params.id), { stage: req.body?.stage, note: req.body?.note, reason: req.body?.reason, value: req.body?.value, nextStep: req.body?.nextStep, by: 'operator', now: new Date().toISOString() });
    if (!moved.ok) return res.status(/no such deal/.test(moved.reason) ? 404 : 400).json({ error: moved.reason });
    log.info('A deal was moved by the operator', { id: req.params.id, stage: moved.event.stage });
    return res.json({ ok: true, deal: moved.deal });
  } catch (error) {
    log.error('Deal move failed', { error: error.message });
    return res.status(500).json({ error: 'Could not move the deal' });
  }
});

// Where deliveries go: a folder on this machine the operator serves, and its https address — the operator's alone.
router.put('/delivery-destination', async (req, res) => {
  try {
    const set = await setDestination(req.walletAddress, { folder: req.body?.folder, linkBase: req.body?.linkBase, by: 'operator', now: new Date().toISOString() });
    if (!set.ok) return res.status(400).json({ error: set.reason });
    res.json(set);
  } catch (error) {
    log.error('the delivery destination could not be set', { error: error.message });
    res.status(500).json({ error: 'Failed to set where deliveries go' });
  }
});

export default router;
