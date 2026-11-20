// lp-aggregator.js — KyberSwap's aggregator, the second road a house member's
// swap may take (Design note, 2026-11-13: […]). Two public calls, no key:
//
//   quote — the best route across Base's exchanges for an exact amount in;
//   build — that route as one call to KyberSwap's router, paying `recipient`,
//           with the slippage asked (the run signs it only through
//           core/wallet/aggregator-policy.js, under a floor of its own).
//
// Host-pinned (aggregator-api.kyberswap.com; a loopback server only for a
// test) and behind its own connection switch, off until the operator turns it
// on. Never throws: the caller gets the answer or a reason it can say.

import { isConnectionOn } from '../connections/connection-switches.js';
import { testEndpoint } from '../test-endpoint-door.js';

export const AGGREGATOR_CONNECTION = 'swap-aggregator';
const HOST = 'aggregator-api.kyberswap.com';
// Read per call (the env-door doctrine): a test points the real client at a loopback server; production never sets it.
const origin = () => testEndpoint(process.env, 'NEUMA_KYBER_ORIGIN', `https://${HOST}`).replace(/\/+$/, '');
const CLIENT_ID = 'neuma';

const refused = (error) => ({ ok: false, error });

// pure — KyberSwap's own host over https, or a loopback test server over http.
const pinned = (raw) => {
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol === 'https:') return url.hostname === HOST;
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
};

// impure — one call, cut short after timeoutMs.
const call = async (path, { method = 'GET', body, timeoutMs = 15000 } = {}) => {
  const url = `${origin()}/base/api/v1${path}`;
  if (!pinned(url)) return refused('refusing to call a host that is not KyberSwap');
  if (!isConnectionOn(AGGREGATOR_CONNECTION)) return refused('the swap aggregator is turned off on this computer — the operator can turn it on in Settings → Security → Connections');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method, redirect: 'error', signal: abort.signal,
      headers: { Accept: 'application/json', 'x-client-id': CLIENT_ID, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.code !== 0) return refused(`KyberSwap answered: ${payload?.message || `HTTP ${res.status}`}`);
    return { ok: true, data: payload.data ?? {} };
  } catch (err) {
    return refused(err.name === 'AbortError' ? 'the call to KyberSwap was cut short' : `KyberSwap is unreachable: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * KyberSwap's best route for an exact amount in. impure — network.
 * @param {{tokenIn: string, tokenOut: string, amountIn: bigint|string}} ask - token addresses, raw amount
 * @returns {Promise<{ok: true, amountOut: bigint, gasUsd: number|null, exchanges: string[], routeSummary: object} | {ok: false, error: string}>}
 */
export const aggregatorQuote = async ({ tokenIn, tokenOut, amountIn }) => {
  const q = new URLSearchParams({ tokenIn, tokenOut, amountIn: String(amountIn) });
  const out = await call(`/routes?${q}`);
  if (!out.ok) return out;
  const summary = out.data.routeSummary;
  try {
    const amountOut = BigInt(summary?.amountOut ?? '');
    const exchanges = [...new Set((summary.route ?? []).flat().map((hop) => hop?.exchange).filter(Boolean))];
    return { ok: true, amountOut, gasUsd: Number.isFinite(Number(summary.gasUsd)) ? Number(summary.gasUsd) : null, exchanges, routeSummary: summary };
  } catch {
    return refused('KyberSwap\'s route had no amount out');
  }
};

/**
 * That route as one call to KyberSwap's router, paying `recipient`. impure — network.
 * @param {{routeSummary: object, wallet: string, slippageBps: number}} ask
 * @returns {Promise<{ok: true, to: string, data: string, value: string, amountOut: bigint} | {ok: false, error: string}>}
 */
export const aggregatorBuild = async ({ routeSummary, wallet, slippageBps }) => {
  const out = await call('/route/build', {
    method: 'POST',
    body: { routeSummary, sender: wallet, recipient: wallet, slippageTolerance: slippageBps },
  });
  if (!out.ok) return out;
  const { routerAddress, data, transactionValue, amountOut } = out.data;
  if (typeof routerAddress !== 'string' || typeof data !== 'string') return refused('KyberSwap\'s build had no transaction');
  try {
    return { ok: true, to: routerAddress, data, value: String(transactionValue ?? '0'), amountOut: BigInt(amountOut ?? 0) };
  } catch {
    return refused('KyberSwap\'s build had no amount out');
  }
};
