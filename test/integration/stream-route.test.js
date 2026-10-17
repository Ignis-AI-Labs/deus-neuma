/**
 * Per-neuma routing at the wire (2a-i). An explicit route handed to
 * createStreamRequest must direct the request to THAT provider's endpoint,
 * path, key, and model — overriding the machine-wide config for the one call.
 *
 * Proven against a REAL local HTTP server capturing the actual request (RULE 0
 * — a real socket, no mocked fetch). We assert on what the provider received,
 * then cancel the stream.
 */
import { describe, test, expect, afterEach } from 'vitest';
import http from 'http';
import { createStreamRequest, configFromRoute } from '../../backend/services/llm-provider.js';

let server;
let captured;

const startServer = () => new Promise((resolve) => {
  captured = [];
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      captured.push({ url: req.url, headers: req.headers, body: JSON.parse(body || '{}') });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

afterEach(() => new Promise((r) => (server ? server.close(() => { server = null; r(); }) : r())));

describe('configFromRoute (pure)', () => {
  test('carries the route wire fields and takes sampling from the global config', () => {
    const cfg = configFromRoute(
      { provider: 'openai', endpoint: 'https://api.openai.com', apiKey: 'k', model: 'gpt-4o', chatPath: '/v1/chat/completions' },
      { temperature: 0.7, maxTokens: 100, topP: 0.9 },
    );
    expect(cfg).toMatchObject({ provider: 'openai', model: 'gpt-4o', temperature: 0.7, maxTokens: 100, topP: 0.9 });
    expect(Object.isFrozen(cfg)).toBe(true);
  });
});

describe('createStreamRequest honors an explicit route (real server)', () => {
  test('an OpenAI-compatible route honors a custom chatPath, bearer key, and model', async () => {
    const port = await startServer();
    const route = {
      provider: 'z-ai',
      endpoint: `http://127.0.0.1:${port}/api/paas/v4`,
      apiKey: 'test-key-123',
      model: 'glm-4.6',
      chatPath: '/chat/completions',
    };
    const { response, provider } = await createStreamRequest(
      [{ role: 'user', content: 'hi' }],
      { route, temperature: 0.5, maxTokens: 16 },
    );
    expect(response.ok).toBe(true);
    await response.body.getReader().cancel();

    expect(provider).toBe('z-ai');
    expect(captured).toHaveLength(1);
    const req = captured[0];
    expect(req.url).toBe('/api/paas/v4/chat/completions'); // chatPath honored, not forced to /v1
    expect(req.headers.authorization).toBe('Bearer test-key-123');
    expect(req.body.model).toBe('glm-4.6');
    expect(req.body.temperature).toBe(0.5);
  }, 20000);

  test('an anthropic route uses the Messages path and x-api-key header', async () => {
    const port = await startServer();
    const route = {
      provider: 'anthropic',
      endpoint: `http://127.0.0.1:${port}`,
      apiKey: 'sk-ant-1',
      model: 'claude-haiku-4-5',
      chatPath: '/v1/messages',
    };
    const { response } = await createStreamRequest(
      [{ role: 'user', content: 'hi' }],
      { route, maxTokens: 8 },
    );
    await response.body.getReader().cancel();

    const req = captured[0];
    expect(req.url).toBe('/v1/messages');
    expect(req.headers['x-api-key']).toBe('sk-ant-1');
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    expect(req.headers.authorization).toBeUndefined(); // anthropic never uses Bearer
    expect(req.body.model).toBe('claude-haiku-4-5');
  }, 20000);
});
