/**
 * THE HOUSE'S COMPANIES — /api/v1/companies (campaign plan §2.3–2.4). A
 * company is a brand kit (kit-locate.js); its `company` block records its
 * parent (a subsidiary under its core company; a client company stands on
 * its own), its site and its legal entity.
 *
 *   GET /             every company of the caller's house, in tree order
 *   PUT /:companyId   its company block {parentId?, site?, legalEntity?}
 *
 * The caller's own house only; a refused block says why in words.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { listCompanies, setCompanyBlock } from '../services/marketing/companies.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Companies');
const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    res.json({ companies: await listCompanies(req.walletAddress) });
  } catch (error) {
    log.error('companies read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the house\'s companies' });
  }
});

router.put('/:companyId', async (req, res) => {
  try {
    const set = await setCompanyBlock(req.walletAddress, req.params.companyId, req.body || {});
    if (!set.ok) return res.status(400).json({ error: set.error });
    log.info('company recorded', { companyId: req.params.companyId, parentId: set.company?.parentId ?? null, wallet: req.walletAddress });
    return res.json({ company: set.company });
  } catch (error) {
    log.error('company write failed', { companyId: req.params.companyId, error: error.message });
    return res.status(500).json({ error: 'Failed to record the company' });
  }
});

export default router;
