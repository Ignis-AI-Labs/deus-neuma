/**
 * Chat bridge routes — the operator's door onto who may talk with the house
 * on Telegram and Discord (channel connections C-04). Mounted at
 * /api/v1/chat-bridge; every route needs the operator's Bearer token and
 * reads or changes only the signed-in wallet's OWN house.
 *
 *   GET    /status                                each chat account: running, its error, who is allowed, the codes waiting
 *   POST   /:accountId/codes/:code   {approve}    the operator's yes or no to a pairing code
 *   DELETE /:accountId/allowed/:kind/:id          take a person (user) or a group off the list
 */

import express from 'express';
import { requireAuth } from '../services/auth.js';
import { chatBridgeStatus, answerChatCode, revokeChatAccess, CHAT_CHANNELS } from '../services/channels/chat-supervisor.js';
import { channelOfAccountId } from '../services/social/account-shape.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('ChatBridgeRoutes');
const router = express.Router();
router.use(requireAuth);

// pure — an account id of a chat channel, or null.
const chatAccount = (value) => {
  const id = String(value ?? '');
  return /^[a-z]+(-\d+)?$/.test(id) && CHAT_CHANNELS[channelOfAccountId(id)] ? id : null;
};

router.get('/status', async (req, res) => {
  try {
    res.json(await chatBridgeStatus(req.walletAddress));
  } catch (error) {
    log.error('the chat bridge status could not be read', { error: error.message });
    res.status(500).json({ error: 'Failed to read the chat bridge' });
  }
});

router.post('/:accountId/codes/:code', async (req, res) => {
  const accountId = chatAccount(req.params.accountId);
  if (!accountId) return res.status(400).json({ error: 'not a Telegram or Discord account' });
  if (typeof req.body?.approve !== 'boolean') return res.status(400).json({ error: 'approve: true or false' });
  try {
    const answered = await answerChatCode(req.walletAddress, accountId, { code: req.params.code, approve: req.body.approve, by: 'operator' });
    if (!answered.ok) return res.status(404).json({ error: answered.reason });
    log.info('a pairing code answered', { accountId, approve: req.body.approve, kind: answered.entry.kind });
    res.json({ ok: true, entry: { kind: answered.entry.kind, name: answered.entry.name }, status: await chatBridgeStatus(req.walletAddress) });
  } catch (error) {
    log.error('a pairing code could not be answered', { error: error.message });
    res.status(500).json({ error: 'Failed to answer the code' });
  }
});

router.delete('/:accountId/allowed/:kind/:id', async (req, res) => {
  const accountId = chatAccount(req.params.accountId);
  if (!accountId || !['user', 'group'].includes(req.params.kind)) return res.status(400).json({ error: 'name a Telegram or Discord account, and user or group' });
  try {
    await revokeChatAccess(req.walletAddress, accountId, { kind: req.params.kind, id: String(req.params.id) });
    res.json({ ok: true, status: await chatBridgeStatus(req.walletAddress) });
  } catch (error) {
    log.error('a chat permission could not be taken back', { error: error.message });
    res.status(500).json({ error: 'Failed to take it back' });
  }
});

export default router;
