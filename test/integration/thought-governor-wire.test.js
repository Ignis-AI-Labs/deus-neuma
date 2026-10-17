/** Actual HTTP/SSE → production round → signed WebSocket. Protocol proof only;
 * scripted packets do not establish vendor acceptance or model inference. */
import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runLLMStream } from '../../backend/services/portal-llm-run.js';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';

const packet = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
const messages = [{ role: 'user', content: 'Protocol transport fixture' }];
const preset = { temperature: 0.7, topP: 1, maxTokens: 32, exactMaxTokens: true };
const effort = { thinkBudget: 1, directive: { channel: 'reasoning-effort', value: 'high' } };

describe('hosted thought governor HTTP wiring', () => {
  let kit, server, endpoint, requests, first;
  beforeEach(async () => {
    kit = await createHarnessTurnKit('witness-thought-wire');
    requests = [];
    first = [packet({ reasoning_content: 'a silent thought exceeds five characters' })];
    server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      requests.push(JSON.parse(raw));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunks = requests.length === 1 ? first : [packet({ content: 'Transport answer.' })];
      for (const chunk of chunks) res.write(chunk);
      res.end('data: [DONE]\n\n');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  });
  afterEach(async () => {
    server?.closeAllConnections();
    if (server) await new Promise((resolve) => server.close(resolve));
    await kit?.close();
  });
  const run = () => runLLMStream(kit.ws, messages, 'TransportFixture', null, preset,
    [], kit.connection.activeTurn.signal, undefined,
    { provider: 'openai', model: 'gpt-5.6', endpoint, apiKey: 'protocol-fixture' }, undefined, effort);

  it('repeats a silent cut with the same messages plus the cut reasoning\'s tail (#569), and the off directive', async () => {
    const result = await run();
    expect(requests).toHaveLength(2);
    expect(requests[0].reasoning_effort).toBe('high');
    expect(requests[1].reasoning_effort).toBe('none');
    // Pass 2 is the round's own messages, then ONE closing turn carrying the cut reasoning's tail (#569).
    expect(requests[1].messages.slice(0, -1)).toEqual(requests[0].messages);
    expect(requests[1].messages.at(-1).role).toBe('user');
    expect(requests[1].messages.at(-1).content).toContain('Using what you already worked out');
    expect(result.content).toBe('Transport answer.');
    await untilHarness(() => kit.frames.some((frame) => frame.type === 'consciousness:stream'));
    expect(kit.frames.filter((frame) => frame.type === 'consciousness:stream').map((frame) => frame.content).join(''))
      .toBe('Transport answer.');
  });
  it('keeps the first response when it speaks before a long reasoning tail', async () => {
    first = [packet({ content: 'First answer.' }), packet({ reasoning_content: 'a long trailing thought' })];
    expect((await run()).content).toBe('First answer.');
    expect(requests).toHaveLength(1);
  });
  it('leaves a short silent thought within its budget in one pass', async () => {
    first = [packet({ reasoning_content: 'a' }), packet({ content: 'Short answer.' })];
    expect((await run()).content).toBe('Short answer.');
    expect(requests).toHaveLength(1);
  });
});

/**
 * THE SHARED CAP (#506), proven over real HTTP: a benchmark's exact
 * max_tokens is TOTAL — thought and speech share it. An uncapped leash
 * (1800-token room ≈ 9000 chars) never trips before a 2048-token ceiling:
 * the serving cuts mid-thought first and the turn settles speechless
 * (neuma-math25 request 10, twice). `sharedOutputBudget` shrinks the leash
 * to (cap − speechFloorFor(cap): a quarter, 768 at most), so the same flood is cut with answer budget
 * left and the lane's proven pass-2 answers. Effort is null, as the
 * benchmark decoding protocol pins it — the room is the standing default.
 */
describe('the shared output cap leash', () => {
  const FLOOD = 'x'.repeat(8000); // past the capped leash (7680: 2048 − a 512 floor), inside the uncapped one (9000)
  let kit, server, endpoint, requests, first;
  beforeEach(async () => {
    kit = await createHarnessTurnKit('shared-cap-wire');
    requests = [];
    first = [packet({ reasoning_content: FLOOD })];
    server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      requests.push(JSON.parse(raw));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunks = requests.length === 1 ? first : [packet({ content: 'Recovered answer.' })];
      for (const chunk of chunks) res.write(chunk);
      res.end('data: [DONE]\n\n');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  });
  afterEach(async () => {
    server?.closeAllConnections();
    if (server) await new Promise((resolve) => server.close(resolve));
    await kit?.close();
  });
  const route = () => ({ provider: 'openai', model: 'gpt-5.6', endpoint, apiKey: 'protocol-fixture' });
  const runWith = (preset) => runLLMStream(kit.ws, messages, 'SharedCapFixture', null, preset,
    [], kit.connection.activeTurn.signal, undefined, route(), undefined, null);

  it('a flood inside the ordinary leash still trips under a shared 2048 cap — and pass 2 answers', async () => {
    const result = await runWith({ temperature: 0, topP: 1, maxTokens: 2048, exactMaxTokens: true, sharedOutputBudget: true });
    expect(requests).toHaveLength(2);
    expect(requests[1].reasoning_effort).toBe('none');
    expect(requests[1].messages.slice(0, -1)).toEqual(requests[0].messages);
    expect(requests[1].messages.at(-1).content).toContain('It ended here:');
    expect(result.content).toBe('Recovered answer.');
  });

  it('the SAME flood rides out the ordinary uncapped leash in one pass', async () => {
    first = [packet({ reasoning_content: FLOOD }), packet({ content: 'Untripped answer.' })];
    const result = await runWith({ temperature: 0, topP: 1, maxTokens: 2048, exactMaxTokens: true });
    expect(requests).toHaveLength(1);
    expect(result.content).toBe('Untripped answer.');
  });

  it('an UNCAPPED sitting (maxTokens null) never cuts thinking and never sends a null or zero cap', async () => {
    // Design note, 2026-10-02: a cap the benchmark does not set creates false scores.
    first = [packet({ reasoning_content: 'x'.repeat(40000) }), packet({ content: 'Uncapped answer.' })];
    const result = await runWith({ temperature: 0, topP: 1, maxTokens: null, exactMaxTokens: false, sharedOutputBudget: true });
    expect(requests).toHaveLength(1);
    expect(result.content).toBe('Uncapped answer.');
    expect(Number.isInteger(requests[0].max_tokens) && requests[0].max_tokens > 0).toBe(true);
  });

  it('the budget flag itself never reaches the wire', async () => {
    first = [packet({ content: 'Plain answer.' })];
    await runWith({ temperature: 0, topP: 1, maxTokens: 2048, exactMaxTokens: true, sharedOutputBudget: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty('sharedOutputBudget');
    expect(requests[0].max_tokens).toBe(2048);
  });
});
