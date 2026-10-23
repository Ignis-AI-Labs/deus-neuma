/**
 * GET /api/v1/social-channels/queue/:id/tiktok — what a TikTok post's card
 * renders from: the house's TikTok account as creator info names it RIGHT
 * NOW (nickname, the privacy levels it offers, which interactions it turned
 * off) and the author's suggestions from the post's settings lines
 * (services/social/tiktok-approval.js). TikTok's guidelines require it read
 * at every render, so it is never cached. Mounted inside the social router,
 * so the session and the `/queue/:id` house door stand in front of it.
 */
import express from 'express';
import { postQueue } from '../services/social/post-queue.js';
import { houseWallet } from '../services/house-served.js';
import { tiktokCardView } from '../services/social/tiktok-approval.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('SocialTikTok');
const router = express.Router();

router.get('/queue/:id/tiktok', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    const entry = (await postQueue.load()).find((e) => e.id === req.params.id);
    if (entry?.channelId !== 'tiktok') return res.status(404).json({ error: 'no such TikTok post' });
    const view = await tiktokCardView(houseWallet(req.walletAddress), entry);
    return view.ok ? res.json(view) : res.status(409).json({ error: view.detail });
  } catch (error) {
    log.error('TikTok card read failed', { id: req.params.id, error: error.message });
    return res.status(500).json({ error: 'Failed to read the TikTok account' });
  }
});

export default router;
