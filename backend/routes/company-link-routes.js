/**
 * COMPANY LINK CHANGES — /api/v1/company-links (ruling, 2026-10-24: […]). The house's seated CMO
 * proposes a company's site, pages and repos with the marketing/company-links
 * act; each proposal waits here, and in WAITING ON YOU, for the operator.
 *
 *   GET  /              the house's open proposals, each with what it would change now
 *   POST /:id/approve   write it onto the company (the company block's own door)
 *   POST /:id/decline   nothing is written
 *
 * The caller's own house only — the house is the signed-in wallet, so no
 * route takes a house a caller could forge, and an id from another house is
 * no proposal here. Approving lists a repo; it lends no one its reading.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { openLinkChanges, approveLinkChange, declineLinkChange } from '../services/marketing/link-changes.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('CompanyLinks');
const router = express.Router();
router.use(requireAuth);

const ID = /^lc_[a-f0-9]{12}$/;

router.get('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json({ changes: await openLinkChanges(req.walletAddress) });
  } catch (error) {
    log.error('link changes read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the proposed link changes' });
  }
});

const decide = (act, verb) => async (req, res) => {
  if (!ID.test(req.params.id)) return res.status(404).json({ error: 'no open link change has that id in your house' });
  try {
    const out = await act(req.walletAddress, req.params.id);
    if (!out.ok) return res.status(out.status || 400).json({ error: out.error });
    log.info(`link change ${verb}`, { id: req.params.id, companyId: out.entry.companyId, wallet: req.walletAddress });
    return res.json(out);
  } catch (error) {
    log.error(`link change ${verb} failed`, { id: req.params.id, error: error.message });
    return res.status(500).json({ error: `The link change was not ${verb}` });
  }
};
router.post('/:id/approve', decide(approveLinkChange, 'approved'));
router.post('/:id/decline', decide(declineLinkChange, 'declined'));

export default router;
