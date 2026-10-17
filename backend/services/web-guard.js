// Web-target SSRF guard — the rules for where a being's web tool may point.
//
// STRICTER than endpoint-guard.js on purpose: that guard allows localhost
// because model servers live there; THIS guard never does. A being fetching
// the rig's own loopback services (the backend's own API, LM Studio, anything
// bound to 127.0.0.1) would be a confused deputy reading itself — the web
// tool reaches OUTWARD only. Private ranges stay blocked, checked on the
// literal host AND on every DNS-resolved address (DNS rebinding).

import { promises as dns } from 'dns';
import { isPrivateHost } from './endpoint-guard.js';
import { stripBrackets, isIpLiteral } from './host-guard-common.js';

/**
 * True when a host string names the rig itself or private space. Unlike
 * endpoint-guard, the 'localhost' NAME is forbidden here — loopback in any
 * spelling. Pure.
 * @param {string} host
 */
export const isForbiddenWebHost = (host) => {
  if (typeof host !== 'string' || host.length === 0) return true; // no host, no fetch
  const h = stripBrackets(host.toLowerCase());
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  return isPrivateHost(h);
};

/**
 * Decide whether the web tool may fetch a URL — and hand back the vetted
 * addresses when it may. The fetch layer pins its connection to THESE
 * addresses (custom `lookup`), so the name is resolved exactly once: a
 * rebinding DNS server gets no second, unvetted answer. A name that
 * resolves nowhere fails CLOSED (an unvetted fallback resolution is exactly
 * the gap the pinning exists to close).
 * @param {string} target
 * @returns {Promise<{ok: true, addrs: Array<{address: string, family: number}>} | {ok: false, reason: string}>}
 */
// impure — DNS resolution
export const assertSafeWebTarget = async (target) => {
  let url;
  try { url = new URL(target); } catch { return { ok: false, reason: 'invalid-url' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'bad-protocol' };

  const host = url.hostname;
  if (isForbiddenWebHost(host)) return { ok: false, reason: 'forbidden-host' };

  // An IP literal needs no resolution — the vetted address is the literal.
  if (isIpLiteral(host)) {
    const address = stripBrackets(host);
    const family = address.includes(':') ? 6 : 4;
    return { ok: true, addrs: [{ address, family }] };
  }

  const [v4, v6] = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host)]);
  const addrs = [
    ...(v4.status === 'fulfilled' ? v4.value.map((address) => ({ address, family: 4 })) : []),
    ...(v6.status === 'fulfilled' ? v6.value.map((address) => ({ address, family: 6 })) : []),
  ];
  if (addrs.some((a) => isPrivateHost(a.address))) return { ok: false, reason: 'dns-rebind-private' };
  if (addrs.length === 0) return { ok: false, reason: 'unresolvable' };
  return { ok: true, addrs };
};

/**
 * Resolve a redirect Location against the URL that produced it. Pure —
 * returns the absolute next URL, or null when the header is unusable (the
 * fetch then stops honestly rather than guessing).
 * @param {string} currentUrl
 * @param {string|null|undefined} location
 */
export const nextRedirectUrl = (currentUrl, location) => {
  if (typeof location !== 'string' || location.trim() === '') return null;
  try {
    return new URL(location, currentUrl).toString();
  } catch {
    return null;
  }
};
