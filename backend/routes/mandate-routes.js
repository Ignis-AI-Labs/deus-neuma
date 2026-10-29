/**
 * Mandate routes — the house operator's MANDATE for the CMO seat (Founder
 * 2026-10-24). Mounted at /api/v1/mandate.
 *
 *   GET  /          where the mandate stands, its words, what a grant may
 *                   name, its open holds, and DONE FOR YOU (mandate-feed.js)
 *   POST /preflight the grant protocol's rows for a grant about to be made
 *   POST /grant     grant one (refused while one stands, or any row fails)
 *   POST /withdraw  end it NOW: cancels what has not left, tells the seat
 *   POST /resume    resume a paused one
 *   POST /renew     restart its term from today
 *   POST /holds/:id/clear  clear a hostile-text hold, once the operator looked
 *
 * ON FROM THE DESK, OFF FROM ANYWHERE (ruling, 2026-10-24). Every act that
 * turns capacity ON — grant, resume, renew, clearing a hold — is refused
 * unless the request is this computer's own desk (install-owner.js
 * isLocalDesk: a loopback peer, no forwarding, a loopback Host — never a
 * paired phone or a tunnel), with the operator's signed session. WITHDRAW
 * answers on every road, and the CLI withdraws with the desk closed.
 *
 * The house is always the caller's own wallet — no route takes a house id a
 * caller could forge — and a grant is refused unless the seated CMO's lane is
 * that wallet's own. A being holds no operator session, so no being can
 * reach any of these: a mandate never grants itself.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { isLocalDesk } from '../services/install-owner.js';
import { houseKey } from '../services/staff/cos-designation.js';
import { houseOfLane } from '../services/social/house-positions.js';
import { cmoDesignation } from '../services/marketing/cmo-designation.js';
import { readMandateView } from '../services/marketing/mandate/mandate-feed.js';
import { grantMandate, withdrawMandate, resumeMandate, renewMandate, clearMandateHold } from '../services/marketing/mandate/mandate-lifecycle.js';
import { runPreflight } from '../services/marketing/mandate/mandate-preflight-facts.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Mandate');

const router = express.Router();
router.use(requireAuth);
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

// impure — answer one act's outcome, with the fresh view beside it.
const answer = async (res, req, out) => {
  if (!out.ok) return res.status(out.status || 409).json({ error: out.error });
  return res.json({ ...out, view: await readMandateView(req.walletAddress) });
};

export const DESK_ONLY = 'A mandate is turned on only at this computer\'s own desk. WITHDRAW works from anywhere; turning it on never does.';

// The gate on every act that turns capacity ON.
const deskOnly = (req, res, next) => (isLocalDesk(req)
  ? next()
  : res.status(403).json({ error: DESK_ONLY, code: 'MANDATE_DESK_ONLY' }));

const guarded = (name, fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    log.error(`mandate ${name} failed`, { error: error.message });
    res.status(500).json({ error: `The mandate could not be ${name === 'view' ? 'read' : name}` });
  }
};

router.get('/', guarded('view', async (req, res) => res.json(await readMandateView(req.walletAddress))));

router.post('/preflight', guarded('checked', async (req, res) => res.json({
  ...(await runPreflight(req.walletAddress, req.body || {})), atDesk: isLocalDesk(req),
})));

router.post('/grant', deskOnly, guarded('granted', async (req, res) => {
  const house = houseKey(req.walletAddress);
  const officer = house ? await cmoDesignation.getOfficer(house) : null;
  if (officer?.laneId && (await houseOfLane(officer.laneId)) !== house) {
    return res.status(403).json({ error: 'only the house operator who owns the CMO\'s lane may grant its mandate' });
  }
  // The protocol again, here: the screen that showed it is never the gate.
  const checked = await runPreflight(house, req.body || {});
  if (!checked.clear) {
    const failed = checked.rows.filter((r) => r.ok !== true);
    return res.status(409).json({ error: `Not granted — ${failed.map((r) => `${r.label}: ${r.words}`).join(' ')}`, code: 'MANDATE_PREFLIGHT', rows: checked.rows });
  }
  const out = await grantMandate(house, req.body || {});
  if (out.ok) log.warn('MANDATE GRANTED — the CMO acts without asking inside its scope', { house, mandateId: out.mandate.id });
  return answer(res, req, out);
}));

router.post('/withdraw', guarded('withdrawn', async (req, res) => answer(res, req,
  await withdrawMandate(req.walletAddress, { by: houseKey(req.walletAddress), reason: req.body?.reason }))));

router.post('/resume', deskOnly, guarded('resumed', async (req, res) => answer(res, req, await resumeMandate(req.walletAddress))));

router.post('/renew', deskOnly, guarded('renewed', async (req, res) => answer(res, req, await renewMandate(req.walletAddress))));

router.post('/holds/:id/clear', deskOnly, guarded('cleared', async (req, res) => answer(res, req, await clearMandateHold(req.walletAddress, req.params.id))));

export default router;
