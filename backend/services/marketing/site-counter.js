// site-counter — the house's door to the site counter (campaign plan §4.1–4.2;
// the deus-neuma-site Worker's /go-codes and /go-counts). The house publishes
// the codes it minted (code + destination + company, nothing else) and reads
// back the aggregate counts — clicks and downloads per code per day — for its
// own codes only.
//
// The site token is the house's: sealed in its encrypted credential store as
// the `site` app entry (no new secret store, plan §7). Its value is read only
// to make the request; nothing returns it to a caller, a log or a being.
// The counter's address rides an env door (NEUMA_SITE_COUNTER_ROOT) so tests
// aim the REAL calls at a local stand-in; it defaults to https://deusneuma.ai.
//
// impure — the credential store and the network.

import { loadAccountStore, mutateAccountStore } from '../social/account-store.js';
import { publishBody } from './link-codes.js';

const TIMEOUT_MS = 8000;
const BATCH = 100; // the counter's own limit per read and per publish

/** The counter's base address. */
export const siteCounterRoot = () => (process.env.NEUMA_SITE_COUNTER_ROOT || 'https://deusneuma.ai').replace(/\/+$/, '');

// impure — the house's site token, or null.
const tokenOf = async (wallet) => {
  const token = (await loadAccountStore(wallet))?.apps?.site?.token;
  return typeof token === 'string' && token.trim() ? token.trim() : null;
};

/** Whether this house can publish and read its codes — never the token itself. impure. */
export const siteCounterStatus = async (wallet) => ({ configured: Boolean(await tokenOf(wallet)), root: siteCounterRoot() });

/**
 * Seal (or clear, with '') the house's site token. impure.
 * @param {string} wallet
 * @param {string} token
 */
export const setSiteToken = async (wallet, token) => {
  const value = typeof token === 'string' ? token.trim() : '';
  if (value && !/^[\x21-\x7e]{16,512}$/.test(value)) return { ok: false, error: 'the site token is 16 to 512 visible characters' };
  await mutateAccountStore(wallet, (store) => {
    const apps = { ...store.apps };
    if (value) apps.site = { token: value };
    else delete apps.site;
    return { ...store, apps };
  });
  return { ok: true };
};

// impure — one call to the counter with the house's token.
const call = async (wallet, method, path, body) => {
  const token = await tokenOf(wallet);
  if (!token) return { ok: false, detail: 'the site counter is not set up for this house (its site token is not saved)' };
  try {
    const res = await fetch(`${siteCounterRoot()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const parsed = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, body: parsed } : { ok: false, status: res.status, detail: parsed?.error || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: `the site counter did not answer (${err.name === 'TimeoutError' ? 'timed out' : err.message})` };
  }
};

/**
 * Publish codes to the counter (POST /go-codes), at most 100 per call. The
 * answer names each code's state: published, already, or conflict. impure.
 * @param {string} wallet
 * @param {Array<{code: string, destination: string, companyId?: ?string, createdAt: string}>} records
 * @returns {Promise<{ok: true, results: Array<{code: string, state: string}>}|{ok: false, detail: string}>}
 */
export const publishCodes = async (wallet, records) => {
  const results = [];
  for (let i = 0; i < records.length; i += BATCH) {
    const res = await call(wallet, 'POST', '/go-codes', publishBody(records.slice(i, i + BATCH)));
    if (!res.ok) return res;
    results.push(...(Array.isArray(res.body?.codes) ? res.body.codes : []));
  }
  return { ok: true, results };
};

/**
 * The counter's aggregate counts for codes (GET /go-counts), 100 per call:
 * [{code, kind: click|download, day, count}]. impure.
 * @param {string} wallet
 * @param {string[]} codes - only codes this house minted (the caller's to ensure)
 * @param {{from?: string, to?: string}} [range]
 */
export const readGoCounts = async (wallet, codes, { from, to } = {}) => {
  const counts = [];
  for (let i = 0; i < codes.length; i += BATCH) {
    const q = new URLSearchParams({ codes: codes.slice(i, i + BATCH).join(',') });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const res = await call(wallet, 'GET', `/go-counts?${q}`);
    if (!res.ok) return res;
    counts.push(...(Array.isArray(res.body?.counts) ? res.body.counts : []));
  }
  return { ok: true, counts };
};
