/**
 * The TikTok channel's own reads, mounted inside the social router (so the
 * session stands in front of every one, and the `/queue/:id` house door in
 * front of the first):
 *
 *   GET /queue/:id/tiktok  — what a TikTok post's card renders from: the
 *       house's account as creator info names it RIGHT NOW (nickname, privacy
 *       levels offered, interactions turned off) and the author's suggestions
 *       (services/social/tiktok-approval.js). Read at every render.
 *   GET /tiktok/profile[?account=tiktok-<n>] — the TIKTOK window's account view
 *       of one of the house's TikTok accounts (its first when unnamed): profile, the
 *       four counts, the recent videos, and what the connection cannot read
 *       yet (services/social/tiktok-profile.js). Read on open and on REFRESH.
 *   GET /tiktok/image?src= — one TikTok picture (avatar, cover) through the
 *       narrow relay (services/social/tiktok-image-relay.js).
 *
 * Every answer about the account is the caller's own house's, and none is
 * cached server-side.
 */
import express from 'express';
import { postQueue } from '../services/social/post-queue.js';
import { houseWallet } from '../services/house-served.js';
import { tiktokCardView } from '../services/social/tiktok-approval.js';
import { readTikTokProfile } from '../services/social/tiktok-profile.js';
import { relayTikTokImage } from '../services/social/tiktok-image-relay.js';
import { channelOfAccountId } from '../services/social/account-shape.js';
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

router.get('/tiktok/profile', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    // Which of the house's TikTok accounts (`?account=tiktok-2`); the first when unnamed.
    const asked = typeof req.query.account === 'string' ? req.query.account : 'tiktok-1';
    if (channelOfAccountId(asked) !== 'tiktok') return res.status(400).json({ error: `${asked} is not a TikTok account id` });
    const view = await readTikTokProfile(houseWallet(req.walletAddress), { accountId: asked });
    if (view.ok) return res.json(view);
    return res.status(409).json({ error: view.detail, reconnect: Boolean(view.reconnect) });
  } catch (error) {
    log.error('TikTok account read failed', { error: error.message });
    return res.status(500).json({ error: 'Failed to read the TikTok account' });
  }
});

router.get('/tiktok/image', async (req, res) => {
  const out = await relayTikTokImage(req.query.src);
  if (!out.ok) {
    res.set('Cache-Control', 'no-store');
    return res.status(out.status).json({ error: out.detail });
  }
  res.set({
    'Content-Type': out.type,
    'Content-Length': String(out.bytes.length),
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
  });
  return res.end(out.bytes);
});

export default router;
