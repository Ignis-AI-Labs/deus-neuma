import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  consumeStream,
  createStreamRequest,
} from '../../backend/services/llm-provider.js';

const openAIWire = ({ cached = true } = {}) => [
  `data: ${JSON.stringify({ choices: [{ delta: { content: 'OPENAI' }, finish_reason: 'stop' }] })}`,
  `data: ${JSON.stringify({
    choices: [],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 2,
      ...(cached ? { prompt_tokens_details: { cached_tokens: 12 } } : {}),
    },
    ...(cached ? { timings: { prompt_ms: 8.25 } } : {}),
  })}`,
  'data: [DONE]',
  '',
].join('\n');

const RESPONSES_WIRE = [
  `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'RESPONSES' })}`,
  `data: ${JSON.stringify({
    type: 'response.completed',
    response: {
      output: [],
      usage: {
        input_tokens: 30,
        output_tokens: 3,
        input_tokens_details: { cached_tokens: 18 },
      },
    },
  })}`,
  '',
].join('\n');

const ANTHROPIC_WIRE = [
  `data: ${JSON.stringify({
    type: 'message_start',
    message: {
      usage: {
        input_tokens: 40,
        output_tokens: 0,
        cache_read_input_tokens: 25,
      },
    },
  })}`,
  `data: ${JSON.stringify({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'ANTHROPIC' },
  })}`,
  `data: ${JSON.stringify({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: 4 },
  })}`,
  `data: ${JSON.stringify({ type: 'message_stop' })}`,
  '',
].join('\n');

const OLLAMA_WIRE = [
  JSON.stringify({ message: { content: 'OLLAMA' }, done: false }),
  JSON.stringify({
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 50,
    eval_count: 5,
    prompt_eval_duration: 6_500_000,
  }),
  '',
].join('\n');

const streamFor = (url) => {
  if (url === '/v1/chat/completions') return openAIWire();
  if (url === '/v1/chat/completions-absent') return openAIWire({ cached: false });
  if (url === '/responses') return RESPONSES_WIRE;
  if (url === '/v1/messages') return ANTHROPIC_WIRE;
  if (url === '/api/chat') return OLLAMA_WIRE;
  return null;
};

const routeFor = (base, provider, chatPath = undefined) => ({
  provider,
  endpoint: base,
  apiKey: 'wire-proof-key',
  model: 'wire-proof-model',
  ...(chatPath ? { chatPath } : {}),
});

const runRoute = async (route) => {
  const stream = await createStreamRequest(
    [{ role: 'user', content: 'Return the wire proof token.' }],
    { route, maxTokens: 16 },
  );
  let usage = null;
  let telemetry = null;
  const answer = await consumeStream(stream, () => {}, {
    onUsage: (value) => { usage = value; },
    onTelemetry: (value) => { telemetry = value; },
  });
  return { answer, usage, telemetry };
};

const expectMeasuredTtft = (telemetry) => {
  expect(telemetry.providerTtftMilliseconds).toBeGreaterThan(0);
  expect(telemetry.providerTtftMilliseconds).toBeLessThan(2_000);
};

describe('provider cache telemetry over the real HTTP streaming boundary', () => {
  let server;
  let base;
  const requests = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        requests.push({ url: req.url, body: JSON.parse(body) });
        const wire = streamFor(req.url);
        if (wire === null) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        setTimeout(() => res.end(wire), 12);
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('preserves OpenAI cached tokens and llama.cpp-style prefill timing', async () => {
    const result = await runRoute(routeFor(base, 'openai'));

    expect(result.answer).toBe('OPENAI');
    expect(result.usage).toEqual({ promptTokens: 20, completionTokens: 2 });
    expect(result.telemetry).toMatchObject({
      cachedPromptTokens: 12,
      providerPrefillDurationMilliseconds: 8.25,
      providerCacheTelemetryPresent: true,
    });
    expectMeasuredTtft(result.telemetry);
    expect(requests.at(-1).body.stream_options).toEqual({ include_usage: true });
  });

  it('preserves Responses input cache details without changing token usage', async () => {
    const result = await runRoute(routeFor(base, 'openai-chatgpt', '/responses'));

    expect(result.answer).toBe('RESPONSES');
    expect(result.usage).toEqual({ promptTokens: 30, completionTokens: 3 });
    expect(result.telemetry).toMatchObject({
      cachedPromptTokens: 18,
      providerPrefillDurationMilliseconds: null,
      providerCacheTelemetryPresent: true,
    });
    expectMeasuredTtft(result.telemetry);
  });

  it('folds Anthropic cache-read tokens across partial usage events', async () => {
    const result = await runRoute(routeFor(base, 'anthropic'));

    expect(result.answer).toBe('ANTHROPIC');
    expect(result.usage).toEqual({ promptTokens: 40, completionTokens: 4 });
    expect(result.telemetry).toMatchObject({
      cachedPromptTokens: 25,
      providerPrefillDurationMilliseconds: null,
      providerCacheTelemetryPresent: true,
    });
    expectMeasuredTtft(result.telemetry);
  });

  it('converts Ollama prompt evaluation nanoseconds to milliseconds', async () => {
    const result = await runRoute(routeFor(base, 'ollama'));

    expect(result.answer).toBe('OLLAMA');
    expect(result.usage).toEqual({ promptTokens: 50, completionTokens: 5 });
    expect(result.telemetry).toMatchObject({
      cachedPromptTokens: null,
      providerPrefillDurationMilliseconds: 6.5,
      providerCacheTelemetryPresent: true,
    });
    expectMeasuredTtft(result.telemetry);
  });

  it('reports unavailable provider cache telemetry as null, never zero', async () => {
    const result = await runRoute(routeFor(base, 'openai', '/v1/chat/completions-absent'));

    expect(result.usage).toEqual({ promptTokens: 20, completionTokens: 2 });
    expect(result.telemetry).toMatchObject({
      cachedPromptTokens: null,
      providerPrefillDurationMilliseconds: null,
      providerCacheTelemetryPresent: false,
    });
    expectMeasuredTtft(result.telemetry);
  });
});
