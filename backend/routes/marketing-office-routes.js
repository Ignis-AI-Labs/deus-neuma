/**
 * /api/v1/marketing/office — the two reads the MARKETING board's new panels
 * need that the desk did not already make (marketing panel slice 4):
 *
 *   GET /plan                 the house's weekly plan (CMO LOG): the locked
 *                             plan, or null when none is locked; and `board`,
 *                             the CMO's board arrangements so far
 *                             ({changes, lastAt, lastLevel}, or null)
 *   GET /watch/:companyId     what changed in one company (COMPANY WATCH):
 *                             its repos over the last 30 days, read with the
 *                             seated CMO's own grants and every wall of
 *                             company_updates (company-updates.js), folded
 *                             (company-watch.js); never marks a report point
 *
 * Read-only. Every route reads only the signed-in operator's OWN house: its
 * plan, its companies, its CMO's grants — another house's company is […].
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { weeklyPlanStoreFor } from '../services/marketing/weekly-plan.js';
import { boardStoreFor } from '../services/marketing/board-store.js';
import { cmoDesignation } from '../services/marketing/cmo-designation.js';
import { readCompanyUpdates } from '../services/marketing/company-updates.js';
import { companyWatch, WATCH_DAYS } from '../services/marketing/company-watch.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('MarketingOffice');
const router = express.Router();
router.use(requireAuth);

const COMPANY = /^[a-z0-9][a-z0-9_-]{0,63}$/;

router.get('/plan', async (req, res) => {
  try {
    const [doc, board] = await Promise.all([(await weeklyPlanStoreFor(req.walletAddress)).load(), (await boardStoreFor(req.walletAddress)).cmoRecord()]);
    res.json({ plan: doc?.status === 'approved' && Array.isArray(doc.days) ? doc : null, board });
  } catch (error) {
    log.error('weekly plan read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the weekly plan' });
  }
});

router.get('/watch/:companyId', async (req, res) => {
  const { companyId } = req.params;
  if (!COMPANY.test(companyId)) return res.status(400).json({ error: 'a company id is lower-case letters, digits, - and _' });
  try {
    const officer = await cmoDesignation.getOfficer(req.walletAddress).catch(() => null);
    const since = new Date(Date.now() - WATCH_DAYS * 864e5).toISOString();
    const out = await readCompanyUpdates({ wallet: req.walletAddress, laneId: officer?.laneId || null, company: companyId, since });
    if (!out.ok || out.report.company.id !== companyId) return res.status(404).json({ error: out.error || `there is no "${companyId}" company in your house` });
    return res.json({ watch: { ...companyWatch(out.report), cmo: officer?.laneId ? { laneId: officer.laneId } : null } });
  } catch (error) {
    log.error('company watch read failed', { companyId, error: error.message });
    return res.status(500).json({ error: 'Failed to read what changed in the company' });
  }
});

export default router;
