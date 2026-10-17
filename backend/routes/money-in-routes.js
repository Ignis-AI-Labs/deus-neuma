/**
 * Money-in routes — the operator's window onto the house's receive ledger:
 * what came in (paged, filtered), totals per period, the watch set, a
 * scan-now, the extra receive addresses, and attributions. Mounted at
 * /api/v1/money-in. Every route requires the operator's Bearer token, and
 * the house IS the caller's wallet — no route reads or writes another
 * house's ledger. Every mutation is logged with that wallet.
 *
 * Nothing here can move money: there is no send, no sign, no key — the
 * ledger is receive-only and read-only by construction.
 */

import express from 'express';
import { ethers } from 'ethers';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { readReceipts, readScanState, readExtras, putExtra, deleteExtra, appendAttribution } from '../services/money-in/money-in-store.js';
import { filterReceipts, summarizeMoneyIn, totalsByPeriod, GRANULARITIES } from '../services/money-in/money-in-summary.js';
import { houseWatchSet } from '../services/money-in/watch-set.js';
import { scanHouse } from '../services/money-in/money-in-scan.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('MoneyIn');

const router = express.Router();
router.use(requireAuth);

const PAGE_MAX = 200;
const LABEL_RE = /^[\x20-\x7E]{1,64}$/;
const ATTRIBUTION_MAX = 280;

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

// The filter a query string asks for; an unparseable date is refused, never
// silently widened into "all time".
const filterOf = (query) => {
  const f = { member: str(query.member), asset: str(query.asset), network: str(query.network), from: str(query.from), to: str(query.to) };
  for (const k of ['from', 'to']) {
    if (f[k] !== undefined && Number.isNaN(Date.parse(f[k]))) return { error: `${k} must be an ISO date` };
  }
  return { filter: f };
};

const fail = (res, error, message) => {
  log.error(message, { error: error.message });
  res.status(500).json({ error: message });
};

// GET /ledger?member&asset&network&from&to&offset&limit — newest first.
router.get('/ledger', async (req, res) => {
  const { filter, error } = filterOf(req.query);
  if (error) return res.status(400).json({ error });
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const limit = Math.min(PAGE_MAX, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  try {
    const rows = filterReceipts(await readReceipts(req.walletAddress), filter)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    res.json({ total: rows.length, offset, limit, receipts: rows.slice(offset, offset + limit) });
  } catch (err) {
    fail(res, err, 'Failed to read the money-in ledger');
  }
});

// GET /totals?from&to&member&asset&network&granularity=day|week|month
router.get('/totals', async (req, res) => {
  const { filter, error } = filterOf(req.query);
  if (error) return res.status(400).json({ error });
  const granularity = str(req.query.granularity);
  if (granularity && !GRANULARITIES.includes(granularity)) {
    return res.status(400).json({ error: `granularity must be one of ${GRANULARITIES.join(', ')}` });
  }
  try {
    const rows = await readReceipts(req.walletAddress);
    res.json({
      summary: summarizeMoneyIn(rows, filter),
      ...(granularity ? { granularity, periods: totalsByPeriod(rows, { granularity, ...filter }) } : {}),
    });
  } catch (err) {
    fail(res, err, 'Failed to total the money-in ledger');
  }
});

// GET /watch — what is watched, what is not and why, cursors and gaps.
router.get('/watch', async (req, res) => {
  try {
    const [set, state, extras] = await Promise.all([
      houseWatchSet(req.walletAddress), readScanState(req.walletAddress), readExtras(req.walletAddress),
    ]);
    res.json({ ...set, extras, networks: state.networks, gaps: state.gaps, lastScan: state.lastScan });
  } catch (err) {
    fail(res, err, 'Failed to read the money-in watch');
  }
});

// POST /scan — scan now. 409 when chain access is switched off.
router.post('/scan', async (req, res) => {
  try {
    const result = await scanHouse(req.walletAddress);
    if (!result.ok) return res.status(result.code === 'CHAIN_ACCESS_OFF' ? 409 : 400).json({ error: result.message, code: result.code });
    log.info('money-in scan run', { wallet: req.walletAddress, appended: result.appended.length });
    res.json({ appended: result.appended.length, networks: result.networks, watched: result.watched, unwatched: result.unwatched });
  } catch (err) {
    fail(res, err, 'The money-in scan failed');
  }
});

// PUT /addresses/:address {label, member?} — declare a receive address.
router.put('/addresses/:address', async (req, res) => {
  const { address } = req.params;
  if (!ethers.isAddress(address)) return res.status(400).json({ error: 'not an EVM address' });
  const label = str(req.body?.label);
  if (!label || !LABEL_RE.test(label)) return res.status(400).json({ error: 'a label of 1-64 printable characters is required' });
  const member = str(req.body?.member) ?? null;
  if (member && !(await assertNeumaOwner(req, res, member))) return;
  try {
    const extras = await putExtra(req.walletAddress, {
      address: ethers.getAddress(address), label, member, by: req.walletAddress, at: new Date().toISOString(),
    });
    log.info('money-in receive address declared', { wallet: req.walletAddress, address, member });
    res.json({ extras });
  } catch (err) {
    fail(res, err, 'Failed to declare the receive address');
  }
});

// DELETE /addresses/:address — stop watching it; its receipts stay.
router.delete('/addresses/:address', async (req, res) => {
  const { address } = req.params;
  if (!ethers.isAddress(address)) return res.status(400).json({ error: 'not an EVM address' });
  try {
    const extras = await deleteExtra(req.walletAddress, address);
    if (!extras) return res.status(404).json({ error: 'that address is not a declared receive address' });
    log.info('money-in receive address removed', { wallet: req.walletAddress, address });
    res.json({ extras });
  } catch (err) {
    fail(res, err, 'Failed to remove the receive address');
  }
});

// PATCH /attribution {key, attribution|null} — which deal or work it was for.
router.patch('/attribution', async (req, res) => {
  const key = str(req.body?.key);
  const raw = req.body?.attribution;
  if (!key) return res.status(400).json({ error: 'a receipt key is required' });
  if (raw !== null && (typeof raw !== 'string' || !raw.trim() || raw.length > ATTRIBUTION_MAX)) {
    return res.status(400).json({ error: `attribution must be null or 1-${ATTRIBUTION_MAX} characters` });
  }
  try {
    const found = await appendAttribution(req.walletAddress, {
      key, attribution: raw === null ? null : raw.trim(), by: req.walletAddress, at: new Date().toISOString(),
    });
    if (!found) return res.status(404).json({ error: 'no receipt carries that key' });
    log.info('money-in attribution set', { wallet: req.walletAddress, key });
    res.json({ key, attribution: raw === null ? null : raw.trim() });
  } catch (err) {
    fail(res, err, 'Failed to record the attribution');
  }
});

export default router;
