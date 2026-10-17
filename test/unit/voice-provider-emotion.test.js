/**
 * Emotion → prosody at the provider seam. Locks three defects found in the
 * 2026-07-03 T1.4 pass:
 *
 *   1. Zonos: the detector's neuma vocabulary (joyful/defiant/…) is NOT the
 *      sidecar's Zonos vocabulary (happiness/anger/…) — unmapped labels fell
 *      through to the sidecar's neutral vector, so emotion did nothing.
 *   2. Zonos: intensity was sent as camelCase emotionIntensity; the sidecar's
 *      pydantic field is emotion_intensity, so intensity was silently dropped.
 *   3. Cartesia: emotion was sent as a top-level body field that is not part
 *      of the API — it belongs in generation_config (sonic-3+ only).
 *
 * All functions under test are pure — real modules, no mocks.
 */

import { describe, test, expect } from 'vitest';
import { EMOTION_LABELS } from '../../core/runtime/emotion-detector.js';
import { buildZonosRequest, toZonosEmotion } from '../../backend/services/voice/providers/zonos.js';
import { buildCartesiaRequest, modelSupportsEmotion, resolveModelId, CARTESIA_EMOTION } from '../../backend/services/voice/providers/cartesia.js';

// The sidecar's accepted slots (voice-engines/zonos/server.py _EMOTION_SLOTS)
const ZONOS_SLOTS = ['happiness', 'sadness', 'disgust', 'fear', 'surprise', 'anger', 'other', 'neutral'];

describe('zonos — neuma emotion vocabulary maps onto sidecar slots', () => {
  test('every label the detector can emit maps to a slot the sidecar accepts', () => {
    for (const label of EMOTION_LABELS) {
      expect(ZONOS_SLOTS).toContain(toZonosEmotion(label));
    }
  });

  test('labels already in Zonos vocabulary pass through untouched', () => {
    for (const slot of ZONOS_SLOTS) expect(toZonosEmotion(slot)).toBe(slot);
  });

  test('detected emotion lands in the body as a mapped slot + snake_case intensity', () => {
    const body = buildZonosRequest({
      text: 'hello',
      voiceDNA: { language: 'en-us' },
      emotion: { label: 'defiant', intensity: 0.8 },
    });
    expect(body.emotion).toBe('anger');
    expect(body.emotion_intensity).toBe(0.8);
    expect(body).not.toHaveProperty('emotionIntensity');
  });

  test('no detected emotion → Voice DNA default emotion, no intensity key', () => {
    const body = buildZonosRequest({
      text: 'hello',
      voiceDNA: { emotionProfile: { default: 'neutral' } },
    });
    expect(body.emotion).toBe('neutral');
    expect(body).not.toHaveProperty('emotion_intensity');
  });

  test('no emotion anywhere → no emotion keys at all', () => {
    const body = buildZonosRequest({ text: 'hello', voiceDNA: {} });
    expect(body).not.toHaveProperty('emotion');
    expect(body).not.toHaveProperty('emotion_intensity');
  });
});

describe('cartesia — emotion rides generation_config, never a top-level field', () => {
  const DNA = { engine: { voiceId: 'v-1' } };

  test('every label the detector can emit has a documented enum mapping', () => {
    for (const label of EMOTION_LABELS) {
      expect(typeof CARTESIA_EMOTION[label]).toBe('string');
    }
  });

  test('emotion is never sent as a top-level body field', () => {
    const body = buildCartesiaRequest({
      text: 'hello', voiceDNA: DNA, emotion: { label: 'joyful', intensity: 0.5 }, config: {},
    });
    expect(body).not.toHaveProperty('emotion');
  });

  test('generation_config is gated on a model that supports it', () => {
    expect(modelSupportsEmotion('sonic-3')).toBe(true);
    expect(modelSupportsEmotion('sonic-3.5')).toBe(true);
    expect(modelSupportsEmotion('sonic-2')).toBe(false);

    // Default model is sonic-2 — emotion must be withheld, not sent into an
    // undocumented field.
    const body = buildCartesiaRequest({
      text: 'hello', voiceDNA: DNA, emotion: { label: 'joyful', intensity: 0.5 }, config: {},
    });
    expect(body.model_id).toBe('sonic-2');
    expect(body).not.toHaveProperty('generation_config');
  });

  test('unmapped emotion label is dropped even on an emotion-capable model', () => {
    const body = buildCartesiaRequest({
      text: 'hello', voiceDNA: DNA, emotion: { label: 'not-a-real-label', intensity: 0.5 },
      config: { model: 'sonic-3' },
    });
    expect(body).not.toHaveProperty('generation_config');
    expect(body).not.toHaveProperty('emotion');
  });

  test('model pinned via config tracks the deployed model and unlocks emotion', () => {
    // Sonic-shaped config.model wins; the registry's display name does not.
    expect(resolveModelId({ model: 'sonic-3' })).toBe('sonic-3');
    expect(resolveModelId({ model: 'Cartesia Sonic' })).toBe('sonic-2');
    expect(resolveModelId({})).toBe('sonic-2');

    const body = buildCartesiaRequest({
      text: 'hello', voiceDNA: DNA, emotion: { label: 'empathic', intensity: 0.4 },
      config: { model: 'sonic-3' },
    });
    expect(body.model_id).toBe('sonic-3');
    expect(body.generation_config).toEqual({ emotion: 'sympathetic' });
  });
});
