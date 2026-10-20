/**
 * Special-purpose address space — the pure range law behind endpoint-guard's
 * isPrivateHost (and so behind web-guard and the web fetch's pinned lookup).
 *
 * An address is judged by its VALUE, never its spelling. The old prefix
 * checks read `127.` and `fe80:` as text, so a numeric spelling (`2130706433`,
 * `0x7f.1`), an embedding (NAT64 `64:ff9b::a00:1`, 6to4 `2002:a00:1::`) or a
 * block nobody listed (100.64/10, 198.18/15) passed as public (audit
 * 2026-10-19, G9). Here a host is parsed the way a resolver or URL parser
 * would read it and tested against the RFC 6890 special-purpose registry plus
 * multicast and reserved space. Pure throughout.
 */

// RFC 6890 IPv4 special-purpose blocks, plus multicast (224/4) and the
// reserved 240/4 (which holds the limited broadcast address).
const V4_SPECIAL = Object.freeze([
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => Object.freeze([base.split('.').reduce((acc, n) => acc * 256 + Number(n), 0), bits])));

// pure — one IPv4 part as a resolver reads it: decimal, 0-prefixed octal, or 0x hex.
const parseV4Part = (part) => {
  if (/^0x[0-9a-f]*$/i.test(part)) return part.length === 2 ? 0 : parseInt(part.slice(2), 16);
  if (/^0[0-7]+$/.test(part)) return parseInt(part, 8);
  if (/^(0|[1-9]\d*)$/.test(part)) return Number(part);
  return null;
};

/**
 * An IPv4 host in any spelling inet_aton and the URL parser accept — dotted,
 * one 32-bit number, or 2-3 part shorthand, each part decimal, octal or hex —
 * as its 32-bit value; null when the host is not IPv4.
 * @param {string} host
 * @returns {number|null}
 */
const parseIpv4 = (host) => {
  const parts = (host.endsWith('.') ? host.slice(0, -1) : host).split('.');
  if (parts.length > 4) return null;
  const nums = parts.map(parseV4Part);
  if (nums.some((n) => n === null || !Number.isSafeInteger(n))) return null;
  const last = nums.pop();
  if (nums.some((n) => n > 255) || last >= 256 ** (4 - nums.length)) return null;
  return nums.reduce((acc, n, i) => acc + n * 256 ** (3 - i), 0) + last;
};

/**
 * An IPv6 literal (zone id ignored, dotted IPv4 tail allowed) as its eight
 * 16-bit groups; null when the host is not IPv6.
 * @param {string} host
 * @returns {number[]|null}
 */
const parseIpv6 = (host) => {
  let h = host.split('%')[0];
  if (!h.includes(':')) return null;
  const cut = h.lastIndexOf(':') + 1;
  if (h.slice(cut).includes('.')) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(h.slice(cut))) return null;
    const v4 = h.slice(cut).split('.').map(Number);
    if (v4.some((n) => n > 255)) return null;
    h = `${h.slice(0, cut)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = h.split('::');
  if (halves.length > 2) return null;
  const groupsOf = (s) => (s === '' ? [] : s.split(':'));
  const head = groupsOf(halves[0]);
  const tail = halves.length === 2 ? groupsOf(halves[1]) : [];
  if ([...head, ...tail].some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  return [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((g) => parseInt(g, 16));
};

/**
 * Does a 32-bit IPv4 value lie in special-purpose space?
 * @param {number} v4
 * @returns {boolean}
 */
const isSpecialIpv4 = (v4) => V4_SPECIAL.some(([base, bits]) => {
  const size = 2 ** (32 - bits);
  return Math.floor(v4 / size) === Math.floor(base / size);
});

const allZero = (groups) => groups.every((g) => g === 0);

/**
 * Does an IPv6 address (eight groups) lie in special-purpose space? An
 * address that embeds an IPv4 one (mapped, translated, NAT64, 6to4) is judged
 * by the IPv4 address it reaches.
 * @param {number[]} g
 * @returns {boolean}
 */
const isSpecialIpv6 = (g) => {
  const low32 = g[6] * 65536 + g[7];
  if (allZero(g.slice(0, 5)) && g[5] === 0xffff) return isSpecialIpv4(low32); // ::ffff:0:0/96 mapped
  if (allZero(g.slice(0, 4)) && g[4] === 0xffff && g[5] === 0) return isSpecialIpv4(low32); // ::ffff:0:0:0/96 translated
  if (allZero(g.slice(0, 6))) return true; // ::/96 — unspecified, loopback, deprecated IPv4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b) return allZero(g.slice(2, 6)) ? isSpecialIpv4(low32) : g[2] === 1; // NAT64; 64:ff9b:1::/48 local-use
  if (g[0] === 0x2002) return isSpecialIpv4(g[1] * 65536 + g[2]); // 6to4
  if (g[0] === 0x100 && allZero(g.slice(1, 4))) return true; // 100::/64 discard-only
  if (g[0] === 0x2001 && (g[1] < 0x200 || g[1] === 0xdb8)) return true; // 2001::/23 IETF (Teredo, ORCHID…), 2001:db8::/32 documentation
  return (g[0] & 0xfe00) === 0xfc00 // fc00::/7 unique local
    || (g[0] & 0xff80) === 0xfe80 // fe80::/10 link-local and fec0::/10 site-local
    || (g[0] & 0xff00) === 0xff00; // ff00::/8 multicast
};

/**
 * Is this host an IP address (any spelling) in special-purpose space? A DNS
 * name is never special by its text — the guards resolve it and judge each
 * address.
 * @param {string} host - lowercased, brackets stripped
 * @returns {boolean}
 */
export const isSpecialAddress = (host) => {
  const v4 = parseIpv4(host);
  if (v4 !== null) return isSpecialIpv4(v4);
  const v6 = parseIpv6(host);
  return v6 !== null && isSpecialIpv6(v6);
};
