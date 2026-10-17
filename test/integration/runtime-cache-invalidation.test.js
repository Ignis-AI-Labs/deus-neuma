/** Real HTTP ordering proves cache ownership; response bodies are protocol fixtures. */
import { createServer } from 'node:http';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  getRouteCapabilities, getThinkBehavior, expireRuntimeModelCaches,
  _resetCapsCache, _expireCapsCache,
} from '../../backend/services/llm-provider.js';

let server, endpoint;
const responses = new Set();
beforeEach(() => { _resetCapsCache(); expireRuntimeModelCaches(); });
afterEach(async () => {
  for (const res of responses) res.destroy();
  responses.clear();
  server?.closeAllConnections();
  if (server) await new Promise((resolve) => server.close(resolve));
  expireRuntimeModelCaches();
});

const start = async (handle) => {
  server = createServer((req, res) => {
    responses.add(res);
    res.once('close', () => responses.delete(res));
    req.resume();
    handle(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${server.address().port}`;
};
const json = (res, data) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

test('old capability responses cannot overwrite a newer generation or its last-good reading', async () => {
  let release, arrived;
  let hits = 0;
  let noWindow = false;
  const received = new Promise((resolve) => { arrived = resolve; });
  await start((req, res) => {
    if (req.url !== '/props') return res.writeHead(404).end();
    hits++;
    if (hits === 1) {
      release = () => json(res, { default_generation_settings: { n_ctx: 262144 } });
      arrived();
    } else json(res, noWindow ? {} : { default_generation_settings: { n_ctx: 131072 } });
  });
  const route = { provider: 'llama-server', endpoint, model: 'cache-generation-proof' };
  const old = getRouteCapabilities(route);
  await received;
  expireRuntimeModelCaches();
  expect((await getRouteCapabilities(route)).contextWindow).toBe(131072);
  release();
  expect((await old).contextWindow).toBe(262144);
  expect((await getRouteCapabilities(route)).contextWindow).toBe(131072);
  expect(hits).toBe(2);
  _expireCapsCache();
  noWindow = true;
  expect(await getRouteCapabilities(route)).toMatchObject({
    contextWindow: 131072, contextWindowSource: 'provider-runtime-last-good',
  });
});

test('old reasoning responses cannot replace the post-switch filter classification', async () => {
  let release, arrived;
  let hits = 0;
  const received = new Promise((resolve) => { arrived = resolve; });
  await start((_req, res) => {
    hits++;
    if (hits === 1) {
      release = () => json(res, { choices: [{ message: { content: 'reasoning\n</think>\nready' } }] });
      arrived();
    } else json(res, { choices: [{ message: { content: 'ready' } }] });
  });
  const route = { provider: 'custom', endpoint, model: 'cache-generation-proof', apiKey: '' };
  const old = getThinkBehavior(route);
  await received;
  expireRuntimeModelCaches();
  expect(await getThinkBehavior(route)).toEqual({ thinks: false, implicitOpen: false, serverBudget: false });
  release();
  expect(await old).toEqual({ thinks: true, implicitOpen: true, serverBudget: false });
  expect(await getThinkBehavior(route)).toEqual({ thinks: false, implicitOpen: false, serverBudget: false });
  expect(hits).toBe(2);
});
