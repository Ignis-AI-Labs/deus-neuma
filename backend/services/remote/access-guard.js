/**
 * access-guard — the request gate, once for HTTP and once for the upgrade.
 *
 * Express middleware never sees a WebSocket upgrade, and a socket is exempt
 * from the browser's same-origin policy, so the SAME decision runs in both
 * places from the SAME pure function (accessDecision). The decision reads the
 * remote store's cached state — never disk, never an await — because it sits
 * on every request.
 *
 * What each scope requires:
 *   local  — a loopback peer with a loopback Host (access-scope.js); nothing
 *            else changes for it. Remote access OFF leaves local exactly as
 *            it was.
 *   remote — a tailnet peer through Serve on the enrolled origin, plus the
 *            device cookie on everything except the enrolment road itself,
 *            plus Origin === Host on anything that can change state; OR a
 *            pinned tunnel device (Road B), whose identity rides the socket
 *            and needs no cookie at all.
 *
 * `requireLocalScope` is the local-only tier: minting, host-OS acts, quit.
 */
import { classifyAccess, originMatchesHost } from './access-scope.js';
import { remoteStore } from './remote-store.js';
import { DEVICE_COOKIE, findDevice, findDeviceBySpki, readCookie } from './pairing.js';
import { createLogger } from '../logger.js';

const log = createLogger('RemoteGate');

export const ENROLL_PREFIX = '/r/';
const SAFE_METHODS = Object.freeze(new Set(['GET', 'HEAD', 'OPTIONS']));

const refusal = (status, error, reason = error) =>
  Object.freeze({ allow: false, scope: null, status, error, reason, device: null });
const admission = (scope, device = null) =>
  Object.freeze({ allow: true, scope, status: 200, error: null, reason: null, device });

/**
 * The verdict for one request or upgrade. Pure. The tunnel marker — set by
 * our own TLS layer on a socket it admitted — is checked first and is the
 * only road where the device is read from the socket rather than a cookie.
 * A pairing socket reaches exactly one door: POST /r/claim.
 * @param {{ headers: Record<string, unknown>, remoteAddress: unknown, method: string, path: string, state: object, now?: number, tunnel?: object | null }} input
 * @returns {{ allow: boolean, scope: 'local' | 'remote' | null, status: number, error: string | null, device: object | null }}
 */
export const accessDecision = ({ headers, remoteAddress, method, path, state, now = Date.now(), tunnel = null }) => {
  const verdict = classifyAccess({
    remoteAddress,
    forwardedFor: headers['x-forwarded-for'],
    host: headers.host,
    enrolledHost: state.enabled ? state.origin : null,
    tunnel,
  });
  if (verdict.scope === 'local') return admission('local');
  if (verdict.scope === 'pairing') {
    if (path === '/r/claim' && String(method).toUpperCase() === 'POST') return admission('remote');
    return refusal(403, 'the pairing road carries the claim only', verdict.reason);
  }
  if (tunnel?.spki) {
    // The row is looked up LIVE, never from the marker: a revocation on the
    // desk must cut the device on the very next request or frame (I8).
    const device = findDeviceBySpki(state.devices, tunnel.spki, now);
    if (!device) return refusal(403, 'unauthorized', 'tunnel device revoked or unknown');
    if (!SAFE_METHODS.has(String(method).toUpperCase()) && !originMatchesHost(headers.origin, headers.host)) {
      return refusal(403, 'cross-origin request blocked');
    }
    return admission('remote', device);
  }
  if (verdict.scope === null) {
    return refusal(403, state.enabled ? 'untrusted network peer' : 'remote access is disabled', `${verdict.reason} (peer ${verdict.peer})`);
  }
  if (path.startsWith(ENROLL_PREFIX)) return admission('remote');
  const device = findDevice(state.devices, readCookie(headers.cookie, DEVICE_COOKIE), now);
  if (!device) return refusal(403, 'unauthorized');
  if (!SAFE_METHODS.has(String(method).toUpperCase()) && !originMatchesHost(headers.origin, headers.host)) {
    return refusal(403, 'cross-origin request blocked');
  }
  return admission('remote', device);
};

const decide = (req, store) => accessDecision({
  headers: req.headers,
  remoteAddress: req.socket?.remoteAddress,
  method: req.method,
  path: String(req.url ?? '').split('?')[0],
  state: store.get(),
  tunnel: req.socket?.neumaTunnel ?? null,
});

/**
 * Build the guard against a store — the default instance below uses the
 * real one; tests build theirs against a tmp file.
 * @param {{ store?: ReturnType<import('./remote-store.js').createRemoteStore> }} [opts]
 */
export const createAccessGuard = ({ store = remoteStore } = {}) => ({
  /** Express middleware: refuse or stamp `req.accessScope` and `req.remoteDevice`. */
  middleware: (req, res, next) => {
    const decision = decide(req, store);
    if (!decision.allow) {
      // Never a silent drop: a tailnet ACL, a proxy hop, or a bad cookie each
      // look the same from the phone. The reason is here, not on the wire.
      log.debug('request refused', { reason: decision.reason, method: req.method, path: String(req.url ?? '').split('?')[0] });
      res.status(decision.status).json({ error: decision.error });
      return;
    }
    req.accessScope = decision.scope;
    req.remoteDevice = decision.device;
    next();
  },
  /** The same decision for a raw upgrade request. */
  upgradeAccess: (req) => decide(req, store),
  /** The Origin the served origin presents on an upgrade, while enabled. */
  servedOrigin: () => {
    const state = store.get();
    return state.enabled && state.origin ? `https://${state.origin}` : null;
  },
});

const defaultGuard = createAccessGuard();

export const accessScopeMiddleware = defaultGuard.middleware;
export const upgradeAccess = defaultGuard.upgradeAccess;
export const servedOrigin = defaultGuard.servedOrigin;

/**
 * The local-only tier. A paired phone can use the app but never read or mint
 * the capability, never act on the host OS, and never strand itself.
 */
export const requireLocalScope = (req, res, next) => {
  if (req.accessScope === 'local') {
    next();
    return;
  }
  res.status(403).json({ error: 'local only' });
};
