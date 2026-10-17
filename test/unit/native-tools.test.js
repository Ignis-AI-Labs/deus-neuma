import { encodeToolName, decodeToolName, toOpenAITools } from '../../backend/services/tool-schema.js';
import { getCapabilities } from '../../backend/services/model-capabilities.js';
import {
  mergeToolCallDelta, decodeToolCallDeltas,
} from '../../backend/services/llm-provider.js';
import { toResponsesInput } from '../../backend/services/wire-history.js';

describe('tool-schema adapter (native FC <-> internal)', () => {
  test('encodeToolName namespaces server/tool into a valid OpenAI function name', () => {
    expect(encodeToolName('filesystem', 'write_file')).toBe('filesystem__write_file');
    expect(encodeToolName(null, 'read_file')).toBe('read_file');
  });

  test('decodeToolName reverses on the first separator', () => {
    expect(decodeToolName('filesystem__write_file')).toEqual({ server: 'filesystem', toolName: 'write_file' });
    expect(decodeToolName('read_file')).toEqual({ server: null, toolName: 'read_file' });
  });

  test('decodeToolName keeps a tool name that itself contains the separator after the server', () => {
    const encoded = encodeToolName('filesystem', 'weird__name');
    expect(decodeToolName(encoded)).toEqual({ server: 'filesystem', toolName: 'weird__name' });
  });

  test('toOpenAITools builds the OpenAI schema and omits tools without an inputSchema', () => {
    const schema = toOpenAITools([
      { server: 'filesystem', name: 'write_file', description: 'write', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
      { server: 'wallet', name: 'wallet_send', description: 'spend' }, // no inputSchema — kept on text protocol
    ]);
    expect(schema).toEqual([{
      type: 'function',
      function: {
        name: 'filesystem__write_file',
        description: 'write',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    }]);
  });

  test('toOpenAITools guards against non-array input', () => {
    expect(toOpenAITools(null)).toEqual([]);
    expect(toOpenAITools([])).toEqual([]);
  });
});

describe('model-capabilities — native tool detection', () => {
  test('gpt-oss (served as openai/gpt-oss-120b) resolves to tools:true', () => {
    const caps = getCapabilities('openai/gpt-oss-120b');
    expect(caps.tools).toBe(true);
    expect(caps.family).toBe('openai');
  });

  test('org/ prefix is stripped for registry + prefix matching', () => {
    expect(getCapabilities('qwen/qwen2.5-7b').tools).toBe(true);
    expect(getCapabilities('meta-llama/llama3').tools).toBe(false);
  });

  test('registry exact + tag-stripped match still work', () => {
    expect(getCapabilities('gpt-4o').tools).toBe(true);
    expect(getCapabilities('llama3.1:8b').tools).toBe(true);
  });
});

describe('native tool-call delta assembly', () => {
  test('mergeToolCallDelta assembles name + streamed argument fragments by index', () => {
    const asm = {};
    mergeToolCallDelta(asm, { index: 0, id: 'call_1', function: { name: 'filesystem__write_file', arguments: '{"path": "' } });
    mergeToolCallDelta(asm, { index: 0, function: { arguments: '/tmp/x.md"}' } });
    mergeToolCallDelta(asm, { index: 1, function: { name: 'filesystem__read_file', arguments: '{"path":"/tmp/x.md"}' } });
    const calls = decodeToolCallDeltas(asm);
    expect(calls).toEqual([
      { callId: 'call_1', server: 'filesystem', toolName: 'write_file', tool: 'filesystem/write_file', args: { path: '/tmp/x.md' }, _native: true },
      { callId: null, server: 'filesystem', toolName: 'read_file', tool: 'filesystem/read_file', args: { path: '/tmp/x.md' }, _native: true },
    ]);
  });

  test('malformed native arguments are repaired where they can be, and FLAGGED where they cannot — never run on {} silently', () => {
    // a raw control character inside a string: repaired, the call runs with its real args
    const repaired = decodeToolCallDeltas({ 0: { name: 'fs__write', args: '{"path": "a.md", "content": "line one\nline two"}'.replace('\\n', '\n') } });
    expect(repaired[0].args).toMatchObject({ path: 'a.md' });
    expect(repaired[0]._argsError).toBeUndefined();
    // beyond repair: empty args, and the raw text carried so the model is told (portal-tool-loop)
    const broken = decodeToolCallDeltas({ 0: { name: 'filesystem__write_file', args: '{not json' } });
    expect(broken[0].args).toEqual({});
    expect(broken[0].toolName).toBe('write_file');
    expect(broken[0]._argsError).toBe('{not json');
    // a JSON value that is not an object (a bare string, an array) is not arguments either
    expect(decodeToolCallDeltas({ 0: { name: 'fs__read', args: '["a.md"]' } })[0]._argsError).toBe('["a.md"]');
    // no arguments at all is a call with none — not an error
    expect(decodeToolCallDeltas({ 0: { name: 'fs__list', args: '' } })[0]).not.toHaveProperty('_argsError');
  });

  test('a bare (un-namespaced) native call decodes with a null server', () => {
    const asm = { 0: { name: 'write_file', args: '{"path":"a"}' } };
    expect(decodeToolCallDeltas(asm)[0]).toMatchObject({ server: null, toolName: 'write_file', tool: 'write_file' });
  });
});

describe('Responses native tool history', () => {
  test('preserves function-call and function-output pairing between rounds', () => {
    expect(toResponsesInput([
      { role: 'system', content: 'Use tools.' },
      {
        role: 'assistant', content: null,
        tool_calls: [{
          id: 'call_1', type: 'function',
          function: { name: 'coding__inspect', arguments: '{"command":"pwd"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'coding/inspect -> ok' },
      { role: 'user', content: 'Report the evidence.' },
    ])).toEqual([
      {
        type: 'function_call', call_id: 'call_1', name: 'coding__inspect',
        arguments: '{"command":"pwd"}',
      },
      { type: 'function_call_output', call_id: 'call_1', output: 'coding/inspect -> ok' },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Report the evidence.' }] },
    ]);
  });
});
