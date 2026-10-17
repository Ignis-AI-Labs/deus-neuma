/**
 * EVERY MODEL A LOCAL SERVER CAN SERVE (RULE 0) — not only the loaded one.
 *
 * Design note, 2026-10-14, at the harness door: LM Studio read […] on a machine holding 42 downloaded models — its OpenAI-compatible
 * /v1/models lists LOADED models only. […] LM Studio's own REST list names every downloaded model.
 *
 * Nothing mocked: REAL http servers speak the real LM Studio shapes on real
 * ports, and the real readers (local-server-models.js, the port-sweep
 * identifier, the routing probe) make real requests to them. When LM Studio
 * itself is serving on this machine, it is read too — read only.
 */
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { servableModelIds, lmStudioCatalog, parseLmStudioCatalog, ensureLmStudioLoaded } from '../../backend/services/local-server-models.js';
import { identifyEndpoint } from '../../backend/services/provider-discovery.js';
import { liveModels } from '../../backend/services/provider-probe.js';
import { getProvider } from '../../backend/services/provider-registry.js';
import { createStreamRequest, getConfig, setConfig } from '../../backend/services/llm-provider.js';

const REAL_LM_STUDIO = 'http://127.0.0.1:1234';

// LM Studio 0.4: /v1/models = loaded only; /api/v1/models = every download
const V1_ALL = {
  models: [
    { type: 'llm', key: 'qwen/qwen3-32b', display_name: 'Qwen3 32B', loaded_instances: [] },
    { type: 'embedding', key: 'text-embedding-nomic', display_name: 'Nomic', loaded_instances: [] },
    { type: 'llm', key: 'google/gemma-3-12b', display_name: 'Gemma 3 12B', loaded_instances: [{ id: 'g' }] },
    { type: 'vlm', key: 'qwen/qwen3-vl-8b', display_name: 'Qwen3 VL 8B', loaded_instances: [] },
  ],
};
// an older LM Studio: only the v0 REST list
const V0_ALL = { data: [{ type: 'llm', id: 'mistral-7b', state: 'not-loaded' }, { type: 'embeddings', id: 'e5', state: 'not-loaded' }] };

const serve = (routes) => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    const body = routes[req.url];
    if (body === undefined) { res.writeHead(404); res.end('{}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});
const base = (server) => `http://127.0.0.1:${server.address().port}`;

let modern; let older; let llamacpp; let realLmStudio = false;

beforeAll(async () => {
  // LM Studio runs llama.cpp inside and answers /props as well
  modern = await serve({ '/v1/models': { data: [{ id: 'google/gemma-3-12b' }] }, '/api/v1/models': V1_ALL, '/props': {} });
  older = await serve({ '/v1/models': { data: [] }, '/api/v0/models': V0_ALL });
  llamacpp = await serve({ '/v1/models': { data: [{ id: 'qwen3.8-27b-q8_0.gguf' }] }, '/props': { model_path: '/m/q.gguf' } });
  try {
    realLmStudio = (await fetch(`${REAL_LM_STUDIO}/api/v1/models`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch { realLmStudio = false; }
});

afterAll(async () => {
  await Promise.all([modern, older, llamacpp].map((s) => new Promise((r) => s.close(r))));
});

describe('the LM Studio catalog', () => {
  test('every downloaded chat model, loaded first, embeddings left out', async () => {
    expect(await lmStudioCatalog(base(modern))).toEqual([
      { id: 'google/gemma-3-12b', name: 'Gemma 3 12B', loaded: true },
      { id: 'qwen/qwen3-32b', name: 'Qwen3 32B', loaded: false },
      { id: 'qwen/qwen3-vl-8b', name: 'Qwen3 VL 8B', loaded: false },
    ]);
  });

  test('an older LM Studio is read through its v0 list', async () => {
    expect(await servableModelIds(base(older))).toEqual(['mistral-7b']);
  });

  test('a server with no REST list falls back to what /v1/models names', async () => {
    expect(await lmStudioCatalog(base(llamacpp))).toBeNull();
    expect(await servableModelIds(base(llamacpp))).toEqual(['qwen3.8-27b-q8_0.gguf']);
  });

  test('a payload of neither shape reads as no catalog', () => {
    expect(parseLmStudioCatalog(null)).toBeNull();
    expect(parseLmStudioCatalog({ object: 'list' })).toBeNull();
  });
});

describe('every reader agrees', () => {
  test('the port sweep: LM Studio — even answering /props — names what is loaded AND everything it can serve', async () => {
    const found = await identifyEndpoint(base(modern));
    expect(found.provider).toBe('lm-studio');
    expect(found.models).toEqual(['google/gemma-3-12b']); // the flight check adopts only from what is loaded
    expect(found.available).toEqual(['google/gemma-3-12b', 'qwen/qwen3-32b', 'qwen/qwen3-vl-8b']);
  });

  test('the sweep leaves llama.cpp as it was', async () => {
    expect(await identifyEndpoint(base(llamacpp))).toEqual({
      provider: 'llama-server', endpoint: base(llamacpp), models: ['qwen3.8-27b-q8_0.gguf'],
    });
  });

  test('the routing probe (Settings → Models, CONNECT) lists them all, by their names', async () => {
    const models = await liveModels(getProvider('lm-studio'), base(modern), '');
    expect(models.map((m) => [m.id, m.name])).toEqual([
      ['google/gemma-3-12b', 'Gemma 3 12B'], ['qwen/qwen3-32b', 'Qwen3 32B'], ['qwen/qwen3-vl-8b', 'Qwen3 VL 8B'],
    ]);
  });

  test('this machine\'s own LM Studio, when it serves: every download is offered', async (ctx) => {
    if (!realLmStudio) ctx.skip();
    const v1 = await (await fetch(`${REAL_LM_STUDIO}/v1/models`)).json();
    const all = await servableModelIds(REAL_LM_STUDIO, v1);
    expect(all.length).toBeGreaterThanOrEqual(v1.data.length);
    expect(all.length).toBeGreaterThan(0);
    expect((await identifyEndpoint(REAL_LM_STUDIO)).provider).toBe('lm-studio');
  });
});

describe('a chosen LM Studio model that is not loaded is loaded before the turn (the desk once read "No models loaded")', () => {
  // a real http server holding LM Studio's REST shapes, with state: a load really loads
  const lmStudio = (keys, { refuse = false } = {}) => new Promise((resolve) => {
    const loaded = new Set();
    const loads = [];
    const windows = [];
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET' && req.url === '/api/v1/models') {
          res.end(JSON.stringify({ models: keys.map((key) => ({ type: 'llm', key, max_context_length: 262144, loaded_instances: loaded.has(key) ? [{ id: key }] : [] })) }));
          return;
        }
        if (req.method === 'POST' && req.url === '/v1/chat/completions') {
          const { model } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!loaded.has(model)) { res.writeHead(400); res.end(JSON.stringify({ error: { message: 'No models loaded. Please load a model in the developer page or use the \'lms load\' command.' } })); return; }
          res.end('data: {"choices":[{"delta":{"content":"Paris"}}]}\n\ndata: [DONE]\n\n');
          return;
        }
        if (req.method === 'POST' && req.url === '/api/v1/models/load') {
          const { model, context_length: window } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          loads.push(model);
          windows.push(window);
          if (refuse) { res.writeHead(500); res.end(JSON.stringify({ error: { type: 'load_failed', message: 'not enough memory' } })); return; }
          setTimeout(() => { loaded.add(model); res.end(JSON.stringify({ type: 'llm', instance_id: model, status: 'loaded' })); }, 50);
          return;
        }
        res.writeHead(404); res.end('{}');
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, loads, loaded, windows }));
  });

  test('loads it once, even for two turns at the same moment; then it is simply used', async () => {
    const lm = await lmStudio(['qwen/qwen3-32b']);
    try {
      const at = `${base(lm.server)}/v1`; // routes carry the OpenAI path
      await Promise.all([ensureLmStudioLoaded(at, 'qwen/qwen3-32b'), ensureLmStudioLoaded(at, 'qwen/qwen3-32b')]);
      expect(lm.loads).toEqual(['qwen/qwen3-32b']);
      expect(lm.windows).toEqual([32768]); // never LM Studio's 4,096 default, never the 262k native window
      expect(lm.loaded.has('qwen/qwen3-32b')).toBe(true);
      await ensureLmStudioLoaded(at, 'qwen/qwen3-32b');
      expect(lm.loads).toHaveLength(1); // already loaded: nothing more
    } finally { await new Promise((r) => lm.server.close(r)); }
  });

  test('the turn itself: "No models loaded" → the model is loaded → the same request is asked once more', async () => {
    const lm = await lmStudio(['qwen/qwen3-32b']);
    const saved = getConfig();
    try {
      setConfig({ provider: 'lm-studio', endpoint: base(lm.server), apiKey: '', model: 'qwen/qwen3-32b' });
      const { response } = await createStreamRequest([{ role: 'user', content: 'The capital of France?' }], { maxTokens: 16 });
      expect(response.ok).toBe(true);
      expect(await response.text()).toContain('Paris');
      expect(lm.loads).toEqual(['qwen/qwen3-32b']);
    } finally {
      setConfig(saved);
      await new Promise((r) => lm.server.close(r));
    }
  });

  test('a model it does not list, or a server that is not LM Studio, is left alone', async () => {
    const lm = await lmStudio(['qwen/qwen3-32b']);
    try {
      await ensureLmStudioLoaded(base(lm.server), 'someone/else');
      expect(lm.loads).toEqual([]);
      await expect(ensureLmStudioLoaded(base(llamacpp), 'qwen3.8-27b-q8_0.gguf')).resolves.toBeUndefined();
    } finally { await new Promise((r) => lm.server.close(r)); }
  });

  test('a load LM Studio refuses fails the turn in LM Studio\'s own words', async () => {
    const lm = await lmStudio(['qwen/qwen3-32b'], { refuse: true });
    try {
      await expect(ensureLmStudioLoaded(base(lm.server), 'qwen/qwen3-32b')).rejects.toMatchObject({
        code: 'LOCAL_MODEL_LOAD_FAILED', message: 'LM Studio could not load qwen/qwen3-32b: not enough memory',
      });
    } finally { await new Promise((r) => lm.server.close(r)); }
  });
});

