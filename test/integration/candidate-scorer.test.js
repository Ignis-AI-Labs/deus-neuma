// THE CANDIDATE SCORER against the REAL substrate (#533 phase 1).
// Rule 0: the live block drives the operator's actual house llama-server on
// :8089 (gated only on its /health answering — a down substrate is an
// environment state, not a pass). The pure laws run on real inputs, no doubles.

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  chatCompletionsUrl, totalLogprobOf, scoreCandidates, CANDIDATE_SCORER_DEFAULTS,
} from '../../backend/services/candidate-scorer.js';

const exec = promisify(execFile);
const HOUSE = 'http://127.0.0.1:8089';
const MODEL = 'qwen3.8-27b';

const substrateUp = await exec('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}',
  `${HOUSE}/health`, '--max-time', '3'])
  .then(({ stdout }) => stdout.trim() === '200')
  .catch(() => false);

describe('candidate scorer — pure laws', () => {
  it('chatCompletionsUrl resolves base, /v1, and trailing-slash forms; refuses non-http', () => {
    expect(chatCompletionsUrl('http://127.0.0.1:8089')).toBe('http://127.0.0.1:8089/v1/chat/completions');
    expect(chatCompletionsUrl('http://127.0.0.1:8089/')).toBe('http://127.0.0.1:8089/v1/chat/completions');
    expect(chatCompletionsUrl('http://127.0.0.1:8089/v1')).toBe('http://127.0.0.1:8089/v1/chat/completions');
    expect(() => chatCompletionsUrl('unix:///run/podman.sock')).toThrow(/http\(s\)/);
  });

  it('totalLogprobOf sums per-token logprobs and is null-safe', () => {
    expect(totalLogprobOf({ logprobs: { content: [{ logprob: -0.5 }, { logprob: -1.25 }] } })).toBeCloseTo(-1.75);
    expect(totalLogprobOf({ logprobs: { content: [] } })).toBeNull();
    expect(totalLogprobOf({})).toBeNull();
    // A missing number is the worst possible evidence, not zero.
    expect(totalLogprobOf({ logprobs: { content: [{ logprob: -1 }, {}] } })).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe.runIf(substrateUp)('against the live house substrate', () => {
  it('K scored generations ride the non-streaming, tool-free door', async () => {
    const results = await scoreCandidates({
      url: HOUSE,
      model: MODEL,
      messages: [{ role: 'user', content: 'Reply with exactly one word: readiness' }],
      count: 2,
      temperature: 0.4,
      maxTokens: 24,
    });
    expect(results).toHaveLength(2);
    for (const candidate of results) {
      expect(candidate.tokens).toBeGreaterThan(0);
      expect(candidate.totalLogprob).toBeLessThan(0);
      expect(Number.isFinite(candidate.totalLogprob)).toBe(true);
      expect(typeof candidate.text).toBe('string');
    }
    // The seeds differ (seed+i) — the two calls are independent asks, and the
    // default topLogprobs rode the request (CANDIDATE_SCORER_DEFAULTS).
    expect(CANDIDATE_SCORER_DEFAULTS.topLogprobs).toBe(1);
  }, 90_000);

  it('a refusal is a typed error, never a silent zero', async () => {
    await expect(scoreCandidates({
      url: 'http://127.0.0.1:9', // nothing listens here
      model: MODEL,
      messages: [{ role: 'user', content: 'x' }],
      count: 1,
      timeoutMs: 2_000,
    })).rejects.toThrow(/candidate 0/);
  }, 30_000);

  it('argument laws refuse before any wire call', async () => {
    await expect(scoreCandidates({ url: HOUSE, model: MODEL, messages: [{ role: 'user', content: 'x' }], count: 0 }))
      .rejects.toThrow(/integer 1-16/);
    await expect(scoreCandidates({ url: HOUSE, model: MODEL, messages: [], count: 1 }))
      .rejects.toThrow(/messages/);
  });
});
