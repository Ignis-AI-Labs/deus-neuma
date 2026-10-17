/**
 * THE TOOL EXCHANGE (#283 / BE-157) — pure functions, real inputs, real
 * outputs, no mocks (RULE 0).
 *
 * The contract under test: a round whose acts came from NATIVE tool calls
 * re-enters history on the pairing the model was trained on — its own
 * `tool_calls` on the assistant turn, one `role:'tool'` + `tool_call_id`
 * per result — and the text protocol's `<tool_response>` turn is unchanged
 * to the byte for substrates without native calling.
 */
import { describe, test, expect } from 'vitest';
import {
  TOOL_RESULT_MAX_CHARS, RESULTS_FOLLOW_UP,
  formatToolResult, formatToolResults, nativeToolExchange,
} from '../../backend/services/tool-exchange.js';

const CALLS = [
  { callId: 'prov_1', server: 'filesystem', toolName: 'read_file', args: { path: '/tmp/a.txt' } },
  { callId: null, server: 'tasks', toolName: 'task_add', args: { content: 'ship it' } },
];
const RESULTS = [
  { tool: 'filesystem/read_file', status: 'ok', content: 'file body' },
  { tool: 'tasks/task_add', status: 'error', error: 'ledger sealed' },
];

const exchange = () => nativeToolExchange({
  response: 'Reading, then filing.',
  calls: CALLS,
  results: RESULTS,
  callId: (index) => `neuma_call_3_${index}`,
  formatResult: formatToolResult,
  followUp: RESULTS_FOLLOW_UP,
});

describe('nativeToolExchange — the on-contract pairing', () => {
  test('the assistant turn carries the model\'s own calls, names re-encoded as advertised', () => {
    const [assistant] = exchange();
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toBe('Reading, then filing.');
    expect(assistant.tool_calls).toEqual([
      {
        id: 'prov_1',
        type: 'function',
        function: { name: 'filesystem__read_file', arguments: JSON.stringify({ path: '/tmp/a.txt' }) },
      },
      {
        id: 'neuma_call_3_1',
        type: 'function',
        function: { name: 'tasks__task_add', arguments: JSON.stringify({ content: 'ship it' }) },
      },
    ]);
  });

  test('one role:tool message per result, ids matching the calls by position', () => {
    const msgs = exchange();
    const tools = msgs.filter((m) => m.role === 'tool');
    expect(tools).toEqual([
      { role: 'tool', tool_call_id: 'prov_1', content: 'filesystem/read_file → ok\nfile body' },
      { role: 'tool', tool_call_id: 'neuma_call_3_1', content: 'tasks/task_add → error: ledger sealed' },
    ]);
  });

  test('the trailing user turn carries the follow-up, and nothing else does', () => {
    const msgs = exchange();
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: RESULTS_FOLLOW_UP });
    expect(msgs).toHaveLength(4);
  });

  test('the follow-up turns gnosis on recall: look, where a tool can reach the answer (SWE-bench 2026-10-10)', () => {
    expect(RESULTS_FOLLOW_UP).toContain('What you remember is a claim too: when the answer is within reach of a tool, look rather than recall.');
  });

  test('a call with no result gets an honest not-executed tool message', () => {
    const msgs = nativeToolExchange({
      response: '', calls: CALLS, results: [RESULTS[0]],
      callId: (i) => `id_${i}`, formatResult: formatToolResult, followUp: 'go on',
    });
    expect(msgs[0].tool_calls).toHaveLength(2);
    expect(msgs.filter((m) => m.role === 'tool')).toHaveLength(2);
    expect(msgs[2].tool_call_id).toBe('id_1');
    expect(msgs[2].content).toContain('not executed');
    // An empty narration rides as null — the OpenAI shape for a pure call turn.
    expect(msgs[0].content).toBeNull();
  });

  test('argless calls encode as "{}" — never undefined on the wire', () => {
    const msgs = nativeToolExchange({
      response: 'x', calls: [{ server: 'a', toolName: 'b' }], results: [],
      callId: (i) => `id_${i}`, formatResult: formatToolResult, followUp: 'f',
    });
    expect(msgs[0].tool_calls[0].function.arguments).toBe('{}');
  });
});

describe('the text protocol is unchanged to the byte', () => {
  test('formatToolResults renders the exact pre-#283 turn', () => {
    expect(formatToolResults(RESULTS)).toBe(
      '<tool_response>\nfilesystem/read_file → ok\nfile body\n\n'
      + 'tasks/task_add → error: ledger sealed\n</tool_response>\n\n'
      + RESULTS_FOLLOW_UP,
    );
  });

  test('an over-cap result is compressed, bounded, and marked recoverable', () => {
    const huge = 'x'.repeat(TOOL_RESULT_MAX_CHARS * 3);
    const text = formatToolResult({ tool: 'filesystem/read_file', status: 'ok', content: huge, ref: 'test1' });
    expect(text.length).toBeLessThan(huge.length);
    expect(text).toContain('ccr:test1');
    expect(text).toContain('record/retrieve_result {"ref":"test1","offset":0}');
  });

  test('a result carrying its own cap keeps the room it asked for', () => {
    const body = 'y'.repeat(6000);
    const text = formatToolResult({ tool: 'skill/use_skill', status: 'ok', content: body, cap: 8000 });
    expect(text).toBe(`skill/use_skill → ok\n${body}`);
  });

  test('a HELD repeat receipt renders its explanation, not a bare status', () => {
    const held = {
      tool: 'fs/read', status: 'held',
      content: 'You already made this exact call earlier this turn — it was not run again. When it ran, it returned (ok):\n\nTHE BODY',
    };
    const text = formatToolResult(held);
    expect(text).toContain('fs/read → held');
    expect(text).toContain('already made this exact call');
    expect(text).toContain('THE BODY');
  });
});
