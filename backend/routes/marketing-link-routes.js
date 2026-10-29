/**
 * /api/v1/marketing/links — the house's tracked links (campaign plan §4.1,
 * slice 7): its code map, its site counter's standing, the site token (sealed,
 * never returned), a retry for codes the counter has not taken yet, and the
 * map as the counter's own publish body — the export the owner can deploy by
 * hand (POST /go-codes on the site). Every route reads and moves only the
 * signed-in operator's OWN house.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { loadLinks, markPublished } from '../services/marketing/link-store.js';
import { publishBody } from '../services/marketing/link-codes.js';
import { siteCounterStatus, setSiteToken, publishCodes } from '../services/marketing/site-counter.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('MarketingLinks');
const router = express.Router();
router.use(requireAuth);

const fail = (res, what, error) => {
  log.error(`${what} failed`, { error: error.message });
  return res.status(500).json({ error: `Failed to ${what}` });
};

// The house's map and whether its counter is set up.
router.get('/', async (req, res) => {
  try {
    const [links, site] = await Promise.all([loadLinks(req.walletAddress), siteCounterStatus(req.walletAddress)]);
    res.json({ site, links });
  } catch (error) { fail(res, 'read the tracked links', error); }
});

// The map as the site counter's publish body: code, destination, company, createdAt.
router.get('/export', async (req, res) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json(publishBody(await loadLinks(req.walletAddress)));
  } catch (error) { fail(res, 'export the tracked links', error); }
});

// Seal (or clear, with '') the house's site token. The value never comes back.
router.put('/site-token', async (req, res) => {
  try {
    const result = await setSiteToken(req.walletAddress, req.body?.token ?? '');
    if (!result.ok) return res.status(400).json({ error: result.error });
    log.info('site counter token saved', { wallet: req.walletAddress, cleared: !req.body?.token });
    res.json({ site: await siteCounterStatus(req.walletAddress) });
  } catch (error) { fail(res, 'save the site token', error); }
});

// Publish every code the counter has not taken yet (or answered conflict on).
router.post('/publish', async (req, res) => {
  try {
    const waiting = (await loadLinks(req.walletAddress)).filter((r) => !['published', 'already'].includes(r.published?.state));
    if (!waiting.length) return res.json({ results: [] });
    const published = await publishCodes(req.walletAddress, waiting);
    if (!published.ok) return res.status(502).json({ error: published.detail });
    await markPublished(req.walletAddress, published.results, new Date().toISOString());
    res.json({ results: published.results });
  } catch (error) { fail(res, 'publish the tracked links', error); }
});

export default router;
