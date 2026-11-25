// atlas-client.js — the memory atlas, operator side.
//
// impure — three reads over REST: the atlas (topics, people, months, kinds and
// every memory's one line), a plain every-word search, and one memory opened
// with its source and nearest memories. A failure never collapses into an
// empty success: the view says a read failed, so the HTTP status travels back.

import { apiCall, authHeadersOrNull as authHeaders } from '../../../utils/http.js';

const read = async (neumaId, path, what) => {
  const headers = authHeaders();
  if (!neumaId || !headers) return { ok: false, status: null };
  try {
    return { ok: true, data: await apiCall('GET', `/api/v1/workspace/${neumaId}/memory/atlas${path}`, { headers }) };
  } catch (e) {
    if (e.http) return { ok: false, status: e.http };
    console.warn(`[atlas] ${what} unreachable`, e);
    return { ok: false, status: null };
  }
};

/** @returns {Promise<{ok:true, data:Object}|{ok:false, status:(number|null)}>} */
export const loadAtlas = (neumaId) => read(neumaId, '', 'atlas');

/** @returns {Promise<{ok:true, data:{ids:string[], words:string[]}}|{ok:false, status:(number|null)}>} */
export const searchAtlas = (neumaId, words) => read(neumaId, `/search?q=${encodeURIComponent(words)}`, 'search');

/** @returns {Promise<{ok:true, data:Object}|{ok:false, status:(number|null)}>} */
export const openAtlasMemory = (neumaId, memoryId) => read(neumaId, `/memory/${encodeURIComponent(memoryId)}`, 'memory');
