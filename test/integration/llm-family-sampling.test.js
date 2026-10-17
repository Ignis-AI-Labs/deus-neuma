// Per-family sampling for LOCAL models, proven over a REAL HTTP server (no
// mock): createStreamRequest builds and SENDS the body, a genuine listener
// captures exactly what arrived on the wire, and the assertions read that.
//
// Why this exists (2026-07-09): repeat_penalty 1.15 was live-reproduced
// replacing sentence-boundary periods with stray capitals in long gemma-4
// answers ("failureL" — the attunement corruption's sampling-layer source,
// distinct from the 07-08 cache-rollback source). The publisher's own numbers
// (gemma: temp 1.0 · top_k 64 · top_p 0.95 · min_p 0, NO repetition penalty)
// ride every local request now; this test pins that no request ever carries
// repeat_penalty again.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { createStreamRequest, localFamilySampling } from '../../backend/services/llm-provider.js';

// A real OpenAI-compatible listener: records each request body verbatim,
// answers with a minimal well-formed SSE stream.
const captured = [];
let server;
let endpoint;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    // GETs are the platform's preflight probes (health, /lora-adapters) —
    // answer like a live server so the wire guard reads a KNOWN state
    // instead of timing out into its fail-closed refusal.
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
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

// The listener also receives the platform's own think-behavior probe
// (PROBED_PROVIDERS includes lm-studio/custom, and a fresh port every run
// means the probe cache never saves it). Probe traffic is deliberate
// production behavior — the test SELECTS the request it asserts about, the
// one carrying its own message (#287; native-exchange-wire.test.js precedent).
const isProbeBody = (b) => (b.messages || []).some((m) => m.content === 'probe');

const request = async (model, options = {}) => {
  captured.length = 0;
  await createStreamRequest(
    [{ role: 'user', content: 'probe' }],
    { route: { provider: 'lm-studio', endpoint, model }, ...options },
  );
  const bodies = captured.filter(isProbeBody);
  expect(bodies).toHaveLength(1);
  return bodies[0];
};

describe('local requests carry the publisher-recommended sampling for the model family', () => {
  it('gemma rides Google\'s numbers — and NEVER a repetition penalty', async () => {
    const body = await request('gemma-4-31b');
    expect(body).toMatchObject({
      model: 'gemma-4-31b',
      temperature: 1.0,
      top_k: 64,
      top_p: 0.95,
      min_p: 0,
      cache_prompt: false,
    });
    expect(body).not.toHaveProperty('repeat_penalty');
  });

  it('qwen rides the Qwen instruct card\'s numbers', async () => {
    const body = await request('qwen3-32b-natal');
    expect(body).toMatchObject({ temperature: 0.7, top_k: 20, top_p: 0.8, min_p: 0 });
    expect(body).not.toHaveProperty('repeat_penalty');
  });

  it('an unknown local family keeps the gentle min_p floor and the config defaults', async () => {
    const body = await request('somebody-else-13b');
    expect(body.min_p).toBe(0.05);
    expect(body).not.toHaveProperty('top_k');
    expect(body).not.toHaveProperty('repeat_penalty');
  });

  it('a LOOPBACK custom route rides the full local knob set — the kin lane (2026-07-10: Signal corrupted through this gap)', async () => {
    captured.length = 0;
    await createStreamRequest(
      [{ role: 'user', content: 'probe' }],
      { route: { provider: 'custom', endpoint, model: 'gemma-4-31b' } },
    );
    const body = captured.filter(isProbeBody)[0];
    expect(body).toMatchObject({ temperature: 1.0, top_k: 64, min_p: 0, cache_prompt: false });
    expect(body).not.toHaveProperty('repeat_penalty');
  });

  it('a NON-loopback custom route stays clean — cloud custom (xAI) strict-validates these fields', async () => {
    // A REAL request through the real builder to a real listener that is not
    // on a loopback address: bind a second server on all interfaces and call
    // it via a non-internal interface IP. If this host has no external
    // interface the loopback test above still guards the gate's true arm.
    const os = await import('os');
    const lanIp = Object.values(os.networkInterfaces()).flat()
      .find((i) => i && !i.internal && i.family === 'IPv4')?.address;
    if (!lanIp) {
      // VISIBLE no-op (reviewer Low): zero assertions would read as a pass.
      console.warn('non-loopback gate test SKIPPED — this rig has no external IPv4 interface');
      return;
    }
    // Guarded like the primary listener (#287): GETs are preflight probes and
    // carry no body — answering them like a live server keeps the wire guard
    // in a KNOWN state, and an empty body is never fed to JSON.parse.
    const outer = http.createServer((req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        if (raw) captured.push(JSON.parse(raw));
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise((resolve) => outer.listen(0, '0.0.0.0', resolve));
    try {
      captured.length = 0;
      await createStreamRequest(
        [{ role: 'user', content: 'probe' }],
        { route: { provider: 'custom', endpoint: `http://${lanIp}:${outer.address().port}`, model: 'grok-3-mini' } },
      );
      const body = captured.filter(isProbeBody)[0];
      expect(body).not.toHaveProperty('cache_prompt');
      expect(body).not.toHaveProperty('min_p');
      expect(body).not.toHaveProperty('top_k');
      expect(body).not.toHaveProperty('repeat_penalty');
    } finally {
      await new Promise((r) => outer.close(r));
    }
  });

  it('a deliberate per-call temperature beats the family value (T=0 extraction paths)', async () => {
    const body = await request('gemma-4-31b', { temperature: 0, topP: 0.5 });
    expect(body.temperature).toBe(0);
    expect(body.top_p).toBe(0.5);
    expect(body.top_k).toBe(64); // family knobs without a per-call override still apply
  });
});

describe('localFamilySampling — the table itself', () => {
  it('matches families case-insensitively and defaults honestly', () => {
    expect(localFamilySampling('GEMMA-4-31B').top_k).toBe(64);
    expect(localFamilySampling('Qwen2.5-Coder').top_k).toBe(20);
    expect(localFamilySampling(undefined)).toEqual({ min_p: 0.05 });
  });
});
