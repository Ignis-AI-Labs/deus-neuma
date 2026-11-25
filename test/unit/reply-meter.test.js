/**
 * THE REPLY METER (backend/services/reply-meter.js) — no mock on the claimed
 * path (RULE 0): the phase math is pure and called with real inputs, and the
 * wired path runs the platform's OWN stream pump (consumeStreamWithTools) over
 * frames in the exact shape the house's llama-server sends — reasoning, then
 * speech, then a batched tool call, then its usage + timings frame.
 */
import { describe, test, expect } from 'vitest';
import { meterOpen, meterStep, meterView, recentSummary, replyPerformance } from '../../backend/services/reply-meter.js';
import { consumeStreamWithTools } from '../../backend/services/llm-provider.js';

const think = { reasoning: 'x' };
const say = { content: 'x' };
const call = { toolCalls: [{ index: 0, function: { arguments: 'x' } }] };

describe('one reply, timed by phase', () => {
  test('the first token ends the wait; every later token is its phase\'s, with the gap before it', () => {
    let s = meterOpen(1000);
    s = meterStep(s, think, 1400); // first token: 400 ms to first token, no phase gap
    for (let i = 1; i <= 50; i += 1) s = meterStep(s, think, 1400 + i * 14); // 50 more at 14 ms
    for (let i = 1; i <= 20; i += 1) s = meterStep(s, say, 2100 + i * 12.5); // 20 answer tokens
    const v = meterView(s);
    expect(v.ttftMs).toBe(400);
    expect(v.thinking).toMatchObject({ tokens: 51, timed: 50 });
    expect(v.thinking.tokPerSec).toBeCloseTo(50 / 0.7, 6);
    expect(v.answer).toMatchObject({ tokens: 20, timed: 20 });
    expect(v.answer.tokPerSec).toBeCloseTo(20 / 0.25 * 1, 0); // 250 ms incl. the turn from thinking
    expect(v.phase).toBe('answer');
  });

  test('a tool call\'s batched pieces are counted as the server counted the reply', () => {
    let s = meterOpen(0);
    s = meterStep(s, think, 100);
    for (let i = 1; i <= 10; i += 1) s = meterStep(s, think, 100 + i * 10);
    for (let i = 1; i <= 3; i += 1) s = meterStep(s, call, 200 + i * 100);
    s = meterStep(s, { timings: { predicted_n: 40, predicted_ms: 500, prompt_n: 5, prompt_ms: 50, cache_n: 95, draft_n: 30, draft_n_accepted: 27 } }, 600);
    const v = meterView(s);
    expect(v.tool).toMatchObject({ tokens: 29, timed: 29, ms: 300 });
    expect(v.server).toMatchObject({ promptTokens: 5, cachedTokens: 95, draftAccepted: 27 });
  });

  test('frames that carry no token (usage, finish) are no phase\'s', () => {
    const s = meterStep(meterOpen(0), { usage: { promptTokens: 3 }, finishReason: 'stop' }, 50);
    expect(meterView(s)).toMatchObject({ ttftMs: null, phase: null, thinking: { tokens: 0, tokPerSec: null } });
  });
});

describe('the last replies together', () => {
  test('rates weighted by tokens, first token by median, cache and drafts from the server\'s own counts', () => {
    const view = (thinkTimed, thinkMs, ttft, server) => meterView({
      ...meterOpen(0), firstAt: ttft, lastAt: ttft + thinkMs, phase: 'thinking', timings: server,
      phases: { thinking: { tokens: thinkTimed + 1, timed: thinkTimed, ms: thinkMs }, answer: { tokens: 0, timed: 0, ms: 0 }, tool: { tokens: 0, timed: 0, ms: 0 } },
    });
    const sum = recentSummary([
      view(1000, 10_000, 300, { prompt_n: 1000, prompt_ms: 500, cache_n: 9000, predicted_n: 1001, predicted_ms: 10_000, draft_n: 800, draft_n_accepted: 600 }),
      view(10, 1000, 900, { prompt_n: 100, prompt_ms: 100, cache_n: 0, predicted_n: 11, predicted_ms: 1000, draft_n: 0, draft_n_accepted: 0 }),
      view(0, 0, 500, null),
    ]);
    expect(sum.replies).toBe(3);
    expect(sum.thinking).toBeCloseTo(1010 / 11, 6); // not the mean of 100 and 10
    expect(sum.ttftMs).toBe(500);
    expect(sum.promptTokPerSec).toBeCloseTo(1100 / 0.6, 6);
    expect(sum.cacheReuse).toBeCloseTo(9000 / 10_100, 6);
    expect(sum.draftAcceptance).toBe(0.75);
    expect(sum.answer).toBeNull();
  });
});

describe('the platform\'s own pump meters a reply from the house\'s server', () => {
  const frame = (delta, extra = {}) => `data: ${JSON.stringify({ choices: [{ index: 0, finish_reason: null, delta }], object: 'chat.completion.chunk', ...extra })}\n\n`;
  const frames = [
    ...Array.from({ length: 30 }, () => frame({ reasoning_content: 'hm ' })),
    ...Array.from({ length: 10 }, () => frame({ content: 'yes ' })),
    frame({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'system__call', arguments: '{"tool":"fs/read",' } }] }),
    frame({ tool_calls: [{ index: 0, function: { arguments: '"args":{"path":"a.md"}}' } }] }),
    `data: ${JSON.stringify({ choices: [], usage: { completion_tokens: 52, prompt_tokens: 900 }, timings: { prompt_n: 900, prompt_ms: 600, cache_n: 4000, predicted_n: 52, predicted_ms: 700, draft_n: 40, draft_n_accepted: 33 } })}\n\n`,
    'data: [DONE]\n\n',
  ];
  // The bytes arrive over real time, a frame every 15 ms, as a server sends them.
  const served = () => new Response(new ReadableStream({
    async start(c) {
      for (const f of frames) { c.enqueue(new TextEncoder().encode(f)); await new Promise((r) => setTimeout(r, 15)); }
      c.close();
    },
  }));

  test('a local reply lands in the recent replies, by phase, with the server\'s account', async () => {
    const before = replyPerformance(performance.now()).recent.length;
    const out = await consumeStreamWithTools({ response: served(), provider: 'llama-server', dialect: 'openai', requestStartedAt: performance.now(), local: true }, () => {}, {});
    expect(out.toolCalls[0].tool).toBe('system/call');
    const { recent, live } = replyPerformance(performance.now());
    expect(live).toEqual([]);
    expect(recent.length).toBe(Math.min(before + 1, 10));
    expect(recent[0]).toMatchObject({ thinking: { tokens: 30 }, answer: { tokens: 10 }, tool: { tokens: 12 }, server: { cachedTokens: 4000, draftAccepted: 33 } });
    expect(recent[0].thinking.tokPerSec).toBeGreaterThan(20);
    expect(recent[0].ttftMs).toBeGreaterThan(0);
  });

  test('a reply to any other server is never metered', async () => {
    const before = replyPerformance(performance.now()).recent[0];
    await consumeStreamWithTools({ response: served(), provider: 'anthropic-like', dialect: 'openai', requestStartedAt: performance.now() }, () => {}, {});
    expect(replyPerformance(performance.now()).recent[0]).toBe(before);
  });
});
