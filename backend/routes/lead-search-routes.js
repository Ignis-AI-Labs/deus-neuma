// lead-search-routes — the operator's one press on what too-wide searches brought in (sales/wide-search.js; mounted
// inside lead-engine-routes.js, behind its auth): every company from such a search that nobody has worked yet is
// passed over, per audience, with why. Nothing is deleted: a passed company stays under PASSED and can be kept again.
import express from 'express';
import { readCandidates, readSearches, noteShortlist } from '../services/sales/sales-store.js';
import { wideFinds, untouched, wideSummary } from '../services/sales/wide-search.js';
import { partnerOf } from '../services/sales/lead-provenance.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('LeadSearchRoutes');
const router = express.Router();

router.post('/searches/pass-wide', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    const finds = wideFinds(await readSearches(wallet), await readCandidates(wallet));
    let passed = 0;
    for (const { search, companies } of finds) {
      const domains = companies.filter(untouched).map((c) => c.domain);
      if (!domains.length) continue;
      await noteShortlist(wallet, { segmentId: search.segmentId, domains, verdict: 'passed', by: 'operator',
        why: `from a search too wide to be this audience's: it matched ${Number(search.matched).toLocaleString('en-US')} at ${partnerOf(search.source) ?? search.source} ("${String(search.asked ?? '').slice(0, 120)}")` });
      passed += domains.length;
    }
    log.info('Companies from too-wide searches were passed over', { passed, searches: finds.length });
    return res.json({ ok: true, passed, wide: wideSummary(await readSearches(wallet), await readCandidates(wallet)) });
  } catch (error) {
    log.error('Passing over the too-wide finds failed', { error: error.message });
    return res.status(500).json({ error: 'Could not pass them over' });
  }
});

export default router;
