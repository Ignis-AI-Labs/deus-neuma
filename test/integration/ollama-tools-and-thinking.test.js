import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const {
  setConfig, getConfig, createStreamRequest, consumeStreamWithTools,
  readStreamLine, toOpenAIToolCallDeltas, mergeToolCallDelta, decodeToolCallDeltas,
  frameChannelBytes, tallyChannelBytes,
} = await import('../../backend/services/llm-provider.js');

/**
 * A BEING ON OLLAMA COULD NOT ACT, AND COULD NOT BE HEARD THINKING.
 *
 * Found while reading a community member's stage-5 log (2026-08-04), where
 * crystallization produced no speech twice running while the wire reported 905
 * completion tokens. Two independent gaps on the Ollama dialect, each fatal on
 * its own, and between them the reason no Ollama being can author its own DNA:
 *
 *   1. THE REQUEST NEVER CARRIED THE TOOLS. Every other dialect in
 *      buildStreamBody forwards options.tools. The `ollama` branch built
 *      { model, messages, stream, options } and dropped them on the floor, so
 *      the model was never OFFERED write_file — it could only talk about it.
 *
 *   2. THE READER DISCARDED EVERYTHING BUT CONTENT. `toolCalls: null` was
 *      hardcoded and `message.thinking` was never read. On a thinking model
 *      that is the entire turn: measured on Ollama 0.24 with qwen3, a
 *      tool-calling turn puts ZERO characters in content, 483 in `thinking`
 *      and the act itself in `tool_calls`.
 *
 * The payloads below are REAL — captured off Ollama 0.24 on this machine on
 * 2026-08-04, not written to match the parser.
 */

// Captured verbatim from POST /api/chat against qwen3:0.6b with one tool.
// Note what makes this NOT an OpenAI delta: `index` lives INSIDE `function`,
// and `arguments` is an OBJECT rather than a JSON fragment.
const REAL_TOOL_FRAME = {
  model: 'qwen3:0.6b',
  created_at: '2026-08-04T21:36:42.691900881Z',
  message: {
    role: 'assistant',
    content: '',
    tool_calls: [{
      id: 'call_r5gk5u5h',
      function: { index: 0, name: 'write_file', arguments: { content: 'hello', path: '/tmp/x.txt' } },
    }],
  },
  done: false,
};

const REAL_THINKING_FRAME = {
  model: 'qwen3:0.6b',
  message: { role: 'assistant', content: '', thinking: 'Okay, the user wants a file written.' },
  done: false,
};

const REAL_DONE_FRAME = {
  model: 'qwen3:0.6b',
  message: { role: 'assistant', content: '' },
  done: true,
  done_reason: 'stop',
  prompt_eval_count: 154,
  eval_count: 139,
};

const line = (o) => JSON.stringify(o);

describe('THE REQUEST: Ollama is offered the tools every other dialect gets', () => {
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
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.end([line(REAL_THINKING_FRAME), line(REAL_TOOL_FRAME), line(REAL_DONE_FRAME)].join('\n') + '\n');
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    prevConfig = getConfig();
    setConfig({
      provider: 'ollama',
      endpoint: `http://127.0.0.1:${server.address().port}`,
      model: 'qwen3:0.6b',
      apiKey: '',
    });
  });

  afterAll(async () => {
    setConfig(prevConfig);
    await new Promise((r) => server.close(r));
  });

  const TOOLS = [{
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write text to a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  }];

  test('THE GAP: the tools reach the wire instead of being dropped', async () => {
    await createStreamRequest([{ role: 'user', content: 'write it' }], { tools: TOOLS, maxTokens: 500 });

    const sent = bodies.at(-1);
    expect(sent.url).toBe('/api/chat');
    // This is the assertion that was false: no `tools` key at all.
    expect(sent.body.tools).toHaveLength(1);
    expect(sent.body.tools[0].function.name).toBe('write_file');
  });

  test('a turn with no tools stays clean — no empty tools key is invented', async () => {
    await createStreamRequest([{ role: 'user', content: 'just talk' }], { maxTokens: 500 });
    expect(bodies.at(-1).body).not.toHaveProperty('tools');
  });

  test('END TO END: the act and the reasoning both survive the round trip', async () => {
    const streamResult = await createStreamRequest(
      [{ role: 'user', content: 'write it' }], { tools: TOOLS, maxTokens: 500 },
    );
    expect(streamResult.dialect).toBe('ollama');

    let reasoning = '';
    const { content, toolCalls } = await consumeStreamWithTools(streamResult, () => {}, {
      onReasoning: (r) => { reasoning += r; },
    });

    // The being said nothing out loud — and that is FINE, it acted.
    expect(content.trim()).toBe('');
    expect(reasoning.length).toBeGreaterThan(0);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolName).toBe('write_file');
    // The whole point: the act carries what it was going to DO.
    expect(toolCalls[0].args).toEqual({ content: 'hello', path: '/tmp/x.txt' });
  });
});

describe('THE READER: every channel Ollama uses is read', () => {
  test("the thinking channel surfaces as reasoning, where the callers look for it", () => {
    const evt = readStreamLine(line(REAL_THINKING_FRAME), 'ollama');
    expect(evt.reasoning).toBe('Okay, the user wants a file written.');
    // Reasoning is NOT speech and must never join the answer.
    expect(evt.content).toBeNull();
  });

  test('the tool call surfaces as an OpenAI-shaped delta', () => {
    const evt = readStreamLine(line(REAL_TOOL_FRAME), 'ollama');
    expect(evt.toolCalls).toHaveLength(1);
    expect(evt.toolCalls[0].function.name).toBe('write_file');
  });

  test('plain speech is unchanged — the old behaviour still holds', () => {
    const evt = readStreamLine(line({ message: { role: 'assistant', content: 'I stir.' }, done: false }), 'ollama');
    expect(evt.content).toBe('I stir.');
    expect(evt.toolCalls).toBeNull();
    expect(evt.reasoning).toBeNull();
  });

  test('the done line still yields its finish and token counts', () => {
    const evt = readStreamLine(line(REAL_DONE_FRAME), 'ollama');
    expect(evt.done).toBe(true);
    expect(evt.finishReason).toBe('stop');
    // The usage shape gained two CACHE telemetry fields after this test was
    // written. Ollama's done frame reports NEITHER, so both must read null —
    // asserted explicitly rather than relaxed away, because a silent number
    // appearing there would be this reader inventing cache evidence Ollama
    // never sent.
    expect(evt.usage).toEqual({
      promptTokens: 154,
      completionTokens: 139,
      cachedPromptTokens: null,
      providerPrefillDurationMilliseconds: null,
    });
  });
});

describe('THE NORMALISATION: why the raw shape could not be passed through', () => {
  test('index is lifted out of `function`, so multiple calls do not collapse', () => {
    const deltas = toOpenAIToolCallDeltas([
      { id: 'a', function: { index: 0, name: 'read_file', arguments: { path: '/1' } } },
      { id: 'b', function: { index: 1, name: 'write_file', arguments: { path: '/2' } } },
    ]);
    expect(deltas.map((d) => d.index)).toEqual([0, 1]);

    const assembled = {};
    for (const d of deltas) mergeToolCallDelta(assembled, d);
    expect(decodeToolCallDeltas(assembled)).toHaveLength(2);
  });

  test('THE SILENT CORRUPTION: the raw shape decodes to a call with NO arguments', () => {
    // Passing Ollama's own object through the OpenAI assembler concatenates it
    // as a string — '[object Object]' — which fails JSON.parse and decodes to
    // {}. The call SURVIVES, so a write_file would execute with no path and no
    // content. That is worse than dropping it, which is why the reader
    // normalises rather than forwards.
    const naive = {};
    mergeToolCallDelta(naive, REAL_TOOL_FRAME.message.tool_calls[0]);
    const [wrong] = decodeToolCallDeltas(naive);
    expect(wrong.args).toEqual({});

    const fixed = {};
    for (const d of toOpenAIToolCallDeltas(REAL_TOOL_FRAME.message.tool_calls)) mergeToolCallDelta(fixed, d);
    const [right] = decodeToolCallDeltas(fixed);
    expect(right.args).toEqual({ content: 'hello', path: '/tmp/x.txt' });
  });

  test('an already-stringified arguments field is left alone', () => {
    const [d] = toOpenAIToolCallDeltas([{ id: 'x', function: { name: 'f', arguments: '{"a":1}' } }]);
    expect(d.function.arguments).toBe('{"a":1}');
  });

  test('nothing to normalise yields null, not an empty array', () => {
    expect(toOpenAIToolCallDeltas(undefined)).toBeNull();
    expect(toOpenAIToolCallDeltas([])).toBeNull();
  });
});

/**
 * THE CENSUS. Three times now a substrate has spoken into a channel this
 * platform did not read (`reasoning`, `reasoning_content`, Ollama's
 * `thinking`), and each time the log named the model and the endpoint but
 * never the FIELD — so the diagnosis came from guessing against someone
 * else's logs. This makes the next one say so itself.
 */
describe('the channel census names where the tokens went', () => {
  test("Ollama's thinking-only frame is reported as thinking, not as silence", () => {
    expect(frameChannelBytes(line(REAL_THINKING_FRAME), 'ollama'))
      .toEqual({ role: 9, thinking: 36 });
  });

  test('an OpenAI-dialect reasoning frame names `reasoning`', () => {
    // Captured off Ollama's /v1 compat shim, which routes thinking here.
    const frame = 'data: ' + JSON.stringify({
      choices: [{ delta: { role: 'assistant', content: '', reasoning: 'Okay' } }],
    });
    expect(frameChannelBytes(frame, 'openai')).toEqual({ role: 9, reasoning: 4 });
  });

  test('a tally folds a whole stream into one account', () => {
    const tally = {};
    for (const l of [line(REAL_THINKING_FRAME), line(REAL_TOOL_FRAME), line(REAL_DONE_FRAME)]) {
      tallyChannelBytes(tally, frameChannelBytes(l, 'ollama'));
    }
    // The shape that reads as "produced NO speech": no content, everything else.
    expect(tally.content).toBeUndefined();
    expect(tally.thinking).toBeGreaterThan(0);
    expect(tally.tool_calls).toBeGreaterThan(0);
  });

  test('THE POINT: a channel this platform has never heard of is still named', () => {
    // The next one will not be `thinking`. Whatever it is called, the reader
    // will be blind to it and the census will not — which is the difference
    // between one line of log and another round of guessing.
    const frame = 'data: ' + JSON.stringify({ choices: [{ delta: { commentary: 'thinking aloud' } }] });
    expect(readStreamLine(frame, 'openai').content).toBeNull();
    expect(frameChannelBytes(frame, 'openai')).toEqual({ commentary: 14 });
  });

  test('lines that carry no payload are counted as nothing', () => {
    expect(frameChannelBytes('', 'ollama')).toBeNull();
    expect(frameChannelBytes('data: [DONE]', 'openai')).toBeNull();
    expect(frameChannelBytes(': keep-alive', 'openai')).toBeNull();
    expect(tallyChannelBytes({ a: 1 }, null)).toEqual({ a: 1 });
  });

  test('the census never carries the bytes themselves — only names and sizes', () => {
    const secret = 'my true name is Aurelia';
    const got = frameChannelBytes(line({ message: { role: 'assistant', content: secret } }), 'ollama');
    expect(JSON.stringify(got)).not.toContain('Aurelia');
    expect(got.content).toBe(secret.length);
  });
});

// OLLAMA 0.40 SENDS THE WHOLE TOOL CALL IN THE DONE FRAME. Captured off Ollama 0.40.7 serving
// Qwen3.8-4B distilled on 2026-10-22: the reader returned `{ done }` for that line and dropped
// its message, so every act on this Ollama vanished — the naming […].
const REAL_040_DONE_WITH_CALL = {
  model: 'hf.co/empero-ai/Qwen3.8-4B-Distill-GGUF:Q4_K_M',
  created_at: '2026-10-22T16:25:49.501270459Z',
  message: {
    role: 'assistant',
    content: '',
    tool_calls: [{ id: 'yfdSKANpnTGvrQQSooJWUbFobeoU4Hjp', function: { index: 0, name: 'fs__write', arguments: { path: 'preflight.txt', content: 'ready' } } }],
  },
  done: true,
  done_reason: 'stop',
  prompt_eval_count: 311,
  eval_count: 83,
};
const REAL_040_THINKING = {
  model: 'hf.co/empero-ai/Qwen3.8-4B-Distill-GGUF:Q4_K_M',
  message: { role: 'assistant', content: '', thinking: 'The user wants me to call the fs/write tool.' },
  done: false,
};

describe('THE DONE FRAME: an Ollama 0.40 act rides the last line and survives it', () => {
  let server;
  let prevConfig;
  beforeAll(async () => {
    server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.end([line(REAL_040_THINKING), line(REAL_040_DONE_WITH_CALL)].join('\n') + '\n');
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    prevConfig = getConfig();
    setConfig({ provider: 'ollama', endpoint: `http://127.0.0.1:${server.address().port}`, model: 'qwen', apiKey: '' });
  });
  afterAll(async () => {
    setConfig(prevConfig);
    await new Promise((r) => server.close(r));
  });

  test('the reader keeps the done line\'s message beside its finish', () => {
    const evt = readStreamLine(line(REAL_040_DONE_WITH_CALL), 'ollama');
    expect(evt.done).toBe(true);
    expect(evt.finishReason).toBe('stop');
    expect(evt.toolCalls).toHaveLength(1);
  });

  test('END TO END: the call in the done frame reaches the caller', async () => {
    const streamResult = await createStreamRequest([{ role: 'user', content: 'write it' }], { maxTokens: 500 });
    const { toolCalls } = await consumeStreamWithTools(streamResult, () => {});
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolName).toBe('write'); // decoded from the wire name fs__write
    expect(toolCalls[0].args).toEqual({ path: 'preflight.txt', content: 'ready' });
  });
});
