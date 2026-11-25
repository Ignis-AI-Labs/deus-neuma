// loopback-route-owner — a saved model route that points at this computer is checked for who
// answers there when the backend starts, not only when it was set up (PR600 audit P6-153).
//
// A route the operator saved names an address, and an address is not a program: by the next start
// another account's program may hold that port. So each saved loopback route that is answering at
// start has its listener's owner read (listener-owner.js). One run by another account is REFUSED:
// every model request to that address fails with the reason, until the next start finds it clear.
// A route nothing answers on yet is left alone (the house's own server starts later, as a child of
// this account). This is one look at start; a program that takes the port afterwards is not seen.
//
// impure — the network (one loopback connect), the listener table, a module-held refusal set.
import net from 'node:net';
import { createLogger } from './logger.js';
import { listenerStanding, answeredStanding } from './listener-owner.js';

const log = createLogger('RouteOwner');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
// the account Ollama's Linux installer runs its service under
export const SERVICE_ACCOUNTS = Object.freeze(['ollama']);

/** endpoint (as saved) → the foreign account's id, where it was read */
const refused = new Map();

/** The loopback port an endpoint names, or null (another host's listener is not ours to read). Pure. */
export const loopbackPort = (endpoint) => {
  try {
    const url = new URL(endpoint);
    if (!LOOPBACK.has(url.hostname)) return null;
    return Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
  } catch {
    return null;
  }
};

// impure (network) — does anything accept a connection on this loopback port?
const answers = (host, port) => new Promise((resolve) => {
  const socket = net.connect({ host, port });
  const done = (up) => { socket.destroy(); resolve(up); };
  socket.setTimeout(1000, () => done(false));
  socket.once('connect', () => done(true));
  socket.once('error', () => done(false));
});

/** Local model endpoints use IPv4 explicitly, never a resolver-dependent name. Pure. */
export const canonicalLoopbackEndpoint = (endpoint) => {
  try {
    const url = new URL(endpoint);
    if (!LOOPBACK.has(url.hostname)) return endpoint;
    url.hostname = '127.0.0.1';
    return url.toString().replace(/\/$/, '');
  } catch {
    return endpoint;
  }
};

const loopbackHosts = (endpoint) => {
  try {
    const host = new URL(endpoint).hostname;
    return host === 'localhost' ? ['127.0.0.1', '::1'] : host === '[::1]' || host === '::1' ? ['::1'] : ['127.0.0.1'];
  } catch {
    return [];
  }
};

/**
 * Check the saved routes at start: each loopback endpoint that answers and is run by another
 * account is refused from now on. impure, never throws.
 * @param {Array<?string>} endpoints - the saved routes' endpoints (others are skipped)
 * @param {{platform?: string}} [opts]
 * @returns {Promise<Array<{endpoint: string, uid: number|string|null}>>} the routes refused
 */
export const checkSavedRoutes = async (endpoints, { platform = process.platform } = {}) => {
  const found = [];
  for (const endpoint of new Set(endpoints.filter((e) => typeof e === 'string' && e).map(canonicalLoopbackEndpoint))) {
    const port = loopbackPort(endpoint);
    if (port === null) continue;
    const heard = [];
    for (const host of loopbackHosts(endpoint)) if (await answers(host, port)) heard.push(host);
    if (!heard.length) continue;
    const owner = answeredStanding(platform, listenerStanding(port, { serviceAccounts: SERVICE_ACCOUNTS, platform }));
    if (owner.standing !== 'foreign') continue;
    refused.set(endpoint, owner.uid);
    found.push({ endpoint, uid: owner.uid });
    log.error('a saved model route is answered by a program another account runs; it is not used', { endpoint, owner: owner.uid ?? 'not readable', heard });
  }
  return found;
};

/**
 * Refuse a model request to a route found in another account's hands at start. Throws the reason. Pure
 * over the refusal set.
 * @param {?string} endpoint
 */
export const assertRouteOwned = (endpoint) => {
  const canonical = canonicalLoopbackEndpoint(endpoint);
  if (!refused.has(canonical)) return;
  throw new Error(`The model server at ${canonical} is run by another account on this computer, so it is not used. Stop that program or choose another model server, then start Deus Neuma again.`);
};

/** Forget every refusal (a start begins clear; a suite ends clear). impure */
export const clearRouteRefusals = () => refused.clear();
