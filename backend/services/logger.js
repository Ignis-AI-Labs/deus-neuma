/**
 * Structured Logger — JSON in production, human-readable in dev.
 *
 * Usage:
 *   import { createLogger } from './services/logger.js';
 *   const log = createLogger('Server');
 *   log.info('LLM provider connected');
 *   log.warn('LLM not reachable', { provider: 'lm-studio' });
 *   log.error('Fatal error', { err: error.message });
 *
 * Child loggers inherit parent context:
 *   const birthLog = log.child('Birth');
 *   birthLog.info('Stage complete', { stage: 3 });
 *   // → {"level":"info","context":"Server.Birth","msg":"Stage complete","stage":3,...}
 */

const LEVELS = Object.freeze({ error: 0, warn: 1, info: 2, debug: 3 });

const isProduction = () => process.env.NODE_ENV === 'production';

const minLevel = () => {
  const env = (process.env.LOG_LEVEL || '').toLowerCase();
  if (env in LEVELS) return LEVELS[env];
  return isProduction() ? LEVELS.info : LEVELS.debug;
};

const timestamp = () => new Date().toISOString();

/**
 * One log entry as TEXT and its data. A message is always a string: the
 * failures feed is rendered by the SUBSTRATE window, and a non-text message
 * there crashed it (2026-10-18, React #31 […]). An
 * object-first call (`log.warn({ … }, 'text')`) is read in its own order; any
 * other non-text message is said as text. Pure.
 * @returns {[string, object|null]}
 */
export const entryOf = (msg, data) => {
  if (typeof msg === 'string') return [msg, data ?? null];
  if (msg && typeof msg === 'object' && !(msg instanceof Error) && typeof data === 'string') return [data, msg];
  const text = msg instanceof Error ? msg.message
    : typeof msg?.message === 'string' ? msg.message
      : typeof msg?.error === 'string' ? msg.error
        : (() => { try { return JSON.stringify(msg) ?? String(msg); } catch { return String(msg); } })();
  return [text, data && typeof data === 'object' ? data : null];
};

// In-memory ring of the most recent warn/error entries — the failures feed for
// the SUBSTRATE HUD (and pullable from the CLI). Bounded so it never grows
// unbounded; process-lifetime only (not a durable audit log).
const RECENT_MAX = 100;
const recentIssues = [];

const captureIssue = (level, context, msg, data) => {
  if (level !== 'error' && level !== 'warn') return;
  recentIssues.push(Object.freeze({ level, context, msg, data: data ?? null, ts: timestamp() }));
  if (recentIssues.length > RECENT_MAX) recentIssues.shift();
};

/**
 * Most recent warn/error log entries, newest first. Powers the SUBSTRATE
 * failures panel. Pure read over the in-memory ring.
 * @param {number} [limit=50]
 */
export const getRecentIssues = (limit = 50) => recentIssues.slice(-limit).reverse();

/**
 * Format a log entry as JSON (production) or human-readable (dev).
 */
const formatJSON = (level, context, msg, data) =>
  JSON.stringify({ level, context, msg, ...data, ts: timestamp() });

const formatDev = (level, context, msg, data) => {
  const tag = level === 'error' ? '\x1b[31mERR\x1b[0m'
    : level === 'warn' ? '\x1b[33mWRN\x1b[0m'
    : level === 'debug' ? '\x1b[90mDBG\x1b[0m'
    : '\x1b[36mINF\x1b[0m';
  const meta = data && Object.keys(data).length > 0
    ? ' ' + JSON.stringify(data)
    : '';
  return `${tag} [${context}] ${msg}${meta}`;
};

/**
 * Create a logger bound to a context string.
 * @param {string} context - Module/domain name (e.g. 'Server', 'Birth', 'MCP')
 * @returns {{ info, warn, error, debug, child }}
 */
export function createLogger(context) {
  const format = isProduction() ? formatJSON : formatDev;
  const threshold = minLevel();

  const emit = (level, rawMsg, rawData) => {
    const [msg, data] = entryOf(rawMsg, rawData);
    // Capture warn/error to the ring even if the console threshold would hide
    // them, so the failures feed never misses one.
    captureIssue(level, context, msg, data);
    if (LEVELS[level] > threshold) return;
    const line = format(level, context, msg, data);
    if (level === 'error') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  };

  return Object.freeze({
    info:  (msg, data) => emit('info', msg, data),
    warn:  (msg, data) => emit('warn', msg, data),
    error: (msg, data) => emit('error', msg, data),
    debug: (msg, data) => emit('debug', msg, data),
    child: (sub) => createLogger(`${context}.${sub}`),
  });
}
