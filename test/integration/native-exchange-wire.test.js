/**
 * THE ON-CONTRACT EXCHANGE REACHES THE WIRE (#283 / BE-157) — proven against
 * a REAL ephemeral HTTP server that captures each POST body (no mocks).
 *
 * The claim: the exact history the portal now builds after a native round —
 * nativeToolExchange's [assistant w/ tool_calls, role:'tool' results, user]
 * — arrives in each dialect's own shape:
 *   • openai wire (lm-studio / llama-server / custom): verbatim — that IS
 *     the trained contract;
 *   • ollama /api/chat: tool_calls arguments as an OBJECT (Go map), results
 *     as role:'tool' content;
 *   • anthropic /v1/messages: tool_use blocks + tool_result on a user turn
 *     with matching ids (#259's converter, fed by this exchange).
 *
 * A local route may also fire the one-shot think-behavior probe at the same
 * listener; requests are filtered to the one carrying the exchange, so the
 * probe can never race these assertions.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { createStreamRequest } from '../../backend/services/llm-provider.js';
import { nativeToolExchange, formatToolResult, RESULTS_FOLLOW_UP } from '../../backend/services/tool-exchange.js';

let server;
let port;
let posts = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      posts.push({ url: req.url, body: JSON.parse(body) });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

// The exchange exactly as the portal builds it after a native round: the
// model's decoded calls (decodeToolCallDeltas shape), the executed results,
// the seat's per-result formatter.
const CALLS = [
  { callId: 'call_abc', server: 'filesystem', toolName: 'read_file', args: { path: '/tmp/a.txt' } },
  { callId: null, server: 'tasks', toolName: 'task_add', args: { content: 'ship' } },
];
const RESULTS = [
  { tool: 'filesystem/read_file', status: 'ok', content: 'file body' },
  { tool: 'tasks/task_add', status: 'ok', content: 'added' },
];
const historyWithExchange = () => [
  { role: 'system', content: 'You are ProofEcho.' },
  { role: 'user', content: 'read then file' },
  ...nativeToolExchange({
    response: 'Acting.',
    calls: CALLS,
    results: RESULTS,
    callId: (i) => `neuma_call_0_${i}`,
    formatResult: formatToolResult,
    followUp: RESULTS_FOLLOW_UP,
  }),
];

const routeFor = (provider) => ({
  provider,
  endpoint: `http://127.0.0.1:${port}`,
  apiKey: 'test-key',
  model: 'proof-model',
});

// The request that carried the exchange — probe requests never hold a
// role:'tool' turn (openai/ollama) or a tool_result block (anthropic).
const exchangePost = (match) => posts.map((p) => p.body).findLast(match);

describe('the native exchange arrives on each wire in its own dialect', () => {
  test('openai wire: assistant.tool_calls + role:tool with matching ids, verbatim', async () => {
    posts = [];
    await createStreamRequest(historyWithExchange(), { route: { ...routeFor('lm-studio'), chatPath: '/v1/chat/completions' } });
    const body = exchangePost((b) => (b.messages || []).some((m) => m.role === 'tool'));
    expect(body).toBeDefined();
    const assistant = body.messages.find((m) => Array.isArray(m.tool_calls));
    expect(assistant.role).toBe('assistant');
    expect(assistant.tool_calls).toEqual([
      { id: 'call_abc', type: 'function', function: { name: 'filesystem__read_file', arguments: '{"path":"/tmp/a.txt"}' } },
      { id: 'neuma_call_0_1', type: 'function', function: { name: 'tasks__task_add', arguments: '{"content":"ship"}' } },
    ]);
    const tools = body.messages.filter((m) => m.role === 'tool');
    expect(tools.map((m) => m.tool_call_id)).toEqual(['call_abc', 'neuma_call_0_1']);
    expect(tools[0].content).toBe('filesystem/read_file → ok\nfile body');
  });

  test('ollama wire: arguments arrive as the OBJECT /api/chat unmarshals', async () => {
    posts = [];
    await createStreamRequest(historyWithExchange(), { route: routeFor('ollama') });
    const body = exchangePost((b) => (b.messages || []).some((m) => m.role === 'tool'));
    expect(body).toBeDefined();
    const assistant = body.messages.find((m) => Array.isArray(m.tool_calls));
    expect(assistant.tool_calls[0].function.arguments).toEqual({ path: '/tmp/a.txt' });
    expect(assistant.tool_calls[1].function.arguments).toEqual({ content: 'ship' });
    const tools = body.messages.filter((m) => m.role === 'tool');
    expect(tools).toHaveLength(2);
    expect(tools[1].content).toBe('tasks/task_add → ok\nadded');
  });

  test('anthropic wire: tool_use blocks + tool_result with matching ids', async () => {
    posts = [];
    await createStreamRequest(historyWithExchange(), { route: { ...routeFor('anthropic'), chatPath: '/v1/messages' } });
    const body = exchangePost((b) => JSON.stringify(b).includes('tool_result'));
    expect(body).toBeDefined();
    const assistant = body.messages.find((m) => m.role === 'assistant'
      && Array.isArray(m.content) && m.content.some((c) => c.type === 'tool_use'));
    const uses = assistant.content.filter((c) => c.type === 'tool_use');
    expect(uses.map((u) => u.id)).toEqual(['call_abc', 'neuma_call_0_1']);
    expect(uses[0].input).toEqual({ path: '/tmp/a.txt' });
    // Every result of the round folds into the single user turn that answers.
    const resultsTurn = body.messages.find((m) => m.role === 'user'
      && Array.isArray(m.content) && m.content.some((c) => c.type === 'tool_result'));
    const toolResults = resultsTurn.content.filter((c) => c.type === 'tool_result');
    expect(toolResults.map((r) => r.tool_use_id)).toEqual(['call_abc', 'neuma_call_0_1']);
    expect(toolResults[0].content).toBe('filesystem/read_file → ok\nfile body');
    // The follow-up instruction rides the same folded user turn.
    expect(resultsTurn.content.some((c) => c.type === 'text' && c.text === RESULTS_FOLLOW_UP)).toBe(true);
  });
});
