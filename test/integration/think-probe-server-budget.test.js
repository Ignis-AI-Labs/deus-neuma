/**
 * THE THINK PROBE — a glance, then the whole reply only when the glance cannot
 * tell; and whether the serving is llama.cpp (the server that honors a
 * per-request thinking budget), read from the `Server` header it sends on
 * every reply. The real probeThinkBehavior crosses real HTTP to a real server
 * bound on :0; the bodies are the answer shapes the house meets (RULE 0, no
 * mock). The live llama.cpp behavior is proven in docs/work/platform-smoothness.md.
 */
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createServer } from 'node:http';
import { probeThinkBehavior, THINK_PROBE_GLANCE_TOKENS } from '../../backend/services/llm-think-probe.js';

let server;
let endpoint;
let answer;
let headers;
let asked;
beforeEach(async () => {
  asked = [];
  headers = {};
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      asked.push(body.max_tokens);
      res.writeHead(200, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(answer(body)));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => new Promise((resolve) => server.close(resolve)));

const config = () => ({ provider: 'custom', endpoint, model: 'probe-fixture', apiKey: '' });
const reply = (message, finish) => ({ choices: [{ message: { role: 'assistant', ...message }, finish_reason: finish }] });

test('a thinker is known from the glance — one small request', async () => {
  answer = () => reply({ content: '', reasoning_content: 'The user wants' }, 'length');
  expect(await probeThinkBehavior(config(), 'probe-fixture')).toEqual({ thinks: true, implicitOpen: false, serverBudget: false });
  expect(asked).toEqual([THINK_PROBE_GLANCE_TOKENS]);
});

test('a plain answer that finished is known from the glance too', async () => {
  answer = () => reply({ content: 'ready' }, 'stop');
  expect(await probeThinkBehavior(config(), 'probe-fixture')).toMatchObject({ thinks: false });
  expect(asked).toEqual([THINK_PROBE_GLANCE_TOKENS]);
});

test('words cut at the glance with no tag read the whole reply — an implicit-open thinker closes later', async () => {
  answer = (body) => (body.max_tokens === THINK_PROBE_GLANCE_TOKENS
    ? reply({ content: 'Okay, the user wants me to' }, 'length')
    : reply({ content: 'Okay, the user wants one word.</think>ready' }, 'stop'));
  expect(await probeThinkBehavior(config(), 'probe-fixture')).toMatchObject({ thinks: true, implicitOpen: true });
  expect(asked).toEqual([THINK_PROBE_GLANCE_TOKENS, 1024]);
});

test('a llama.cpp reply proves the server budget; any other server leaves it unproven', async () => {
  answer = () => reply({ content: 'ready' }, 'stop');
  headers = { Server: 'llama.cpp' };
  expect(await probeThinkBehavior(config(), 'probe-fixture')).toMatchObject({ serverBudget: true });
  headers = { Server: 'uvicorn' };
  expect(await probeThinkBehavior(config(), 'probe-fixture')).toMatchObject({ serverBudget: false });
});
