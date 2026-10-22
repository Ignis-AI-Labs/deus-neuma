// The harness door's LOCAL road (Design note, 2026-10-14: […]). It reads the same machine
// probe the birth's flight check reads — GET /api/v1/preflight/setup: Ollama
// and LM Studio at their configured addresses, plus every local server the
// port sweep finds (a llama.cpp on any port). Pure.

const NAMES = Object.freeze({ ollama: 'Ollama', 'lm-studio': 'LM Studio', 'llama-server': 'llama.cpp' });
/** The name a person knows a local server by — llama.cpp, not llama-server. */
export const serverName = (providerId) => NAMES[providerId] || null;
const RANK = Object.freeze({ ready: 0, empty: 1, off: 2 });

// the same server reached as localhost or 127.0.0.1, with or without a slash
const fold = (endpoint) => String(endpoint || '').replace(/\/+$/, '').replace('//localhost', '//127.0.0.1');

/** Whether two addresses name one server. */
export const sameEndpoint = (a, b) => fold(a) === fold(b);

const stateOf = (s) => (!s.running ? 'off' : s.models.length ? 'ready' : 'empty');

/**
 * One row per local model server: ready (models loaded) first, then running
 * with nothing loaded, then the addresses where nothing answered.
 * @param {object|null} setup the /preflight/setup payload
 * @returns {Array<{providerId: string, name: string, endpoint: string, state: 'ready'|'empty'|'off', models: string[], loaded: number}>}
 */
export const localServers = (setup) => {
  const p = setup?.providers || {};
  const sightings = [
    { providerId: 'ollama', ...(p.ollama || {}) },
    { providerId: 'lm-studio', ...(p.lmStudio || {}) },
    ...(p.discovered || []).map((d) => ({ providerId: d.provider, running: true, models: d.models, available: d.available, endpoint: d.endpoint })),
  ].filter((s) => s.endpoint && NAMES[s.providerId]);
  // a running sighting of a server outranks a silent one at the same address
  const merged = sightings.reduce((rows, s) => {
    const at = rows.findIndex((r) => sameEndpoint(r.endpoint, s.endpoint));
    if (at === -1) return [...rows, s];
    return rows[at].running || !s.running ? rows : rows.map((r, i) => (i === at ? s : r));
  }, []);
  // `models` is what the server has LOADED; `available`, when the server says,
  // is every model it can serve (LM Studio loads one on first use) — the row
  // offers all of them (backend/services/local-server-models.js)
  const list = (v) => (Array.isArray(v) ? v : []);
  return merged
    .map((s) => {
      const loaded = list(s.models);
      const models = list(s.available).length ? [...new Set([...loaded, ...s.available])] : loaded;
      return {
        providerId: s.providerId, name: NAMES[s.providerId], endpoint: s.endpoint, models,
        loaded: loaded.length, state: stateOf({ running: Boolean(s.running), models }),
      };
    })
    .sort((a, b) => RANK[a.state] - RANK[b.state]);
};

/**
 * What the person must do next on this machine, or null when a server is ready.
 * @param {ReturnType<typeof localServers>} servers
 * @param {{model?: string|null, quant?: string, sizeGB?: number}|null} recommendation
 * @returns {string|null}
 */
export const localGuide = (servers, recommendation) => {
  if (servers.some((s) => s.state === 'ready')) return null;
  const model = recommendation?.model
    ? `${recommendation.model}${recommendation.quant ? ` ${recommendation.quant}` : ''}${recommendation.sizeGB ? ` (~${recommendation.sizeGB} GB)` : ''}`
    : 'a model';
  const idle = servers.find((s) => s.state === 'empty');
  if (idle) return `${idle.name} is running with no model loaded — load ${model} in it, then RECHECK.`;
  return `No model server is running on this machine. Install Ollama (ollama.com) or LM Studio (lmstudio.ai), start it, load ${model} — then RECHECK. `
    + 'A server on another computer: add its address in Settings → Models.';
};

/**
 * The address to store for the server's provider before connecting, or null
 * when the provider already points there (the harness lane rides the
 * provider's stored address, harness-lane.js resolveHarnessRoute).
 * @param {{providerId: string, endpoint: string}} server
 * @param {Array<{id: string, endpoint?: string|null}>} providers the routing catalog
 */
export const endpointToStore = (server, providers) => {
  const provider = (providers || []).find((p) => p.id === server.providerId);
  return provider && sameEndpoint(provider.endpoint, server.endpoint) ? null : server.endpoint;
};

/** The model a ready server offers for the ModelPicker. */
export const serverModels = (server) => (server?.models || []).map((id) => ({ id, name: id }));

/**
 * A model id as a person reads it: Ollama's Hugging Face form loses its host, owner and
 * "-GGUF" (hf.co/org/Qwen3.8-4B-Distill-GGUF:Q4_K_M → Qwen3.8-4B-Distill · Q4_K_M). Pure.
 * @param {string} id
 * @returns {string}
 */
export const modelLabel = (id) => {
  const m = /^hf\.co\/[^/]+\/([^:]+?)(?:-GGUF)?(?::(.+))?$/i.exec(String(id || ''));
  return m ? `${m[1]}${m[2] ? ` · ${m[2]}` : ''}` : String(id || '');
};

/** The first model a ready local server holds, as a person reads it, or null. Pure. */
export const readyModelLabel = (setup) => {
  const ready = localServers(setup).find((s) => s.state === 'ready');
  return ready?.models[0] ? modelLabel(ready.models[0]) : null;
};
