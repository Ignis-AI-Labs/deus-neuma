// Integration: measured token usage capture over real HTTP/SSE (B-03).
//
// GNOSIS — no mocks: a real Node http server on an ephemeral 127.0.0.1 port
// speaks OpenAI-compatible SSE, and the provider is pointed at it through
// setConfig exactly the way the platform configures a custom endpoint. Both
// sides of the contract are proven for real: the request body the server
// RECEIVED carries stream_options.include_usage, and the stream the provider
// CONSUMED yields measured usage — or an explicit null when the capability
// is absent (visible downgrade, never a faked zero, never a throw).

import http from 'node:http';
import { isThinkProbe, respondThinkProbe } from '../helpers/think-probe.js';
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setConfig,
  createStreamRequest,
  consumeStream,
  consumeStreamWithTools,
} from '../../backend/services/llm-provider.js';

const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

const DELTA_LINES = [
  sse({ choices: [{ delta: { content: 'Hello' } }] }),
  sse({ choices: [{ delta: { content: ' world' } }] }),
];
// Real providers emit the usage chunk with an EMPTY choices array
const USAGE_LINE = sse({ choices: [], usage: { prompt_tokens: 123, completion_tokens: 7 } });
const MALFORMED_USAGE_LINE = sse({ choices: [], usage: 'garbage' });
const DONE_LINE = 'data: [DONE]\n\n';

// Sentinel distinguishes […] from "never fired"
const UNSET = Symbol('unset');

describe('llm-provider usage capture (real SSE server)', () => {
  let server;
  let received;    // parsed request bodies the server actually got
  let scriptLines; // SSE payload the server streams for the next request

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        // A BODYLESS PROBE MUST NOT KILL THE RUN. Some probes arrive as a GET,
        // so `raw` is empty and JSON.parse throws — inside the server's own
        // handler, where nothing catches it. That surfaces as an UNCAUGHT
        // EXCEPTION attributed to whichever test happened to be in flight, and
        // it takes the file down with it. Measured: this file passes alone and
        // failed only under a 25-file parallel run, blaming a test that had
        // already finished. Answer the probe the same way a non-turn body is
        // answered, and let the real assertions speak.
        let body;
        try { body = JSON.parse(raw); } catch { body = {}; }
        // A CAPABILITY PROBE IS NOT A TURN. The provider asks the endpoint what
        // it can do before speaking (Ollama's /api/show, llama.cpp's /props), so
        // the server sees two requests where the test means one — `received[0]`
        // was arriving as `{ name: 'test-model' }`, a show-probe body, not a
        // completion. A turn is the thing carrying `messages`; anything else is
        // answered and left out of `received`. Same separation
        // test/helpers/local-provider.js makes, for the same measured reason.
        if (isThinkProbe(body)) { respondThinkProbe(res); return; }
        if (!Array.isArray(body.messages)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ model_info: {}, capabilities: [] }));
          return;
        }
        received.push(body);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const line of scriptLines) res.write(line);
        res.end();
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    // Explicit model skips the 'local-model' active-model resolution round-trip
    setConfig({ provider: 'lm-studio', endpoint: `http://127.0.0.1:${port}`, apiKey: '', model: 'test-model' });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    received = [];
    scriptLines = [];
  });

  test('captures final-chunk usage and asked for it via stream_options.include_usage', async () => {
    scriptLines = [...DELTA_LINES, USAGE_LINE, DONE_LINE];
    const chunks = [];
    let usage = UNSET;

    const streamResult = await createStreamRequest([{ role: 'user', content: 'hi' }]);
    const text = await consumeStream(streamResult, (c) => chunks.push(c), {
      onUsage: (u) => { usage = u; },
    });

    expect(text).toBe('Hello world');
    expect(chunks.join('')).toBe('Hello world');
    expect(usage).toEqual({ promptTokens: 123, completionTokens: 7 });

    // Request side — the body the real server received carried the ask
    expect(received).toHaveLength(1);
    expect(received[0].stream).toBe(true);
    expect(received[0].stream_options).toEqual({ include_usage: true });
    expect(received[0].model).toBe('test-model');
  });

  test('usage chunk absent — text intact, usage is explicit null', async () => {
    scriptLines = [...DELTA_LINES, DONE_LINE];
    let usage = UNSET;

    const streamResult = await createStreamRequest([{ role: 'user', content: 'hi' }]);
    const text = await consumeStream(streamResult, () => {}, {
      onUsage: (u) => { usage = u; },
    });

    expect(text).toBe('Hello world');
    expect(usage).toBeNull();
  });

  test('malformed usage chunk — text intact, usage null, no crash', async () => {
    scriptLines = [...DELTA_LINES, MALFORMED_USAGE_LINE, DONE_LINE];
    let usage = UNSET;

    const streamResult = await createStreamRequest([{ role: 'user', content: 'hi' }]);
    const text = await consumeStream(streamResult, () => {}, {
      onUsage: (u) => { usage = u; },
    });

    expect(text).toBe('Hello world');
    expect(usage).toBeNull();
  });

  test('consumeStreamWithTools carries the same onUsage contract', async () => {
    scriptLines = [...DELTA_LINES, USAGE_LINE, DONE_LINE];
    let usage = UNSET;

    const streamResult = await createStreamRequest([{ role: 'user', content: 'hi' }]);
    const result = await consumeStreamWithTools(streamResult, () => {}, {
      onUsage: (u) => { usage = u; },
    });

    expect(result.content).toBe('Hello world');
    expect(result.toolCalls).toEqual([]);
    expect(usage).toEqual({ promptTokens: 123, completionTokens: 7 });
  });

  test('stream without [DONE] terminator still resolves usage on connection end', async () => {
    // Some servers close the connection after the usage chunk without a
    // [DONE] line — the reader-done exit path must honor the contract too
    scriptLines = [...DELTA_LINES, USAGE_LINE];
    let usage = UNSET;

    const streamResult = await createStreamRequest([{ role: 'user', content: 'hi' }]);
    const text = await consumeStream(streamResult, () => {}, {
      onUsage: (u) => { usage = u; },
    });

    expect(text).toBe('Hello world');
    expect(usage).toEqual({ promptTokens: 123, completionTokens: 7 });
  });

  test('Anthropic usage split across start and delta events is measured', async () => {
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    setConfig({ provider: 'anthropic', endpoint, apiKey: 'wire-key', model: 'claude-test' });
    scriptLines = [
      sse({ type: 'message_start', message: { usage: { input_tokens: 41 } } }),
      sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } }),
      sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 6 } }),
      sse({ type: 'message_stop' }),
    ];
    let usage = UNSET;

    const streamResult = await createStreamRequest([{ role: 'user', content: 'hi' }]);
    const text = await consumeStream(streamResult, () => {}, { onUsage: (value) => { usage = value; } });

    expect(text).toBe('hello');
    expect(usage).toEqual({ promptTokens: 41, completionTokens: 6 });
  });

  test('Ollama final counts are measured', async () => {
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    setConfig({ provider: 'ollama', endpoint, apiKey: '', model: 'ollama-test' });
    scriptLines = [
      `${JSON.stringify({ message: { content: 'hello' }, done: false })}\n`,
      `${JSON.stringify({ done: true, done_reason: 'stop', prompt_eval_count: 19, eval_count: 4 })}\n`,
    ];
    let usage = UNSET;

    const streamResult = await createStreamRequest([{ role: 'user', content: 'hi' }]);
    const text = await consumeStream(streamResult, () => {}, { onUsage: (value) => { usage = value; } });

    expect(text).toBe('hello');
    expect(usage).toEqual({ promptTokens: 19, completionTokens: 4 });
  });
});
