/**
 * Every model a LOCAL server can serve — not only the one it has loaded
 * (Design note, 2026-10-14: […]).
 *
 * The OpenAI-compatible /v1/models of LM Studio lists LOADED models only, so a
 * machine with forty models downloaded and none loaded read as "no model". LM
 * Studio's own REST list (/api/v1/models, then the older /api/v0/models) names
 * every downloaded model; a chosen one that is not loaded is loaded before the
 * turn (ensureLmStudioLoaded). Ollama's /api/tags
 * already lists every pulled model; llama.cpp's /v1/models lists what it can
 * serve (one model, or every model in router mode).
 *
 * One reader, so the harness door, Settings → Models and the connect probe
 * (provider-probe.js liveModels) never disagree about a server.
 */

const TIMEOUT_MS = 2500;
const NOT_CHAT = new Set(['embedding', 'embeddings']);

// impure — GET JSON with a short timeout; null on any failure
export const getJson = async (url) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
};

/**
 * LM Studio's REST list → chat models, loaded ones first. Pure.
 * /api/v1/models: {models:[{type, key, display_name, loaded_instances}]}
 * /api/v0/models: {data:[{type, id, state}]}
 * @returns {Array<{id: string, name: string, loaded: boolean}>|null} null when the payload is neither shape
 */
export const parseLmStudioCatalog = (json) => {
  const v1 = Array.isArray(json?.models) ? json.models.map((m) => ({
    type: m.type, id: m.key, name: m.display_name || m.key, loaded: (m.loaded_instances || []).length > 0,
  })) : null;
  // v0 rows always carry `state` — a plain OpenAI {data:[{id}]} list is not LM Studio's
  const v0 = Array.isArray(json?.data) && json.data.length && json.data.every((m) => typeof m?.state === 'string')
    ? json.data.map((m) => ({ type: m.type, id: m.id, name: m.id, loaded: m.state === 'loaded' })) : null;
  const rows = v1 || v0;
  if (!rows) return null;
  return rows
    .filter((m) => m.id && !NOT_CHAT.has(m.type))
    .map(({ id, name, loaded }) => ({ id, name, loaded }))
    .sort((a, b) => Number(b.loaded) - Number(a.loaded));
};

/** An OpenAI-compatible /v1/models payload → ids. Pure. */
const openAiIds = (json) => (Array.isArray(json?.data) ? json.data.map((m) => m.id).filter(Boolean) : []);

/**
 * impure — LM Studio's downloaded chat models, or null when its REST list is
 * not served (an older build, or not LM Studio at all).
 * @param {string} base e.g. http://localhost:1234
 */
export const lmStudioCatalog = async (base) => {
  const clean = String(base || '').replace(/\/+$/, '');
  for (const path of ['/api/v1/models', '/api/v0/models']) {
    const list = parseLmStudioCatalog(await getJson(`${clean}${path}`));
    if (list && list.length) return list;
  }
  return null;
};

/**
 * impure — every model id an OpenAI-compatible local server can serve: LM
 * Studio's downloaded models when it answers its REST list, else /v1/models.
 * @param {string} base
 * @param {object|null} [v1] an already-read /v1/models payload
 * @returns {Promise<string[]>}
 */
export const servableModelIds = async (base, v1 = null) => {
  const catalog = await lmStudioCatalog(base);
  if (catalog) return catalog.map((m) => m.id);
  return openAiIds(v1 || await getJson(`${String(base || '').replace(/\/+$/, '')}/v1/models`));
};

const LOAD_TIMEOUT_MS = 10 * 60 * 1000; // a 30 GB model from a cold disk
// The window a load asks for. LM Studio's own default is 4,096 — less than one
// harness turn — and a model's full native window (often 262k) is more memory
// than most local GPUs hold beside the weights. 32k carries long work and fits
// the 8–16 GB machines most local users run (Founder: optimize for the 90%).
export const LM_STUDIO_LOAD_CONTEXT = 32768;
/** The window a downloaded model will be loaded at. Pure. */
export const loadContextFor = (maxContext) => Math.min(Number(maxContext) || LM_STUDIO_LOAD_CONTEXT, LM_STUDIO_LOAD_CONTEXT);
const loading = new Map(); // `${base}|${model}` → the one load in flight

/**
 * impure — make a chosen LM Studio model ready before a turn is sent to it.
 * The picker offers every DOWNLOADED model; LM Studio answers only for a
 * LOADED one unless its own just-in-time loading is on (it was off on Founder's
 * machine: […]). So a downloaded, unloaded model is loaded here
 * through LM Studio's own REST door (/api/v1/models/load — what `lms load`
 * does) at a window a turn fits in (loadContextFor), once, with concurrent
 * turns sharing the one load. A server that is
 * not LM Studio, a model it does not list, or one already loaded: nothing.
 * @param {string} endpoint the route's endpoint (with or without /v1)
 * @param {string} model the route's model id (LM Studio's key)
 * @throws {Error} code LOCAL_MODEL_LOAD_FAILED, in LM Studio's own words
 */
export const ensureLmStudioLoaded = async (endpoint, model) => {
  const base = String(endpoint || '').replace(/\/+$/, '').replace(/\/v1$/, '');
  if (!base || !model) return;
  const entry = (await lmStudioCatalog(base))?.find((m) => m.id === model);
  if (!entry || entry.loaded) return;
  const listed = (await getJson(`${base}/api/v1/models`))?.models?.find((m) => m.key === model);
  const key = `${base}|${model}`;
  if (!loading.has(key)) {
    const load = (async () => {
      const res = await fetch(`${base}/api/v1/models/load`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, context_length: loadContextFor(listed?.max_context_length) }),
        signal: AbortSignal.timeout(LOAD_TIMEOUT_MS),
      });
      if (res.ok) return;
      const said = (await res.json().catch(() => null))?.error;
      const err = new Error(`LM Studio could not load ${model}: ${said?.message || `HTTP ${res.status}`}`);
      err.code = 'LOCAL_MODEL_LOAD_FAILED';
      throw err;
    })().finally(() => loading.delete(key));
    loading.set(key, load);
  }
  await loading.get(key);
};

/**
 * impure — what a DOWNLOADED LM Studio model will hold: the window it is
 * loaded at, else the one ensureLmStudioLoaded will load it at — so a turn's
 * prompt is sized for the model it will meet, never LM Studio's 4,096 default.
 * @returns {Promise<{contextWindow: number, vision: boolean}|null>} null when not listed
 */
export const lmStudioDownloadedCaps = async (base, modelId) => {
  const clean = String(base || '').replace(/\/+$/, '').replace(/\/v1$/, '');
  const listed = (await getJson(`${clean}/api/v1/models`))?.models?.find((m) => m.key === modelId);
  return listed ? Object.freeze({
    contextWindow: listed.loaded_instances?.[0]?.config?.context_length ?? loadContextFor(listed.max_context_length),
    vision: Boolean(listed.capabilities?.vision),
  }) : null;
};
