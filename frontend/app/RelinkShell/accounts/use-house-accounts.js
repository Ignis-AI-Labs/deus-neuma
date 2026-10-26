// use-house-accounts.js — the house's apps, accounts and companies, read ONCE
// for every surface that names an account (the queue's chips, the platform
// window's strip, Settings → API). One shared read, refreshed on demand and
// after any change, so a hundred queue cards never mean a hundred requests.
//
// impure — network + a module-level shared store.

import { useEffect, useState } from 'react';
import { getHouseAccounts } from '../../../services/social-accounts-client.js';

const STALE_MS = 30 * 1000;
const EMPTY = Object.freeze({ apps: [], accounts: [], companies: [] });
let state = { data: null, at: 0, error: null };
let inflight = null;
const listeners = new Set();

const publish = (next) => {
  state = next;
  for (const fn of listeners) fn(state);
};

/** Read the house's accounts now (or reuse a read under 30 s old). impure. */
export const loadHouseAccounts = async ({ force = false } = {}) => {
  if (!force && state.data && Date.now() - state.at < STALE_MS) return state.data;
  if (!inflight) {
    inflight = getHouseAccounts()
      .then((data) => { publish({ data, at: Date.now(), error: null }); return data; })
      .catch((e) => { publish({ ...state, error: e.message }); return state.data; })
      .finally(() => { inflight = null; });
  }
  return inflight;
};

/**
 * impure — {apps, accounts, companies, known, error, refresh}; `known` once
 * a read has answered, or failed with its error (an empty house and an
 * unread one are not the same).
 */
export const useHouseAccounts = () => {
  const [snap, setSnap] = useState(state);
  useEffect(() => {
    listeners.add(setSnap);
    loadHouseAccounts().catch(() => null);
    return () => { listeners.delete(setSnap); };
  }, []);
  return { ...(snap.data || EMPTY), known: Boolean(snap.data || snap.error), error: snap.error, refresh: () => loadHouseAccounts({ force: true }) };
};
