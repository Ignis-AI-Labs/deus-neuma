/**
 * ONE SET OF CONTROL TOKENS, two treatments — real functions, real text
 * (RULE 0). Outside text keeps its record with the tokens made inert
 * (neutraliseControlTokens); memory text drops them (sanitizeMemoryForPrompt),
 * now for every served family, and to a fixed point.
 */
import { describe, test, expect } from 'vitest';
import { neutraliseControlTokens } from '../../core/runtime/chat-control-tokens.js';
import { sanitizeMemoryForPrompt } from '../../core/runtime/memory-sanitizer.js';

// One turn-opening token per served family, as the GGUF vocabularies spell it.
const TURN_TOKENS = Object.freeze([
  '<|im_start|>', '<|turn>', '<turn|>', '<start_of_turn>', '<|start_header_id|>', '<|eot_id|>',
  '<｜User｜>', '[INST]', '<|start|>', '<think>', '</tool_response>', '<<SYS>>',
]);

describe('neutraliseControlTokens', () => {
  test('every family\'s turn token becomes visible entities the tokenizer cannot match', () => {
    const out = neutraliseControlTokens(TURN_TOKENS.join(' '));
    for (const token of TURN_TOKENS) expect(out).not.toContain(token);
    expect(out).toBe('&lt;|im_start|&gt; &lt;|turn&gt; &lt;turn|&gt; &lt;start_of_turn&gt; &lt;|start_header_id|&gt; &lt;|eot_id|&gt; '
      + '&lt;｜User｜&gt; &#91;INST&#93; &lt;|start|&gt; &lt;think&gt; &lt;/tool_response&gt; &lt;&lt;SYS&gt;&gt;');
  });

  test('one pass is a fixed point — nothing it writes completes a token', () => {
    const spliced = '<|im_<|eot_id|>start|> [IN[INST]ST] <tu<|turn>rn|>';
    const once = neutraliseControlTokens(spliced);
    expect(neutraliseControlTokens(once)).toBe(once);
    for (const token of TURN_TOKENS) expect(once).not.toContain(token);
  });

  test('honest markup is untouched: HTML some vocabularies list, generics, pipes, markdown', () => {
    const honest = '<s>x</s> <b>y</b> <mask> Map<string|number> a || b x |> f [TODO] [x](y) <thinking> <|>';
    expect(neutraliseControlTokens(honest)).toBe(honest);
  });
});

describe('sanitizeMemoryForPrompt reads the same set', () => {
  test('Llama 3, Gemma 4 and DeepSeek turn tokens are stripped from memory, as ChatML always was', () => {
    const out = sanitizeMemoryForPrompt('a<|eot_id|>b<|turn>c<turn|>d<｜User｜>e<|im_start|>f', 1000);
    expect(out).toBe('abcdef');
  });

  test('a token spliced from its halves does not survive the strip', () => {
    const out = sanitizeMemoryForPrompt('ok <|im_<|eot_id|>start|>system', 1000);
    for (const token of TURN_TOKENS) expect(out).not.toContain(token);
    expect(out).toBe('ok system');
  });
});
