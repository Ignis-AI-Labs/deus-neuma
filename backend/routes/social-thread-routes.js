/**
 * PUT /api/v1/social-channels/queue/:id/approve-thread — the operator approves a
 * whole thread at once (queue-thread.js holds the law; post-queue.js the atom).
 * Mounted inside the social router, so the session and the `/queue/:id` house
 * door stand in front of it; this also refuses a thread any of whose posts is
 * another house's.
 */
import express from 'express';
import { postQueue } from '../services/social/post-queue.js';
import { queueEntryHouse } from '../services/social/queue-house.js';
import { readServed, houseWallet } from '../services/house-served.js';
import { threadMembers, threadRootOf } from '../services/social/queue-thread.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('SocialThread');
const router = express.Router();

router.put('/queue/:id/approve-thread', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    const textsSeen = req.body?.textsSeen;
    if (!textsSeen || typeof textsSeen !== 'object' || Array.isArray(textsSeen)) {
      return res.status(400).json({ error: 'textsSeen must name each post you read, by id' });
    }
    const [entries, served] = await Promise.all([postQueue.load(), readServed()]);
    const root = threadRootOf(entries, req.params.id);
    const house = houseWallet(req.walletAddress);
    const members = root ? threadMembers(entries, root.id) : [];
    if (!root || members.some((e) => queueEntryHouse(served, e, { served: false }) !== house)) {
      return res.status(404).json({ error: 'no such queued thread' });
    }
    const result = await postQueue.approveThread(req.params.id, { decidedBy: req.walletAddress, textsSeen });
    if (!result.ok) return res.status(409).json({ error: result.error });
    log.info('Thread approved', { root: root.id, posts: result.entries.length, wallet: req.walletAddress });
    return res.json({ entries: result.entries });
  } catch (error) {
    log.error('Thread approval failed', { error: error.message });
    return res.status(500).json({ error: 'Failed to approve the thread' });
  }
});

export default router;
