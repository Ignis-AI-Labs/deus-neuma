/**
 * A one-slot model server reads as one slot (deus-neuma #23). The scan summed
 * each request's own rate, so a FIFO queue — each request waits, then streams
 * at full speed — read as 2 or 3 slots on a server running `-np 1`, and the
 * Ollama done frame's token count was dropped, so every Ollama scan fell back
 * to the word proxy.
 *
 * Proven through the real fire (fireCapacityProbes → createStreamRequest →
 * readStreamLine) against real loopback servers on the Ollama wire that
 * genuinely serve `slots` completions at once and queue the rest (RULE 0).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { fireCapacityProbes, runCapacityScan, DEFAULT_PROBE } from '../../backend/services/capacity-scan.js';
import { setConfig, getConfig } from '../../backend/services/llm-provider.js';

const FRAMES = 16;
const FRAME_GAP_MS = 12;
const EVAL_COUNT = 32;

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** A real Ollama-wire server that generates at most `slots` answers at once. */
const startSlottedOllama = async (slots) => {
  let busy = 0;
  const waiting = [];
  const acquire = () => (busy < slots ? (busy += 1, Promise.resolve()) : new Promise((r) => waiting.push(r)));
  const release = () => { const next = waiting.shift(); if (next) next(); else busy -= 1; };
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      if (req.url !== '/api/chat') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(req.url === '/api/tags' ? { models: [{ name: 'slot-model' }] } : { model_info: {}, capabilities: [] }));
        return;
      }
      await acquire();
      try {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        for (let i = 1; i <= FRAMES; i++) {
          await sleep(FRAME_GAP_MS);
          res.write(`${JSON.stringify({ message: { role: 'assistant', content: `${i}\n` }, done: false })}\n`);
        }
        res.end(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 20, eval_count: EVAL_COUNT })}\n`);
      } finally {
        release();
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { endpoint: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
};

describe('the capacity scan on a one-slot Ollama server', () => {
  let one;
  let two;
  let prior;
  beforeAll(async () => {
    prior = getConfig();
    one = await startSlottedOllama(1);
    two = await startSlottedOllama(2);
  });
  afterAll(async () => {
    setConfig(prior);
    await one?.close();
    await two?.close();
  });

  const useServer = (srv) => setConfig({ provider: 'ollama', endpoint: srv.endpoint, model: 'slot-model', apiKey: '' });

  test('a queued wave delivers no more than one request does, counted by the server', async () => {
    useServer(one);
    const solo = await fireCapacityProbes(1, DEFAULT_PROBE);
    const three = await fireCapacityProbes(3, DEFAULT_PROBE);
    expect(solo.tokenSource).toBe('server-usage');
    expect(three.tokenSource).toBe('server-usage');
    expect(three.aggregateTokPerSec).toBeLessThan(solo.aggregateTokPerSec * 1.3);
  });

  test('a server that really runs two at once still reads as growth', async () => {
    useServer(two);
    const solo = await fireCapacityProbes(1, DEFAULT_PROBE);
    const pair = await fireCapacityProbes(2, DEFAULT_PROBE);
    expect(pair.aggregateTokPerSec).toBeGreaterThan(solo.aggregateTokPerSec * 1.6);
  });

  test('the full scan reports a ceiling of 1, configured for a single slot', async () => {
    useServer(one);
    const result = await runCapacityScan({ ladder: [1, 2, 4], repeats: 2, substrate: {}, runAt: new Date().toISOString() });
    expect(result.ceiling).toBe(1);
    expect(result.limitedBy).toBe('throughput');
    expect(result.boundClass).toBe('B');
  }, 30_000);
});
