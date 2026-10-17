import { portalSourceBlocked, recordPortalMessage, recordRateLimitedRequest } from './security/traffic-monitor.js';

/**
 * Rate Limiter — In-memory sliding window rate limiting
 *
 * No external dependencies. Express middleware factory + WebSocket counter.
 */

/**
 * Create a sliding-window rate limiter Express middleware.
 * @param {{ windowMs: number, max: number, keyFn?: (req) => string }} options
 * @returns {Function} Express middleware
 */
export const createRateLimiter = ({ windowMs, max, keyFn }) => {
  const windows = new Map();

  // Periodic cleanup every windowMs to prevent memory leaks
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entries] of windows) {
      const valid = entries.filter(t => now - t < windowMs);
      if (valid.length === 0) {
        windows.delete(key);
      } else {
        windows.set(key, valid);
      }
    }
  }, windowMs);

  // Allow GC if the process shuts down
  if (cleanupInterval.unref) cleanupInterval.unref();

  const middleware = (req, res, next) => {
    const key = keyFn ? keyFn(req) : req.ip;
    const now = Date.now();

    let entries = windows.get(key) || [];
    // Remove expired entries
    entries = entries.filter(t => now - t < windowMs);

    if (entries.length >= max) {
      recordRateLimitedRequest(req);
      res.status(429).json({
        error: 'Too many requests',
        retryAfterMs: windowMs - (now - entries[0]),
      });
      return;
    }

    entries.push(now);
    windows.set(key, entries);
    next();
  };

  // Expose for testing
  middleware._windows = windows;
  middleware._cleanup = cleanupInterval;

  return middleware;
};

/**
 * Global API rate limiter: 200 requests per minute per wallet.
 *
 * NEUMA_RATE_GLOBAL_MAX widens the ceiling for an ISOLATED e2e stack only —
 * a Playwright run compresses hours of one witness's desk driving into
 * minutes on one wallet, and at the live ceiling the burst turns real
 * passes into 429 reds (root-close "TOO MANY REQUESTS", vanished git
 * badges — explorer-panel run 2026-07-24). A live stack never sets it; the
 * default IS the law, and the auth/brute-force limiters below have no door.
 */
const envCeiling = (name, fallback) => {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/**
 * The read tier's signal. PURE. One wallet drives the whole desk — the being's
 * stream churn, every open window's poller, BENCH's status/proof reads — and
 * at a flat 200/min the desk ate its own minute and painted a red TOO MANY
 * REQUESTS banner during a live proof run (2026-09-24, the same one-wallet
 * cadence that stormed the explorer on 2026-07-24). Reads with a session
 * attached are the desk's heartbeat, not the abuse this ceiling exists for:
 * idempotent methods (GET/HEAD/OPTIONS) carrying an Authorization bearer get
 * 600/min; everything else stays 200.
 *
 * The signal is PRESENCE, not validity — the limiter never verifies tokens
 * (requireAuth does, downstream, exactly once). A forged bearer riding the
 * read tier still dies at requireAuth, and 600/min of 401s is contained the
 * same as before. Writes never tier up: a POST spends CPU, tokens, or disk.
 *
 * NEUMA_RATE_GLOBAL_MAX stays the e2e-only single knob: when set, BOTH tiers
 * take the set value, exactly as the flat ceiling behaved before.
 */
const GLOBAL_READ_MAX = envCeiling('NEUMA_RATE_GLOBAL_MAX', 600);
const GLOBAL_WRITE_MAX = envCeiling('NEUMA_RATE_GLOBAL_MAX', 200);

/**
 * Is this request in the read tier? Idempotent method + bearer attached.
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export const isReadTierRequest = (req) =>
  ['GET', 'HEAD', 'OPTIONS'].includes(String(req?.method || '').toUpperCase())
  && typeof req?.headers?.authorization === 'string'
  && req.headers.authorization.startsWith('Bearer ');

/**
 * Each tier counts in its OWN window. One shared window let the desk's reads
 * fill past 200 and then refuse every write — /api is metered BEFORE auth, so
 * req.walletAddress is unset there and every local caller shares one IP
 * bucket: 160 git-status polls a minute turned uploads, sends and plane verbs
 * into TOO MANY REQUESTS (live 2026-09-25). Polling can never spend the
 * witness's acts.
 */
const readLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: GLOBAL_READ_MAX,
  keyFn: (req) => req.walletAddress || req.ip,
});
const writeLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: GLOBAL_WRITE_MAX,
  keyFn: (req) => req.walletAddress || req.ip,
});

export const globalLimiter = (req, res, next) => (
  isReadTierRequest(req) ? readLimiter(req, res, next) : writeLimiter(req, res, next)
);

/**
 * Paths under /api the global ceiling does not meter. PURE; `p` is
 * MOUNT-RELATIVE, because the limiter mounts at '/api' and Express strips that.
 *
 * THE GALLERY's bytes are not API calls. One screen of thumbnails is dozens of
 * GETs of local files, so at 200/min simply OPENING the gallery spent the
 * operator's whole minute: every tile came back black and the window said […] in red, while the desk's other polling starved behind it
 * (live, 2026-08-05). Auth still gates that route and the root allowlist still
 * bounds it to folders the operator explicitly granted — a disk read behind
 * both is not the abuse this ceiling exists for.
 *
 * Keep this list to routes that serve BYTES ALREADY ON DISK. Anything that
 * spends CPU, tokens, money, or reaches the network stays metered.
 *
 * @param {string} p mount-relative path, e.g. '/v1/gallery/file'
 * @returns {boolean}
 */
export const isUnmeteredApiPath = (p) => p === '/v1/gallery/file';

/**
 * Hold-to-talk transcription. PURE. Operator-initiated, auth still gates
 * the route. Explorer + HUD polls share the 200/min bucket and were 429ing
 * this POST — Space held, mic opened, no words (Design note, 2026-08-17.
 */
export const isVoiceTranscribePath = (method, p) =>
  String(method || '').toUpperCase() === 'POST' && p === '/v1/voice/transcribe';

/**
 * Explorer live refresh. PURE. GET /list re-reads one dir after a save or
 * a watch frame; GET /events is the SSE ear. Both sat in the 200/min
 * bucket with HUD polls — a save announced, listDir 429'd, the tree
 * stayed stale (Design note, 2026-08-17. GET /roots serves an in-memory array —
 * no CPU, no spawn — and metering it let a mid-storm mount strand the
 * tree on LOADING (audit, 2026-09-02). Auth still gates all three.
 */
export const isFilesLivePath = (method, p) =>
  String(method || '').toUpperCase() === 'GET'
  && (p === '/v1/user/files/list' || p === '/v1/user/files/events' || p === '/v1/user/files/roots');


/**
 * Essential GET status lights the live desk polls. PURE; method +
 * mount-relative path. Exact or bounded-segment match only — never a
 * prefix, never a query, never a write. Saturation of the 200/min API
 * bucket must not starve these, and they must not be unlimited.
 *
 *   GET /v1/health                              public liveness
 *   GET /v1/llm/provider                        local provider (SUBSTRATE)
 *   GET /v1/neuma/:neumaId/route/health         neuma ROUTE light
 *   GET /v1/witnesses/:vendor/:name/health      witness ROUTE light
 *
 * @param {string} method HTTP method
 * @param {string} p mount-relative path, e.g. '/v1/health'
 * @returns {boolean}
 */
export const isEssentialStatusPath = (method, p) => {
  if (String(method || '').toUpperCase() !== 'GET') return false;
  if (p === '/v1/health') return true;
  if (p === '/v1/llm/provider') return true;
  if (/^\/v1\/neuma\/[A-Za-z0-9_-]{1,96}\/route\/health$/.test(p)) return true;
  if (/^\/v1\/witnesses\/[^/]{1,96}\/[^/]{1,96}\/health$/.test(p)) return true;
  return false;
};

/**
 * Independent sliding-window budget for the four essential GET lights.
 * Finite on purpose: a scanner still 429s; a saturated general bucket
 * cannot turn the desk's status probes into false OFFLINE.
 */
export const STATUS_PROBE_MAX = 60;

export const statusLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: STATUS_PROBE_MAX,
  keyFn: (req) => req.walletAddress || req.ip,
});


/**
 * What actually guards /api: the global ceiling, minus the unmetered file
 * routes above, with the essential GET status lights on their own finite
 * budget so a spent 200/min bucket cannot starve the two desk lights.
 */
export const apiLimiter = (req, res, next) => (
  isUnmeteredApiPath(req.path)
    || isVoiceTranscribePath(req.method, req.path)
    || isFilesLivePath(req.method, req.path)
    ? next()
    : isEssentialStatusPath(req.method, req.path)
      ? statusLimiter(req, res, next)
      : globalLimiter(req, res, next)
);

/**
 * Auth rate limiter: 10 attempts per 5 minutes per IP.
 */
export const authLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 10,
  keyFn: (req) => req.ip,
});

/**
 * Neuma-auth limiter: the brute-force threat on /unlock is password guessing
 * PER KEYPAIR, so the bucket is keyed per (IP, being) — a HOUSE FOUNDING
 * types nine founders' passwords back to back, and under the flat per-IP
 * auth limiter the tenth legitimate request read as an attack (TOO MANY
 * REQUESTS, live founding 2026-07-23). Ten tries per being per window keeps
 * each password's exposure exactly as tight as before; the router already
 * stands behind wallet auth + fail-closed ownership, so an unauthenticated
 * caller never reaches this bucket's generosity. Requests without a
 * neumaId/address (unshaped bodies) fall to a per-path bucket.
 */
export const neumaAuthLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 10,
  keyFn: (req) => {
    const target = typeof req.body?.neumaId === 'string' ? req.body.neumaId
      : typeof req.body?.address === 'string' ? req.body.address
        : req.path;
    return `${req.ip}:${target}`;
  },
});

/**
 * The key a phone is metered by. On the native road (Road B) the identity
 * rides the socket, so the bucket is the DEVICE — every relay phone would
 * otherwise share one address-less bucket, and an attacker-supplied
 * X-Forwarded-For must never pick the key. Pure.
 * @param {import('express').Request} req
 * @returns {string}
 */
export const requestLimiterKey = (req) => req.socket?.neumaTunnel?.id || req.ip;

/**
 * Bridge limiter: generous, because the Electron→system-browser wallet bridge
 * polls for the token (~1 request / 2s). 120/min/IP comfortably covers polling
 * without the tight auth limiter starving it. localhost-bound. On the native
 * road the bucket is per device (requestLimiterKey).
 */
export const bridgeLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  keyFn: (req) => requestLimiterKey(req),
});

// --- WebSocket rate limiting ---

const WS_MSG_LIMIT = 30;
const WS_WINDOW_MS = 60 * 1000;

/**
 * Initialize WebSocket message rate tracking on a connection object.
 * Call once when the connection is established.
 * @param {Object} connection - Portal connection object
 */
export const initWsRateLimit = (connection) => {
  connection._msgCount = 0;
  connection._msgWindowStart = Date.now();
};

/**
 * Check if a WebSocket message should be rate-limited.
 * Resets the counter every minute. Returns true if the message should be held.
 * @param {Object} connection - Portal connection object
 * @returns {boolean} True if rate limit exceeded
 */
export const checkWsRateLimit = (connection) => {
  const now = Date.now();

  // Reset window
  if (now - (connection._msgWindowStart || 0) >= WS_WINDOW_MS) {
    connection._msgCount = 0;
    connection._msgWindowStart = now;
  }

  connection._msgCount = (connection._msgCount || 0) + 1;

  const limited = connection._msgCount > WS_MSG_LIMIT || portalSourceBlocked(connection);
  recordPortalMessage(connection, limited);
  return limited;
};
