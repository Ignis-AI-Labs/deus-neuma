// tiktok-token.js — a usable TikTok access token for one ACCOUNT of a house,
// refreshed BEFORE it expires and sealed back into THAT account's credentials
// (never another account's: each authorization has its own token pair).
//
// A TikTok access token lives 24 hours and every refresh may hand back a new
// refresh token that replaces the old one, so a refresh is never a private
// act of one caller: the new pair is written back at once, and refreshes are
// serialized per account, each re-reading the store first so a second caller
// uses the pair the first one just stored instead of spending a stale
// refresh token.

import { resolveAccountCredential, setAccountFields } from './account-store.js';
import { firstAccountId } from './account-shape.js';
import { refreshTikTokToken, tokenRecord } from './tiktok-oauth.js';
import { houseKey } from '../staff/cos-designation.js';

/** Refresh this long before the access token's end: a long upload must not outlive it. */
export const REFRESH_MARGIN_MS = 30 * 60 * 1000;

/**
 * Whether a stored connection's access token must be refreshed now. Pure.
 * @param {{accessToken?: string, accessExpiresAt?: string}} credentials
 * @param {number} nowMs
 */
export const needsRefresh = (credentials, nowMs) => {
  const until = Date.parse(credentials?.accessExpiresAt || '');
  return !credentials?.accessToken || !Number.isFinite(until) || until - nowMs <= REFRESH_MARGIN_MS;
};

const chains = new Map();

// impure — run fn after every earlier refresh of this account has settled.
const serialized = (key, fn) => {
  const prior = chains.get(key) || Promise.resolve();
  const next = prior.then(fn, fn);
  chains.set(key, next.catch(() => null));
  return next;
};

/**
 * A usable access token for one of the house's TikTok accounts. impure —
 * credential store + network.
 * @param {string} wallet - the house
 * @param {{signal?: AbortSignal, nowMs?: () => number, accountId?: string}} [opts]
 *   accountId — `tiktok-<n>`; the house's first TikTok account when absent
 * @returns {Promise<{ok: true, accessToken: string, credentials: object}
 *   |{ok: false, status?: number, detail: string, reconnect?: boolean}>}
 */
export const tiktokAccessFor = async (wallet, { signal, nowMs = Date.now, accountId = firstAccountId('tiktok') } = {}) => {
  const house = houseKey(wallet);
  if (!house) return { ok: false, detail: 'a TikTok post needs the house it speaks for' };
  const current = await resolveAccountCredential(house, accountId);
  if (!current) return { ok: false, detail: 'TikTok is not connected: save the client key and secret, then press CONNECT in Settings → API → Channel keys' };
  if (!needsRefresh(current, nowMs())) return { ok: true, accessToken: current.accessToken, credentials: current };
  return serialized(`${house}|${accountId}`, async () => {
    const latest = await resolveAccountCredential(house, accountId);
    if (!latest) return { ok: false, detail: 'TikTok was disconnected while a refresh waited' };
    if (!needsRefresh(latest, nowMs())) return { ok: true, accessToken: latest.accessToken, credentials: latest };
    const refreshed = await refreshTikTokToken(latest, { signal });
    if (!refreshed.ok) return refreshed;
    const record = tokenRecord(refreshed.data, nowMs());
    await setAccountFields(house, accountId, record);
    return { ok: true, accessToken: record.accessToken, credentials: { ...latest, ...record } };
  });
};
