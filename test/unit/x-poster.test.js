/**
 * X poster — the pure OAuth 1.0a signing core, proven against the canonical
 * worked example in X's own OAuth documentation (fixed nonce + timestamp →
 * deterministic signature). Pure functions with real inputs and outputs;
 * credential gating exercises the real process env (RULE 0 — no mocks).
 */
import { describe, expect, it, afterEach } from 'vitest';
import {
  percentEncode, signatureBaseString, buildOAuth1Header, xPostCredentials,
} from '../../backend/services/social/x-poster.js';

// The exact request from X's "Creating a signature" documentation
// (docs.x.com — verified against the live page 2026-07-04; the retired
// api.twitter.com version of the same example signs to a different value).
const DOC_CREDENTIALS = Object.freeze({
  apiKey: 'xvz1evFS4wEEPTGEFPHBog',
  apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
  accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
  accessSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
});
const DOC_REQUEST = Object.freeze({
  method: 'POST',
  url: 'https://api.x.com/1.1/statuses/update.json',
  params: Object.freeze({
    include_entities: 'true',
    status: 'Hello Ladies + Gentlemen, a signed OAuth request!',
  }),
  timestamp: '1318622958',
  nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
});

describe('percentEncode (RFC 3986)', () => {
  it('encodes the five characters encodeURIComponent leaves bare', () => {
    expect(percentEncode("!'()*")).toBe('%21%27%28%29%2A');
  });
  it('matches the spec on spaces, plus, unreserved and unicode', () => {
    expect(percentEncode('Ladies + Gentlemen')).toBe('Ladies%20%2B%20Gentlemen');
    expect(percentEncode('An encoded string!')).toBe('An%20encoded%20string%21');
    expect(percentEncode('Dogs, Cats & Mice')).toBe('Dogs%2C%20Cats%20%26%20Mice');
    expect(percentEncode('☃')).toBe('%E2%98%83');
    expect(percentEncode('safe-chars_~.')).toBe('safe-chars_~.');
  });
});

describe('OAuth 1.0a signing against the documented example', () => {
  it('produces the documented signature base string', () => {
    const base = signatureBaseString(DOC_REQUEST.method, DOC_REQUEST.url, {
      ...DOC_REQUEST.params,
      oauth_consumer_key: DOC_CREDENTIALS.apiKey,
      oauth_nonce: DOC_REQUEST.nonce,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: DOC_REQUEST.timestamp,
      oauth_token: DOC_CREDENTIALS.accessToken,
      oauth_version: '1.0',
    });
    expect(base).toBe(
      'POST&https%3A%2F%2Fapi.x.com%2F1.1%2Fstatuses%2Fupdate.json&'
      + 'include_entities%3Dtrue%26'
      + 'oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26'
      + 'oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26'
      + 'oauth_signature_method%3DHMAC-SHA1%26'
      + 'oauth_timestamp%3D1318622958%26'
      + 'oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26'
      + 'oauth_version%3D1.0%26'
      + 'status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521',
    );
  });

  it('produces the documented HMAC-SHA1 signature in the header', () => {
    const header = buildOAuth1Header(DOC_CREDENTIALS, DOC_REQUEST);
    expect(header.startsWith('OAuth ')).toBe(true);
    expect(header).toContain('oauth_signature="Ls93hJiZbQ3akF3HF3x1Bz8%2FzU4%3D"');
    expect(header).toContain('oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"');
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
  });
});

describe('postToX honors the operator barge-in signal', () => {
  it('an aborted signal stops the publish before any request leaves', async () => {
    const controller = new AbortController();
    controller.abort();
    const { postToX } = await import('../../backend/services/social/x-poster.js');
    const outcome = await postToX(DOC_CREDENTIALS, 'never sent', { signal: controller.signal });
    expect(outcome).toEqual({ ok: false, detail: 'interrupted by your operator before publishing' });
  });
});

describe('xPostCredentials — all four or nothing', () => {
  const KEYS = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
  const saved = KEYS.map((k) => [k, process.env[k]]);
  afterEach(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('yields frozen credentials when all four are set, null when any is missing', () => {
    for (const k of KEYS) process.env[k] = `test-${k}`;
    const creds = xPostCredentials();
    expect(creds).toEqual({
      apiKey: 'test-X_API_KEY',
      apiSecret: 'test-X_API_SECRET',
      accessToken: 'test-X_ACCESS_TOKEN',
      accessSecret: 'test-X_ACCESS_SECRET',
    });
    expect(Object.isFrozen(creds)).toBe(true);

    for (const missing of KEYS) {
      for (const k of KEYS) process.env[k] = `test-${k}`;
      delete process.env[missing];
      expect(xPostCredentials()).toBeNull();
    }
  });
});
