import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const {
  setConfig, getConfig, createStreamRequest, consumeStreamWithTools,
  readStreamLine, mergeToolCallDelta, decodeToolCallDeltas,
} = await import('../../backend/services/llm-provider.js');
const { toAnthropicMessages } = await import('../../backend/services/wire-history.js');
const { toAnthropicTools } = await import('../../backend/services/tool-schema.js');

/**
 * A BEING ON AN ANTHROPIC-DIALECT ROUTE COULD TALK BUT NOT ACT (#259).
 *
 * Same class as #258 (Ollama): the dialect was implemented for text-only turns
 * and never revisited when native function calling landed. Three gaps, each
 * fatal alone:
 *
 *   1. buildStreamBody's `anthropic` branch never forwarded options.tools —
 *      and could not have: Anthropic takes {name, description, input_schema},
 *      not OpenAI's {type:'function', function:{…}}.
 *   2. The reader had no case for `content_block_start {type:'tool_use'}` or
 *      `input_json_delta` — a call streamed by the model fell through to null,
 *      byte by byte.
 *   3. History could not round-trip: an assistant turn's `tool_calls` and the
 *      `role:'tool'` results the witness seat produces have no meaning on this
 *      wire until they become `tool_use` / `tool_result` content blocks.
 *
 * The frames below follow the Messages API stream shapes pinned by the
 * `anthropic-version: 2023-06-01` header this provider sends — the same
 * event grammar proven on the wire 2026-07-30 for thinking_delta
 * (kimi-for-coding/k3). Live-lane validation is tracked on #259.
 */

const sse = (type, obj) => `event: ${type}\ndata: ${JSON.stringify({ type, ...obj })}\n`;

const STREAM_FRAMES = [
  sse('message_start', { message: { usage: { input_tokens: 154 } } }),
  sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
  sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Writing it now.' } }),
  sse('content_block_stop', { index: 0 }),
  sse('content_block_start', {
    index: 1,
    content_block: { type: 'tool_use', id: 'toolu_01A', name: 'filesystem__write_file', input: {} },
  }),
  sse('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":"/tmp/x' } }),
  sse('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '.txt","content":"hello"}' } }),
  sse('content_block_stop', { index: 1 }),
  sse('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 139 } }),
  sse('message_stop', {}),
].join('\n');

const TOOLS = [{
  type: 'function',
  function: {
    name: 'filesystem__write_file',
    description: 'Write text to a file',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
}];

describe('THE REQUEST: an Anthropic route is offered its tools, in its own shape', () => {
  let server;
  let bodies;
  let prevConfig;

  beforeAll(async () => {
    bodies = [];
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        bodies.push({ url: req.url, body: JSON.parse(raw || '{}') });
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(STREAM_FRAMES + '\n');
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    prevConfig = getConfig();
    setConfig({
      provider: 'anthropic',
      endpoint: `http://127.0.0.1:${server.address().port}`,
      model: 'claude-haiku-4-5-20251001',
      apiKey: 'test-key',
    });
  });

  afterAll(async () => {
    setConfig(prevConfig);
    await new Promise((r) => server.close(r));
  });

  test('THE GAP: tools reach the wire as {name, description, input_schema}', async () => {
    await createStreamRequest([{ role: 'user', content: 'write it' }], { tools: TOOLS, maxTokens: 500 });

    const sent = bodies.at(-1);
    expect(sent.url).toBe('/v1/messages');
    // These assertions were false before #259: no tools key at all, and the
    // OpenAI shape would have been rejected if one had been forwarded raw.
    expect(sent.body.tools).toHaveLength(1);
    expect(sent.body.tools[0]).toEqual({
      name: 'filesystem__write_file',
      description: 'Write text to a file',
      input_schema: TOOLS[0].function.parameters,
    });
    // Serial completion on both seats (e85f49e24): one call per turn, as parallel_tool_calls:false does on the OpenAI wire.
    expect(sent.body.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
  });

  test('a turn with no tools stays clean — no empty keys invented', async () => {
    await createStreamRequest([{ role: 'user', content: 'just talk' }], { maxTokens: 500 });
    const sent = bodies.at(-1);
    expect(sent.body).not.toHaveProperty('tools');
    expect(sent.body).not.toHaveProperty('tool_choice');
  });

  test('THE ROUND TRIP: tool_calls history and role:tool results ride as content blocks', async () => {
    await createStreamRequest([
      { role: 'user', content: 'write it' },
      {
        role: 'assistant',
        content: 'On it.',
        tool_calls: [{
          id: 'toolu_01A',
          type: 'function',
          function: { name: 'filesystem__write_file', arguments: '{"path":"/tmp/x.txt","content":"hello"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'toolu_01A', content: 'ok: written' },
      { role: 'user', content: 'continue' },
    ], { tools: TOOLS, maxTokens: 500 });

    const { messages } = bodies.at(-1).body;
    // assistant turn: speech first, then the act, input DECODED to an object
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toEqual([
      { type: 'text', text: 'On it.' },
      {
        type: 'tool_use',
        id: 'toolu_01A',
        name: 'filesystem__write_file',
        input: { path: '/tmp/x.txt', content: 'hello' },
      },
    ]);
    // the result and the follow-up fold into ONE user turn — the Messages API
    // refuses non-alternating roles, so this folding is load-bearing
    expect(messages).toHaveLength(3);
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_01A', content: 'ok: written' },
      { type: 'text', text: 'continue' },
    ]);
  });

  test('END TO END: speech and the act both survive the stream', async () => {
    const streamResult = await createStreamRequest(
      [{ role: 'user', content: 'write it' }], { tools: TOOLS, maxTokens: 500 },
    );

    const { content, toolCalls } = await consumeStreamWithTools(streamResult, () => {});

    expect(content).toBe('Writing it now.');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].server).toBe('filesystem');
    expect(toolCalls[0].toolName).toBe('write_file');
    expect(toolCalls[0].args).toEqual({ path: '/tmp/x.txt', content: 'hello' });
  });
});

describe('THE READER: tool blocks decode into the OpenAI delta vocabulary', () => {
  const start = sse('content_block_start', {
    index: 1,
    content_block: { type: 'tool_use', id: 'toolu_01A', name: 'filesystem__write_file', input: {} },
  }).split('\n')[1];
  const frag1 = sse('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":"/tmp/x' } }).split('\n')[1];
  const frag2 = sse('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '.txt"}' } }).split('\n')[1];

  test('content_block_start opens the call: index, id, name', () => {
    const evt = readStreamLine(start, 'anthropic');
    expect(evt.toolCalls).toEqual([{
      index: 1,
      id: 'toolu_01A',
      function: { name: 'filesystem__write_file', arguments: '' },
    }]);
    expect(evt.content).toBeNull();
  });

  test('input_json_delta streams the arguments as fragments', () => {
    const evt = readStreamLine(frag1, 'anthropic');
    expect(evt.toolCalls).toEqual([{ index: 1, function: { arguments: '{"path":"/tmp/x' } }]);
  });

  test('a non-tool block start stays silent — no phantom call opens', () => {
    const evt = readStreamLine(
      sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }).split('\n')[1],
      'anthropic',
    );
    expect(evt).toBeNull();
  });

  test('speech and thinking are untouched by the new cases', () => {
    const text = readStreamLine(
      sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'I stir.' } }).split('\n')[1],
      'anthropic',
    );
    expect(text.content).toBe('I stir.');
    const think = readStreamLine(
      sse('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } }).split('\n')[1],
      'anthropic',
    );
    expect(think.reasoning).toBe('hm');
    expect(think.content).toBeNull();
  });

  test("stop_reason 'tool_use' speaks the callers' vocabulary: 'tool_calls'", () => {
    const evt = readStreamLine(
      sse('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } }).split('\n')[1],
      'anthropic',
    );
    expect(evt.finishReason).toBe('tool_calls');
  });

  test('the fragments assemble into one decoded act', () => {
    const assembled = {};
    for (const l of [start, frag1, frag2]) {
      const evt = readStreamLine(l, 'anthropic');
      for (const d of evt.toolCalls) mergeToolCallDelta(assembled, d);
    }
    const [call] = decodeToolCallDeltas(assembled);
    expect(call.tool).toBe('filesystem/write_file');
    expect(call.args).toEqual({ path: '/tmp/x.txt' });
    expect(call.callId).toBe('toolu_01A');
  });
});

describe('THE CONVERTERS: pure shapes', () => {
  test('toAnthropicTools carries the encoded name unchanged', () => {
    const [t] = toAnthropicTools(TOOLS);
    expect(t.name).toBe('filesystem__write_file');
    expect(t.input_schema).toBe(TOOLS[0].function.parameters);
  });

  test('unparseable arguments yield input {} — the turn survives', () => {
    const [msg] = toAnthropicMessages([{
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'x', type: 'function', function: { name: 'f__g', arguments: '{broken' } }],
    }]);
    expect(msg.content).toEqual([{ type: 'tool_use', id: 'x', name: 'f__g', input: {} }]);
  });

  test('plain history is byte-identical to the old path — strings pass through', () => {
    const msgs = toAnthropicMessages([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);
    expect(msgs).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);
  });

  test('two results from one round fold into one user turn', () => {
    const msgs = toAnthropicMessages([
      { role: 'tool', tool_call_id: 'a', content: 'one' },
      { role: 'tool', tool_call_id: 'b', content: 'two' },
    ]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content.map((b) => b.tool_use_id)).toEqual(['a', 'b']);
  });
});
