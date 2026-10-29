/**
 * Refine routes — POST /api/v1/voice/refine: a dictated draft shaped into
 * readable text, every word kept (core/text/refine.js; Design note, 2026-10-10.
 *
 * Runs on THIS machine's own model only — the neuma's sovereign route, refused
 * if it is not local — because raw dictation never leaves the box (Founder,
 * 2026-07-31: half of what he dictates is unreleased product direction).
 * A shaping that changed a word is refused: the draft comes back untouched
 * with `refined: false`, never a rewrite of the operator.
 *
 * Body: { text, neumaId? } → { text, refined: true } | { text, refined: false, reason }
 */

import { Router } from 'express';
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { createStreamRequest, consumeStream, stripThinkTags } from '../services/llm-provider.js';
import { resolveNeumaRoute } from '../services/neuma-route-resolver.js';
import { isLocalProvider } from '../services/provider-registry.js';
import { REFINE_PROMPT, keptWords, cleanRefined } from '../../core/text/refine.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Voice.Refine');

const MAX_CHARS = 20_000;          // minutes of dictation; bounds one model call
const REFINE_TEMPERATURE = 0.2;    // formatting, not writing

const router = Router();
router.use(requireAuth);

router.post('/refine', express.json({ limit: '128kb' }), async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  if (!text.trim()) return res.status(400).json({ error: 'nothing to refine' });
  if (text.length > MAX_CHARS) return res.status(413).json({ error: `refine takes up to ${MAX_CHARS} characters` });
  const neumaId = typeof req.body?.neumaId === 'string' && req.body.neumaId ? req.body.neumaId : null;
  // A named being's route is its house's: another house's being is refused.
  if (neumaId && !(await assertNeumaOwner(req, res, neumaId))) return;

  let route;
  try {
    route = await resolveNeumaRoute(neumaId, null);
  } catch (err) {
    return res.status(503).json({ error: `no model to refine with: ${err.message}` });
  }
  if (!route?.provider || !isLocalProvider(route.provider)) {
    return res.status(409).json({ error: "refine runs only on this machine's own model" });
  }

  try {
    const stream = await createStreamRequest(
      [{ role: 'system', content: REFINE_PROMPT }, { role: 'user', content: text }],
      // Room for the words plus their punctuation; thinking off — this is formatting.
      { route, temperature: REFINE_TEMPERATURE, maxTokens: Math.ceil(text.length / 2) + 256, noThink: true },
    );
    const refined = cleanRefined(stripThinkTags(await consumeStream(stream, () => {})));
    if (!keptWords(text, refined)) {
      log.warn('refine changed words — draft kept', { chars: text.length, refinedChars: refined.length });
      return res.json({ text, refined: false, reason: 'words-changed' });
    }
    res.json({ text: refined, refined: true });
  } catch (err) {
    log.error('refine failed', { err: err.message });
    res.status(502).json({ error: `refine failed: ${err.message}` });
  }
});

export default router;
