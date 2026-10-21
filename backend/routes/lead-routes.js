/**
 * Lead routes — the witness's window onto the house's working leads.
 *
 * The ledger is the return current of the outreach machine: capture, touch,
 * and walk every prospect in one list. Every mutation records who made it,
 * and every change lands as one appended touch on the lead's history — the
 * record of how a relationship moved is never quietly rewritten. All routes
 * require the witness's Bearer token, and every route reads and moves only
 * the signed-in operator's OWN house's ledger (ruling, 2026-10-16).
 */

import express from 'express';
import { requireAuth } from '../services/auth.js';
import { leadLedgerFor, leadsByStatus, validateLead, LEAD_STATUSES } from '../services/leads/lead-ledger.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Leads');

const router = express.Router();
router.use(requireAuth);

// impure — the signed-in operator's own ledger.
const ledgerOf = (req) => leadLedgerFor(req.walletAddress);

// The whole ledger, plus a by-status board view with honest zeros.
router.get('/', async (req, res) => {
  try {
    const leads = await (await ledgerOf(req)).load();
    res.json({ leads, board: leadsByStatus(leads), statuses: LEAD_STATUSES });
  } catch (error) {
    log.error('Lead ledger read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the lead ledger' });
  }
});

// Capture one lead. A malformed lead is the caller's fault (400, refused at
// the door); a store that cannot be read or written is ours (500).
router.post('/', async (req, res) => {
  const { name, contact, channelId, source, note, status, ownerNeumaId } = req.body || {};
  const invalid = validateLead({ name, contact, channelId, source, status });
  if (invalid) return res.status(400).json({ error: invalid });
  try {
    const lead = await (await ledgerOf(req)).add({
      name, contact, channelId, source, note, status, ownerNeumaId,
      addedBy: req.walletAddress,
    });
    log.info('Lead captured', { id: lead.id, wallet: req.walletAddress });
    res.status(201).json({ lead });
  } catch (error) {
    log.error('Lead capture failed', { error: error.message });
    res.status(500).json({ error: 'Failed to capture the lead' });
  }
});

// Touch one lead — field edits, a status move, and a note, as ONE touch.
router.put('/:id', async (req, res) => {
  const { name, contact, channelId, source, status, note, ownerNeumaId } = req.body || {};
  try {
    const result = await (await ledgerOf(req)).touch(req.params.id, {
      name, contact, channelId, source, status, note, ownerNeumaId,
      by: req.walletAddress,
    });
    if (!result.ok) {
      return res.status(result.error === 'no such lead' ? 404 : 400).json({ error: result.error });
    }
    log.info('Lead touched', { id: req.params.id, wallet: req.walletAddress });
    res.json({ lead: result.lead });
  } catch (error) {
    log.error('Lead touch failed', { id: req.params.id, error: error.message });
    res.status(500).json({ error: 'Failed to update the lead' });
  }
});

// Drop one lead from the ledger.
router.delete('/:id', async (req, res) => {
  try {
    const removed = await (await ledgerOf(req)).remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'no such lead' });
    log.info('Lead removed', { id: req.params.id, wallet: req.walletAddress });
    res.json({ removed });
  } catch (error) {
    log.error('Lead removal failed', { id: req.params.id, error: error.message });
    res.status(500).json({ error: 'Failed to remove the lead' });
  }
});

export default router;
