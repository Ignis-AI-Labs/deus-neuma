/**
 * Dictation readiness — the missing-components contract proven against THIS
 * machine's real state (RULE 0): the real uv probe, the real weights check,
 * and the real /voice/transcribe route. Auth is REAL (#390 tranche 4): the
 * witness carries a real HMAC session token through the real requireAuth —
 * the claim under test is the readiness contract, not auth, so a real
 * wallet with a real session that claims no workspace is exactly the right
 * shape (this route has no neuma lane).
 *
 * The 503-with-missing branch asserts only when this machine genuinely lacks
 * a component; a fully-provisioned rig covers the ready/consistency claims
 * and skips the missing branch honestly rather than faking absence.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  isUvAvailable, engineReadiness, getStatus,
} from '../../backend/services/voice/engine-manager.js';

describe('engineReadiness (pure)', () => {
  test('names exactly what is missing', () => {
    expect(engineReadiness({ uvAvailable: true, downloaded: true }))
      .toEqual({ ready: true, missing: [] });
    expect(engineReadiness({ uvAvailable: false, downloaded: true }))
      .toEqual({ ready: false, missing: ['uv'] });
    expect(engineReadiness({ uvAvailable: true, downloaded: false }))
      .toEqual({ ready: false, missing: ['weights'] });
    expect(engineReadiness({ uvAvailable: false, downloaded: false }))
      .toEqual({ ready: false, missing: ['uv', 'weights'] });
  });
});

describe('against this machine', () => {
  test('isUvAvailable reports a real boolean and is stable across the cache window', async () => {
    const first = await isUvAvailable();
    expect(typeof first).toBe('boolean');
    expect(await isUvAvailable()).toBe(first);
  });

  test('whisper status carries the real downloaded fact', () => {
    const status = getStatus('whisper');
    expect(status).not.toBeNull();
    expect(typeof status.downloaded).toBe('boolean');
  });
});

describe('the transcribe route names missing components', () => {
  let app, witness;

  beforeEach(async () => {
    vi.resetModules();
    // Imported AFTER resetModules so the witness mints its token from the
    // same auth.js instance the router will verify against — the token
    // secret is memoized per module instance, so a stale import would 401.
    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();
    const { default: router } = await import('../../backend/routes/stt-routes.js');
    app = express();
    app.use('/api/v1/voice', router);
  });

  test('503 carries code + the machine-true missing list (or the machine is ready and this skips)', async () => {
    const readiness = engineReadiness({
      uvAvailable: await isUvAvailable(),
      downloaded: getStatus('whisper')?.downloaded ?? false,
    });
    if (readiness.ready) return; // provisioned rig — the missing branch cannot be honestly exercised

    const res = await request(app)
      .post('/api/v1/voice/transcribe')
      .set(witness.header)
      .set('Content-Type', 'audio/wav')
      .send(Buffer.from('RIFFfakeaudio'));
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('STT_COMPONENTS_MISSING');
    expect(res.body.missing).toEqual([...readiness.missing]);
  }, 30000);
});
