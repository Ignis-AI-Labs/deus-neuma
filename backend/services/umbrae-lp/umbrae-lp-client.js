// umbrae-lp-client.js — the ONE door to Umbrae's agent API, and the only thing
// in the umbrae-lp family that talks to it.
//
// Design note, 2026-11-12: […] A house member manages its
// own liquidity on Umbrae with a dedicated wallet. This is a second door beside
// platform-feed-read.js, which stays GET-only and carries no credential; this
// one posts, and carries the wallet's Umbrae key. The two share one host pin.
//
// Held by construction:
//   · The operations are a closed list. A caller names one; it never supplies
//     a path, so a being cannot turn this into a general fetch.
//   · The host is pinned (umbrae.io, www.umbrae.io, loopback for tests) and no
//     redirect is followed, so the key cannot be carried anywhere else.
//   · Off until the person turns the "Umbrae liquidity" connection on. While
//     it is off, nothing is sent.
//   · This module signs nothing and holds no wallet key. The Umbrae key it is
//     handed is used for one request and never logged or returned.

import { permittedFeedUrl } from '../platform-feed/platform-feed-read.js';
import { isConnectionOn } from '../connections/connection-switches.js';
import { testEndpoint } from '../test-endpoint-door.js';

export const UMBRAE_LP_CONNECTION = 'umbrae-liquidity';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const V1 = '/api/v1/base';

// auth: 'none' = public, 'session' = the sign-in token, 'key' = the wallet's Umbrae key.
const post = (path, auth) => Object.freeze({ method: 'POST', path: () => path, auth });
const OPS = Object.freeze({
  pools: Object.freeze({ method: 'GET', path: () => `${V1}/pools`, auth: 'none' }),
  pool: Object.freeze({ method: 'GET', path: (p) => (ADDRESS.test(p?.address || '') ? `${V1}/pools/${p.address}` : null), auth: 'none' }),
  // Liquidity by bin on each side of the active bin (1–500, Umbrae's default 35).
  bins: Object.freeze({ method: 'GET', path: (p) => (ADDRESS.test(p?.address || '') ? `${V1}/bins?pool=${p.address}&bins=${Math.min(500, Math.max(1, Math.trunc(Number(p.bins) || 35)))}` : null), auth: 'none' }),
  challenge: post('/api/auth/challenge', 'none'),
  signIn: post('/api/auth/wallet-auth', 'none'),
  createKey: post('/api/account/api-keys', 'session'),
  quoteAdd: post(`${V1}/quote/add-liquidity`, 'key'),
  quoteWithdrawal: post(`${V1}/quote/withdrawal`, 'key'),
  quoteClaimFees: post(`${V1}/quote/claim-fees`, 'key'),
  // A new pool: the plan (read) and its createPair (write) (Umbrae's agent create-pool flow, pool-routes.ts).
  createPoolQuote: post(`${V1}/quote/create-pool`, 'key'),
  buildPool: post(`${V1}/build-pool`, 'key'),
  positions: post(`${V1}/positions`, 'key'),
  approvals: post(`${V1}/approvals`, 'key'),
  build: post(`${V1}/build`, 'key'),
  send: post(`${V1}/send`, 'key'),
  status: post(`${V1}/status`, 'key'),
  sync: post(`${V1}/sync`, 'key'),
});

/** Every operation this door serves. */
export const UMBRAE_LP_OPS = Object.freeze(Object.keys(OPS));

// The origin, read PER CALL (the platform-feed env-door doctrine): a test
// points the real client at a real loopback server; production never sets it.
// www, not the bare host: the bare host redirects, and no redirect is followed.
const lpOrigin = () => testEndpoint(process.env, 'NEUMA_UMBRAE_LP_ORIGIN', 'https://www.umbrae.io').replace(/\/+$/, '');

const refused = (error, extra = {}) => ({ ok: false, error, ...extra });

// impure — the response body as an object, or {} when it is not JSON.
const bodyOf = async (res) => {
  try {
    const parsed = await res.json();
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * Call one Umbrae operation. Never throws: the caller gets the answer or a
 * reason a being can say out loud. impure — network + clock.
 *
 * @param {string} op - one of UMBRAE_LP_OPS
 * @param {{params?: {address?: string}, body?: object, token?: string,
 *   signal?: AbortSignal, timeoutMs?: number}} [opts]
 *   token — the session token or the wallet's Umbrae key, as the operation needs
 * @returns {Promise<{ok: true, payload: object} | {ok: false, error: string, status?: number, code?: string}>}
 */
export const callUmbrae = async (op, { params, body, token, signal, timeoutMs = 20000 } = {}) => {
  const spec = Object.hasOwn(OPS, op) ? OPS[op] : null;
  if (!spec) return refused(`no Umbrae operation named "${op}" — this client serves: ${UMBRAE_LP_OPS.join(', ')}`);
  const path = spec.path(params);
  if (!path) return refused('that is not a pool address');
  if (spec.auth !== 'none' && (typeof token !== 'string' || token === '')) {
    return refused(spec.auth === 'key' ? 'this wallet has no Umbrae key yet — it must sign in first' : 'this call needs the sign-in session');
  }
  const url = `${lpOrigin()}${path}`;
  if (!permittedFeedUrl(url)) return refused('refusing to call a host that is not Umbrae');
  if (!isConnectionOn(UMBRAE_LP_CONNECTION)) {
    return refused('Umbrae liquidity is turned off on this computer — the operator can turn it on in Settings → Security → Connections');
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const onOuter = () => abort.abort();
  signal?.addEventListener('abort', onOuter);
  try {
    const res = await fetch(url, {
      method: spec.method,
      redirect: 'error',
      signal: abort.signal,
      headers: {
        Accept: 'application/json',
        ...(spec.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        ...(spec.auth !== 'none' ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(spec.method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
    });
    const payload = await bodyOf(res);
    if (!res.ok) {
      const said = typeof payload.error === 'string' && payload.error ? payload.error : `HTTP ${res.status}`;
      return refused(`Umbrae answered: ${said}`, { status: res.status, ...(typeof payload.code === 'string' ? { code: payload.code } : {}) });
    }
    return { ok: true, payload };
  } catch (err) {
    if (err.name === 'AbortError') return refused('the call to Umbrae was cut short');
    return refused(`Umbrae is unreachable: ${err.message}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuter);
  }
};
