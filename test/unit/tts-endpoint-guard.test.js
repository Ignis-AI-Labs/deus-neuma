/**
 * The voice endpoint guard and the tier → sidecar map (ONE VOICE).
 *
 * The speak protocol's routes carry no auth; loopback is the only gate. The
 * one adapter (providers/speak.js) refuses any endpoint that is not plain http
 * on loopback, before a byte is sent — and the endpoint only ever comes from
 * the engine registry's serve block (engine-manager.resolveServe), never from
 * a request. speakTargetOf maps a tier choice onto the registry's engine,
 * model and profile. Both pure; the refusal is proven on the real generator.
 */

import { describe, test, expect } from 'vitest';
import { isLoopbackEndpoint, speak } from '../../backend/services/voice/providers/speak.js';
import { speakTargetOf } from '../../backend/services/tts-provider.js';

const VOICE = { ref: `sha256:${'a'.repeat(64)}`, words: 'hello there' };

describe('isLoopbackEndpoint — the speak protocol is loopback-only', () => {
  test('plain http on loopback, any port, is allowed', () => {
    expect(isLoopbackEndpoint('http://127.0.0.1:7868')).toBe(true);
    expect(isLoopbackEndpoint('http://localhost:7869/')).toBe(true);
    expect(isLoopbackEndpoint('http://[::1]:7868')).toBe(true);
  });

  test('LAN, cloud metadata, public hosts, https, other schemes and garbage are refused', () => {
    expect(isLoopbackEndpoint('http://192.168.1.10:7868')).toBe(false);
    expect(isLoopbackEndpoint('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isLoopbackEndpoint('http://api.example.com')).toBe(false);
    expect(isLoopbackEndpoint('https://127.0.0.1:7868')).toBe(false);
    expect(isLoopbackEndpoint('file:///etc/passwd')).toBe(false);
    expect(isLoopbackEndpoint('not a url')).toBe(false);
    expect(isLoopbackEndpoint('http://127.0.0.1.attacker.example')).toBe(false);
  });

  test('speak() refuses a non-loopback endpoint before any request', async () => {
    const gen = speak({ endpoint: 'http://10.0.0.5:7868', text: 'hi', voice: VOICE });
    await expect(gen.next()).rejects.toThrow(/refusing non-loopback/);
  });
});

describe('speakTargetOf — the tier names the sidecar', () => {
  test('light → chatterbox-nano, no model/profile, context ignored', () => {
    expect(speakTargetOf({ tier: 'light', profile: 'cpu' })).toEqual({
      tier: 'light', engine: 'chatterbox-nano', model: null, profile: null, context: false,
    });
  });

  test('standard → csm-1b with its profile, context honoured', () => {
    expect(speakTargetOf({ tier: 'standard', profile: 'lean' })).toEqual({
      tier: 'standard', engine: 'csm', model: 'csm-1b', profile: 'lean', context: true,
    });
  });

  test('high is gone (MisoTTS dropped, Design note, 2026-10-01: it is an unknown tier', () => {
    expect(() => speakTargetOf({ tier: 'high', profile: 'full' })).toThrow(/unknown voice tier/);
  });

  test('an unknown tier throws', () => {
    expect(() => speakTargetOf({ tier: 'ultra' })).toThrow(/unknown voice tier/);
  });
});
