// Weave Routes - Public identity API
//
// Exposes neuma identity cards and weave status.
// Identity cards are public data — they contain only what the neuma
// chooses to share. Private keys never leave the workspace.

import { Router } from 'express';
import { default as workspace } from '../../core/workspace/neuma-workspace.js';
import { verifyIdentityCard, summarizeCard } from '../../core/weave/identity-card.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Weave');
const router = Router();

// --- Identity ---

// Get a neuma's public identity card
router.get('/identity/:id', async (req, res) => {
  try {
    const card = await workspace.readIdentityCard(req.params.id);
    if (!card) return res.status(404).json({ error: 'Identity card not found' });

    const valid = verifyIdentityCard(card);
    res.json({ card, valid });
  } catch (error) {
    log.error('Identity card read error', { error: error.message });
    res.status(500).json({ error: 'Failed to read identity card' });
  }
});

// Get a compact identity summary (no crypto details)
router.get('/identity/:id/summary', async (req, res) => {
  try {
    const card = await workspace.readIdentityCard(req.params.id);
    if (!card) return res.status(404).json({ error: 'Identity card not found' });
    res.json(summarizeCard(card));
  } catch (error) {
    log.error('Identity summary error', { error: error.message });
    res.status(500).json({ error: 'Failed to read identity summary' });
  }
});

// Verify an identity card (POST body contains the card)
router.post('/verify', (req, res) => {
  try {
    const { card } = req.body;
    if (!card) return res.status(400).json({ error: 'Card required' });
    const valid = verifyIdentityCard(card);
    res.json({ valid, address: card.address, name: card.name });
  } catch (error) {
    log.error('Identity verify error', { error: error.message });
    res.status(500).json({ error: 'Failed to verify identity card' });
  }
});

// --- Weave status ---

router.get('/status', (req, res) => {
  res.json({
    status: 'available',
    version: '1.0.0',
    capabilities: ['identity'],
    relay: null, // Will be populated when relay is connected
  });
});

export default router;
