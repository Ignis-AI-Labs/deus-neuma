/** Endpoint-scoped health probes; invalidated requests cannot refill the cache. */
import net from 'node:net';

const HEALTH_TIMEOUT_MS = 2000;
const SERVED_TRUTH_TTL_MS = 1500;
const readings = new Map();

// impure — unhealthy, unreachable and malformed responses cannot assert health.
const probeHealth = async (port, host) => {
  try {
    const response = await fetch(`http://${host}:${port}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    return (await response.json())?.status === 'ok';
  } catch {
    return false;
  }
};

/** impure — share concurrent probes and retain completed readings briefly. */
export const isServing = async (port, host = '127.0.0.1') => {
  const key = JSON.stringify([host, port]);
  const cached = readings.get(key);
  if (cached && (cached.at === null || Date.now() - cached.at < SERVED_TRUTH_TTL_MS)) {
    return cached.promise;
  }
  const entry = { at: null, promise: null };
  entry.promise = probeHealth(port, host).then((serving) => {
    if (readings.get(key) === entry) entry.at = Date.now();
    return serving;
  });
  readings.set(key, entry);
  return entry.promise;
};

/** impure — old callers finish their own requests but cannot restore removed entries. */
export const expireServedTruth = () => readings.clear();

/**
 * impure — does ANY program accept a connection on this port? Unlike
 * isServing it asks nothing of the listener, so a program that is not a
 * healthy llama-server still reads as holding the port. An unanswered
 * connect within the health deadline reads as free.
 * @param {number} port
 * @param {string} [host]
 * @returns {Promise<boolean>}
 */
export const portTaken = (port, host = '127.0.0.1') => new Promise((resolve) => {
  const socket = net.connect({ port, host });
  const settle = (taken) => { socket.destroy(); resolve(taken); };
  socket.setTimeout(HEALTH_TIMEOUT_MS, () => settle(false));
  socket.once('connect', () => settle(true));
  socket.once('error', () => settle(false));
});
