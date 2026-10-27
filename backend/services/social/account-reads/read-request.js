// read-request.js — the one GET every account read makes, and the count
// reading they share. A read never throws: a platform that does not answer
// is an answer too, in words.

/**
 * One JSON GET. impure — network.
 * @param {string} url
 * @param {{headers?: Record<string, string>, signal?: AbortSignal}} [opts]
 * @returns {Promise<{ok: boolean, status: number, body: object, detail?: string}>}
 */
export const getJson = async (url, { headers = {}, signal } = {}) => {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: signal || AbortSignal.timeout(15000) });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: {}, detail: err.message };
  }
};

/**
 * A platform's count as a number, or null when it gave none (a count the
 * platform hides is never 0). Pure.
 * @param {unknown} v
 * @returns {number|null}
 */
export const countOf = (v) => {
  const x = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return Number.isFinite(x) && x >= 0 ? x : null;
};

/**
 * Words for a refusal the platform gave: its own message, or the status. Pure.
 * @param {string} name - the platform's name
 * @param {{status: number, body: object, detail?: string}} res
 * @returns {string}
 */
export const refusedWords = (name, res) => {
  if (res.detail) return `${name} did not answer (${res.detail})`;
  const said = res.body?.error?.message || res.body?.error_description || res.body?.message
    || (typeof res.body?.error === 'string' ? res.body.error : null);
  return `${name} refused the read (${said || `HTTP ${res.status}`})`;
};

/** How many of an account's newest posts a read lists. */
export const POSTS_PER_READ = 20;
