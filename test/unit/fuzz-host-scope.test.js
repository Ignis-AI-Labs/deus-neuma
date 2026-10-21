/**
 * THE LOCAL SCOPE, FUZZED (security seat pen + fuzz plan, item 5). Every
 * machine-wide change and every host-OS act is gated on `local` — the scope
 * the remote access gate stamps (accessDecision → classifyAccess; the same
 * decision upgradeAccess makes for a WebSocket). `local` must mean a true
 * loopback peer that forwarded nothing and named this machine as its Host: a
 * LAN peer saying `Host: localhost`, a rebound name, a proxied request, or a
 * Host that only looks local must never earn it.
 *
 * The oracle is independent of the classifier: Node's own BlockList decides
 * loopback, and a Host counts as clean only when its name is literally
 * localhost, 127.0.0.1 or [::1] before an optional port. The property is one
 * way — the classifier may be stricter than the oracle, never looser — and a
 * liveness row proves the desk itself is still local. Seeded.
 */
import net from 'node:net';
import { classifyAccess } from '../../backend/services/remote/access-scope.js';
import { accessDecision } from '../../backend/services/remote/access-guard.js';
import { normalizeRemoteState } from '../../backend/services/remote/remote-store.js';
import { prng, pick, flipCase } from '../helpers/seeded-fuzz.js';

const SEED = 0x10ca1;
const ROUNDS = 6000;
const ENROLLED = 'desk.tail0d1e.ts.net';

const PEERS = Object.freeze([
  '127.0.0.1', '127.5.6.7', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:0:0:1', '::ffff:7f00:1', '::ffff:127.0.0.1%lo',
  '10.0.0.5', '192.168.1.2', '100.100.7.9', '::', '0.0.0.0', 'fe80::1%eth0', '::ffff:10.0.0.1', '1.2.3.4',
  '127.0.0.1.evil', '', undefined, 'localhost', '::2', '::1:0', '128.0.0.1', '126.255.255.255',
]);
const HOSTS = Object.freeze([
  'localhost', 'localhost:3333', 'localhost.', 'localhost.:80', '127.0.0.1', '127.0.0.1:1', '127.0.0.1@evil',
  'evil@127.0.0.1', '[::1]', '[::1]:x', '[::1]:3333', '::1', '127.1', '0x7f.0.0.1', '2130706433',
  'localhost.evil.com', 'evil.com', 'localhost\t', '  localhost ', 'localhost:80:80', '[::ffff:127.0.0.1]',
  '127.0.0.1.nip.io', '', undefined, 'xn--localhost', 'localhost%00', 'locałhost', 'ｌｏｃａｌｈｏｓｔ',
  'localhost\u0000', ENROLLED, `${ENROLLED}:443`, '[::1', '::1]', 'localhost/', 'localhost#x', 'localhost?', '127.0.0.1\\evil',
]);
const FORWARDED = Object.freeze([
  undefined, '', ' ', '100.100.7.9', '100.100.7.9, 1.2.3.4', '127.0.0.1', '::1', 'unknown', ',', ' , ', 'garbage',
  '100.64.0.1', 'fd7a:115c:a1e0::1', '1.2.3.4, 100.100.7.9',
]);

// Node's own address arithmetic — never the classifier's.
const loopback = new net.BlockList();
loopback.addSubnet('127.0.0.0', 8, 'ipv4');
loopback.addAddress('::1', 'ipv6');
loopback.addSubnet('::ffff:127.0.0.0', 104, 'ipv6');

const oracleLoopbackPeer = (peer) => {
  const ip = String(peer ?? '').trim().replace(/%.*$/, '');
  const family = net.isIP(ip);
  return family !== 0 && loopback.check(ip, family === 4 ? 'ipv4' : 'ipv6');
};
// A port part may be junk (`[::1]:x`) — it cannot change which machine the
// name means; the NAME must be literally a loopback one.
const oracleCleanHost = (host) => {
  const h = String(host ?? '').trim().toLowerCase();
  return h === '::1' || /^(localhost|127\.0\.0\.1)(:[^@/\\?#\s.:]*)?$/.test(h) || /^\[::1\](:[^@/\\?#\s]*)?$/.test(h);
};
const oracleNothingForwarded = (xff) => String(xff ?? '').split(',').every((entry) => !entry.trim());

// one generated request shape: a listed value, sometimes mutated further
const generate = (r) => {
  let host = pick(r, HOSTS);
  if (typeof host === 'string' && r() < 0.3) host = flipCase(r, host);
  if (typeof host === 'string' && r() < 0.15) host = `${host}:${Math.floor(r() * 70000)}`;
  if (typeof host === 'string' && r() < 0.1) host = pick(r, [' ', '\t', '.', '..', '@']) + host;
  return { peer: pick(r, PEERS), host, xff: pick(r, FORWARDED) };
};

const STATES = Object.freeze([
  normalizeRemoteState(null),
  normalizeRemoteState({ enabled: true, origin: ENROLLED, devices: [] }),
]);

describe('local scope is earned only by a true loopback peer with a clean Host (seeded fuzz)', () => {
  test('liveness — the desk itself is local, in every loopback spelling', () => {
    for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      for (const host of ['localhost:7755', '127.0.0.1:3355', '[::1]:3355', 'LOCALHOST']) {
        expect(classifyAccess({ remoteAddress: peer, host, forwardedFor: undefined, enrolledHost: null }).scope, `${peer} ${host}`).toBe('local');
      }
    }
  });

  test('classifyAccess never says local where the oracle would not', () => {
    const r = prng(SEED);
    const wrong = [];
    let locals = 0;
    for (let i = 0; i < ROUNDS; i += 1) {
      const { peer, host, xff } = generate(r);
      const enrolledHost = r() < 0.5 ? ENROLLED : null;
      const { scope } = classifyAccess({ remoteAddress: peer, host, forwardedFor: xff, enrolledHost });
      if (scope !== 'local') continue;
      locals += 1;
      if (!(oracleLoopbackPeer(peer) && oracleCleanHost(host) && oracleNothingForwarded(xff))) {
        wrong.push(JSON.stringify({ peer, host, xff }));
      }
    }
    expect(wrong).toEqual([]);
    expect(locals).toBeGreaterThan(50);
  });

  test('the request gate admits as local, on any method or path, only what the oracle would', () => {
    const r = prng(SEED ^ 0xbeef);
    const wrong = [];
    for (let i = 0; i < ROUNDS; i += 1) {
      const { peer, host, xff } = generate(r);
      const headers = { host, 'x-forwarded-for': xff, origin: r() < 0.3 ? 'https://evil.example' : undefined };
      const decision = accessDecision({
        headers, remoteAddress: peer, method: pick(r, ['GET', 'POST', 'PUT', 'DELETE']),
        path: pick(r, ['/api/v1/llm/provider', '/r/claim', '/r/abc', '/api/v1/remote/enable']), state: pick(r, STATES),
      });
      if (decision.scope === 'local' && !(oracleLoopbackPeer(peer) && oracleCleanHost(host) && oracleNothingForwarded(xff))) {
        wrong.push(JSON.stringify({ peer, host, xff }));
      }
    }
    expect(wrong).toEqual([]);
  });

  test('a non-loopback peer is never local, whatever Host and forwarding it claims', () => {
    for (const peer of PEERS.filter((p) => !oracleLoopbackPeer(p))) {
      for (const host of HOSTS) {
        for (const xff of FORWARDED) {
          const { scope } = classifyAccess({ remoteAddress: peer, host, forwardedFor: xff, enrolledHost: ENROLLED });
          expect(scope, JSON.stringify({ peer, host, xff })).not.toBe('local');
        }
      }
    }
  });
});
