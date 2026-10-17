// Comparable NEUMA benchmark controls over the real production wire seams.
// No mocks: a real HTTP listener exposes the llama-server adapter and chat
// routes; the resolver probes it and createStreamRequest sends the actual body.
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLoraForTurn } from '../../backend/services/adapter-binding.js';
import { createStreamRequest } from '../../backend/services/llm-provider.js';

const LOADED = [
  { id: 0, path: '/adapters/galen-refinement-1.gguf', scale: 1 },
  { id: 1, path: '/adapters/keir-refinement-1.gguf', scale: 1 },
];

let server;
let endpoint;
let capturedBody;
let requests = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.method === 'GET' && req.url === '/lora-adapters') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(LOADED));
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      capturedBody = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('NEUMA benchmark base-weight wire', () => {
  it('zeros every loaded refinement and carries the exact decoding controls', async () => {
    const binding = await resolveLoraForTurn('galen', {
      endpoint,
      model: 'gemma-4-31B-it-Q8_0.gguf',
    }, { baseWeightsOnly: true });

    // The reason lost its 'benchmark-' prefix because the benchmark no longer
    // has a private path: LoRA is retired, so EVERY turn is neutralized the
    // same way and an arm's bare-ness is the ordinary outcome rather than a
    // special request.
    //
    // This assertion was RED at HEAD before 2026-08-23, and the failure was
    // real: the guard resolved loaded adapters through a supervised authority
    // that only exists when the platform spawns the server, so on any
    // hand-launched conduit -- which is how a house actually runs -- the
    // projection threw, `lora` came back null, and NOTHING was zeroed. It now
    // reads the probe directly, so the zeros above are real for the first
    // time.
    expect(binding).toEqual({
      lora: [{ id: 0, scale: 0 }, { id: 1, scale: 0 }],
      adapter: null,
      reason: 'adapters-neutralized',
      baseWeightsVerified: true,
    });

    const { response } = await createStreamRequest([
      { role: 'user', content: 'benchmark probe' },
    ], {
      route: {
        provider: 'custom',
        dialect: 'openai',
        endpoint,
        model: 'gemma-4-31B-it-Q8_0.gguf',
        chatPath: '/v1/chat/completions',
        apiKey: null,
      },
      temperature: 0,
      topP: 1,
      maxTokens: 16384,
      seed: 7,
      lora: binding.lora,
    });
    await response.text();

    expect(capturedBody).toMatchObject({
      temperature: 0,
      top_p: 1,
      max_tokens: 16384,
      seed: 7,
      lora: [{ id: 0, scale: 0 }, { id: 1, scale: 0 }],
    });
  });

  it('leaves an externally owned benchmark server under its one real supervisor', async () => {
    const before = requests.length;
    const { response } = await createStreamRequest([
      { role: 'user', content: 'externally supervised benchmark probe' },
    ], {
      route: {
        provider: 'llama-server',
        dialect: 'openai',
        endpoint,
        model: 'gemma-4-31B-it-Q8_0.gguf',
        chatPath: '/v1/chat/completions',
        apiKey: null,
      },
      superviseLlamaServer: false,
      temperature: 0,
      maxTokens: 32,
    });
    expect(await response.text()).toContain('"content":"ok"');
    expect(requests.slice(before)).toEqual(['POST /v1/chat/completions']);
  });
});
