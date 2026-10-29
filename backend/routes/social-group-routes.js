/**
 * PUT /api/v1/social-channels/queue/groups/:groupId/approve — APPROVE GROUP:
 * one asset on several accounts, decided with one press (campaign plan §3.2;
 * queue-group.js holds the law, post-queue.js the atom). Only the caller
 * house's own posts of the group are touched — two houses may use the same
 * group name and are never confused. A TikTok post rides the press only with
 * its own card's choices (`tiktok[entryId]`); otherwise it stays a draft and
 * is named in `ownCard`.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { postQueue } from '../services/social/post-queue.js';
import { houseEntries } from '../services/social/queue-house.js';
import { groupMembers } from '../services/social/queue-group.js';
import { tiktokApproval } from '../services/social/tiktok-approval.js';
import { listAccounts } from '../services/social/account-store.js';
import { listCompanies } from '../services/marketing/companies.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('SocialGroup');
const router = express.Router();
router.use(requireAuth);

// The company tree an account speaks for (its root company), or null.
const treeOf = (accountId, accounts, companies) => {
  const companyId = accounts.find((a) => a.id === accountId)?.companyId;
  return companyId ? (companies.find((c) => c.id === companyId)?.rootId || companyId) : null;
};

router.put('/queue/groups/:groupId/approve', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const textsSeen = req.body?.textsSeen;
  if (!textsSeen || typeof textsSeen !== 'object' || Array.isArray(textsSeen)) {
    return res.status(400).json({ error: 'textsSeen must name each post you read, by id' });
  }
  try {
    const wallet = req.walletAddress;
    const members = groupMembers(await houseEntries(wallet), req.params.groupId);
    if (!members.length) return res.status(404).json({ error: 'no such group' });
    // Re-judged at the press: an account moved to another company since staging
    // must not carry the group across two trees.
    const [accounts, companies] = await Promise.all([listAccounts(wallet), listCompanies(wallet)]);
    const trees = new Set(members.filter((m) => m.status === 'draft').map((m) => treeOf(m.accountId, accounts, companies)));
    if (trees.has(null) || trees.size > 1) {
      return res.status(409).json({ error: 'this group now speaks for more than one company tree (or an account with no company) — nothing was approved' });
    }
    const consents = {};
    for (const m of members.filter((e) => e.channelId === 'tiktok' && e.status === 'draft')) {
      const choice = req.body?.tiktok?.[m.id];
      if (choice === undefined) continue;
      const tiktok = await tiktokApproval(wallet, m, choice);
      if (!tiktok.ok) return res.status(409).json({ error: `${m.accountId}: ${tiktok.detail}` });
      consents[m.id] = tiktok.consent;
    }
    const result = await postQueue.approveGroup(req.params.groupId, {
      ids: new Set(members.map((m) => m.id)), decidedBy: wallet, textsSeen, consents,
    });
    if (!result.ok) return res.status(409).json({ error: result.error });
    log.info('Group approved', { group: req.params.groupId, posts: result.entries.length, ownCard: result.ownCard.length, wallet });
    return res.json({ entries: result.entries, ownCard: result.ownCard });
  } catch (error) {
    log.error('Group approval failed', { error: error.message });
    return res.status(500).json({ error: 'Failed to approve the group' });
  }
});

export default router;
