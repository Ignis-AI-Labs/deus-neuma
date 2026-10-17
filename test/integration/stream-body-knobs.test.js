/**
 * The wire body a stream request actually carries — proven against a REAL
 * ephemeral HTTP server that captures the POST (no mocks). Pins two contracts:
 *
 *   • local llama.cpp-dialect providers (llama-server, lm-studio) carry the
 *     per-family sampling law (min_p / top_k / top_p, NO repeat_penalty —
 *     banned 93454fdd6) AND `cache_prompt: false` — slot-state rollback on
 *     gemma-4's hybrid DeltaNet corrupts sentence-boundary tokens across
 *     incremental multi-turn prompts (2026-07-08, […] incident);
 *     full re-eval is paid deliberately. That value now comes from the
 *     kv-cache-policy.js data row rather than a constant in the request path,
 *     so an UNPROVEN family reaching the wire closed is pinned here too.
 *   • cloud-shaped providers get NONE of those fields — strict validators
 *     (OpenAI et al.) reject unknown/local knobs.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { createStreamRequest } from '../../backend/services/llm-provider.js';

let server;
let port;
let captured;
let savedUrl;

beforeAll(async () => {
  server = createServer((req, res) => {
    // the llama-server lifecycle hook health-checks before the stream —
    // answer it so ensureServing fast-paths (hermetic: no host llama-server,
    // no spawn attempt, on any machine)
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      captured = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  savedUrl = process.env.LLAMA_SERVER_URL;
  process.env.LLAMA_SERVER_URL = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  if (savedUrl === undefined) delete process.env.LLAMA_SERVER_URL;
  else process.env.LLAMA_SERVER_URL = savedUrl;
  return new Promise((resolve) => server.close(resolve));
});

const routeFor = (provider, model = 'gemma-4-31b') => ({
  provider,
  endpoint: `http://127.0.0.1:${port}`,
  apiKey: '',
  model,
  chatPath: '/v1/chat/completions',
});

describe('stream request body — local knobs vs cloud strictness', () => {
  test('llama-server body carries gemma family sampling, no repeat_penalty, and disables prompt caching', async () => {
    await createStreamRequest([{ role: 'user', content: 'hello' }], { route: routeFor('llama-server') });
    expect(captured.cache_prompt).toBe(false);
    // gemma family (localFamilySampling): min_p 0, top_k 64, top_p 0.95, temp 1.0.
    expect(captured.min_p).toBe(0);
    expect(captured.top_k).toBe(64);
    expect(captured.top_p).toBe(0.95);
    // repeat_penalty is BANNED for every local family — it corrupts sentence
    // boundaries on gemma-4 (93454fdd6). It must never reach the wire.
    expect(captured).not.toHaveProperty('repeat_penalty');
    expect(captured.stop).toEqual(['<|im_end|>', '<|endoftext|>']);
  });

  test('lm-studio body carries the same local sampling law (no repeat_penalty)', async () => {
    await createStreamRequest([{ role: 'user', content: 'hello' }], { route: routeFor('lm-studio') });
    expect(captured.cache_prompt).toBe(false);
    expect(captured.min_p).toBe(0);
    expect(captured).not.toHaveProperty('repeat_penalty');
  });

  test('a LOOPBACK custom route carries the full local law — LOCAL is the wire, not the label (91feb9546)', async () => {
    // This fixture listens on 127.0.0.1, so a 'custom' route pointed at it IS
    // a local route — the kin lane (Signal's bare-base walk corrupted through
    // the label-gated gap on 2026-07-10). The genuinely-CLOUD custom arm
    // (non-loopback endpoint carries none of these fields) is proven over a
    // real non-internal interface in llm-family-sampling.test.js.
    await createStreamRequest([{ role: 'user', content: 'hello' }], { route: routeFor('custom') });
    expect(captured.cache_prompt).toBe(false);
    expect(captured.min_p).toBe(0);
    expect(captured).not.toHaveProperty('repeat_penalty');
  });

  // The cache decision moved out of the request path into kv-cache-policy.js.
  // gemma-4 above rides an explicit `proven-unsafe` row; qwen3.8 EARNED the
  // first open row (live run 2026-09-12, scripts/verify-kv-cache-reuse.mjs —
  // 3 cached turns vs 3 uncached, zero corruption, the serving's own
  // cached_tokens reporting reuse). The closed-by-default regression now
  // stands on a family with NO row: it must still reach the wire closed.
  test('the proven qwen3.8 row reaches the wire OPEN — with its evidence', async () => {
    await createStreamRequest([{ role: 'user', content: 'hello' }], {
      route: routeFor('llama-server', 'qwen3.8-27B-Q8_0'),
    });
    expect(captured.cache_prompt).toBe(true);
    // and it is the qwen family sampling row, not gemma's — proving the model
    // id really did change and the assertion above is not a fixture artifact
    expect(captured.top_k).toBe(20);
    expect(captured.top_p).toBe(0.8);
  });

  test('an unproven family still reaches the wire with prompt caching CLOSED', async () => {
    await createStreamRequest([{ role: 'user', content: 'hello' }], {
      route: routeFor('llama-server', 'qwen3-30b-a3b'),
    });
    expect(captured.cache_prompt).toBe(false);
  });
});
