// The pure heart of Neuma Remote: the peer classifier and the pairing
// primitives. Every row here is one shape a request can take; the boundary
// integration test drives the same shapes over real sockets.
import { describe, it, expect } from 'vitest';
import {
  classifyAccess, originMatchesHost, isTailnetAddress, isLoopbackAddress,
  parseHostHeader, unmapAddress,
} from '../../backend/services/remote/access-scope.js';
import {
  findDevice, mintDevice, readCookie, deviceCookie, deviceLabel, DEVICE_COOKIE, DEVICE_TTL_MS,
} from '../../backend/services/remote/pairing.js';
import { normalizeRemoteState, EMPTY_REMOTE_STATE } from '../../backend/services/remote/remote-store.js';
import { parseStatus, isServing } from '../../backend/services/remote/tailscale.js';
import { accessDecision } from '../../backend/services/remote/access-guard.js';

const ENROLLED = 'corwin.tail0a1b2c.ts.net';

describe('addresses', () => {
  it('unwraps IPv4-mapped IPv6 and strips zones', () => {
    expect(unmapAddress('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(unmapAddress('fe80::1%eth0')).toBe('fe80::1');
  });
  it('knows loopback in both families', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('127.9.9.9')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('10.0.0.1')).toBe(false);
    expect(isLoopbackAddress('not an ip')).toBe(false);
  });
  it('knows the tailnet ranges and nothing beside them', () => {
    expect(isTailnetAddress('100.64.0.1')).toBe(true);
    expect(isTailnetAddress('100.127.255.254')).toBe(true);
    expect(isTailnetAddress('100.128.0.1')).toBe(false);
    expect(isTailnetAddress('100.63.255.255')).toBe(false);
    expect(isTailnetAddress('fd7a:115c:a1e0::812a:b862')).toBe(true);
    expect(isTailnetAddress('fd7a:115c:a1e1::1')).toBe(false);
    expect(isTailnetAddress('8.8.8.8')).toBe(false);
  });
  it('reads Host headers with ports and brackets', () => {
    expect(parseHostHeader('localhost:7777')).toBe('localhost');
    expect(parseHostHeader('[::1]:3333')).toBe('::1');
    expect(parseHostHeader('::1')).toBe('::1');
    expect(parseHostHeader(`${ENROLLED.toUpperCase()}`)).toBe(ENROLLED);
    expect(parseHostHeader('')).toBeNull();
  });
});

describe('classifyAccess — peer identity before Host', () => {
  const remote = (over = {}) => classifyAccess({
    remoteAddress: '127.0.0.1', forwardedFor: '100.64.0.5', host: ENROLLED, enrolledHost: ENROLLED, ...over,
  });
  it('loopback peer + local host = local', () => {
    expect(classifyAccess({ remoteAddress: '::ffff:127.0.0.1', host: 'localhost:7777' }).scope).toBe('local');
    expect(classifyAccess({ remoteAddress: '::1', host: '[::1]:3333' }).scope).toBe('local');
  });
  it('a rebound hostname on a loopback socket is refused', () => {
    expect(classifyAccess({ remoteAddress: '127.0.0.1', host: 'attacker.example' }).scope).toBeNull();
  });
  it('a LAN peer claiming Host: localhost is refused', () => {
    expect(classifyAccess({ remoteAddress: '192.168.1.20', host: 'localhost' }).scope).toBeNull();
  });
  it('one tailnet hop through serve on the enrolled name = remote', () => {
    const v = remote();
    expect(v.scope).toBe('remote');
    expect(v.peer).toBe('100.64.0.5');
  });
  it('the IPv6 tailnet range counts too', () => {
    expect(remote({ forwardedFor: 'fd7a:115c:a1e0::812a:b862' }).scope).toBe('remote');
  });
  it('a forwarded chain is refused', () => {
    expect(remote({ forwardedFor: '100.64.0.5, 100.64.0.6' }).scope).toBeNull();
  });
  it('a forwarded address outside the tailnet is refused', () => {
    expect(remote({ forwardedFor: '8.8.8.8' }).scope).toBeNull();
  });
  it('a forwarded hop from a non-loopback peer is refused', () => {
    expect(remote({ remoteAddress: '10.0.0.7' }).scope).toBeNull();
  });
  it('the wrong host on a valid hop is refused', () => {
    expect(remote({ host: 'other.tail0a1b2c.ts.net' }).scope).toBeNull();
  });
  it('remote is refused while remote access is off', () => {
    expect(remote({ enrolledHost: null }).reason).toBe('remote access is disabled');
  });
});

describe('originMatchesHost', () => {
  it('passes a non-browser client and the matching origin, refuses the rest', () => {
    expect(originMatchesHost(undefined, ENROLLED)).toBe(true);
    expect(originMatchesHost(`https://${ENROLLED}`, ENROLLED)).toBe(true);
    expect(originMatchesHost('https://evil.example', ENROLLED)).toBe(false);
    expect(originMatchesHost('null', ENROLLED)).toBe(false);
  });
});

describe('accessDecision — the whole gate, pure', () => {
  const state = (devices, enabled = true) =>
    normalizeRemoteState({ enabled, origin: ENROLLED, devices });
  const { secret, device } = mintDevice({ address: '0xAbC', label: 'test phone' });
  const phoneHeaders = (extra = {}) => ({
    host: ENROLLED, 'x-forwarded-for': '100.64.0.5', cookie: `${DEVICE_COOKIE}=${secret}`, ...extra,
  });
  it('local requests are untouched whether remote is on or off', () => {
    const local = { headers: { host: 'localhost' }, remoteAddress: '127.0.0.1', method: 'POST', path: '/api/x' };
    expect(accessDecision({ ...local, state: state([]) }).scope).toBe('local');
    expect(accessDecision({ ...local, state: state([], false) }).scope).toBe('local');
  });
  // Audit 2026-10-28 M-03: a page the operator visits can reach 127.0.0.1. The local tier refuses a
  // request another web origin sent; a CLI, a test and the app's own page are untouched.
  it('a local request sent by another web origin is refused; the app, a dev proxy and a CLI are not', () => {
    const local = (headers) => ({ headers: { host: '127.0.0.1:3333', ...headers }, remoteAddress: '127.0.0.1', method: 'GET', path: '/api/v1/preflight', state: state([], false), originAllowed: (o) => o === 'http://127.0.0.1:3333' || o === 'http://localhost:7777' });
    const verdict = (headers) => accessDecision(local(headers));
    // a CLI or the backend's own fetch: neither header
    expect(verdict({}).allow).toBe(true);
    // the app's own page, and an allowed dev origin
    expect(verdict({ origin: 'http://127.0.0.1:3333' }).allow).toBe(true);
    expect(verdict({ origin: 'http://localhost:7777', 'sec-fetch-site': 'cross-site' }).allow).toBe(true);
    // the browser's word that page and request share an origin (a dev proxy's own page)
    expect(verdict({ origin: 'http://127.0.0.1:41999', 'sec-fetch-site': 'same-origin' }).allow).toBe(true);
    // a foreign page: a CORS fetch carries its Origin; an <img> or no-cors GET only Sec-Fetch-Site
    expect(verdict({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).toMatchObject({ allow: false, status: 403 });
    expect(verdict({ origin: 'https://evil.example' })).toMatchObject({ allow: false, status: 403 });
    expect(verdict({ 'sec-fetch-site': 'cross-site' })).toMatchObject({ allow: false, status: 403 });
    // another localhost port is the same SITE, never the same origin
    expect(verdict({ origin: 'http://127.0.0.1:8080', 'sec-fetch-site': 'same-site' })).toMatchObject({ allow: false, status: 403 });
    expect(verdict({ 'sec-fetch-site': 'same-site' })).toMatchObject({ allow: false, status: 403 });
    // a sandboxed frame or file:// page says Origin: null
    expect(verdict({ origin: 'null' }).allow).toBe(false);
  });

  it('a phone without the cookie is unauthorized; the enrolment road is open to it', () => {
    const bare = { headers: { host: ENROLLED, 'x-forwarded-for': '100.64.0.5' }, remoteAddress: '127.0.0.1', state: state([device]) };
    expect(accessDecision({ ...bare, method: 'GET', path: '/api/x' }).error).toBe('unauthorized');
    expect(accessDecision({ ...bare, method: 'GET', path: '/r/abc' }).allow).toBe(true);
  });
  it('a phone with the cookie is admitted, and named', () => {
    const d = accessDecision({ headers: phoneHeaders(), remoteAddress: '127.0.0.1', method: 'GET', path: '/api/x', state: state([device]) });
    expect(d.allow).toBe(true);
    expect(d.device.id).toBe(device.id);
  });
  it('a state-changing request from a foreign page is blocked', () => {
    const d = accessDecision({ headers: phoneHeaders({ origin: 'https://evil.example' }), remoteAddress: '127.0.0.1', method: 'POST', path: '/api/x', state: state([device]) });
    expect(d.error).toBe('cross-origin request blocked');
  });
  it('rotation cuts the phone', () => {
    const d = accessDecision({ headers: phoneHeaders(), remoteAddress: '127.0.0.1', method: 'GET', path: '/api/x', state: state([]) });
    expect(d.error).toBe('unauthorized');
  });
});

describe('pairing primitives', () => {
  it('finds a device by its secret and only within 30 days', () => {
    const { secret, device } = mintDevice({ address: '0xabc', label: 'x' });
    expect(findDevice([device], secret).id).toBe(device.id);
    expect(findDevice([device], 'wrong')).toBeNull();
    expect(findDevice([device], secret, Date.parse(device.createdAt) + DEVICE_TTL_MS + 1)).toBeNull();
  });
  it('writes and reads the cookie', () => {
    const cookie = deviceCookie('s3cret');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(readCookie(`other=1; ${DEVICE_COOKIE}=s3cret; z=2`, DEVICE_COOKIE)).toBe('s3cret');
    expect(readCookie('other=1', DEVICE_COOKIE)).toBeNull();
  });
  it('labels a phone from its user agent, bounded', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Safari/604.1')).toBe('iPhone · Safari');
    expect(deviceLabel('')).toBe('paired device');
    expect(deviceLabel('x'.repeat(500)).length).toBeLessThanOrEqual(64);
  });
});

describe('store + tailscale parsers', () => {
  it('malformed state reads as OFF with no devices', () => {
    expect(normalizeRemoteState(null)).toBe(EMPTY_REMOTE_STATE);
    expect(normalizeRemoteState({ enabled: true }).enabled).toBe(false);
    expect(normalizeRemoteState({ enabled: true, origin: 'X.TS.NET', devices: [{ id: 'a' }] }))
      .toEqual({ version: 2, enabled: true, origin: 'x.ts.net', roads: { tailnet: 'x.ts.net', lan: null, relay: null }, devices: [], rotatedAt: null });
  });
  it('reads the facts the desk needs from tailscale status', () => {
    const parsed = parseStatus({ BackendState: 'Running', Self: { DNSName: 'corwin.tail0a1b2c.ts.net.', TailscaleIPs: ['100.64.0.97'] }, CertDomains: ['corwin.tail0a1b2c.ts.net'] });
    expect(parsed).toEqual({ backendState: 'Running', dnsName: ENROLLED, certDomains: [ENROLLED], tailnetIps: ['100.64.0.97'] });
    expect(parseStatus('junk').dnsName).toBeNull();
  });
  it('sees the served loopback port whichever spelling serve status uses', () => {
    expect(isServing('https://corwin.ts.net (tailnet only)\n|-- / proxy http://localhost:7777', 7777)).toBe(true);
    expect(isServing('|-- / proxy http://127.0.0.1:3333', 7777)).toBe(false);
  });
});
