// The gate's third shape, pure and header-free: a tunnel socket our own TLS
// layer marked is decided by the MARKER, not by anything a caller could
// send. No server here — this is classifyAccess/accessDecision law.
import { describe, expect, it } from 'vitest';
import { classifyAccess } from '../../backend/services/remote/access-scope.js';
import { accessDecision } from '../../backend/services/remote/access-guard.js';

const now = Date.now();
const cookieRow = Object.freeze({
  id: 'cookie1', hash: 'ab'.repeat(32), label: 'l', address: 'a',
  createdAt: new Date(now).toISOString(), lastSeenAt: new Date(now).toISOString(),
});
const nativeRow = Object.freeze({
  id: 'native1', spki: 'cd'.repeat(32), cert: 'x', label: 'l', address: 'a',
  createdAt: new Date(now).toISOString(), lastSeenAt: new Date(now).toISOString(),
});

const state = (devices = [], origin = null) => ({
  version: 2, enabled: origin !== null, origin,
  roads: { tailnet: origin, lan: { port: 27777 }, relay: null },
  devices, rotatedAt: null,
});

const LOCAL_HEADERS = Object.freeze({ host: 'localhost' });

describe('classifyAccess — the tunnel shapes are checked first', () => {
  it('a pinned tunnel device is remote regardless of peer, Host, or XFF', () => {
    const v = classifyAccess({
      remoteAddress: '192.168.1.50', host: 'evil.example', forwardedFor: '8.8.8.8, 9.9.9.9',
      tunnel: { road: 'lan', id: 'native1', spki: 'cd'.repeat(32) },
    });
    expect(v.scope).toBe('remote');
    expect(v.reason).toBe('pinned tunnel device');
  });

  it('a pairing socket reads as pairing', () => {
    const v = classifyAccess({ remoteAddress: '192.168.1.50', tunnel: { pairingOnly: true } });
    expect(v.scope).toBe('pairing');
  });

  it('without a marker, the old two shapes are untouched', () => {
    expect(classifyAccess({ remoteAddress: '127.0.0.1', host: 'localhost' }).scope).toBe('local');
    expect(classifyAccess({ remoteAddress: '192.168.1.50', host: 'localhost' }).scope).toBe(null);
  });
});

describe('accessDecision — the tunnel road', () => {
  it('admits the live device row by SPKI and stamps req.remoteDevice', async () => {
    const live = state([nativeRow], 'desk.example.ts.net');
    const decision = accessDecision({
      headers: { host: 'abc123.neuma', origin: 'https://abc123.neuma' },
      remoteAddress: '192.168.1.50', method: 'POST', path: '/api/v1/health',
      state: live, tunnel: { road: 'lan', id: 'native1', spki: 'cd'.repeat(32) },
    });
    expect(decision.allow).toBe(true);
    expect(decision.scope).toBe('remote');
    expect(decision.device?.id).toBe('native1');
  });

  it('a REVOKED device fails the live SPKI lookup even with a valid marker', async () => {
    const decision = accessDecision({
      headers: { host: 'abc123.neuma' }, remoteAddress: '192.168.1.50',
      method: 'GET', path: '/', state: state([], 'desk.example.ts.net'),
      tunnel: { road: 'lan', id: 'native1', spki: 'cd'.repeat(32) },
    });
    expect(decision.allow).toBe(false);
    expect(decision.error).toBe('unauthorized');
  });

  it('Origin must equal Host on unsafe methods, even on the tunnel road', () => {
    const live = state([nativeRow], 'desk.example.ts.net');
    const refused = accessDecision({
      headers: { host: 'abc123.neuma', origin: 'https://evil.example' },
      remoteAddress: '192.168.1.50', method: 'POST', path: '/',
      state: live, tunnel: { road: 'lan', id: 'native1', spki: 'cd'.repeat(32) },
    });
    expect(refused.error).toBe('cross-origin request blocked');
  });

  it('a pairing socket reaches POST /r/claim and NOTHING else', () => {
    const pairing = { pairingOnly: true };
    const ok = accessDecision({
      headers: { host: 'x' }, remoteAddress: '192.168.1.50', method: 'POST',
      path: '/r/claim', state: state([nativeRow]), tunnel: pairing,
    });
    expect(ok.allow).toBe(true);
    const wrongPath = accessDecision({
      headers: { host: 'x' }, remoteAddress: '192.168.1.50', method: 'GET',
      path: '/api/v1/health', state: state([nativeRow]), tunnel: pairing,
    });
    expect(wrongPath.error).toBe('the pairing road carries the claim only');
    const wrongMethod = accessDecision({
      headers: { host: 'x' }, remoteAddress: '192.168.1.50', method: 'GET',
      path: '/r/claim', state: state([nativeRow]), tunnel: pairing,
    });
    expect(wrongMethod.allow).toBe(false);
  });

  it('the tailnet and local shapes behave exactly as before', () => {
    expect(accessDecision({
      headers: LOCAL_HEADERS, remoteAddress: '127.0.0.1', method: 'GET',
      path: '/', state: state([cookieRow], 'desk.example.ts.net'),
    }).scope).toBe('local');
    const phone = accessDecision({
      headers: { host: 'desk.example.ts.net', 'x-forwarded-for': '100.64.0.5', cookie: 'neuma_remote=secret' },
      remoteAddress: '127.0.0.1', method: 'GET', path: '/',
      state: state([cookieRow], 'desk.example.ts.net'),
    });
    expect(phone.allow).toBe(false); // wrong secret — unauthorized, as ever
  });
});
