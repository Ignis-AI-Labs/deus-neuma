/**
 * /api/v1/marketing/results — what the house's posts did (campaign plan §4.3):
 * each sent post's latest reading and its series (the trend), what each of the
 * house's accounts cannot report and why, any platform's standing "slow down",
 * the site counter's clicks and downloads for the house's own codes, and what
 * each platform can report at all. POST /sweep reads the due posts now. Every
 * route reads and moves only the signed-in operator's OWN house.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { loadResults, seriesByPost } from '../services/marketing/results-store.js';
import { CAPABILITY } from '../services/social/stats/stats-metrics.js';
import { sweepHouse } from '../services/social/stats/stats-sweep.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('MarketingResults');
const router = express.Router();
router.use(requireAuth);

const SERIES_SHOWN = 28;

router.get('/', async (req, res) => {
  try {
    const record = await loadResults(req.walletAddress);
    const posts = Object.fromEntries([...seriesByPost(record)].map(([entryId, s]) => [entryId, {
      latest: s.latest, series: s.series.slice(-SERIES_SHOWN).map((r) => ({ at: r.at, metrics: r.metrics })),
    }]));
    res.json({
      posts, unavailable: record.unavailable, backoff: record.backoff, links: record.links, pulls: record.pulls, capability: CAPABILITY,
    });
  } catch (error) {
    log.error('results read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the results' });
  }
});

router.post('/sweep', async (req, res) => {
  try {
    const outcome = await sweepHouse(req.walletAddress);
    log.info('stats read on demand', { wallet: req.walletAddress, read: outcome.read });
    res.json(outcome);
  } catch (error) {
    log.error('stats read on demand failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the platforms' });
  }
});

export default router;
