/**
 * Treasury routes — the operator's window onto the Quaestor's office and
 * the house's money. Mounted at /api/v1/treasury. Every route requires the
 * operator's Bearer token and reads or moves the SIGNED-IN operator's own
 * house only: two houses on one machine are never confused.
 *
 *   GET    /seat           the house's Quaestor (or null)
 *   PUT    /seat           seat one of the operator's own lanes {laneId}
 *   DELETE /seat           unseat
 *   GET    /board          the whole treasury (treasury-board.js)
 *   GET    /spends         every pending spend, as cards, and whether a Quaestor is seated
 *   POST   /flags/:id/seen the operator has read a Quaestor's flag
 *   GET    /costs?month=  the cost meter: its setting, its items, a month's statement
 *   PUT    /costs/setup   the electricity rate and this house's share (the meter on), or {on: false}
 *   POST   /costs/fixed   a fixed cost: hardware over its months, or a monthly one
 *   POST   /costs/bills   one provider's API bill for one month
 *   POST   /costs/:id/void a wrong cost or bill, with why
 *   PUT    /invoice-wallet where invoices are paid {address} — the operator's alone; watched for money in
 *   POST   /invoices/:id/paid the receipt that paid it {receipt}
 *   POST   /invoices/:id/void a wrong invoice, with why {reason}
 *
 * No route here moves money. A spend is decided where it always was —
 * POST /api/v1/neuma/:id/wallet/pending/:id/approve (the operator's own
 * signature AND the being's key password) or …/reject {note?}.
 */

import express from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { cfoDesignation } from '../services/treasury/cfo-designation.js';
import { readTreasuryBoard } from '../services/treasury/treasury-board.js';
import { pendingSpendCards } from '../services/treasury/treasury-lanes.js';
import { markFlagSeen } from '../services/treasury/treasury-office-store.js';
import { caoDesignation } from '../services/accounts/cao-designation.js';
import { costBoard, statementOf, setMeter, enterCost, voidCost } from '../services/cost-meter/cost-store.js';
import { makeSetup, makeCost, makeBill, monthOf, MONTH } from '../services/cost-meter/cost-shape.js';
import { setPayTo, recordPaid, voidInvoice } from '../services/invoices/invoice-store.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Treasury');

const router = express.Router();
router.use(requireAuth);
// Money's standing is never cacheable: a decided spend must vanish.
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

router.get('/seat', async (req, res) => {
  try {
    res.json({ cfo: await cfoDesignation.getOfficer(req.walletAddress) });
  } catch (error) {
    log.error('Quaestor designation read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the Quaestor designation' });
  }
});

router.put('/seat', async (req, res) => {
  const laneId = typeof req.body?.laneId === 'string' ? req.body.laneId.trim() : '';
  if (!laneId) return res.status(400).json({ error: 'a Quaestor designation needs a lane id' });
  if (!(await assertNeumaOwner(req, res, laneId))) return;
  try {
    // TREASURY is not ACCOUNTS (2026-10-29): the Logista keeps the books, so it never approves the money.
    if ((await caoDesignation.getOfficer(req.walletAddress))?.laneId === laneId) {
      return res.status(409).json({ error: 'that being keeps the books as Logista — whoever keeps the books never approves the money; seat another being as Quaestor' });
    }
    const cfo = await cfoDesignation.designate(req.walletAddress, laneId);
    log.info('Quaestor designated', { laneId: cfo.laneId, wallet: req.walletAddress });
    res.json({ cfo });
  } catch (error) {
    if (/not a lane of this house/.test(error.message)) return res.status(403).json({ error: error.message });
    log.error('Quaestor designation failed', { error: error.message });
    res.status(500).json({ error: 'Failed to designate the Quaestor' });
  }
});

router.delete('/seat', async (req, res) => {
  try {
    const officer = await cfoDesignation.getOfficer(req.walletAddress);
    if (officer?.laneId && !(await assertNeumaOwner(req, res, officer.laneId))) return;
    await cfoDesignation.clear(req.walletAddress);
    log.info('Quaestor cleared', { wallet: req.walletAddress });
    res.json({ cleared: true });
  } catch (error) {
    log.error('Quaestor clear failed', { error: error.message });
    res.status(500).json({ error: 'Failed to clear the Quaestor designation' });
  }
});

router.get('/board', async (req, res) => {
  try {
    res.json(await readTreasuryBoard(req.walletAddress));
  } catch (error) {
    log.error('the treasury could not be read', { error: error.message });
    res.status(500).json({ error: 'Failed to read the treasury' });
  }
});

router.get('/spends', async (req, res) => {
  try {
    const [spends, officer] = await Promise.all([pendingSpendCards(req.walletAddress), cfoDesignation.getOfficer(req.walletAddress)]);
    res.json({ spends, seated: Boolean(officer) });
  } catch (error) {
    log.error('pending spends could not be read', { error: error.message });
    res.status(500).json({ error: 'Failed to read the pending spends' });
  }
});

router.post('/flags/:id/seen', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^tf_[a-f0-9]{12}$/.test(id)) return res.status(400).json({ error: 'not a treasury flag id' });
  try {
    res.json({ flag: await markFlagSeen(req.walletAddress, id) });
  } catch (error) {
    if (/no such treasury flag/.test(error.message)) return res.status(404).json({ error: error.message });
    log.error('treasury flag could not be marked seen', { error: error.message });
    res.status(500).json({ error: 'Failed to mark the flag seen' });
  }
});

// The cost meter: the operator's own entries; a malformed one is refused with its reason.
const costWrite = (label, act) => async (req, res) => {
  let made;
  try {
    made = act({ ...req.body, by: 'operator', now: new Date().toISOString() });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    res.json(await made(req.walletAddress));
  } catch (error) {
    log.error(`the cost meter could not ${label}`, { error: error.message });
    res.status(500).json({ error: `Failed to ${label}` });
  }
};

router.get('/costs', async (req, res) => {
  const month = typeof req.query.month === 'string' && req.query.month ? req.query.month : monthOf(Date.now());
  if (!MONTH.test(month)) return res.status(400).json({ error: 'month: YYYY-MM' });
  try {
    const nowMs = Date.now();
    const [board, statement] = await Promise.all([costBoard(req.walletAddress, nowMs), statementOf(req.walletAddress, month, nowMs)]);
    res.json({ ...board, statement });
  } catch (error) {
    log.error('the cost meter could not be read', { error: error.message });
    res.status(500).json({ error: 'Failed to read the cost meter' });
  }
});

router.put('/costs/setup', costWrite('set the meter', (body) => {
  const setup = makeSetup(body);
  return (wallet) => setMeter(wallet, setup);
}));

router.post('/costs/fixed', costWrite('enter the cost', (body) => {
  const cost = makeCost(body);
  return (wallet) => enterCost(wallet, 'cost', cost);
}));

router.post('/costs/bills', costWrite('enter the bill', (body) => {
  const bill = makeBill(body);
  return (wallet) => enterCost(wallet, 'bill', bill);
}));

router.post('/costs/:id/void', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[ci]-[a-f0-9]{8}$/.test(id)) return res.status(400).json({ error: 'not a cost or bill id' });
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  if (reason.length < 3) return res.status(400).json({ error: 'reason: why this entry is wrong' });
  try {
    const voided = await voidCost(req.walletAddress, id, { reason, by: 'operator', at: new Date().toISOString() });
    if (!voided.ok) return res.status(404).json({ error: voided.reason });
    res.json(voided);
  } catch (error) {
    log.error('a cost could not be voided', { error: error.message });
    res.status(500).json({ error: 'Failed to void the entry' });
  }
});

// The invoices: where they are paid is the operator's alone to say; the rest the operator may record too.
const invoiceAct = (label, act) => async (req, res) => {
  try {
    const done = await act(req);
    if (!done.ok) return res.status(/no such/.test(done.reason) ? 404 : 400).json({ error: done.reason });
    res.json(done);
  } catch (error) {
    log.error(`an invoice could not ${label}`, { error: error.message });
    res.status(500).json({ error: `Failed to ${label}` });
  }
};

router.put('/invoice-wallet', invoiceAct('set where invoices are paid', (req) => setPayTo(req.walletAddress, { address: req.body?.address, by: 'operator', now: new Date().toISOString() })));
router.post('/invoices/:id/paid', invoiceAct('be recorded paid', (req) => recordPaid(req.walletAddress, { invoiceId: String(req.params.id), receiptKey: req.body?.receipt, by: 'operator', now: new Date().toISOString() })));
router.post('/invoices/:id/void', invoiceAct('be voided', (req) => voidInvoice(req.walletAddress, { invoiceId: String(req.params.id), reason: req.body?.reason, by: 'operator', now: new Date().toISOString() })));

export default router;
