// The LoRA zero-guard, proven over a REAL HTTP server (no mock): llama-server
// keeps per-request adapter scales as persistent slot state, so a request that
// OMITS the `lora` field inherits whatever the previous turn applied. Live-
// reproduced 2026-07-14: four house adapters stuck at scale 1.0 poisoned every
// unrefined being's ceremony turn into degenerate token soup (`lora: []` does
// NOT protect — the server treats it as "no change"). The guard therefore
// sends an explicit scale for EVERY adapter the conduit has loaded: the
// caller's binding verbatim, zeros for the rest. This test pins that law on
// the wire itself.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { createStreamRequest } from '../../backend/services/llm-provider.js';

// A real listener speaking both llama-server dialects: GET /lora-adapters
// lists two loaded adapters, POST /v1/chat/completions records the body
// verbatim and answers a minimal well-formed SSE stream.
const LOADED = [
  { id: 0, path: '/adapters/keir-refinement-1.gguf', scale: 1.0 },
  { id: 1, path: '/adapters/galen-refinement-1.gguf', scale: 1.0 },
];
const captured = [];
let server;
let endpoint;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/lora-adapters')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(LOADED));
      return;
    }
    if (req.method === 'GET') {
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.url !== '/v1/chat/completions') {
      res.writeHead(404);
      res.end();
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      captured.push(JSON.parse(raw));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

// Kin routes ride provider 'custom' pointed at loopback llama-server — the
// exact wire shape the guard exists for (and it skips ensureServing).
const request = async (options = {}) => {
  captured.length = 0;
  await createStreamRequest(
    [{ role: 'user', content: 'probe' }],
    { route: { provider: 'custom', endpoint, model: 'gemma-4-31b', apiKey: 'k' }, ...options },
  );
  expect(captured).toHaveLength(1);
  return captured[0];
};

describe('the LoRA zero-guard on llama-server wires', () => {
  it('an unrefined turn (no binding) carries explicit ZEROS for every loaded adapter', async () => {
    const body = await request();
    expect(body.lora).toEqual([
      { id: 0, scale: 0 },
      { id: 1, scale: 0 },
    ]);
  });

  it("a refined turn's binding rides verbatim — its own adapter dialed, the others zero", async () => {
    const body = await request({ lora: [{ id: 0, scale: 1 }, { id: 1, scale: 0 }] });
    expect(body.lora).toEqual([
      { id: 0, scale: 1 },
      { id: 1, scale: 0 },
    ]);
  });

  it('a partial binding is completed with zeros — an unlisted adapter can never ride implicitly', async () => {
    const body = await request({ lora: [{ id: 1, scale: 0.8 }] });
    expect(body.lora).toEqual([
      { id: 0, scale: 0 },
      { id: 1, scale: 0.8 },
    ]);
  });
});
