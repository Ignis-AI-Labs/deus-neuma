// SSRF guard for the routing surface: allow any PUBLIC endpoint, block
// loopback/link-local/private + DNS-rebinding. Deterministic cases use IP
// literals (no network); one real-DNS case is guarded so the suite stays
// offline-safe. RULE 0: real URL parsing + real dns.resolve4, no mocks.
import { describe, test, expect } from 'vitest';
import { promises as dns } from 'dns';
import { isPrivateHost, assertSafeEndpoint, cachedResolution } from '../../backend/services/endpoint-guard.js';

describe('isPrivateHost (pure)', () => {
  test('flags loopback, link-local, and RFC-1918/ULA ranges', () => {
    for (const h of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '172.31.255.255', '169.254.169.254', '::1', 'fe80::1', 'fd00::1', '0.0.0.0']) {
      expect(isPrivateHost(h)).toBe(true);
    }
  });
  test('flags the IPv6 unspecified address in both spellings (it reaches a ::-bound listener)', () => {
    expect(isPrivateHost('::')).toBe(true);
    expect(isPrivateHost('[::]')).toBe(true);
  });
  test('does not flag public addresses or provider hostnames', () => {
    for (const h of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', 'api.z.ai', 'api.openai.com', 'openrouter.ai']) {
      expect(isPrivateHost(h)).toBe(false);
    }
  });
  test('unwraps IPv4-mapped IPv6 so the mapped form cannot bypass the checks', () => {
    expect(isPrivateHost('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateHost('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateHost('::ffff:10.0.0.5')).toBe(true);
    expect(isPrivateHost('::ffff:8.8.8.8')).toBe(false); // mapped public stays public
  });
  test('does not false-flag public domains that merely start with fc/fd', () => {
    for (const h of ['fcc.gov', 'fdroid.org', 'fcpp.io', 'fd-example.com']) {
      expect(isPrivateHost(h)).toBe(false);
    }
    expect(isPrivateHost('fc00::1')).toBe(true);  // real IPv6 ULA still blocked
    expect(isPrivateHost('fe80::1')).toBe(true);
  });
});

describe('assertSafeEndpoint (IP-literal cases — deterministic)', () => {
  test('allows localhost model servers over http', async () => {
    expect(await assertSafeEndpoint('http://localhost:1234')).toEqual({ ok: true });
    expect(await assertSafeEndpoint('http://127.0.0.1:11434')).toEqual({ ok: true });
    expect(await assertSafeEndpoint('http://[::1]:8080')).toEqual({ ok: true });
  });
  test('refuses the IPv6 unspecified address', async () => {
    expect(await assertSafeEndpoint('http://[::]:8080')).toEqual({ ok: false, reason: 'private-address' });
  });
  test('blocks the cloud-metadata address and private ranges', async () => {
    expect(await assertSafeEndpoint('http://169.254.169.254/latest/meta-data')).toEqual({ ok: false, reason: 'private-address' });
    expect(await assertSafeEndpoint('http://10.0.0.5:9000')).toEqual({ ok: false, reason: 'private-address' });
    expect(await assertSafeEndpoint('http://192.168.1.1')).toEqual({ ok: false, reason: 'private-address' });
  });
  test('allows a public IP literal without any DNS lookup', async () => {
    expect(await assertSafeEndpoint('https://8.8.8.8/v1')).toEqual({ ok: true });
  });
  test('blocks an IPv4-mapped IPv6 metadata literal (SSRF bypass class)', async () => {
    expect(await assertSafeEndpoint('http://[::ffff:169.254.169.254]/latest/meta-data'))
      .toEqual({ ok: false, reason: 'private-address' });
  });
  test('rejects malformed URLs and non-http protocols', async () => {
    expect(await assertSafeEndpoint('not a url')).toEqual({ ok: false, reason: 'invalid-url' });
    expect(await assertSafeEndpoint('ftp://example.com')).toEqual({ ok: false, reason: 'bad-protocol' });
    expect(await assertSafeEndpoint('file:///etc/passwd')).toEqual({ ok: false, reason: 'bad-protocol' });
  });
});

// The DNS-rebinding branch needs a real resolver. Run it only when the network
// is available, and assert both directions against real DNS.
const netUp = await dns.resolve4('api.openai.com').then(() => true).catch(() => false);

describe.skipIf(!netUp)('assertSafeEndpoint (real DNS)', () => {
  test('resolves a public hostname and allows it when every address is public', async () => {
    expect(await assertSafeEndpoint('https://api.openai.com')).toEqual({ ok: true });
  });
  test('a resolved hostname is served from the resolution cache on the next turn', async () => {
    // Real DNS, no mocks: the first call populates the cache with REAL
    // addresses, the second is answered from it — the per-turn ~90-100ms
    // resolve4+resolve6 (measured on api.kimi.com, 2026-07-28) is paid once
    // per TTL, not once per turn.
    expect(await assertSafeEndpoint('https://api.kimi.com')).toEqual({ ok: true });
    const cached = cachedResolution('api.kimi.com');
    expect(cached).toBeDefined();
    expect(cached.addrs.length).toBeGreaterThan(0);
    expect(cached.addrs.every((a) => !isPrivateHost(a))).toBe(true);
    expect(await assertSafeEndpoint('https://api.kimi.com/coding/v1')).toEqual({ ok: true });
  });
});
