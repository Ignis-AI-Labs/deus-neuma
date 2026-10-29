// Speech-to-text routes — the witness speaks, the composer receives words.
//
// Separate from voice-routes.js (neuma speech OUT) because dictation is the
// opposite direction: witness audio IN. One endpoint: raw audio bytes go to
// the local whisper sidecar, the transcript rides back. The sidecar is
// launched lazily on first use (engine-manager owns the lifecycle), so the
// VRAM is only spent once someone actually holds to talk.

import { Router } from 'express';
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { hotwordsPhrase } from '../../core/text/lexicon.js';
import {
  launch, getStatus, ENGINE_STATES, isUvAvailable, engineReadiness, resolveServe,
} from '../services/voice/engine-manager.js';
import { createLogger } from '../services/logger.js';
import { sidecarFetch } from '../services/voice/sidecar-trust.js';

const log = createLogger('Voice.STT');

const STT_ENGINE = 'whisper';
// Hold-to-talk utterances are seconds long; 25MB covers minutes of opus/wav
// while still bounding what an authenticated caller can buffer server-side.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const router = Router();
router.use(requireAuth);

// Concurrent first-use presses must share one launch instead of racing
// engine-manager (which throws on a second launch while one is in flight).
let launching = null; // impure module state — the in-flight launch, if any

// impure — resolve when the sidecar is ready, launching it if needed. The
// composer warms the engine through the engine-lifecycle route the moment a
// hold begins, so a transcribe often arrives while THAT launch is still in
// flight — wait for it instead of racing engine-manager (which throws on a
// second launch attempt).
const ensureEngineReady = async (timeoutMs = 150_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = getStatus(STT_ENGINE)?.state;
    if (state === ENGINE_STATES.READY) return;
    if (state === ENGINE_STATES.SYNCING || state === ENGINE_STATES.LAUNCHING) {
      // 150ms: a hold that arrives mid-launch hears the engine within a beat of ready.
      await new Promise((r) => setTimeout(r, 150));
      continue;
    }
    // stopped / failed / crashed — this request takes the launch itself
    if (!launching) {
      launching = launch(STT_ENGINE).finally(() => { launching = null; });
    }
    await launching;
  }
  throw new Error(`whisper not ready after ${timeoutMs}ms`);
};

router.post(
  '/transcribe',
  express.raw({ type: 'audio/*', limit: MAX_AUDIO_BYTES }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({
        error: 'empty audio body — send raw audio bytes with an audio/* content type',
      });
    }

    try {
      await ensureEngineReady();
    } catch (err) {
      // Name the missing components when that is the true cause — the desk
      // prompts the witness to install them instead of flashing a bare error.
      const readiness = engineReadiness({
        uvAvailable: await isUvAvailable(),
        downloaded: getStatus(STT_ENGINE)?.downloaded ?? false,
      });
      if (!readiness.ready) {
        log.warn('dictation components missing', { missing: readiness.missing });
        return res.status(503).json({
          error: 'dictation components are not installed on this machine',
          code: 'STT_COMPONENTS_MISSING',
          missing: readiness.missing,
        });
      }
      log.error('whisper sidecar unavailable', { err: err.message });
      return res.status(503).json({ error: `speech engine unavailable: ${err.message}` });
    }

    // The port the sidecar was LAUNCHED on (WHISPER_PORT overrides the manifest) —
    // reading the manifest alone sent an isolated stack's audio to the desk's port.
    const { host, port } = resolveServe(STT_ENGINE);
    // The domain vocabulary rides along as decode bias, so "neuma" is HEARD
    // rather than repaired downstream. Cheapest possible fix and the only one
    // that improves the transcript itself — core/text/repair.js is the
    // fallback for what still comes back wrong.
    const bias = encodeURIComponent(hotwordsPhrase());
    // A live read while the key is held decodes greedily; the release's final keeps the beam.
    const preview = req.query.preview === '1' ? '&preview=1' : '';
    try {
      const upstream = await sidecarFetch(`http://${host}:${port}/transcribe?hotwords=${bias}${preview}`, {
        method: 'POST',
        headers: { 'Content-Type': req.get('content-type') || 'application/octet-stream' },
        body: req.body,
        // Sized for a LONG hold: a multi-minute dictation decodes well within
        // this on the rig; 60s was killing exactly the finals whose words the
        // operator had spoken the longest (2026-08-28 cut-out report).
        signal: AbortSignal.timeout(180_000),
      });
      const body = await upstream.json();
      if (!upstream.ok) {
        log.error('sidecar transcription failed', { status: upstream.status, detail: body.detail });
        return res.status(502).json({ error: body.detail || 'transcription failed' });
      }
      res.json({ text: body.text, language: body.language, durationSeconds: body.durationSeconds });
    } catch (err) {
      log.error('sidecar unreachable', { err: err.message });
      res.status(502).json({ error: `speech engine unreachable: ${err.message}` });
    }
  }
);

export default router;
