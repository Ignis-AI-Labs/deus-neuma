/**
 * Chain routes — the operator's window onto the same chain truth the beings
 * read: direct Ethereum + Base reads through the operator's own keyed RPC,
 * never an explorer middleman. Mounted at /api/v1/chain. All routes require
 * the operator's Bearer token; the switch flip is logged with the wallet
 * that made it.
 *
 * The master switch (chain-access.js) governs the BEING surface; the desk's
 * own reads stand on requireAuth alone — an operator reading public chain
 * state through their own endpoint needs no one's consent, and the being
 * catalog stays visible (HELD) so a being can ask for the switch.
 */

import { Router } from 'express';
import { ethers } from 'ethers';
import { requireAuth } from '../services/auth.js';
import { chainSettings } from '../services/chain/chain-access.js';
import { listChains } from '../services/chain/chain-registry.js';
import { nativeBalance, tokenBalance, tokenMeta } from '../services/chain/evm-rpc.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('ChainRoutes');
const router = Router();
router.use(requireAuth);

// The chain key charset — registry membership is judged by the verb layer.
const CHAIN_KEY = /^[a-z0-9-]+$/;

const accessPayload = async () => ({
  enabled: await chainSettings.isEnabled(),
  envLocked: chainSettings.isEnvLocked(),
});

// ── The switch (the web-access precedent: the flip is a deliberate act) ─────
router.get('/access', async (req, res) => {
  try {
    res.json(await accessPayload());
  } catch (error) {
    log.error('chain-access read failed', { error: error.message });
    res.status(500).json({ error: { code: 'CHAIN_ACCESS_READ', message: 'Failed to read chain access state' } });
  }
});

router.put('/access', async (req, res) => {
  try {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: { code: 'CHAIN_BAD_PARAMS', message: 'enabled must be a boolean' } });
    }
    await chainSettings.setEnabled(enabled);
    log.info('Chain access toggled', { enabled, wallet: req.walletAddress });
    res.json(await accessPayload());
  } catch (error) {
    log.error('chain-access write failed', { error: error.message });
    res.status(500).json({ error: { code: 'CHAIN_ACCESS_WRITE', message: 'Failed to persist chain access state' } });
  }
});

// ── The chains this rig can read ────────────────────────────────────────────
router.get('/chains', (req, res) => {
  res.json({ chains: listChains() });
});

// Structured refusals: the verb's error code becomes the HTTP status —
// the caller reads WHY, never a bare 404 that could mean two things.
const STATUS_BY_CODE = Object.freeze({
  CHAIN_BAD_PARAMS: 400,
  CHAIN_RANGE: 400,
  CHAIN_UNKNOWN: 404,
  CHAIN_UNCONFIGURED: 503,
  CHAIN_RPC: 502,
});

const sendResult = (res, result) => {
  if (result.ok) return res.json(result);
  const status = STATUS_BY_CODE[result.error.code] || 500;
  return res.status(status).json({ error: result.error });
};

const validatePath = (res, chain, address) => {
  if (!CHAIN_KEY.test(chain || '')) {
    res.status(400).json({ error: { code: 'CHAIN_BAD_PARAMS', message: 'chain must be a lowercase key (a-z, 0-9, dashes)' } });
    return false;
  }
  if (!ethers.isAddress(address || '')) {
    res.status(400).json({ error: { code: 'CHAIN_BAD_PARAMS', message: 'address must be a valid 0x EVM address' } });
    return false;
  }
  return true;
};

// Native balance, or a token balance when ?token=0x… rides along (&tokenId=
// for ERC-1155).
router.get('/balance/:chain/:address', async (req, res) => {
  const { chain, address } = req.params;
  if (!validatePath(res, chain, address)) return;
  const token = typeof req.query.token === 'string' && req.query.token.trim() ? req.query.token.trim() : null;
  try {
    const result = token
      ? await tokenBalance(chain, token, address, req.query.tokenId)
      : await nativeBalance(chain, address);
    sendResult(res, result);
  } catch (error) {
    log.error('chain balance read failed', { error: error.message });
    res.status(500).json({ error: { code: 'CHAIN_RPC', message: 'Failed to read the balance' } });
  }
});

// A token contract's metadata: name, symbol, decimals, totalSupply.
router.get('/token/:chain/:address', async (req, res) => {
  const { chain, address } = req.params;
  if (!validatePath(res, chain, address)) return;
  try {
    sendResult(res, await tokenMeta(chain, address));
  } catch (error) {
    log.error('chain token read failed', { error: error.message });
    res.status(500).json({ error: { code: 'CHAIN_RPC', message: 'Failed to read the token' } });
  }
});

export default router;
