// look.js — the dress service: applies the derived tokens to the document
// root, mirrors the active theme locally so the dress paints before auth,
// and round-trips the backend store (the canonical copy).
//
// impure — DOM, localStorage, network.

import { apiCall, authHeadersOrNull } from '../utils/http.js';
import { deriveLookVars, isValidLook, LOOK_VAR_NAMES } from '../utils/look-derive.js';

const MIRROR_KEY = 'neuma-look';

/**
 * Dress the platform: set every derived token as an inline custom property
 * on the document root (inline wins over the stylesheet). A null theme
 * removes the overrides — the stock stylesheet stands again.
 * @param {{ground:string,panel:string,ink:string,trim:string} | null} theme
 */
// impure — DOM. Every possible look var is cleared FIRST: a knob released
// between two dresses (alert claimed, then unclaimed) must never leave a
// stale override behind.
export const applyLook = (theme) => {
  const style = document.documentElement.style;
  LOOK_VAR_NAMES.forEach((name) => style.removeProperty(name));
  if (!theme) return;
  Object.entries(deriveLookVars(theme)).forEach(([name, value]) => style.setProperty(name, value));
};

// impure — localStorage; a malformed mirror reads as no mirror.
const readMirror = () => {
  try {
    const theme = JSON.parse(localStorage.getItem(MIRROR_KEY));
    return isValidLook(theme) ? theme : null;
  } catch {
    return null;
  }
};

// impure — localStorage
const writeMirror = (theme) => {
  if (theme) localStorage.setItem(MIRROR_KEY, JSON.stringify(theme));
  else localStorage.removeItem(MIRROR_KEY);
};

/** @returns {Promise<{theme: object|null, presets: object[]}>} */
// impure
export const getLook = () => apiCall('GET', '/api/v1/look', { errorPrefix: 'Could not read the look' });

/**
 * Set (or with null, clear) the active dress — applies, persists, mirrors.
 * @param {object | null} theme
 */
// impure
export const setLookTheme = async (theme) => {
  const state = await apiCall('PUT', '/api/v1/look/theme', {
    body: { theme },
    errorPrefix: 'Could not set the look',
  });
  writeMirror(state.theme);
  return state;
};

/**
 * Save the given knobs as a named preset on the witness's shelf.
 * @param {string} name
 * @param {object} theme
 */
// impure
export const saveLookPreset = (name, theme) =>
  apiCall('POST', '/api/v1/look/presets', {
    body: { name, theme },
    errorPrefix: 'Could not save the preset',
  });

/**
 * Remove one saved preset.
 * @param {string} id
 */
// impure
export const deleteLookPreset = (id) =>
  apiCall('DELETE', `/api/v1/look/presets/${encodeURIComponent(id)}`, {
    errorPrefix: 'Could not delete the preset',
  });

/**
 * Boot-time dress: paint the mirrored theme immediately (no network, before
 * first render), then let the canonical store correct it when a session
 * token already stands.
 */
// impure
export const bootLook = () => {
  applyLook(readMirror());
  if (!authHeadersOrNull()) return; // pre-auth boot — the mirror's paint holds
  getLook()
    .then((state) => {
      applyLook(state.theme);
      writeMirror(state.theme);
    })
    // deliberate fallback, not a swallow: an unreachable backend at boot
    // keeps the mirror's paint; Settings surfaces any real error on open.
    .catch(() => {});
};
