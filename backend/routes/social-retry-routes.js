/**
 * PUT /api/v1/social-channels/queue/:id/retry — TRY AGAIN on a failed post
 * (show-dont-tell-audit.md, finding 29). Mounted inside the social router, so
 * the operator's session and the `/queue/:id` house door stand in front of
 * it: only this house's own post, only from the operator's own signed session
 * (a being holds none), never on a timer.
 *
 * It does not send. A post the platform only stumbled on (send-failure.js:
 * `retry`) returns to DRAFT, the same entry (queue-retry.js); it goes out
 * again only through the same APPROVE every draft takes, with every send-time
 * re-check. A post refused for its keys or its words is refused here — its
 * door is the keys row, or REVISE.
 */
import express from 'express';
import { postQueue } from '../services/social/post-queue.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('SocialRetry');
const router = express.Router();

router.put('/queue/:id/retry', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    const result = await postQueue.restage(req.params.id, { by: req.walletAddress });
    if (!result.ok) return res.status(409).json({ error: result.error });
    log.info('Failed post back to draft for the operator\'s decision', { id: req.params.id, wallet: req.walletAddress });
    return res.json({ entry: result.entry });
  } catch (error) {
    log.error('Queue retry failed', { id: req.params.id, error: error.message });
    return res.status(500).json({ error: 'Failed to stage the post again' });
  }
});

export default router;
