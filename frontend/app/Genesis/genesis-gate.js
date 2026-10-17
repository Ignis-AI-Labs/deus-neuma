// genesis-gate.js — whether THIS launch is the install's GENESIS. // impure
//
// GENESIS plays once per install, ever (backend/services/genesis-store.js is
// the record of authority; this desk remembers it locally so a later launch
// decides at its first frame, before the backend answers). It plays where the
// ignition would — true session start, motion allowed — and never for an
// automated browser (navigator.webdriver): a test run must never spend an
// install's one genesis. `?genesis=1` asks for it anyway (its own e2e).

import { apiCall } from '../../utils/http.js';
import { bootPlaysAtStart } from '../app-state.js';

const SEEN_KEY = 'neuma.genesis';
const CLAIM_TRIES = 20; // the packaged backend may still be starting
const CLAIM_GAP_MS = 750;

const asked = () => new URLSearchParams(window.location.search).get('genesis') === '1';

/** Does this launch open on GENESIS? Decided at the first frame. */
export const genesisDue = () => {
  if (asked()) return true;
  if (!bootPlaysAtStart() || navigator.webdriver) return false;
  try { return !localStorage.getItem(SEEN_KEY); } catch { return false; }
};

/** Remember the install's genesis on this desk. */
export const rememberGenesis = (record) => {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify({ at: record.at, hash: record.hash })); } catch { /* private mode */ }
};

/** The install's genesis as this desk remembers it (its ignition's resting lean), or null. */
export const rememberedGenesis = () => {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || 'null'); } catch { return null; }
};

/**
 * Claim the install's genesis from the backend: minted now when it is the
 * first, else the record that stands. Waits for a backend still starting;
 * null if it never answers (the launch then goes on without its genesis).
 * @returns {Promise<{ record: { at: string, hash: string }, minted: boolean }|null>}
 */
export const claimGenesis = async () => {
  for (let i = 0; i < CLAIM_TRIES; i++) {
    try {
      const { record, minted } = await apiCall('POST', '/api/v1/genesis', { strictJson: true });
      if (record?.at && record?.hash) return { record, minted: Boolean(minted) };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, CLAIM_GAP_MS));
  }
  return null;
};
