/**
 * Endpoint safety guard (SSRF defense) for the model-routing surface.
 *
 * The whole point of routing is to let an operator point at ANY OpenAI-
 * compatible provider — z.ai, OpenRouter, DeepSeek, a self-hosted server — so a
 * fixed host allowlist (as the legacy /llm/test uses) is the wrong shape here.
 * Instead we ALLOW any public endpoint and BLOCK the dangerous targets:
 *   - cloud metadata / link-local  (169.254.*, fe80::/10)
 *   - loopback                     (127.*, ::1)  — except explicit localhost
 *   - RFC-1918 / ULA private ranges (10.*, 192.168.*, 172.16–31.*, fc00::/7)
 *   - the rest of RFC 6890 special space (100.64/10 CGNAT and tailnets,
 *     0/8, 198.18/15, multicast, 240/4) and its NAT64 / 6to4 / mapped forms
 * checked on the literal host AND on every DNS-resolved address, so a hostname
 * that resolves to a private IP (DNS rebinding) is refused too.
 *
 * Localhost is allowed explicitly so local model servers (LM Studio on :1234,
 * Ollama on :11434) keep working over http.
 */
import { promises as dns } from 'dns';
import { stripBrackets, isIpLiteral } from './host-guard-common.js';
import { isSpecialAddress } from './special-address-space.js';

/**
 * True when a host string is an IP address, in any spelling, in special-
 * purpose space: loopback, link-local, RFC-1918/ULA private, shared CGNAT,
 * benchmarking, multicast, reserved, and every IPv4-mapped, NAT64 or 6to4
 * embedding of those (special-address-space.js). A DNS name is never private
 * by its text. Pure — used both directly and on each DNS-resolved address.
 * @param {string} host
 * @returns {boolean}
 */
export const isPrivateHost = (host) => {
  if (typeof host !== 'string' || host.length === 0) return false;
  return isSpecialAddress(stripBrackets(host.toLowerCase()));
};

const isLocalhost = (host) => {
  const h = stripBrackets(host);
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
};

// Resolved-address cache: the guard ran a full resolve4+resolve6 on EVERY
// route resolution — measured 90-103ms per turn on cloud routes (api.kimi.com,
// 2026-07-28) before a single byte left the machine. The endpoints it guards
// are operator-locked provider hosts, not per-turn user input, and cached
// addresses still pass through isPrivateHost on every check — so a short TTL
// keeps the rebinding defense while taking the per-turn cost to ~0.
// Empty resolutions (transient DNS failure) are never cached: the next turn
// retries, and the fetch itself fails naturally if the outage persists.
const RESOLUTION_TTL_MS = 60_000;
const resolutionCache = new Map(); // hostname → { at, addrs }

/**
 * The cached resolution entry for a hostname (undefined when absent/expired).
 * Read-only inspection — diagnostics and tests.
 * @param {string} host
 * @returns {{ at: number, addrs: string[] }|undefined}
 */
export const cachedResolution = (host) => {
  const hit = resolutionCache.get(host);
  return hit && Date.now() - hit.at < RESOLUTION_TTL_MS ? hit : undefined;
};

// impure — DNS resolution (cached for RESOLUTION_TTL_MS on success)
const resolvePublicAddrs = async (host) => {
  const hit = cachedResolution(host);
  if (hit) return hit.addrs;
  const [v4, v6] = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host)]);
  const addrs = [
    ...(v4.status === 'fulfilled' ? v4.value : []),
    ...(v6.status === 'fulfilled' ? v6.value : []),
  ];
  if (addrs.length > 0) resolutionCache.set(host, { at: Date.now(), addrs });
  return addrs;
};

/**
 * Decide whether an endpoint is safe to fetch from. Async because it may resolve
 * DNS to defeat rebinding.
 * @param {string} endpoint
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
// impure — DNS resolution
export const assertSafeEndpoint = async (endpoint) => {
  let url;
  try { url = new URL(endpoint); } catch { return { ok: false, reason: 'invalid-url' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'bad-protocol' };

  const host = url.hostname;
  if (isLocalhost(host)) return { ok: true };            // local model servers
  if (isPrivateHost(host)) return { ok: false, reason: 'private-address' };

  // A non-literal hostname could resolve to a private IP — refuse if any of its
  // A OR AAAA records land in private space (an AAAA-only rebind to ULA/link-local
  // would slip past an A-record-only check).
  if (!isIpLiteral(host)) {
    // Unresolvable → not a proven private target; let the actual fetch fail
    // naturally rather than blocking a transient DNS hiccup.
    if ((await resolvePublicAddrs(host)).some(isPrivateHost)) return { ok: false, reason: 'dns-rebind-private' };
  }
  return { ok: true };
};
