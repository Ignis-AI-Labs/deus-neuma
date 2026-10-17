/**
 * access-scope — who is on the other end of this request, decided BEFORE the
 * Host header is trusted.
 *
 * Faber's law (2026-08-01, its remote-access boundary test): […] A LAN peer that
 * says `Host: localhost` must not cross the local trust boundary, and a
 * rebound hostname (attacker.example resolving to 127.0.0.1) must not reach
 * the app on a loopback socket.
 *
 * Neuma binds loopback only (config.js HOST law) and reaches the tailnet
 * through Tailscale Serve, which proxies to loopback and stamps the caller's
 * tailnet address into X-Forwarded-For. The native road (Road B) adds a
 * third shape, the strongest of the three because its evidence is not a
 * header at all: a TLS socket our own tunnel admitted, carrying a
 * `neumaTunnel` marker no header can forge. Exactly three shapes are
 * trusted:
 *
 *   local   — loopback peer, no forwarding, a loopback Host
 *   remote  — loopback peer, exactly ONE forwarded address inside the
 *             tailnet ranges, and Host equal to the enrolled MagicDNS name
 *   tunnel  — a socket the tunnel marked: `{ pairingOnly }` (the ephemeral
 *             pairing listener) or `{ spki, id }` (a pinned device)
 *
 * A forwarded chain is refused outright: with more than one hop the caller
 * could choose which element is "trusted".
 *
 * PURE throughout — strings in, one frozen verdict out.
 */
import { isIP } from 'node:net';

const LOCAL_HOSTS = Object.freeze(new Set(['localhost', '127.0.0.1', '::1']));
// 100.64.0.0/10 — the CGNAT range Tailscale assigns.
const TAILNET_V4_FIRST = ((100 << 24) | (64 << 16)) >>> 0;
const TAILNET_V4_MASK = 0xffc00000;
// fd7a:115c:a1e0::/48 — Tailscale's ULA range.
const TAILNET_V6_PREFIX = Object.freeze([0xfd7a, 0x115c, 0xa1e0]);

/**
 * Strip an IPv6 zone and unwrap an IPv4-mapped IPv6 address
 * (`::ffff:127.0.0.1` → `127.0.0.1`), lowercased.
 * @param {unknown} address
 * @returns {string}
 */
export const unmapAddress = (address) => {
  const raw = String(address ?? '').trim().replace(/%.*$/, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(raw);
  return (mapped ? mapped[1] : raw).toLowerCase();
};

const ipv4ToInt = (ip) =>
  ip.split('.').reduce((acc, octet) => ((acc << 8) | Number(octet)) >>> 0, 0);

/**
 * Eight hextets, or null when the text is not a well-formed IPv6 address.
 * @param {string} ip
 * @returns {number[] | null}
 */
const expandIpv6 = (ip) => {
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  if (left.length + right.length > 8) return null;
  const fill = halves.length === 2 ? new Array(8 - left.length - right.length).fill('0') : [];
  const parts = [...left, ...fill, ...right];
  if (parts.length !== 8) return null;
  const nums = parts.map((part) => parseInt(part || '0', 16));
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? nums : null;
};

/**
 * @param {unknown} address
 * @returns {boolean}
 */
export const isLoopbackAddress = (address) => {
  const ip = unmapAddress(address);
  const family = isIP(ip);
  if (family === 4) return ip.startsWith('127.');
  if (family !== 6) return false;
  const hextets = expandIpv6(ip);
  return hextets !== null && hextets.slice(0, 7).every((n) => n === 0) && hextets[7] === 1;
};

/**
 * Inside Tailscale's IPv4 or IPv6 range.
 * @param {unknown} address
 * @returns {boolean}
 */
export const isTailnetAddress = (address) => {
  const ip = unmapAddress(address);
  const family = isIP(ip);
  if (family === 4) return ((ipv4ToInt(ip) & TAILNET_V4_MASK) >>> 0) === TAILNET_V4_FIRST;
  if (family !== 6) return false;
  const hextets = expandIpv6(ip);
  return hextets !== null && TAILNET_V6_PREFIX.every((value, i) => hextets[i] === value);
};

/**
 * The hostname of a Host header: port dropped, IPv6 brackets unwrapped,
 * lowercased. Null when empty or malformed.
 * @param {unknown} host
 * @returns {string | null}
 */
export const parseHostHeader = (host) => {
  const raw = String(host ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end > 1 ? raw.slice(1, end) : null;
  }
  // A bare IPv6 literal carries no port; anything with one colon may.
  if (raw.split(':').length > 2) return raw;
  const colon = raw.lastIndexOf(':');
  const name = colon === -1 ? raw : raw.slice(0, colon);
  return name || null;
};

/**
 * @param {unknown} header  the raw X-Forwarded-For value
 * @returns {string[]}
 */
export const parseForwardedFor = (header) =>
  String(header ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);

const verdict = (scope, peer, reason) => Object.freeze({ scope, peer, reason });

/**
 * The verdict for one request. The tunnel marker, when present, decides
 * FIRST — it is evidence from our own TLS layer, stronger than anything a
 * header could claim, and a tunnel socket need not be loopback at all.
 * @param {{ remoteAddress?: unknown, forwardedFor?: unknown, host?: unknown, enrolledHost?: unknown, tunnel?: { pairingOnly?: true, spki?: string, id?: string } | null }} input
 *   `enrolledHost` is the MagicDNS name remote access was enabled on, or
 *   null/empty while remote access is off.
 * @returns {{ scope: 'local' | 'remote' | 'pairing' | null, peer: string, reason: string }}
 */
export const classifyAccess = ({ remoteAddress, forwardedFor, host, enrolledHost, tunnel = null }) => {
  if (tunnel?.pairingOnly) return verdict('pairing', 'pairing-listener', 'ephemeral pairing socket');
  if (tunnel?.spki) return verdict('remote', String(tunnel.id ?? 'tunnel'), 'pinned tunnel device');
  const peer = unmapAddress(remoteAddress);
  if (!isLoopbackAddress(peer)) return verdict(null, peer, 'peer is not loopback');
  const hostname = parseHostHeader(host);
  const forwarded = parseForwardedFor(forwardedFor);
  if (forwarded.length === 0) {
    return LOCAL_HOSTS.has(hostname)
      ? verdict('local', peer, 'loopback peer, local host')
      : verdict(null, peer, 'host is not local');
  }
  if (forwarded.length > 1) return verdict(null, peer, 'forwarded chain');
  const via = unmapAddress(forwarded[0]);
  if (!isTailnetAddress(via)) return verdict(null, via, 'forwarded peer is not on the tailnet');
  const enrolled = String(enrolledHost ?? '').trim().toLowerCase();
  if (!enrolled) return verdict(null, via, 'remote access is disabled');
  if (hostname !== enrolled) return verdict(null, via, 'host is not the enrolled origin');
  return verdict('remote', via, 'tailnet peer via serve, enrolled host');
};

/**
 * For a state-changing remote request: the Origin a browser sent must name
 * the host it is talking to. An absent Origin is a non-browser client and
 * passes; an opaque `null` Origin is a cross-site page and does not.
 * @param {unknown} origin
 * @param {unknown} host
 * @returns {boolean}
 */
export const originMatchesHost = (origin, host) => {
  if (origin === undefined || origin === null || origin === '') return true;
  try {
    return parseHostHeader(new URL(String(origin)).host) === parseHostHeader(host);
  } catch {
    return false;
  }
};
