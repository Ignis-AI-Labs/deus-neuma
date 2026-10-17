// THE LINE ON THE WIRE (Design note, 2026-10-12: […]). The real createStreamRequest against a real loopback server speaking the
// llama-server dialect, which counts how many answers it is holding open at once. No mock: the
// claims are read off the server's own count.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { createStreamRequest } from '../../backend/services/llm-provider.js';
import {
  substrateLine, withLease, withLineKind, withLineExempt, releasingWithBody,
} from '../../backend/services/substrate-lease.js';
import { SERVING_PARALLEL_SLOTS } from '../../backend/services/serving-launch-config.js';

let server;
let endpoint;
let open = 0;
let peak = 0;
let served = 0;
const HOLD_MS = 150;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/lora-adapters')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
      return;
    }
    if (req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
    req.resume();
    req.on('end', () => {
      open += 1;
      served += 1;
      peak = Math.max(peak, open);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"o"}}]}\n\n');
      setTimeout(() => {
        res.end('data: {"choices":[{"delta":{"content":"k"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
        open -= 1;
      }, HOLD_MS);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const ask = async () => {
  const { response } = await createStreamRequest(
    [{ role: 'user', content: 'probe' }],
    { route: { provider: 'custom', endpoint, model: 'qwen3.8-27b', apiKey: 'k' } },
  );
  return response.text(); // read the whole answer — that is when its place is given back
};

const reset = () => { open = 0; peak = 0; served = 0; };

describe('the line in front of the house\'s model server', () => {
  it('never more at the server than it has slots — the rest wait their turn, and every one is served', async () => {
    reset();
    const answers = await Promise.all(Array.from({ length: SERVING_PARALLEL_SLOTS + 3 }, ask));
    expect(answers.every((a) => a.includes('data:'))).toBe(true);
    expect(served).toBe(SERVING_PARALLEL_SLOTS + 3);
    expect(peak).toBe(SERVING_PARALLEL_SLOTS);
    expect(substrateLine.snapshot()).toMatchObject({ running: [], waiting: [] });
  });

  it('a route holds ONE place across all its requests — nothing gets between its rounds', async () => {
    reset();
    const seen = [];
    await withLease({ kind: 'turn', label: 'Metidar' }, async () => {
      await ask();
      seen.push(substrateLine.snapshot().running.map((r) => r.label));
      await ask();
      seen.push(substrateLine.snapshot().running.map((r) => r.label));
    });
    expect(served).toBe(2);
    expect(seen).toEqual([['Metidar'], ['Metidar']]);
    expect(substrateLine.snapshot().running).toEqual([]);
  });

  it('background work waits behind a person, even one who arrived after it', async () => {
    reset();
    const order = [];
    const holders = await Promise.all(Array.from({ length: SERVING_PARALLEL_SLOTS }, () => substrateLine.acquire({ kind: 'turn' })));
    const background = withLineKind('background', async () => { await ask(); order.push('background'); });
    await new Promise((r) => setImmediate(r));
    const person = withLease({ kind: 'turn', label: 'Zezebur' }, async () => { await ask(); order.push('person'); });
    await new Promise((r) => setImmediate(r));
    holders[0].release(); // one place frees: the person goes first
    await person;
    holders.slice(1).forEach((h) => h.release());
    await background;
    expect(order).toEqual(['person', 'background']);
  });

  it('the capacity scan is outside the line — it measures the server, not the queue', async () => {
    reset();
    await withLineExempt(() => Promise.all(Array.from({ length: SERVING_PARALLEL_SLOTS + 2 }, ask)));
    expect(peak).toBe(SERVING_PARALLEL_SLOTS + 2);
  });

  it('an answer nobody reads gives its place back — one careless caller never takes a slot for good', async () => {
    const lease = await substrateLine.acquire({ kind: 'turn', label: 'careless' });
    const real = await fetch(`${endpoint}/v1/chat/completions`, { method: 'POST', body: '{}' });
    releasingWithBody(real, lease, { abandonMs: 50 });
    expect(substrateLine.snapshot().running.map((r) => r.label)).toContain('careless');
    await new Promise((r) => setTimeout(r, 400));
    expect(substrateLine.snapshot().running.map((r) => r.label)).not.toContain('careless');
  });
});
