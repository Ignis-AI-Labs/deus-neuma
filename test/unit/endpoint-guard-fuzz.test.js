/**
 * The SSRF range law, fuzzed (security seat G9, audit 2026-10-19). Every
 * RFC 6890 special-purpose block — plus multicast and reserved space — is
 * private in every spelling a resolver or URL parser accepts: dotted, one
 * decimal number, octal, hex, shorthand, IPv4-mapped, IPv4-translated,
 * deprecated-compatible, NAT64 and 6to4. A fixed sample of public addresses
 * stays public in the same spellings. Seeded, so a red run replays exactly.
 *
 * Real functions on real inputs: isPrivateHost directly, and assertSafeEndpoint
 * through the real WHATWG URL parser (IP literals only — no DNS, no network).
 */
import { describe, test, expect } from 'vitest';
import { isPrivateHost, assertSafeEndpoint } from '../../backend/services/endpoint-guard.js';
import { isForbiddenWebHost } from '../../backend/services/web-guard.js';

const SEED = 0x6890;
const PER_BLOCK = 24;

// mulberry32 — a tiny seeded PRNG, so the fuzz needs no dependency.
const prng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const V4_BLOCKS = Object.freeze([
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]);

const V4_PUBLIC = Object.freeze([
  '8.8.8.8', '1.1.1.1', '9.9.9.9', '11.0.0.1', '100.63.255.255', '100.128.0.0', '126.255.255.255',
  '128.0.0.1', '169.253.255.255', '172.15.255.255', '172.32.0.0', '192.0.1.255', '192.88.98.255',
  '192.169.0.0', '198.17.255.255', '198.20.0.0', '203.0.112.255', '223.255.255.255', '1.0.0.0',
]);

const V6_PUBLIC = Object.freeze([
  '2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001:80b::200e', '2001:200::1',
  '2003::1', 'fbff:ffff::1', 'fe7f::1', '2400:cb00::1', '64:ff9c::a00:1', '101::1',
]);

const toV4Value = (dotted) => dotted.split('.').reduce((acc, n) => acc * 256 + Number(n), 0);
const octets = (v) => [24, 16, 8, 0].map((s) => Math.floor(v / 2 ** s) % 256);
const hex4 = (n) => n.toString(16);

// Every spelling of one IPv4 value: the ones the URL parser reads, plus the
// IPv6 embeddings that reach the same address.
const v4Spellings = (v) => {
  const [a, b, c, d] = octets(v);
  const hi = (a << 8) | b;
  const lo = (c << 8) | d;
  return [
    `${a}.${b}.${c}.${d}`,
    String(v),
    `0x${v.toString(16)}`,
    [a, b, c, d].map((n) => `0${n.toString(8)}`).join('.'),
    [a, b, c, d].map((n) => `0x${n.toString(16)}`).join('.'),
    `${a}.${(b << 16) + lo}`,
    `${a}.${b}.${lo}`,
    `${a}.${b}.${c}.${d}.`,
    `::ffff:${a}.${b}.${c}.${d}`,
    `::ffff:${hex4(hi)}:${hex4(lo)}`,
    `0:0:0:0:0:ffff:${hex4(hi)}:${hex4(lo)}`,
    `::ffff:0:${hex4(hi)}:${hex4(lo)}`,
    `64:ff9b::${a}.${b}.${c}.${d}`,
    `64:ff9b::${hex4(hi)}:${hex4(lo)}`,
    `2002:${hex4(hi)}:${hex4(lo)}::1`,
    `[2002:${hex4(hi)}:${hex4(lo)}:abcd::]`,
    `[::FFFF:${hex4(hi).toUpperCase()}:${hex4(lo).toUpperCase()}]`,
  ];
};

// The spellings a URL can carry as its host (bare IPv6 needs brackets there).
const urlHost = (spelling) => (spelling.includes(':') && !spelling.startsWith('[') ? `[${spelling}]` : spelling);

const rand16 = (r, mask = 0xffff) => Math.floor(r() * 65536) & mask;

// IPv6 special blocks: [label, the leading groups of a random member]
const V6_BLOCKS = Object.freeze([
  ['fc00::/7', (r) => [0xfc00 | rand16(r, 0x1ff)]],
  ['fe80::/10', (r) => [0xfe80 | rand16(r, 0x3f)]],
  ['fec0::/10', (r) => [0xfec0 | rand16(r, 0x3f)]],
  ['ff00::/8', (r) => [0xff00 | rand16(r, 0xff)]],
  ['2001::/23', (r) => [0x2001, rand16(r, 0x1ff)]],
  ['2001:db8::/32', () => [0x2001, 0xdb8]],
  ['100::/64', () => [0x100, 0, 0, 0]],
  ['64:ff9b:1::/48', () => [0x64, 0xff9b, 1]],
  ['::/96', () => [0, 0, 0, 0, 0, 0]],
]);

// Full, upper-case, bracketed, zero-padded, and compressed at the longest zero run.
const v6Spellings = (groups) => {
  const full = groups.map(hex4).join(':');
  const spellings = [full, full.toUpperCase(), `[${full}]`, groups.map((g) => g.toString(16).padStart(4, '0')).join(':')];
  let best = { at: -1, len: 1 };
  for (let i = 0; i < 8; i += 1) {
    let len = 0;
    while (i + len < 8 && groups[i + len] === 0) len += 1;
    if (len > best.len) best = { at: i, len };
  }
  if (best.at >= 0) {
    spellings.push(`${groups.slice(0, best.at).map(hex4).join(':')}::${groups.slice(best.at + best.len).map(hex4).join(':')}`);
  }
  return spellings;
};

// The deprecated IPv4-compatible form (::a.b.c.d) is special space whatever it embeds.
const compatSpelling = (v) => `::${octets(v).join('.')}`;

describe('isPrivateHost — every RFC 6890 IPv4 block, every spelling (seeded fuzz)', () => {
  const r = prng(SEED);
  for (const [base, bits] of V4_BLOCKS) {
    test(`${base}/${bits}`, async () => {
      const size = 2 ** (32 - bits);
      const values = [toV4Value(base), toV4Value(base) + size - 1,
        ...Array.from({ length: PER_BLOCK }, () => toV4Value(base) + Math.floor(r() * size))];
      for (const v of values) {
        for (const spelling of [...v4Spellings(v), compatSpelling(v)]) {
          expect(isPrivateHost(spelling), spelling).toBe(true);
          expect(isForbiddenWebHost(spelling), spelling).toBe(true);
        }
        for (const spelling of v4Spellings(v).filter((s) => !s.endsWith('.'))) {
          const verdict = await assertSafeEndpoint(`http://${urlHost(spelling)}:8080/v1`);
          // localhost is the guard's own allowance for model servers; every
          // other spelling of special space is refused before any fetch.
          if (verdict.ok) expect(new URL(`http://${urlHost(spelling)}/`).hostname, spelling).toMatch(/^(127\.0\.0\.1|\[::1\])$/);
          else expect(verdict.reason, spelling).toBe('private-address');
        }
      }
    });
  }
});

describe('isPrivateHost — every IPv6 special block, every spelling (seeded fuzz)', () => {
  const r = prng(SEED + 1);
  for (const [label, prefix] of V6_BLOCKS) {
    test(label, async () => {
      for (let i = 0; i < PER_BLOCK; i += 1) {
        const head = prefix(r);
        const groups = [...head, ...Array.from({ length: 8 - head.length }, () => (r() < 0.3 ? 0 : rand16(r)))];
        for (const spelling of v6Spellings(groups)) {
          expect(isPrivateHost(spelling), spelling).toBe(true);
        }
        const verdict = await assertSafeEndpoint(`http://${urlHost(groups.map(hex4).join(':'))}/`);
        if (verdict.ok) expect(groups.map(hex4).join(':')).toBe('0:0:0:0:0:0:0:1');
        else expect(verdict.reason).toBe('private-address');
      }
    });
  }

  test('the named points: unspecified, loopback, the metadata address via NAT64 and 6to4', () => {
    for (const h of ['::', '::1', '[::]', 'fe80::1%eth0', '64:ff9b::169.254.169.254', '2002:a9fe:a9fe::1',
      '2002:6440:1::', '64:ff9b::100.100.100.100', '::ffff:100.64.0.1', '::127.0.0.1', '::8.8.8.8']) {
      expect(isPrivateHost(h), h).toBe(true);
    }
  });
});

describe('isPrivateHost — public space stays public in the same spellings', () => {
  test.each(V4_PUBLIC)('%s', async (dotted) => {
    for (const spelling of v4Spellings(toV4Value(dotted))) {
      expect(isPrivateHost(spelling), spelling).toBe(false);
    }
    expect(await assertSafeEndpoint(`https://${dotted}/v1`)).toEqual({ ok: true });
  });

  test.each(V6_PUBLIC)('%s', async (h) => {
    expect(isPrivateHost(h)).toBe(false);
    expect(isPrivateHost(`[${h}]`)).toBe(false);
    expect(await assertSafeEndpoint(`https://[${h}]/v1`)).toEqual({ ok: true });
  });

  test('a DNS name is never private by its text — the guards resolve and judge each address', () => {
    for (const h of ['10.example.com', '127.foo.dev', 'fd-example.com', 'fcc.gov', 'api.openai.com', 'localhost']) {
      expect(isPrivateHost(h), h).toBe(false);
    }
  });
});
