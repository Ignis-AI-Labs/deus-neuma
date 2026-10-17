/**
 * Email routes — the operator's control surface for the box's one email
 * account: named speech to real people.
 *
 * Configure the account (credentials, encrypted at rest) and tie the mailbox
 * to the ONE neuma who holds that position. Every response masks secrets —
 * a raw credential value never leaves the server. All routes require the
 * operator's Bearer token.
 */

import express from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { maskChannelCredentials } from '../services/social/channel-registry.js';
import { EMAIL_ACCOUNT } from '../services/email/email-registry.js';
import {
  loadEmailCredentials, setEmailCredential, removeEmailCredential,
} from '../services/email/email-credentials.js';
import { emailBinding } from '../services/email/email-binding.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Email');

const router = express.Router();
router.use(requireAuth);

// The account board: masked credential state + the mailbox holder.
router.get('/', async (req, res) => {
  try {
    const [store, bindings] = await Promise.all([
      loadEmailCredentials(),
      emailBinding.load(),
    ]);
    res.json({
      account: {
        ...maskChannelCredentials(EMAIL_ACCOUNT, store[EMAIL_ACCOUNT.id], process.env),
        binding: bindings[EMAIL_ACCOUNT.id] || null,
      },
    });
  } catch (error) {
    log.error('Email board read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read email account state' });
  }
});

// Set (or clear fields of) the account credentials.
router.put('/credentials', async (req, res) => {
  const fields = req.body?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return res.status(400).json({ error: 'Body must carry a fields object' });
  }
  // Every value is a string (empty string = clear that field) — the store
  // never sees any other shape.
  if (Object.values(fields).some((v) => typeof v !== 'string')) {
    return res.status(400).json({ error: 'Each field value must be a string' });
  }
  try {
    await setEmailCredential(fields);
    const store = await loadEmailCredentials();
    log.info('Email credentials updated', { wallet: req.walletAddress });
    res.json(maskChannelCredentials(EMAIL_ACCOUNT, store[EMAIL_ACCOUNT.id], process.env));
  } catch (error) {
    log.error('Email credential write failed', { error: error.message });
    res.status(500).json({ error: 'Failed to store credentials' });
  }
});

// Forget the stored credentials entirely (env bootstrap, if any, still
// applies — that is the operator's file to edit).
router.delete('/credentials', async (req, res) => {
  try {
    const removed = await removeEmailCredential();
    log.info('Email credentials removed', { wallet: req.walletAddress, removed });
    res.json({ removed });
  } catch (error) {
    log.error('Email credential removal failed', { error: error.message });
    res.status(500).json({ error: 'Failed to remove credentials' });
  }
});

// Tie the mailbox to its one holder — the neuma whose position this is.
router.put('/binding', async (req, res) => {
  const neumaId = req.body?.neumaId;
  if (!(await assertNeumaOwner(req, res, neumaId))) return;
  try {
    const binding = await emailBinding.bind(EMAIL_ACCOUNT.id, {
      neumaId,
      boundBy: req.walletAddress,
    });
    log.info('Email bound', { neumaId, wallet: req.walletAddress });
    res.json({ binding });
  } catch (error) {
    if (error.message === 'Invalid neumaId') {
      return res.status(400).json({ error: error.message });
    }
    log.error('Email bind failed', { error: error.message });
    res.status(500).json({ error: 'Failed to bind email account' });
  }
});

// Release the mailbox — back to default deny: no one may use it.
router.delete('/binding', async (req, res) => {
  try {
    const released = await emailBinding.unbind(EMAIL_ACCOUNT.id);
    log.info('Email released', { wallet: req.walletAddress, released });
    res.json({ released });
  } catch (error) {
    log.error('Email release failed', { error: error.message });
    res.status(500).json({ error: 'Failed to release email account' });
  }
});

export default router;
