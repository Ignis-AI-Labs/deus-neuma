// skills-client.js — the installed skills library, from the witness's side.
//
// Reads GET /api/v1/skills (auth-gated) and caches the list for the session:
// the library changes only when something installs into it, and the palette
// must open instantly on "/". Failure (no auth yet, backend down) yields an
// empty library — the palette simply doesn't open; the composer never breaks.
//
// Neither export ever rejects. `listSkillsResult` additionally reports
// whether the read genuinely succeeded, so surfaces that must stay honest
// (THE CRAFT) can tell "library is empty" from "library is unreachable".

import { apiCall, authHeadersOrNull } from '../utils/http.js';

let cache = null;

/**
 * Fetch + memoize the library, with an honest success flag.
 * @returns {Promise<{ok: boolean, skills: Array<Object>}>} never rejects
 */
// impure
export const listSkillsResult = async () => {
  if (cache) return { ok: true, skills: cache };
  const headers = authHeadersOrNull();
  if (!headers) return { ok: false, skills: [] };
  try {
    const data = await apiCall('GET', '/api/v1/skills', { headers, strictJson: true });
    cache = Array.isArray(data.skills) ? data.skills : [];
    return { ok: true, skills: cache };
  } catch (e) {
    if (e.http) console.warn('[skills] library read failed', e.http);
    else console.warn('[skills] library unreachable', e);
    return { ok: false, skills: [] };
  }
};

// impure — the palette's view: just the list, empty on any failure
export const listSkills = async () => (await listSkillsResult()).skills;
