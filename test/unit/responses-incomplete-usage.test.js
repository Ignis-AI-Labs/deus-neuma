import { expect, test } from 'vitest';
import { readStreamLine } from '../../backend/services/llm-stream-frames.js';

const parse = (type, response) => readStreamLine(`data: ${JSON.stringify({ type, response })}`, 'openai-responses');

test('max-output incomplete frame preserves finish reason and real usage fields', () => {
  const response = { incomplete_details: { reason: 'max_output_tokens' }, usage: {
    input_tokens: 123, output_tokens: 40, input_tokens_details: { cached_tokens: 100 }, prefill_duration_ms: 12,
  } };
  const result = parse('response.incomplete', response);
  expect(result).toEqual({ done: true, finishReason: 'length', usage: {
    promptTokens: 123, completionTokens: 40, cachedPromptTokens: 100, providerPrefillDurationMilliseconds: 12,
  } });
  expect(result.usage).toEqual(parse('response.completed', response).usage);
});

test('incomplete frame without usage still reports truncation without inventing counts', () => {
  expect(parse('response.incomplete', { incomplete_details: { reason: 'max_output_tokens' } }))
    .toEqual({ done: true, finishReason: 'length', usage: null });
});

test('other incomplete reasons remain errors', () => {
  expect(parse('response.incomplete', { incomplete_details: { reason: 'content_filter' } }))
    .toEqual({ error: 'OpenAI response incomplete: content_filter' });
});
