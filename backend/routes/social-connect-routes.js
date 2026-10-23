/**
 * The CONNECT of a channel whose key is a sign-in —
 * /api/v1/social-channels/:channel/connect, for `youtube` (Google desktop
 * OAuth) and `tiktok` (Login Kit for Desktop).
 *
 *   POST   → open the house's consent; answers the URL the desk opens in the
 *            system browser (the loopback listener is already up).
 *   GET    → the outcome: pending, complete (with the account's name), or
 *            the plain reason it failed.
 *   DELETE → cancel a consent in progress.
 *
 * The house is the caller's own wallet: the tokens land in that house's
 * sealed channel credentials and nowhere else, and no response ever carries
 * a token. Every route requires the operator's Bearer token.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { startYouTubeConnect, pollYouTubeConnect, cancelYouTubeConnect } from '../services/social/youtube-connect.js';
import { startTikTokConnect, pollTikTokConnect, cancelTikTokConnect } from '../services/social/tiktok-connect.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('SocialChannels.Connect');
const router = express.Router();

const FLOWS = Object.freeze({
  youtube: Object.freeze({ name: 'YouTube', start: startYouTubeConnect, poll: pollYouTubeConnect, cancel: cancelYouTubeConnect }),
  tiktok: Object.freeze({ name: 'TikTok', start: startTikTokConnect, poll: pollTikTokConnect, cancel: cancelTikTokConnect }),
});
const PATH = '/:channel(youtube|tiktok)/connect';

router.use(PATH, requireAuth, (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

router.post(PATH, async (req, res) => {
  const flow = FLOWS[req.params.channel];
  try {
    const started = await flow.start(req.walletAddress);
    if (!started.ok) return res.status(400).json({ error: started.error });
    res.json({ authUrl: started.authUrl });
  } catch (error) {
    log.error('connect failed to start', { channel: req.params.channel, error: error.message });
    res.status(500).json({ error: `Failed to start the ${flow.name} connect` });
  }
});

router.get(PATH, (req, res) => {
  res.json(FLOWS[req.params.channel].poll(req.walletAddress));
});

router.delete(PATH, (req, res) => {
  res.json({ cancelled: FLOWS[req.params.channel].cancel(req.walletAddress) });
});

export default router;
