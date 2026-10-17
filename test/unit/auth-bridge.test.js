import { describe, it, expect, beforeEach } from 'vitest';
import {
  startBridgeSession,
  associateBridgeToken,
  retrieveBridgeToken,
  _clearBridgeSessions,
} from '../../backend/services/auth-bridge.js';
import { createSessionToken } from '../../backend/services/auth.js';

// The system-browser wallet bridge (WEB-001 / #126): Electron starts a session,
// the system browser authenticates + associates the minted token, Electron polls
// with a pollSecret to retrieve it. The token never travels in a URL.
const ADDR = '0x' + '1'.repeat(40);

describe('auth — system-browser wallet bridge', () => {
  beforeEach(() => _clearBridgeSessions());

  it('start mints a browserCode + a distinct, high-entropy pollSecret', () => {
    const { browserCode, pollSecret, expiresIn } = startBridgeSession();
    expect(browserCode).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(pollSecret).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(browserCode).not.toBe(pollSecret);
    expect(expiresIn).toBeGreaterThan(0);
  });

  it('happy path: associate a valid token, retrieve it once with the pollSecret', () => {
    const { browserCode, pollSecret } = startBridgeSession();
    const token = createSessionToken(ADDR);

    expect(associateBridgeToken(browserCode, token)).toEqual({ ok: true, address: ADDR.toLowerCase() });

    const got = retrieveBridgeToken(browserCode, pollSecret);
    expect(got.status).toBe(200);
    expect(got.token).toBe(token);
    expect(got.address).toBe(ADDR.toLowerCase());

    // one-time — the session is consumed on retrieval
    expect(retrieveBridgeToken(browserCode, pollSecret).status).toBe(404);
  });

  it('rejects a junk token (no session poisoning)', () => {
    const { browserCode } = startBridgeSession();
    expect(associateBridgeToken(browserCode, 'not-a-real-token')).toMatchObject({ ok: false, status: 401 });
  });

  it('browserCode alone cannot retrieve — a wrong pollSecret is 403, no token leaked', () => {
    const { browserCode } = startBridgeSession();
    associateBridgeToken(browserCode, createSessionToken(ADDR));
    const r = retrieveBridgeToken(browserCode, 'wrong-secret');
    expect(r.status).toBe(403);
    expect(r.token).toBeUndefined();
  });

  it('poll before associate is pending (not an error)', () => {
    const { browserCode, pollSecret } = startBridgeSession();
    expect(retrieveBridgeToken(browserCode, pollSecret)).toEqual({ status: 200, pending: true });
  });

  it('first association wins — a second associate is rejected (409)', () => {
    const { browserCode } = startBridgeSession();
    expect(associateBridgeToken(browserCode, createSessionToken(ADDR)).ok).toBe(true);
    const second = associateBridgeToken(browserCode, createSessionToken('0x' + '2'.repeat(40)));
    expect(second).toMatchObject({ ok: false, status: 409 });
  });

  it('unknown bridge session → 404 on both associate and retrieve', () => {
    expect(associateBridgeToken('nope', createSessionToken(ADDR))).toMatchObject({ status: 404 });
    expect(retrieveBridgeToken('nope', 'whatever').status).toBe(404);
  });
});
