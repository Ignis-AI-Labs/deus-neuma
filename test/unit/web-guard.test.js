import { describe, test, expect } from 'vitest';
import { isForbiddenWebHost, nextRedirectUrl, assertSafeWebTarget } from '../../backend/services/web-guard.js';

describe('isForbiddenWebHost (pure) — stricter than endpoint-guard', () => {
  test('the localhost NAME is forbidden here (endpoint-guard allows it for model servers)', () => {
    expect(isForbiddenWebHost('localhost')).toBe(true);
    expect(isForbiddenWebHost('api.localhost')).toBe(true);
    expect(isForbiddenWebHost('LOCALHOST')).toBe(true);
  });

  test('loopback, link-local, and private ranges in every spelling', () => {
    for (const h of ['127.0.0.1', '127.55.0.9', '::1', '[::1]', '0.0.0.0',
      '169.254.169.254', '10.0.0.4', '192.168.1.10', '172.16.0.1', '172.31.9.9',
      '::ffff:127.0.0.1', '::ffff:a9fe:a9fe']) {
      expect(isForbiddenWebHost(h)).toBe(true);
    }
  });

  test('public hosts pass; empty input is refused, never passed', () => {
    expect(isForbiddenWebHost('example.com')).toBe(false);
    expect(isForbiddenWebHost('172.32.0.1')).toBe(false);
    expect(isForbiddenWebHost('')).toBe(true);
    expect(isForbiddenWebHost(null)).toBe(true);
  });
});

describe('nextRedirectUrl (pure)', () => {
  test('absolute, relative, and protocol-relative targets resolve against the current URL', () => {
    expect(nextRedirectUrl('http://a.com/x', 'https://b.com/y')).toBe('https://b.com/y');
    expect(nextRedirectUrl('https://a.com/x/y', '/z')).toBe('https://a.com/z');
    expect(nextRedirectUrl('https://a.com/x/', '//b.com/c')).toBe('https://b.com/c');
  });

  test('missing or unusable Location → null (the fetch stops honestly)', () => {
    expect(nextRedirectUrl('https://a.com/', null)).toBeNull();
    expect(nextRedirectUrl('https://a.com/', '')).toBeNull();
    expect(nextRedirectUrl('https://a.com/', ' ')).toBeNull();
  });
});

describe('assertSafeWebTarget (real DNS where needed)', () => {
  test('refuses loopback and private literals, bad protocols, invalid urls', async () => {
    expect((await assertSafeWebTarget('http://127.0.0.1:8089/props')).ok).toBe(false);
    expect((await assertSafeWebTarget('http://localhost:1234/v1/models')).ok).toBe(false);
    expect((await assertSafeWebTarget('http://192.168.1.1/admin')).ok).toBe(false);
    expect((await assertSafeWebTarget('ftp://example.com/f')).reason).toBe('bad-protocol');
    expect((await assertSafeWebTarget('not a url')).reason).toBe('invalid-url');
  });

  test('a real public host passes and carries vetted addresses for the pinned lookup', async () => {
    const out = await assertSafeWebTarget('https://example.com/');
    expect(out.ok).toBe(true);
    expect(out.addrs.length).toBeGreaterThan(0);
    for (const a of out.addrs) {
      expect(a.address).toBeTruthy();
      expect([4, 6]).toContain(a.family);
    }
  });

  test('an IP literal vets itself — no resolution, family from the spelling', async () => {
    const v4 = await assertSafeWebTarget('http://93.184.216.34/');
    expect(v4).toEqual({ ok: true, addrs: [{ address: '93.184.216.34', family: 4 }] });
    const v6 = await assertSafeWebTarget('http://[2606:2800:220:1:248:1893:25c8:1946]/');
    expect(v6).toEqual({ ok: true, addrs: [{ address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }] });
  });
});
