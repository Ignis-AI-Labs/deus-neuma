import { describe, it, expect } from 'vitest';
import {
  initWsRateLimit, checkWsRateLimit, isUnmeteredApiPath, isEssentialStatusPath,
  isVoiceTranscribePath, isFilesLivePath, isReadTierRequest,
} from '../../backend/services/rate-limiter.js';

describe('WebSocket rate limiting', () => {
  it('initializes rate limit state', () => {
    const conn = {};
    initWsRateLimit(conn);
    expect(conn._msgCount).toBe(0);
    expect(conn._msgWindowStart).toBeGreaterThan(0);
  });

  it('allows messages under the limit', () => {
    const conn = {};
    initWsRateLimit(conn);
    expect(checkWsRateLimit(conn)).toBe(false);
  });

  it('blocks after 30 messages', () => {
    const conn = {};
    initWsRateLimit(conn);

    for (let i = 0; i < 30; i++) {
      checkWsRateLimit(conn);
    }

    expect(checkWsRateLimit(conn)).toBe(true);
  });

  it('resets after window expires', () => {
    const conn = {};
    initWsRateLimit(conn);
    conn._msgCount = 30;
    conn._msgWindowStart = Date.now() - 61000; // 61 seconds ago

    expect(checkWsRateLimit(conn)).toBe(false); // Should reset
  });
});

describe('apiLimiter — the ceiling, minus files already on disk', () => {
  it('exempts the gallery file route and NOTHING adjacent to it', () => {
    expect(isUnmeteredApiPath('/v1/gallery/file')).toBe(true);
    // The listing is a real scan of every root — it stays metered.
    expect(isUnmeteredApiPath('/v1/gallery/items')).toBe(false);
    expect(isUnmeteredApiPath('/v1/gallery/roots')).toBe(false);
    // No prefix or suffix slack: a future sibling must be added deliberately.
    expect(isUnmeteredApiPath('/v1/gallery/file/anything')).toBe(false);
    expect(isUnmeteredApiPath('/v1/gallery/files')).toBe(false);
    expect(isUnmeteredApiPath('/v1/llm/complete')).toBe(false);
  });

  it('exempts hold-to-talk transcribe and NOTHING adjacent to it', () => {
    expect(isVoiceTranscribePath('POST', '/v1/voice/transcribe')).toBe(true);
    expect(isVoiceTranscribePath('post', '/v1/voice/transcribe')).toBe(true);
    expect(isVoiceTranscribePath('GET', '/v1/voice/transcribe')).toBe(false);
    expect(isVoiceTranscribePath('POST', '/v1/voice/transcribe/x')).toBe(false);
    expect(isVoiceTranscribePath('POST', '/v1/voice/engines/local/whisper/launch')).toBe(false);
  });

  it('exempts explorer live list/events/roots and NOTHING adjacent to them', () => {
    expect(isFilesLivePath('GET', '/v1/user/files/list')).toBe(true);
    expect(isFilesLivePath('GET', '/v1/user/files/events')).toBe(true);
    // /roots serves an in-memory array — no spawn, no CPU. Metering it let a
    // mid-storm mount strand the tree on LOADING (audit, 2026-09-02).
    expect(isFilesLivePath('GET', '/v1/user/files/roots')).toBe(true);
    expect(isFilesLivePath('get', '/v1/user/files/list')).toBe(true);
    expect(isFilesLivePath('POST', '/v1/user/files/list')).toBe(false);
    expect(isFilesLivePath('GET', '/v1/user/files/list/x')).toBe(false);
    expect(isFilesLivePath('GET', '/v1/user/files/roots/x')).toBe(false);
    expect(isFilesLivePath('POST', '/v1/user/files/roots')).toBe(false);
    expect(isFilesLivePath('GET', '/v1/user/files/read')).toBe(false);
  });

});

describe('isEssentialStatusPath — exact GET lights, nothing adjacent', () => {
  it('matches only the four live-desk GET status paths', () => {
    expect(isEssentialStatusPath('GET', '/v1/health')).toBe(true);
    expect(isEssentialStatusPath('GET', '/v1/llm/provider')).toBe(true);
    expect(isEssentialStatusPath('GET', '/v1/neuma/fenna/route/health')).toBe(true);
    expect(isEssentialStatusPath('GET', '/v1/witnesses/xai/Grok/health')).toBe(true);
    expect(isEssentialStatusPath('GET', '/v1/witnesses/kimi-code/Basunor/health')).toBe(true);
    expect(isEssentialStatusPath('get', '/v1/health')).toBe(true);
  });

  it('refuses writes, neighbors, prefixes, queries, and unbounded ids', () => {
    expect(isEssentialStatusPath('POST', '/v1/health')).toBe(false);
    expect(isEssentialStatusPath('PUT', '/v1/llm/provider')).toBe(false);
    expect(isEssentialStatusPath('GET', '/v1/health/detailed')).toBe(false);
    expect(isEssentialStatusPath('GET', '/v1/health/')).toBe(false);
    expect(isEssentialStatusPath('GET', '/v1/llm/provider/x')).toBe(false);
    expect(isEssentialStatusPath('GET', '/v1/neuma/fenna/route')).toBe(false);
    expect(isEssentialStatusPath('GET', '/v1/neuma/fenna/route/health/x')).toBe(false);
    expect(isEssentialStatusPath('GET', '/v1/neuma/a/b/route/health')).toBe(false);
    expect(isEssentialStatusPath('GET', '/v1/neuma/../x/route/health')).toBe(false);
    expect(isEssentialStatusPath('GET', '/v1/witnesses/xai/Grok')).toBe(false);
    expect(isEssentialStatusPath('GET', '/v1/witnesses/xai/Grok/test')).toBe(false);
    expect(isEssentialStatusPath('POST', '/v1/witnesses/xai/Grok/health')).toBe(false);
    expect(isEssentialStatusPath('GET', '/v1/witnesses/xai/Grok/health/x')).toBe(false);
    expect(isEssentialStatusPath('GET', '/v1/gallery/file')).toBe(false);
    expect(isEssentialStatusPath('GET', '/v1/health?x=1')).toBe(false);
    expect(isEssentialStatusPath('GET', `/v1/neuma/${'a'.repeat(97)}/route/health`)).toBe(false);
    expect(isEssentialStatusPath('', '/v1/health')).toBe(false);
    expect(isEssentialStatusPath('GET', '')).toBe(false);
  });
});


describe('isReadTierRequest — the two-tier signal (PRESENCE, never validity)', () => {
  it('idempotent methods with a bearer attached ride the read tier', () => {
    const req = (method, authorization) => ({ method, headers: { ...(authorization ? { authorization } : {}) } });
    expect(isReadTierRequest(req('GET', 'Bearer abc'))).toBe(true);
    expect(isReadTierRequest(req('HEAD', 'Bearer abc'))).toBe(true);
    expect(isReadTierRequest(req('OPTIONS', 'Bearer abc'))).toBe(true);
    expect(isReadTierRequest(req('get', 'Bearer abc'))).toBe(true);
    // Writes never tier up — a POST spends CPU, tokens, or disk.
    expect(isReadTierRequest(req('POST', 'Bearer abc'))).toBe(false);
    expect(isReadTierRequest(req('PUT', 'Bearer abc'))).toBe(false);
    expect(isReadTierRequest(req('DELETE', 'Bearer abc'))).toBe(false);
    // No bearer, no tier — the desk's cadence is a SESSION'S cadence.
    expect(isReadTierRequest(req('GET'))).toBe(false);
    expect(isReadTierRequest(req('GET', 'Basic abc'))).toBe(false);
    expect(isReadTierRequest(req('GET', 'bearer abc'))).toBe(false); // the exact scheme, like requireAuth
    // A forged bearer still tier-reads here — and dies at requireAuth
    // downstream; the limiter never verifies (once, later, not here).
    expect(isReadTierRequest(req('GET', 'Bearer forged'))).toBe(true);
    expect(isReadTierRequest(null)).toBe(false);
  });
});
