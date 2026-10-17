// Pure validation for a user-supplied RPC URL.
//
// The custom RPC is used in the MAIN process both to read balances and to
// BROADCAST the witness's transactions, so a planted URL must not be able to
// turn this machine into an SSRF proxy for internal services. We mirror the
// backend's SSRF posture (backend/routes/llm-routes.js) but ALLOW loopback —
// the user may legitimately run their own node locally.
//
// We validate the host with node:net rather than regex-on-string alone: the
// WHATWG URL parser already canonicalizes decimal/hex/octal IPv4 (so
// http://2852039166 arrives as 169.254.169.254), and net.isIP lets us catch
// IPv4-mapped IPv6 (::ffff:a.b.c.d) which a string regex misses.
//
// Residual gap: a public hostname that RESOLVES to a private IP (DNS rebinding)
// is not caught here — the user controls their own RPC and `set` is gated by a
// native confirm, so the risk is low; a resolve-time check is the follow-up if
// third-party URLs are ever accepted.

const net = require('node:net');

const PRIVATE_V4 = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,                                 // link-local incl. cloud metadata 169.254.169.254
  /^0\./,                                         // "this network"
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,    // CGNAT 100.64.0.0/10
];

// A canonical dotted-decimal IPv4 in a blocked range. 127.0.0.0/8 is loopback
// and intentionally NOT blocked (a local node is allowed).
const isBlockedV4 = (ip) => PRIVATE_V4.some((re) => re.test(ip));

/**
 * Embedded IPv4 of an IPv4-mapped IPv6 address, else null. Node's WHATWG URL
 * serializer emits the HEX form (e.g. [::ffff:169.254.169.254] -> ::ffff:a9fe:a9fe,
 * pinned by a test in rpc-url.test.js), so the hex branch is the live path for URL
 * input; the dotted branch is defense-in-depth for a directly-supplied dotted host.
 * Both branches are exercised by embeddedV4 unit tests.
 * @param {string} ip6 - an IPv6 host, brackets already stripped and lowercased
 * @returns {string|null} dotted-decimal IPv4 when mapped/compatible, else null
 */
const embeddedV4 = (ip6) => {
  const dotted = ip6.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  const hex = ip6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return null;
};

/**
 * Validate a user RPC URL for safe use as a main-process provider.
 * @param {string} url
 * @returns {{ok:true,url:string}|{ok:false,error:string}}
 */
const validateRpcUrl = (url) => {
  const raw = String(url ?? '').trim();
  if (!raw) return { ok: false, error: 'Enter an RPC URL.' };

  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: 'That is not a valid URL.' };
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: 'RPC URL must start with http:// or https://.' };
  }

  const host = u.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (!host) return { ok: false, error: 'RPC URL has no host.' };

  const blocked = { ok: false, error: 'RPC URL must not point at a private or link-local address.' };
  const kind = net.isIP(host);

  if (kind === 4) {
    return isBlockedV4(host) ? blocked : { ok: true, url: raw };
  }

  if (kind === 6) {
    if (host === '::1') return { ok: true, url: raw };                        // loopback
    const v4 = embeddedV4(host);                                              // IPv4-mapped → judge the embedded v4
    if (v4) return isBlockedV4(v4) ? blocked : { ok: true, url: raw };
    if (/^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host === '::') return blocked; // ULA / link-local / unspecified
    return { ok: true, url: raw };                                            // public IPv6
  }

  // Not an IP literal — a hostname (incl. localhost). Allowed; a name that
  // resolves to a private IP is the residual DNS-rebinding gap noted above.
  return { ok: true, url: raw };
};

module.exports = { validateRpcUrl, embeddedV4 };
