import { expect, test } from 'vitest';
import { readStreamLine } from '../../backend/services/llm-stream-frames.js';

// Anthropic counts the prompt in three parts; the prompt the window holds is
// their sum (#19 — the uncached part alone kept witness compaction from firing).
const start = (usage) => readStreamLine(`data: ${JSON.stringify({ type: 'message_start', message: { usage } })}`, 'anthropic');

test('the prompt count is uncached + cache read + cache write; the cache read still rides beside it', () => {
  expect(start({ input_tokens: 10000, cache_read_input_tokens: 140000, cache_creation_input_tokens: 2500, output_tokens: 1 }).usage)
    .toMatchObject({ promptTokens: 152500, cachedPromptTokens: 140000 });
});

test('an uncached prompt reads as before, and a frame with no counts invents none', () => {
  expect(start({ input_tokens: 420, output_tokens: 1 }).usage).toMatchObject({ promptTokens: 420 });
  expect(start({}).usage).toBeUndefined();
});
