// Probe the residency daemon's public liveness endpoint. The /api/v1/health
// route is the same one scripts/neuma-daemon.sh's `health` verb hits — it
// has NO auth requirement (it's the operator's "are you home?" question).
// This means the no-arg snapshot in dispatch.js can call it cheaply on
// every `neuma` invocation without firing the wallet/auth machinery.
//
// Returns a plain status object (never throws) so the snapshot can render
// the daemon line regardless of what state the daemon is in.
//
// impure (network)

const DEFAULT_TIMEOUT_MS = 1500;

/**
 * @param {{ backend: string, timeoutMs?: number }} params
 * @returns {Promise<{ alive: boolean, status?: number, error?: string }>}
 */
export const getDaemonHealth = async ({ backend, timeoutMs = DEFAULT_TIMEOUT_MS }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${backend}/api/v1/health`, { signal: controller.signal });
    return { alive: res.ok, status: res.status };
  } catch (err) {
    const reason = err?.name === 'AbortError'
      ? `timeout after ${timeoutMs}ms`
      : (err?.cause?.code || err?.code || err?.message || 'unknown error');
    return { alive: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
};
