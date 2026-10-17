/** Real accepting-but-unresponsive HTTP endpoints; no model inference. */
import { createServer } from 'node:http';
import { beforeEach, afterEach, expect, test } from 'vitest';
import { getConfig, setConfig, getModels } from '../../backend/services/llm-selection.js';
import { probeThinkBehavior } from '../../backend/services/llm-think-probe.js';
import { isTransientProviderError } from '../../backend/services/provider-retry.js';
import { queryLocalCapabilities } from '../../backend/services/model-capabilities.js';

let server, endpoint, savedConfig, paths, respond;
beforeEach(async () => {
  savedConfig = getConfig();
  paths = [];
  respond = () => {};
  server = createServer((req, res) => {
    paths.push(req.url);
    req.resume();
    respond(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  setConfig(savedConfig);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test.each(['ollama', 'custom'])('%s model listing stops waiting on a wedged endpoint', async (provider) => {
  setConfig({ provider, endpoint, model: 'probe-fixture', apiKey: '' });
  const started = Date.now();
  expect(await getModels()).toEqual([]);
  expect(Date.now() - started).toBeGreaterThanOrEqual(2500);
  expect(paths).toEqual([provider === 'ollama' ? '/api/tags' : '/v1/models']);
}, 15000);

test('reasoning-shape probe aborts its actual unresponsive request', async () => {
  const started = Date.now();
  await expect(probeThinkBehavior({ provider: 'custom', endpoint, model: 'probe-fixture', apiKey: '' }, 'probe-fixture'))
    .rejects.toMatchObject({ name: 'TimeoutError' });
  expect(Date.now() - started).toBeGreaterThanOrEqual(9000);
  expect(paths).toEqual(['/v1/chat/completions']);
}, 15000);

test('unknown adapter state is retryable while explicit authority refusal stays permanent', () => {
  expect(isTransientProviderError({ code: 'adapter_probe_unknown', message: 'not ready' })).toBe(true);
  expect(isTransientProviderError({ code: 'permission_error', message: 'not allowed' })).toBe(false);
});

test('fallback dialect requests overlap on the wire and keep declared priority', async () => {
  let ollamaResponse, lmsResponse;
  let overlapped = false;
  const json = (res, body) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  respond = (req, res) => {
    if (req.url === '/props') return json(res, {});
    if (req.url === '/api/show') ollamaResponse = res;
    else if (req.url === '/api/v0/models') lmsResponse = res;
    else return res.writeHead(404).end();
    if (ollamaResponse && lmsResponse) {
      overlapped = !ollamaResponse.destroyed && !lmsResponse.destroyed;
      json(lmsResponse, { data: [{ id: 'probe-fixture', max_context_length: 32768 }] });
      json(ollamaResponse, { parameters: 'num_ctx 65536' });
    }
  };
  const result = await queryLocalCapabilities('llama-server', endpoint, 'probe-fixture');
  expect(overlapped).toBe(true);
  expect(result.contextWindow).toBe(65536);
});
