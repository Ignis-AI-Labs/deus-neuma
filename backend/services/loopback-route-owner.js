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
const answers = (port) => new Promise((resolve) => {
  const socket = net.connect({ host: '127.0.0.1', port });
  const done = (up) => { socket.destroy(); resolve(up); };
  socket.setTimeout(1000, () => done(false));
  socket.once('connect', () => done(true));
  socket.once('error', () => done(false));
});

/**
 * Check the saved routes at start: each loopback endpoint that answers and is run by another
 * account is refused from now on. impure, never throws.
 * @param {Array<?string>} endpoints - the saved routes' endpoints (others are skipped)
 * @param {{platform?: string}} [opts]
 * @returns {Promise<Array<{endpoint: string, uid: number|string|null}>>} the routes refused
 */
export const checkSavedRoutes = async (endpoints, { platform = process.platform } = {}) => {
  const found = [];
  for (const endpoint of new Set(endpoints.filter((e) => typeof e === 'string' && e))) {
    const port = loopbackPort(endpoint);
    if (port === null || !(await answers(port))) continue;
    const owner = answeredStanding(platform, listenerStanding(port, { serviceAccounts: SERVICE_ACCOUNTS, platform }));
    if (owner.standing !== 'foreign') continue;
    refused.set(endpoint, owner.uid);
    found.push({ endpoint, uid: owner.uid });
    log.error('a saved model route is answered by a program another account runs; it is not used', { endpoint, owner: owner.uid ?? 'not readable' });
  }
  return found;
};

/**
 * Refuse a model request to a route found in another account's hands at start. Throws the reason. Pure
 * over the refusal set.
 * @param {?string} endpoint
 */
export const assertRouteOwned = (endpoint) => {
  if (!refused.has(endpoint)) return;
  throw new Error(`The model server at ${endpoint} is run by another account on this computer, so it is not used. Stop that program or choose another model server, then start Deus Neuma again.`);
};

/** Forget every refusal (a start begins clear; a suite ends clear). impure */
export const clearRouteRefusals = () => refused.clear();
