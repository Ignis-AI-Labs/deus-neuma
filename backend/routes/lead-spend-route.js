import { setSpend } from '../services/sales/lead-spend.js';
import { requireInstallOwner } from '../services/install-owner.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('LeadEngine');

/** The install owner's paid lead-data rule, at the local desk only. impure (store). */
export const postLeadSpend = [requireInstallOwner, async (req, res) => {
  try {
    const set = await setSpend(req.walletAddress, { mode: req.body?.mode, cap: req.body?.cap });
    if (!set.ok) return res.status(400).json({ error: set.reason });
    log.info('The paid lead data rule was set by the operator', { mode: set.rule.mode, cap: set.rule.cap });
    return res.json({ ok: true, rule: set.rule });
  } catch (error) {
    log.error('The paid lead data rule could not be set', { error: error.message });
    return res.status(500).json({ error: 'Could not set the paid lead data rule' });
  }
}];
