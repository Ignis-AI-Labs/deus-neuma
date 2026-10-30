/**
 * Neuma Wallet Routes
 *
 * REST API for neuma wallet operations: balance, send, history, sign.
 * Routes require either neuma auth or witness auth + workspace ownership.
 *
 * GET  /api/neuma/:neumaId/wallet           — address, balance
 * POST /api/neuma/:neumaId/wallet/send      — send ETH
 * GET  /api/neuma/:neumaId/wallet/history   — transaction history
 * POST /api/neuma/:neumaId/wallet/sign-message — sign arbitrary message
 */

import { Router } from 'express';
import { ethers } from 'ethers';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { requireNeumaAuth } from '../middleware/require-neuma-auth.js';
import * as walletService from '../services/neuma-wallet.js';
import { default as neumaWorkspace } from '../../core/workspace/neuma-workspace.js';
import { toAllowlist, addEntry, removeEntry } from '../../core/wallet/spend-policy.js';
import { redactRpcUrl } from '../services/chain/chain-registry.js';

import { createLogger } from '../services/logger.js';
const log = createLogger('NeumaWallet');

const router = Router();

// Validate neumaId param format
router.param('neumaId', (req, res, next, value) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    return res.status(400).json({ error: 'Invalid neumaId format' });
  }
  next();
});

/**
 * GET /:neumaId/wallet — Get wallet overview (address + balance).
 * Accepts either witness auth or neuma auth.
 */
router.get('/:neumaId/wallet', requireAuth, async (req, res) => {
  try {
    const { neumaId } = req.params;
    if (!(await witnessOwns(req, res, neumaId))) return;
    const address = await walletService.getAddress(neumaId);
    if (!address) {
      return res.status(404).json({ error: 'No wallet found for this neuma' });
    }

    // The desk's selected network governs the read where a neuma wallet lives
    // (base | base-sepolia); any other key is read on Base mainnet, and the
    // reply names the network actually read so the desk never shows a Base
    // number under another chain's name.
    const network = walletService.walletNetworkKey(typeof req.query.network === 'string' ? req.query.network : undefined);
    // null when the RPC does not answer: '0' would read as an empty wallet.
    let balance = null;
    try {
      balance = await walletService.getBalance(neumaId, { network });
    } catch (err) {
      log.warn('Balance read failed', { neumaId, network, error: redactRpcUrl(err.message) });
    }

    res.json({ neumaId, address, network, balance });
  } catch (err) {
    log.error('Balance error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch wallet info' });
  }
});

/**
 * POST /:neumaId/wallet/send — Send ETH from neuma wallet.
 * Requires neuma auth (keypair must be unlocked).
 * Body: { to, value }
 */
router.post('/:neumaId/wallet/send', requireNeumaAuth, async (req, res) => {
  const { neumaId } = req.params;

  // Verify the authenticated neuma matches the route param
  if (req.neumaId !== neumaId) {
    return res.status(403).json({ error: 'Token does not match requested neuma' });
  }

  const { to, value, approval } = req.body;
  if (!to || !ethers.isAddress(to)) {
    return res.status(400).json({ error: 'Valid recipient address required' });
  }
  if (!value || isNaN(Number(value)) || Number(value) <= 0) {
    return res.status(400).json({ error: 'Valid positive ETH amount required' });
  }

  try {
    const receipt = await walletService.sendTransaction(neumaId, { to, value, approval });
    res.json({ success: true, ...receipt });
  } catch (err) {
    log.error('Send error', { error: err.message });
    const msg = err.message;
    const status = msg.includes('rate limit') ? 429 :
                   msg.includes('not unlocked') ? 401 :
                   (msg.includes('allowlist') || msg.includes('approval') || msg.includes('threshold')) ? 403 :
                   500;
    res.status(status).json({ error: msg });
  }
});

/**
 * GET /:neumaId/wallet/history — Get transaction history.
 */
router.get('/:neumaId/wallet/history', requireAuth, async (req, res) => {
  try {
    const { neumaId } = req.params;
    if (!(await witnessOwns(req, res, neumaId))) return;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const transactions = await walletService.getTransactionHistory(neumaId, limit);
    res.json({ neumaId, transactions });
  } catch (err) {
    log.error('History error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch transaction history' });
  }
});

/**
 * POST /:neumaId/wallet/sign-message — Sign a domain-allowed message with
 * neuma's keypair (SEC-AUDIT-008 / #167). Requires neuma auth.
 * Body: { message } — must start with neuma:
 */
router.post('/:neumaId/wallet/sign-message', requireNeumaAuth, async (req, res) => {
  const { neumaId } = req.params;

  if (req.neumaId !== neumaId) {
    return res.status(403).json({ error: 'Token does not match requested neuma' });
  }

  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message string required' });
  }
  if (!walletService.isAllowedSignMessage(message)) {
    return res.status(403).json({
      error: 'Message not allowed — must start with the neuma: domain prefix',
    });
  }

  try {
    const signature = await walletService.signMessage(neumaId, message);
    res.json({ neumaId, message, signature });
  } catch (err) {
    log.error('Sign error', { error: err.message });
    const status = err.message.includes('not unlocked') ? 401
      : err.message.includes('not allowed') ? 403
      : 500;
    res.status(status).json({ error: err.message });
  }
});

// --- Spend allowlist (witness-managed) ---

/**
 * Verify the authenticated witness owns this neuma's workspace.
 * Returns true on success; writes the 403 and returns false otherwise.
 * Mirrors the ownership check in neuma-auth-routes /unlock.
 */
const witnessOwns = (req, res, neumaId) => assertNeumaOwner(req, res, neumaId);

/**
 * GET /:neumaId/wallet/allowlist — list approved recipients (witness only).
 */
router.get('/:neumaId/wallet/allowlist', requireAuth, async (req, res) => {
  const { neumaId } = req.params;
  try {
    if (!(await witnessOwns(req, res, neumaId))) return;
    const allowlist = toAllowlist(await neumaWorkspace.readSpendAllowlist(neumaId));
    res.json({ neumaId, entries: allowlist.entries });
  } catch (err) {
    log.error('Allowlist read error', { error: err.message });
    res.status(500).json({ error: 'Failed to read allowlist' });
  }
});

/**
 * POST /:neumaId/wallet/allowlist — approve a recipient (witness only).
 * Body: { address, label? }
 */
router.post('/:neumaId/wallet/allowlist', requireAuth, async (req, res) => {
  const { neumaId } = req.params;
  const { address, label } = req.body;
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Valid recipient address required' });
  }
  try {
    if (!(await witnessOwns(req, res, neumaId))) return;
    const updated = addEntry(
      await neumaWorkspace.readSpendAllowlist(neumaId),
      address, typeof label === 'string' ? label : '', new Date().toISOString(),
    );
    await neumaWorkspace.writeSpendAllowlist(neumaId, updated);
    log.info('wallet allowlist: recipient approved', { neumaId, address, by: req.walletAddress });
    res.json({ neumaId, entries: updated.entries });
  } catch (err) {
    log.error('Allowlist add error', { error: err.message });
    res.status(500).json({ error: 'Failed to update allowlist' });
  }
});

/**
 * DELETE /:neumaId/wallet/allowlist — revoke a recipient (witness only).
 * Body: { address }
 */
router.delete('/:neumaId/wallet/allowlist', requireAuth, async (req, res) => {
  const { neumaId } = req.params;
  const { address } = req.body;
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Valid recipient address required' });
  }
  try {
    if (!(await witnessOwns(req, res, neumaId))) return;
    const updated = removeEntry(await neumaWorkspace.readSpendAllowlist(neumaId), address);
    await neumaWorkspace.writeSpendAllowlist(neumaId, updated);
    res.json({ neumaId, entries: updated.entries });
  } catch (err) {
    log.error('Allowlist remove error', { error: err.message });
    res.status(500).json({ error: 'Failed to update allowlist' });
  }
});

/**
 * GET /:neumaId/wallet/threshold — read the autonomous spend threshold (witness only).
 */
router.get('/:neumaId/wallet/threshold', requireAuth, async (req, res) => {
  const { neumaId } = req.params;
  try {
    if (!(await witnessOwns(req, res, neumaId))) return;
    const threshold = await neumaWorkspace.readSpendThreshold(neumaId);
    res.json({ neumaId, thresholdEth: threshold?.thresholdEth ?? 0 });
  } catch (err) {
    log.error('Threshold read error', { error: err.message });
    res.status(500).json({ error: 'Failed to read threshold' });
  }
});

/**
 * PUT /:neumaId/wallet/threshold — set the autonomous spend threshold (witness only).
 * Body: { thresholdEth } — the ceiling (in ETH) for autonomous sends; above it a
 * fresh witness signature is required per transfer.
 */
router.put('/:neumaId/wallet/threshold', requireAuth, async (req, res) => {
  const { neumaId } = req.params;
  const { thresholdEth } = req.body;
  if (typeof thresholdEth !== 'number' || !Number.isFinite(thresholdEth) || thresholdEth < 0) {
    return res.status(400).json({ error: 'thresholdEth must be a number >= 0' });
  }
  try {
    if (!(await witnessOwns(req, res, neumaId))) return;
    await neumaWorkspace.writeSpendThreshold(neumaId, { thresholdEth });
    log.info('wallet threshold set', { neumaId, thresholdEth, by: req.walletAddress });
    res.json({ neumaId, thresholdEth });
  } catch (err) {
    log.error('Threshold write error', { error: err.message });
    res.status(500).json({ error: 'Failed to set threshold' });
  }
});

// --- Pending spend approvals (neuma-initiated; the witness resolves) ---

/**
 * GET /:neumaId/wallet/pending — the neuma's open spend requests awaiting the
 * witness's approval (witness only).
 */
router.get('/:neumaId/wallet/pending', requireAuth, async (req, res) => {
  const { neumaId } = req.params;
  try {
    if (!(await witnessOwns(req, res, neumaId))) return;
    const requests = await walletService.listPendingSpends(neumaId);
    res.json({ neumaId, requests });
  } catch (err) {
    log.error('Pending list error', { error: err.message });
    res.status(500).json({ error: 'Failed to read pending spends' });
  }
});

/**
 * POST /:neumaId/wallet/pending/:id/approve — approve a neuma's spend request by
 * signing its bound approval message; the transfer then executes (witness only).
 * Body: { signature, password } over pendingApprovalMessage(neumaId, request).
 * The key is decrypted for this exact request and never enters the unlock cache.
 */
router.post('/:neumaId/wallet/pending/:id/approve', requireAuth, async (req, res) => {
  const { neumaId, id } = req.params;
  const { signature, password } = req.body;
  if (!signature || typeof signature !== 'string') {
    return res.status(400).json({ error: 'Witness signature required' });
  }
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Neuma key password required' });
  }
  try {
    if (!(await witnessOwns(req, res, neumaId))) return;
    const receipt = await walletService.approvePendingSpendWithPassword(neumaId, id, signature, password);
    res.json({ success: true, ...receipt });
  } catch (err) {
    log.error('Pending approve error', { error: err.message });
    const msg = err.message;
    const status = msg.includes('Pending spend not found') ? 404 :
                   msg.includes('already') ? 409 :
                   msg.includes('rate limit') ? 429 :
                   (msg.includes('not unlocked') || msg.includes('Wrong password')) ? 401 :
                   (msg.includes('allowlist') || msg.includes('approval') || msg.includes('threshold')) ? 403 :
                   500;
    res.status(status).json({ error: msg });
  }
});

/**
 * POST /:neumaId/wallet/pending/:id/reject — decline a neuma's spend request
 * (witness only). Nothing is sent. Body: { note? } — the operator's word
 * back to the being, told with the outcome.
 */
router.post('/:neumaId/wallet/pending/:id/reject', requireAuth, async (req, res) => {
  const { neumaId, id } = req.params;
  const note = typeof req.body?.note === 'string' ? req.body.note : '';
  try {
    if (!(await witnessOwns(req, res, neumaId))) return;
    const request = await walletService.rejectPendingSpend(neumaId, id, note);
    res.json({ success: true, request });
  } catch (err) {
    log.error('Pending reject error', { error: err.message });
    const status = err.message.includes('not found') ? 404 : err.message.includes('already') ? 409 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
