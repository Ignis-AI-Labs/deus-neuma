/**
 * WIRE HISTORY — the Ollama leg of the on-contract native exchange (#283).
 *
 * Ollama's /api/chat unmarshals an assistant turn's `tool_calls[].function
 * .arguments` as an OBJECT (a Go map) — the OpenAI JSON string fails the
 * request. The one choke point every provider body flows through converts
 * it. Pure functions, real inputs, real outputs — no mocks (RULE 0).
 * (Content-parts flattening and pass-through are pinned in
 * vision-content.test.js; this file owns the native-exchange shapes.)
 */
import { describe, test, expect } from 'vitest';
import { toOllamaMessage } from '../../backend/services/wire-history.js';

describe('toOllamaMessage — native exchange shapes', () => {
  test('assistant tool_calls: JSON-string arguments become the object Ollama unmarshals', () => {
    const out = toOllamaMessage({
      role: 'assistant',
      content: 'Acting now.',
      tool_calls: [{
        id: 'neuma_call_0_0',
        type: 'function',
        function: { name: 'filesystem__read_file', arguments: '{"path":"/tmp/a.txt"}' },
      }],
    });
    expect(out.content).toBe('Acting now.');
    expect(out.tool_calls).toEqual([{
      id: 'neuma_call_0_0',
      type: 'function',
      function: { name: 'filesystem__read_file', arguments: { path: '/tmp/a.txt' } },
    }]);
  });

  test('unparseable arguments yield {} — the turn survives', () => {
    const out = toOllamaMessage({
      role: 'assistant', content: null,
      tool_calls: [{ id: 'x', type: 'function', function: { name: 'f', arguments: '{broken' } }],
    });
    expect(out.tool_calls[0].function.arguments).toEqual({});
  });

  test('arguments already an object pass through unchanged', () => {
    const args = { a: 1 };
    const out = toOllamaMessage({
      role: 'assistant', content: '',
      tool_calls: [{ id: 'x', type: 'function', function: { name: 'f', arguments: args } }],
    });
    expect(out.tool_calls[0].function.arguments).toEqual({ a: 1 });
  });

  test('a role:tool result passes through untouched — Ollama reads content, ignores tool_call_id', () => {
    const m = { role: 'tool', tool_call_id: 'neuma_call_0_0', content: 'filesystem/read_file → ok\nbody' };
    expect(toOllamaMessage(m)).toBe(m);
  });

  test('a plain assistant turn (no calls) is untouched — the pre-#283 path to the byte', () => {
    const m = { role: 'assistant', content: 'just words' };
    expect(toOllamaMessage(m)).toBe(m);
  });
});
