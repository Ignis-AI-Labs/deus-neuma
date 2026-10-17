// Port resolution — NEUMA must not lose to whatever else the operator runs.
//
// WHY (Design note, 2026-08-02: […]
//
// The desk used to take one look at port 47317, and if ANYTHING held it, show a
// dialog asserting […], tell the operator to go kill it, and quit. For a stale NEUMA
// backend that is exactly right. For a person whose own service happens to sit
// on 47317 it is a false accusation followed by a dead app, with no way to
// change the port from the GUI.
//
// So: ASK WHO IS THERE before deciding.
//   free    → take it
//   neuma   → a backend of ours is already up; that is the stale-desk case, and
//             the caller keeps its existing behaviour (never two backends over
//             one data root)
//   foreign → somebody else's service. Step to the next free port and carry on.
//             The port is loopback-only and nothing external depends on the
//             number, so moving is free.
//
// The scan is bounded and the classification is pure; only the two probes touch
// the network.

const net = require('node:net');
const http = require('node:http');

const PROBE_MS = 1500;
/** How many ports to try past the preferred one before giving up. */
const SCAN_SPAN = 40;

/**
 * Is a NEUMA backend what answered? Pure.
 *
 * The health route is public and unmistakable — it names its own components.
 * Anything else answering on the port (a dev server, another app, a proxy) does
 * not produce this shape, and a body we cannot parse is by definition foreign.
 * @param {number} status
 * @param {string} body
 * @returns {boolean}
 */
const looksLikeNeuma = (status, body) => {
  if (status !== 200) return false;
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.status === 'string' && typeof parsed?.components === 'object' && parsed.components !== null;
  } catch {
    return false;
  }
};

/** impure — is anything accepting TCP on this port? */
const isHeld = (port, host = '127.0.0.1') => new Promise((resolve) => {
  const socket = net.createConnection({ host, port });
  const settle = (held) => { socket.destroy(); resolve(held); };
  socket.setTimeout(PROBE_MS);
  socket.once('connect', () => settle(true));
  socket.once('timeout', () => settle(false));
  socket.once('error', () => settle(false)); // ECONNREFUSED = nobody home
});

/** impure — GET /api/v1/health and report (status, body). Never throws. */
const probeHealth = (port, host = '127.0.0.1') => new Promise((resolve) => {
  const req = http.get({ host, port, path: '/api/v1/health', timeout: PROBE_MS }, (res) => {
    let body = '';
    res.setEncoding('utf8');
    // A foreign service could stream forever — take only what the check needs.
    res.on('data', (chunk) => { if (body.length < 4096) body += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
  req.on('error', () => resolve({ status: 0, body: '' }));
});

/**
 * Who holds this port? impure.
 * @param {number} port
 * @returns {Promise<'free'|'neuma'|'foreign'>}
 */
const identifyPortHolder = async (port) => {
  if (!(await isHeld(port))) return 'free';
  const { status, body } = await probeHealth(port);
  return looksLikeNeuma(status, body) ? 'neuma' : 'foreign';
};

/**
 * The port this desk should use. impure.
 *
 * Returns the preferred port when it is free, the FIRST free port after it when
 * somebody else's service is in the way, and reports the NEUMA case so the
 * caller can keep refusing to run two backends over one data root.
 *
 * @param {number} preferred
 * @param {{span?:number, identify?:(p:number)=>Promise<string>}} [opts]
 * @returns {Promise<{port:number|null, outcome:'preferred'|'moved'|'neuma-held'|'exhausted', skipped:number[]}>}
 */
const resolvePort = async (preferred, { span = SCAN_SPAN, identify = identifyPortHolder } = {}) => {
  const first = await identify(preferred);
  if (first === 'free') return { port: preferred, outcome: 'preferred', skipped: [] };
  if (first === 'neuma') return { port: null, outcome: 'neuma-held', skipped: [] };

  const skipped = [preferred];
  for (let candidate = preferred + 1; candidate <= preferred + span; candidate += 1) {
    // A NEUMA backend parked on a neighbouring port is not ours to take either,
    // and it is not the stale-desk case for the port we asked for — keep walking.
    if ((await identify(candidate)) === 'free') return { port: candidate, outcome: 'moved', skipped };
    skipped.push(candidate);
  }
  return { port: null, outcome: 'exhausted', skipped };
};

module.exports = { looksLikeNeuma, identifyPortHolder, resolvePort, isHeld, SCAN_SPAN };
