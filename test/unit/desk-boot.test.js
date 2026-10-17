// Desk boot payload sanitizer (I-02a) — the pure gate untrusted renderer
// input passes through before a token may ride the one-shot relay.
// Pure functions on plain data: no Electron, no mocks (GNOSIS-compatible).
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MAX_TOKEN_CHARS, sanitizeBootPayload, sanitizeCompanionSeed } = require('../../electron/desk-boot.cjs');

describe('sanitizeBootPayload', () => {
  it('passes a well-formed token through, and ONLY the token', () => {
    const raw = { authToken: 'eyJhbGciOiJIUzI1NiJ9.payload_-sig', extra: 'dropped', nested: { x: 1 } };
    expect(sanitizeBootPayload(raw)).toEqual({ authToken: 'eyJhbGciOiJIUzI1NiJ9.payload_-sig' });
  });

  it('accepts base64url alphabet (dash and underscore)', () => {
    expect(sanitizeBootPayload({ authToken: 'a-b_c.d' })).toEqual({ authToken: 'a-b_c.d' });
  });

  it('trims surrounding whitespace instead of rejecting it', () => {
    expect(sanitizeBootPayload({ authToken: '  tok3n  ' })).toEqual({ authToken: 'tok3n' });
  });

  it('rejects non-objects and missing/non-string tokens', () => {
    expect(sanitizeBootPayload(null)).toBeNull();
    expect(sanitizeBootPayload('token')).toBeNull();
    expect(sanitizeBootPayload({})).toBeNull();
    expect(sanitizeBootPayload({ authToken: 42 })).toBeNull();
    expect(sanitizeBootPayload({ authToken: ['t'] })).toBeNull();
  });

  it('rejects empty and oversized tokens', () => {
    expect(sanitizeBootPayload({ authToken: '' })).toBeNull();
    expect(sanitizeBootPayload({ authToken: '   ' })).toBeNull();
    expect(sanitizeBootPayload({ authToken: 'x'.repeat(MAX_TOKEN_CHARS + 1) })).toBeNull();
    expect(sanitizeBootPayload({ authToken: 'x'.repeat(MAX_TOKEN_CHARS) })).not.toBeNull();
  });

  it('carries a valid companion seed alongside the token, and ONLY then', () => {
    const companion = { name: 'Fenna', neumaId: 'FBF167B8F932', extra: 'dropped' };
    expect(sanitizeBootPayload({ authToken: 'tok3n', companion }))
      .toEqual({ authToken: 'tok3n', companion: { name: 'Fenna', neumaId: 'FBF167B8F932' } });
    // no valid token -> no payload at all, companion or not
    expect(sanitizeBootPayload({ companion })).toBeNull();
    // malformed companion -> token still rides, seed dropped
    expect(sanitizeBootPayload({ authToken: 'tok3n', companion: { name: '' } }))
      .toEqual({ authToken: 'tok3n' });
  });

  it('rejects internal whitespace, control characters, and non-ASCII', () => {
    // control chars built via fromCharCode — never typed literally
    const nul = String.fromCharCode(0);
    const nl = String.fromCharCode(10);
    const del = String.fromCharCode(127);
    const nbsp = String.fromCharCode(160);
    const cjk = String.fromCharCode(0x4e2d);
    expect(sanitizeBootPayload({ authToken: `tok${nul}en` })).toBeNull();
    expect(sanitizeBootPayload({ authToken: `tok${nl}en` })).toBeNull();
    expect(sanitizeBootPayload({ authToken: `tok${del}en` })).toBeNull();
    expect(sanitizeBootPayload({ authToken: 'tok en' })).toBeNull();
    expect(sanitizeBootPayload({ authToken: `tok${nbsp}en` })).toBeNull();
    expect(sanitizeBootPayload({ authToken: `tok${cjk}en` })).toBeNull();
  });
});

describe('sanitizeCompanionSeed', () => {
  it('accepts a name with optional neumaId; unicode names pass', () => {
    expect(sanitizeCompanionSeed({ name: 'Fenna' })).toEqual({ name: 'Fenna' });
    expect(sanitizeCompanionSeed({ name: ' Веріс ', neumaId: 'abc-123' }))
      .toEqual({ name: 'Веріс', neumaId: 'abc-123' });
  });

  it('rejects missing/empty/oversized names and control characters', () => {
    const nl = String.fromCharCode(10);
    expect(sanitizeCompanionSeed(null)).toBeNull();
    expect(sanitizeCompanionSeed({})).toBeNull();
    expect(sanitizeCompanionSeed({ name: '   ' })).toBeNull();
    expect(sanitizeCompanionSeed({ name: 'x'.repeat(101) })).toBeNull();
    expect(sanitizeCompanionSeed({ name: `Au${nl}rora` })).toBeNull();
  });

  it('rejects a non-ASCII or oversized neumaId (derived ids are ASCII)', () => {
    expect(sanitizeCompanionSeed({ name: 'A', neumaId: 'id中' })).toBeNull();
    expect(sanitizeCompanionSeed({ name: 'A', neumaId: 'x'.repeat(201) })).toBeNull();
    // absent/empty neumaId is fine — the seed is just a name
    expect(sanitizeCompanionSeed({ name: 'A', neumaId: '' })).toEqual({ name: 'A' });
  });
});

