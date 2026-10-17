// Voice routes — the engine catalogue, the voice tier, and a being's voice.
//
// ONE VOICE (docs/work/one-voice.md): a being's voice is its Voice DNA v2 (a
// clip and its words, sealed by two parties through the forge); the machine's
// voice TIER picks which sidecar renders it. All routes require auth.
//
//   GET  /engines, /engines/:id   the registry, public fields only
//   GET  /tier                    {setting, chosen, auto, reason, machine, tiers}
//   PUT  /tier {tier, profile?}   the person's pick ('auto' | 'light' | 'standard')
//   GET  /dna/:companion          owner-only: {standing, dna, errors}
//   GET  /has-voice/:companion    {hasVoice, standing}
//
// Engine lifecycle lives in voice-engine-routes.js; the forge in
// voice-forge-routes.js — both mounted beside this under /api/v1/voice.

import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { toPublicJSON, getEngine, listTiers } from '../services/voice/engine-registry.js';
import { voiceSettings, voiceTierInForce, voiceSettingError } from '../services/voice/voice-settings.js';
import { needGB } from '../services/voice/voice-tier.js';
import { readVoice } from '../../core/voice/voice-dna-service.js';

import { createLogger } from '../services/logger.js';
const log = createLogger('Voice');

const router = Router();
router.use(requireAuth);

const VALID_NAME = /^[a-zA-Z0-9_-]+$/;
router.param('companion', (req, res, next, name) => {
  if (!VALID_NAME.test(name)) {
    return res.status(400).json({ error: 'Invalid companion name format' });
  }
  next();
});

// --- Engine catalogue (read-only, drives the UI) ---

router.get('/engines', (_req, res) => {
  res.json({ engines: toPublicJSON() });
});

router.get('/engines/:id', (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) return res.status(404).json({ error: 'unknown engine' });
  const { id, name, publisher, license, commercial, type, languages, capabilities, requirements, validated, notes } = engine;
  res.json({ engine: { id, name, publisher, license, commercial, type, languages, capabilities, requirements, validated, notes } });
});

// --- The voice tier ---

// pure — every tier with what each profile costs: the measured memory and the
// GPU room this machine must have free for it (needGB).
const tiersView = () => listTiers().map((t) => ({
  id: t.id,
  engine: t.engine,
  model: t.model ?? null,
  device: t.device,
  defaultProfile: t.defaultProfile,
  profiles: Object.fromEntries(Object.entries(t.profiles ?? {}).map(([id, p]) => [id, {
    memMB: p.memMB, ramMB: p.ramMB ?? null, firstAudioMs: p.firstAudioMs ?? null, rtf: p.rtf ?? null,
    needGB: t.device === 'cuda' ? needGB(t.id, id) : null,
  }])),
}));

// impure — the tier answer both routes give.
const tierAnswer = async () => {
  const { setting, machine, auto, chosen } = await voiceTierInForce({ fresh: true });
  return { setting, chosen, auto, reason: chosen.reason, machine, tiers: tiersView() };
};

router.get('/tier', async (_req, res) => {
  try {
    res.json(await tierAnswer());
  } catch (err) {
    log.error('voice tier read failed', { err: err.message });
    res.status(500).json({ error: 'could not read the voice tier' });
  }
});

router.put('/tier', async (req, res) => {
  const next = { tier: req.body?.tier, profile: req.body?.profile ?? null };
  const error = voiceSettingError(next);
  if (error) return res.status(400).json({ error });
  try {
    await voiceSettings.write(next, { wallet: req.walletAddress ?? null });
    res.json(await tierAnswer());
  } catch (err) {
    log.error('voice tier write failed', { err: err.message });
    res.status(500).json({ error: 'could not save the voice tier' });
  }
});

// --- A being's voice (Voice DNA v2) ---

router.get('/dna/:companion', async (req, res) => {
  // Voice DNA is sovereign identity — only its owner may read it (fail-closed, W1-004).
  if (!await assertNeumaOwner(req, res, req.params.companion)) return;
  try {
    const { standing, dna, errors } = await readVoice(req.params.companion);
    res.json({ standing, dna, errors });
  } catch (err) {
    // A decrypt/integrity failure on one being's voice must never crash the process.
    log.error('Voice DNA read failed', { neumaId: req.params.companion, error: err.message });
    res.status(500).json({ error: 'could not read voice DNA' });
  }
});

router.get('/has-voice/:companion', async (req, res) => {
  const { standing } = await readVoice(req.params.companion).catch(() => ({ standing: 'unreadable' }));
  res.json({ hasVoice: standing === 'ready', standing });
});

export default router;
