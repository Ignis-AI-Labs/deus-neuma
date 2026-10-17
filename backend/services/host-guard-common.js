// Host-string parsing helpers shared by the two SSRF guards —
// endpoint-guard.js (model routing) and web-guard.js (the being web tool).
//
// PARSING ONLY. The guards' POLICIES stay separate by law: endpoint-guard
// allows localhost (model servers live there), web-guard blocks loopback in
// every spelling (the web tool reaches outward only). Policy never moves here.

/**
 * Strip the brackets URL.hostname keeps on an IPv6 literal ([::1] → ::1).
 * @param {string} h
 * @returns {string}
 */
export const stripBrackets = (h) => (h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h);

/**
 * True when a host string is an IP literal (dotted IPv4, or anything with a
 * colon — IPv6) rather than a DNS name.
 * @param {string} host
 * @returns {boolean}
 */
export const isIpLiteral = (host) => {
  const h = stripBrackets(host);
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':');
};
