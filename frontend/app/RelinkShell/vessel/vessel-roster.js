// vessel-roster.js — which avatars this installation holds, and which one to
// wear. The fetch is the only IO; selection logic is pure. (File keeps the
// legacy `vessel/` dir name this pass — the forms it lists are avatars per
// the locked triad; the dir migrates in a later rename pass.)

import { apiCall } from '../../../utils/http.js';

export const AVATAR_STORAGE_KEY = 'neuma-avatar';
// The pre-triad key — read once as a fallback, replaced on the next wear.
export const LEGACY_VESSEL_STORAGE_KEY = 'neuma-vessel';

/**
 * Pick the avatar to wear: the stored choice when it still exists,
 * otherwise the first held avatar, otherwise none.
 * @param {Array<{name: string}>} avatars
 * @param {string|null} stored - persisted selection (may point at a deleted file)
 * @returns {string|null}
 */
export const chooseVessel = (avatars, stored) => {
  if (stored && avatars.some((v) => v.name === stored)) return stored;
  return avatars.length ? avatars[0].name : null;
};

/**
 * Fetch the held-avatar roster from the platform. The platform bundles no
 * models (none are ours to distribute — Design note, 2026-08-06; modelDir is the
 * real folder the operator drops their own .vrm into, so the empty state can
 * name it instead of gesturing at a URL path.
 * @returns {Promise<{avatars: Array<{name: string, displayName: string}>, modelDir: string|null}>}
 */
// impure
export const fetchVessels = async () => {
  // The thrown string is a fixed contract (server error text never replaces
  // it); the rethrow keeps the exact legacy shape off apiCall's error.http.
  const body = await apiCall('GET', '/api/v1/avatars', { strictJson: true, useServerError: false })
    .catch((error) => {
      throw error.http ? new Error(`avatar roster fetch failed: ${error.http}`) : error;
    });
  return {
    avatars: Array.isArray(body.avatars) ? body.avatars : [],
    modelDir: typeof body.modelDir === 'string' && body.modelDir ? body.modelDir : null,
  };
};
