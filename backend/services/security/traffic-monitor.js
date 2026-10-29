import { performance } from 'perf_hooks';
import { createLogger, getRecentIssues } from '../logger.js';
import { issuesForHouse } from '../house-issue-feed.js';
import { circuitBreaker, isLoopbackSource, normalizeSource } from './circuit-breaker.js';

const log = createLogger('Security.Traffic');
const RING_MAX = 5_000;
const SOURCE_WINDOW_MS = 60_000;
const SOURCE_MAX = 2_000;
const SIGNAL_COOLDOWN_MAX = SOURCE_MAX * 4;
const SIGNAL_COOLDOWN_MS = 60_000;
const MAX_WINDOW_SECONDS = 15 * 60;
const RECORDED_EARLY = Symbol('securityTrafficRecordedEarly');

const statusClass = (status) => `${Math.floor(Number(status) / 100) || 0}xx`;
const boundedMethod = (value) => String(value || 'UNKNOWN').toUpperCase().slice(0, 12);

/** Low-cardinality path with no query string or user-supplied identifiers. Pure. */
export const normalizeTrafficPath = (value) => {
  const pathname = String(value || '/').split('?')[0].slice(0, 300);
  return pathname
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, ':id')
    .replace(/\b0x[0-9a-f]{16,}\b/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, '/:id')
    .slice(0, 180) || '/';
};

/** One bounded traffic event; headers, query strings, and bodies never enter. Pure. */
export const normalizeTrafficEvent = (raw, nowMs = Date.now()) => {
  const atMs = Number.isFinite(raw?.atMs) ? raw.atMs : nowMs;
  const source = normalizeSource(raw?.source);
  const status = Number.isInteger(raw?.status) ? raw.status : 0;
  return Object.freeze({
    at: new Date(atMs).toISOString(),
    atMs,
    source,
    sourceClass: source ? (isLoopbackSource(source) ? 'loopback' : 'remote') : 'unknown',
    method: boundedMethod(raw?.method),
    path: normalizeTrafficPath(raw?.path),
    status,
    statusClass: statusClass(status),
    durationMs: Math.max(0, Math.min(Number(raw?.durationMs) || 0, 300_000)),
    transport: raw?.transport === 'portal' ? 'portal' : 'http',
    blocked: raw?.blocked === true,
  });
};

/** Deterministic signals from one source's latest minute. Pure. */
export const detectTrafficSignals = (events, nowMs = Date.now()) => {
  const sinceMinute = nowMs - SOURCE_WINDOW_MS;
  const sinceTenSeconds = nowMs - 10_000;
  const distinctPaths = new Set();
  let requestsTenSeconds = 0;
  let unauthorized = 0;
  let notFound = 0;
  let rateLimited = 0;
  let serverErrors = 0;
  for (const event of events || []) {
    if (event.atMs < sinceMinute) continue;
    distinctPaths.add(event.path);
    if (event.atMs >= sinceTenSeconds) requestsTenSeconds += 1;
    if (event.status === 401 || event.status === 403) unauthorized += 1;
    if (event.status === 404) notFound += 1;
    if (event.status === 429) rateLimited += 1;
    if (event.status >= 500) serverErrors += 1;
  }
  const signals = [];
  if (requestsTenSeconds >= 600) signals.push(Object.freeze({
    type: 'remote_flood', severity: 'critical', count: requestsTenSeconds,
    detail: `${requestsTenSeconds} requests in 10 seconds`,
  }));
  if (unauthorized >= 80 && distinctPaths.size >= 5) signals.push(Object.freeze({
    type: 'credential_probe', severity: 'critical', count: unauthorized,
    detail: `${unauthorized} authorization failures across ${distinctPaths.size} paths in 60 seconds`,
  }));
  if (notFound >= 120 && distinctPaths.size >= 40) signals.push(Object.freeze({
    type: 'path_scan', severity: 'critical', count: notFound,
    detail: `${notFound} misses across ${distinctPaths.size} paths in 60 seconds`,
  }));
  if (rateLimited >= 80) signals.push(Object.freeze({
    type: 'rate_limit_abuse', severity: 'critical', count: rateLimited,
    detail: `${rateLimited} requests continued after rate limiting in 60 seconds`,
  }));
  if (serverErrors >= 30) signals.push(Object.freeze({
    type: 'server_error_spike', severity: 'high', count: serverErrors,
    detail: `${serverErrors} server errors in 60 seconds; diagnose before attributing intent`,
  }));
  return Object.freeze(signals);
};

/** Process-lifetime request instrument with bounded memory and deterministic alerts. */
export const createTrafficMonitor = ({
  now = Date.now,
  onCritical = ({ source, signal }) => circuitBreaker.autoContain({ source, signal: signal.detail }),
} = {}) => {
  const ring = [];
  const bySource = new Map();
  const signalCooldown = new Map();
  let ringStart = 0;

  const orderedRing = () => ring.length < RING_MAX || ringStart === 0
    ? ring
    : [...ring.slice(ringStart), ...ring.slice(0, ringStart)];

  const record = (raw) => {
    const instant = now();
    const event = normalizeTrafficEvent(raw, instant);
    if (ring.length < RING_MAX) ring.push(event);
    else {
      ring[ringStart] = event;
      ringStart = (ringStart + 1) % RING_MAX;
    }
    if (event.source) {
      const sourceEvents = bySource.get(event.source) || [];
      sourceEvents.push(event);
      const firstFresh = sourceEvents.findIndex((entry) => entry.atMs >= instant - SOURCE_WINDOW_MS);
      if (firstFresh > 0) sourceEvents.splice(0, firstFresh);
      bySource.delete(event.source);
      bySource.set(event.source, sourceEvents);
      while (bySource.size > SOURCE_MAX) bySource.delete(bySource.keys().next().value);
      if (event.sourceClass === 'remote') {
        for (const signal of detectTrafficSignals(sourceEvents, instant).filter((entry) => entry.severity === 'critical')) {
          const key = `${event.source}:${signal.type}`;
          if ((signalCooldown.get(key) || 0) > instant - SIGNAL_COOLDOWN_MS) continue;
          signalCooldown.delete(key);
          signalCooldown.set(key, instant);
          while (signalCooldown.size > SIGNAL_COOLDOWN_MAX) signalCooldown.delete(signalCooldown.keys().next().value);
          Promise.resolve(onCritical({ source: event.source, signal, event })).catch((error) => {
            log.error('automatic traffic containment failed', { source: event.source, signal: signal.type, error: error.message });
          });
        }
      }
    }
    return event;
  };

  const snapshot = ({ windowSeconds = 60, limit = 100 } = {}) => {
    const seconds = Math.min(Math.max(Number(windowSeconds) || 60, 1), MAX_WINDOW_SECONDS);
    const eventLimit = Math.min(Math.max(Number(limit) || 0, 0), 200);
    const sinceMs = now() - seconds * 1000;
    const events = orderedRing().filter((event) => event.atMs >= sinceMs);
    const aggregate = (keyOf) => {
      const groups = new Map();
      for (const event of events) {
        const key = keyOf(event);
        if (!groups.has(key)) groups.set(key, { key, requests: 0, errors: 0, denied: 0, durationTotal: 0, maxDurationMs: 0 });
        const row = groups.get(key);
        row.requests += 1;
        if (event.status >= 500) row.errors += 1;
        if ([401, 403, 429].includes(event.status)) row.denied += 1;
        row.durationTotal += event.durationMs;
        row.maxDurationMs = Math.max(row.maxDurationMs, event.durationMs);
      }
      return [...groups.values()].map(({ durationTotal, ...row }) => Object.freeze({
        ...row,
        averageDurationMs: row.requests ? Math.round(durationTotal / row.requests) : 0,
      })).sort((a, b) => b.requests - a.requests || a.key.localeCompare(b.key)).slice(0, 30);
    };
    const anomalies = [];
    for (const [source, sourceEvents] of bySource) {
      for (const signal of detectTrafficSignals(sourceEvents, now())) anomalies.push(Object.freeze({ source, ...signal }));
    }
    return Object.freeze({
      measuredAt: new Date(now()).toISOString(),
      windowSeconds: seconds,
      since: new Date(sinceMs).toISOString(),
      totals: Object.freeze({
        requests: events.length,
        denied: events.filter((event) => [401, 403, 429].includes(event.status)).length,
        serverErrors: events.filter((event) => event.status >= 500).length,
        remote: events.filter((event) => event.sourceClass === 'remote').length,
        portalMessages: events.filter((event) => event.transport === 'portal').length,
      }),
      byPath: Object.freeze(aggregate((event) => `${event.method} ${event.path}`)),
      bySource: Object.freeze(aggregate((event) => event.source || 'unknown')),
      anomalies: Object.freeze(anomalies.sort((a, b) => b.count - a.count).slice(0, 50)),
      recent: Object.freeze(eventLimit ? events.slice(-eventLimit).reverse() : []),
    });
  };

  const clear = () => {
    ring.length = 0;
    bySource.clear();
    ringStart = 0;
    signalCooldown.clear();
  };

  return Object.freeze({ record, snapshot, clear });
};

export const trafficMonitor = createTrafficMonitor();

const requestSource = (req) => normalizeSource(req?.socket?.remoteAddress || req?.connection?.remoteAddress);
const requestPath = (req) => {
  const routed = req?.route?.path
    ? `${req.baseUrl || ''}${req.route.path}`
    : req?.path || req?.url || '/';
  return normalizeTrafficPath(routed);
};

const recordHttpOutcome = (req, res, startedAt, blocked = false) => trafficMonitor.record({
  source: requestSource(req),
  method: req?.method,
  path: requestPath(req),
  status: Number(res?.statusCode) || 0,
  durationMs: performance.now() - startedAt,
  transport: 'http',
  blocked,
});

/** Record one limiter refusal that happened before the global traffic middleware. */
export const recordRateLimitedRequest = (req) => {
  if (req?.[RECORDED_EARLY]) return null;
  if (req) req[RECORDED_EARLY] = true;
  return trafficMonitor.record({
    source: requestSource(req), method: req?.method, path: requestPath(req), status: 429, transport: 'http',
  });
};

/** Record one authenticated portal message without content. */
export const recordPortalMessage = (connection, limited = false) => trafficMonitor.record({
  source: connection?.ws?._socket?.remoteAddress,
  method: 'WS',
  path: '/portal',
  status: limited ? 429 : 200,
  transport: 'portal',
});

/** Synchronous hot-path check after a same-process automatic block. */
export const portalSourceBlocked = (connection) => circuitBreaker.isBlockedNow(connection?.ws?._socket?.remoteAddress);

/** Application-firewall guard plus completion telemetry. impure Express middleware. */
export const securityTrafficMiddleware = (req, res, next) => {
  const startedAt = performance.now();
  let settled = false;
  const recordOnce = (blocked = false) => {
    if (settled || req?.[RECORDED_EARLY]) return;
    settled = true;
    recordHttpOutcome(req, res, startedAt, blocked);
  };
  res.once('finish', () => recordOnce(res.locals?.securityBlocked === true));
  res.once('close', () => recordOnce(res.locals?.securityBlocked === true));
  const source = requestSource(req);
  if (!source || isLoopbackSource(source)) return next();
  circuitBreaker.evaluate(source).then((decision) => {
    if (!decision.blocked) return next();
    res.locals.securityBlocked = true;
    return res.status(403).json({ error: 'Request blocked by the emergency security circuit breaker' });
  }).catch((error) => {
    log.error('circuit-breaker state unavailable', { source, error: error.message });
    if (!source || isLoopbackSource(source)) return next();
    res.locals.securityBlocked = true;
    return res.status(503).json({ error: 'Security state unavailable; remote traffic is fail-closed' });
  });
};

const issueLimit = (limit) => Math.min(Math.max(Number(limit) || 20, 1), 50);

/**
 * One live, bounded CSO pulse: traffic, anomaly signals, breakers, redacted
 * failures — only the reader's house's and the machine's (house-issue-feed.js).
 * @param {{wallet: string, windowSeconds?: number, limit?: number, logLimit?: number}} opts
 */
export const readSecurityTelemetry = async (opts = {}) => {
  const feed = await issuesForHouse(getRecentIssues(issueLimit(opts.logLimit)), opts.wallet);
  return Object.freeze({
    traffic: trafficMonitor.snapshot(opts),
    circuitBreakers: await circuitBreaker.load(),
    systemIssues: feed.rows,
    systemIssuesWithheld: feed.withheld,
  });
};
