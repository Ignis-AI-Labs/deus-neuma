/**
 * The capacity scan counts what the server GENERATED (2026-10-13), proven
 * over a real loopback OpenAI-wire provider (RULE 0) through the real fire
 * (fireCapacityProbes → createStreamRequest → readStreamLine).
 *
 * The Sep 9 scan counted only the visible words of a thinking model: its
 * one-agent row read 20 "tok/s" on a server the long-session bench measured
 * at 80. Reasoning is generated work, and when the server reports its own
 * count (stream usage) that count is the truth; the whitespace proxy is the
 * fallback only.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { startLocalProvider } from '../helpers/local-provider.js';
import { fireCapacityProbes, DEFAULT_PROBE } from '../../backend/services/capacity-scan.js';
import { setConfig, getConfig } from '../../backend/services/llm-provider.js';

describe('a capacity probe counts the reasoning and the server\'s own token count', () => {
  let provider;
  let prior;
  beforeAll(async () => {
    provider = await startLocalProvider();
    prior = getConfig();
    setConfig({ provider: 'custom', endpoint: provider.endpoint, model: 'test-model', apiKey: '' });
  });
  afterAll(async () => {
    setConfig(prior);
    await provider?.close();
  });

  test('a thinking answer with a server usage count: the server\'s count is the token source', async () => {
    provider.setScript([{
      reasoning: ['Counting carefully, ', 'one number per line.'], reply: '1\n2\n3',
      usage: { prompt_tokens: 30, completion_tokens: 64 }, delayMs: 50,
    }]);
    const wave = await fireCapacityProbes(1, DEFAULT_PROBE);
    expect(wave.ok).toBe(true);
    expect(wave.tokenSource).toBe('server-usage');
    // 64 generated tokens over the generation span — never the 3 visible "words".
    expect(wave.aggregateTokPerSec).toBeGreaterThan(64);
  });

  test('a server that reports nothing: reasoning and words both counted, by the whitespace proxy', async () => {
    provider.setScript([{ reasoning: 'a b c d e f g h', reply: '1 2' }]);
    const wave = await fireCapacityProbes(2, DEFAULT_PROBE);
    expect(wave.ok).toBe(true);
    expect(wave.tokenSource).toBe('whitespace-proxy');
    expect(wave.aggregateTokPerSec).toBeGreaterThan(0);
  });
});
