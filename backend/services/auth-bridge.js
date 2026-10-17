/**
 * System-browser auth bridge (WEB-001 / #126).
 *
 * Extracted verbatim from backend/services/auth.js (size-law breakdown):
 * the bridge session store, its lifecycle helpers, and the bridge router.
 * Token minting/verification stays in auth.js; this module only brokers a
 * minted token from the user's real browser back to Electron.
 */

import crypto from 'crypto';
import { verifySessionToken, CHALLENGE_CLEANUP_INTERVAL_MS } from './auth.js';

// --- System-browser bridge (WEB-001 / #126) ---
// Lets the Electron app authenticate with a wallet that only lives in the user's
// real browser (a Rabby/MetaMask extension Electron can't see). Electron starts a
// bridge, opens the system browser to /?bridge=<browserCode>; the browser
// authenticates normally and ASSOCIATES the minted token; Electron POLLS with a
// separate pollSecret to retrieve it. The token NEVER travels in a URL. The
// URL-exposed browserCode can only associate an already-valid token (HMAC-checked,
// first-association-wins); retrieval requires pollSecret, which never leaves
// Electron. TTL'd, one-time, localhost-bound. (The Electron client also confirms
// the retrieved address in-app before use — defeats any associate-injection
// race: a mismatched address is rejected before it becomes the session.)
// /start is intentionally unauthenticated (the browser side authenticates); the
// session map is bounded by the bridgeLimiter (120/min/IP) + TTL + a 1-min GC
// sweep, and the local-first launch is expected to bind loopback.
const bridgeSessions = new Map(); // browserCode -> { pollSecret, token, address, expiresAt }
const BRIDGE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes — the connect window

const _bridgeCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [code, s] of bridgeSessions) {
    if (now > s.expiresAt) bridgeSessions.delete(code);
  }
}, CHALLENGE_CLEANUP_INTERVAL_MS);
if (typeof _bridgeCleanupTimer.unref === 'function') _bridgeCleanupTimer.unref();

/**
 * Begin a bridge handoff. Returns two secrets: browserCode (safe in the browser
 * URL — can only ASSOCIATE) and pollSecret (kept by Electron — the only thing
 * that can RETRIEVE the token).
 * @returns {{ browserCode: string, pollSecret: string, expiresIn: number }}
 */
export const startBridgeSession = () => {
  const browserCode = crypto.randomBytes(24).toString('base64url');
  const pollSecret = crypto.randomBytes(32).toString('base64url');
  bridgeSessions.set(browserCode, { pollSecret, token: null, address: null, expiresAt: Date.now() + BRIDGE_EXPIRY_MS });
  return { browserCode, pollSecret, expiresIn: BRIDGE_EXPIRY_MS };
};

/**
 * Associate a freshly-minted session token with a bridge session. The token is
 * HMAC-validated first (a junk token can't poison the session), and the first
 * valid association wins (no overwrite races).
 * @returns {{ ok: true, address: string } | { ok: false, status: number, error: string }}
 */
export const associateBridgeToken = (browserCode, token) => {
  const session = bridgeSessions.get(browserCode);
  if (!session) return { ok: false, status: 404, error: 'Unknown or expired bridge session' };
  if (Date.now() > session.expiresAt) { bridgeSessions.delete(browserCode); return { ok: false, status: 410, error: 'Bridge session expired' }; }
  if (session.token) return { ok: false, status: 409, error: 'Bridge session already associated' };
  const verified = verifySessionToken(token);
  if (!verified) return { ok: false, status: 401, error: 'Invalid session token' };
  session.token = token;
  session.address = verified.address;
  return { ok: true, address: verified.address };
};

/**
 * Retrieve the associated token — gated on pollSecret (browserCode alone, which
 * is URL-exposed, can never retrieve). One-time: the session is consumed on a
 * successful read.
 * @returns {{ status: number, pending?: true, token?: string, address?: string, error?: string }}
 */
export const retrieveBridgeToken = (browserCode, pollSecret) => {
  const session = bridgeSessions.get(browserCode);
  if (!session) return { status: 404, error: 'Unknown bridge session' };
  if (Date.now() > session.expiresAt) { bridgeSessions.delete(browserCode); return { status: 410, error: 'Bridge session expired' }; }
  const a = Buffer.from(session.pollSecret, 'utf8');
  const b = Buffer.from(String(pollSecret || ''), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { status: 403, error: 'Bad bridge secret' };
  if (!session.token) return { status: 200, pending: true };
  const { token, address } = session;
  bridgeSessions.delete(browserCode); // one-time retrieval
  return { status: 200, token, address };
};

/** Test helper — clear all bridge sessions between tests. */
export const _clearBridgeSessions = () => bridgeSessions.clear();

/**
 * Bridge router — mount at /api/v1/auth/bridge, OUTSIDE the tight auth limiter
 * (Electron polls for the token, which would trip a 10/5min limiter). Security
 * model lives in startBridgeSession / associateBridgeToken / retrieveBridgeToken.
 */
export const createBridgeRouter = (express) => {
  const router = express.Router();

  // Electron begins the handoff and keeps both secrets.
  router.post('/start', (_req, res) => {
    res.json(startBridgeSession());
  });

  // The browser (which just authenticated) hands its token to the session.
  router.post('/associate', (req, res) => {
    const { browserCode, token } = req.body || {};
    if (!browserCode || !token) return res.status(400).json({ error: 'Missing browserCode or token' });
    const r = associateBridgeToken(browserCode, token);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true, address: r.address });
  });

  // Electron retrieves the token — gated on the pollSecret it never shared.
  router.get('/poll', (req, res) => {
    const browserCode = req.query.code;
    const pollSecret = req.headers['x-bridge-secret'];
    if (!browserCode || !pollSecret) return res.status(400).json({ error: 'Missing code or secret' });
    const r = retrieveBridgeToken(browserCode, pollSecret);
    if (r.error) return res.status(r.status).json({ error: r.error });
    if (r.pending) return res.json({ pending: true });
    res.json({ token: r.token, address: r.address });
  });

  return router;
};
