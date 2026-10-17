// Authentication and authorization failures on the adapter inventory are not
// proof that a local conduit carries no adapters. This real HTTP wire pins the
// fail-closed contract: no chat request may ride until adapter state is known.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import {
  createStreamRequest,
  invalidateServerAdapters,
} from '../../backend/services/llm-provider.js';

let server;
let endpoint;
let probeStatus = 401;
let chatRequests = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/lora-adapters') {
      res.writeHead(probeStatus).end();
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      chatRequests += 1;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"unsafe"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const attempt = async (status) => {
  probeStatus = status;
  chatRequests = 0;
  invalidateServerAdapters(endpoint);
  const turn = createStreamRequest(
    [{ role: 'user', content: 'identity boundary probe' }],
    { route: { provider: 'custom', endpoint, model: 'local-model', apiKey: 'secret' } },
  );
  await expect(turn).rejects.toThrow(/adapter scales unknowable/);
  expect(chatRequests).toBe(0);
};

describe('local adapter inventory authorization failures', () => {
  it.each([401, 403])('refuses the turn after HTTP %i instead of assuming no adapters', attempt);
});
