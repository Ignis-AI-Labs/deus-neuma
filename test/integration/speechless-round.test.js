/**
 * THE SPEECHLESS ROUND (#506), proven at the wire (RULE 0): the REAL
 * `runToolRounds` against a REAL loopback SSE provider (no seam mocked) —
 * the exact failure shape that killed neuma-math25 request 10 twice:
 * reasoning burns the whole output budget (finish_reason length), content
 * arrives empty, no acts are made. The loop used to settle in silence; it
 * must now close for the answer, carrying the being's reasoning tail, once.
 */
import { beforeEach, afterEach, expect, test, describe } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import { startLocalProvider } from '../helpers/local-provider.js';
import { runToolRounds, speechlessRoundClose, SPEECHLESS_ROUND_TAIL_CHARS } from '../../backend/services/portal-turn-rounds.js';
import { openTurnRecord, closeTurnRecord } from '../../backend/services/tool-action-record.js';
import { CLOSE_THINK_BUDGET, UNSETTLED_ALLOWANCE, leashReaskNote } from '../../backend/services/thought-governor.js';
import { THINKING_BUDGET_MESSAGE } from '../../backend/services/llm-request-builders.js';

let kit, provider;
beforeEach(async () => {
  kit = await createHarnessTurnKit('speechless-round-proof');
  provider = await startLocalProvider();
  openTurnRecord(kit.ws);
});
afterEach(async () => {
  closeTurnRecord(kit.ws);
  await provider?.close();
  await kit?.close();
});

const runTurn = () => runToolRounds({
  ws: kit.ws, connection: kit.connection, companion: kit.connection.companion,
  companionName: 'SpeechlessFixture', voiceDNA: null,
  messages: [{ role: 'system', content: 'Answer the task.' }, { role: 'user', content: 'Solve the problem.' }],
  preset: { temperature: 0, maxTokens: 2048, exactMaxTokens: true },
  nativeToolsForRound: () => [],
  interrupt: kit.connection.activeTurn,
  route: { provider: 'lm-studio', endpoint: provider.endpoint, model: 'test-model', apiKey: '' },
  turnLora: null, turnEffort: null, take: { turnId: 'speechless-proof', takeIndex: 1 },
  turnCapabilities: null, contextSections: [], contextBudget: null, contextScope: {},
});

const lastUserMessage = (body) => [...body.messages].reverse().find((m) => m.role === 'user')?.content;

describe('the speechless round closes for the answer', () => {
  test('a budget-dead reasoning round is followed by ONE close that answers', async () => {
    provider.setScript([
      { reasoning: 'the answer requires care; first I consider 6 times 7, which is', reply: '', finishReason: 'length' },
      { reply: 'The final answer is 42.' },
    ]);
    const result = await runTurn();
    expect(result.error).toBeNull();
    expect(provider.turns).toHaveLength(2);
    expect(result.fullResponse).toBe('The final answer is 42.');
    expect(result.latestResponse).toBe('The final answer is 42.');
    // The close asked directly, and carried the being's own reasoning tail so
    // exact sampling continues rather than restarts.
    const close = lastUserMessage(provider.turns[1]);
    expect(close).toContain('Do not deliberate further');
    expect(close).toContain('the answer requires care; first I consider 6 times 7, which is');
    // The close round is tool-less — a closing, never another act.
    expect(provider.turns[1].tools).toBeUndefined();
  });

  test('a second speechless round settles honestly — one close, never a loop', async () => {
    provider.setScript([
      { reasoning: 'again and again', reply: '', finishReason: 'length' },
    ]);
    const result = await runTurn();
    expect(result.error).toBeNull();
    // The script's last entry repeats — if the close re-triggered the
    // recovery, the turns count would run away. Exactly two requests stand.
    expect(provider.turns).toHaveLength(2);
    expect(result.fullResponse).toBe('');
  });

  test('mid-work, the close keeps the tools and the act it makes runs (Terminal-Bench 2026-10-07)', async () => {
    const probe = { type: 'function', function: { name: 'probe__look', description: 'Look.', parameters: { type: 'object', properties: { at: { type: 'string' } } } } };
    provider.setScript([
      { reply: '', toolCalls: [{ name: 'probe__look', args: { at: 'first' } }] },
      { reasoning: 'the setup script is ready, now I should run', reply: '', finishReason: 'length' },
      { reply: '', toolCalls: [{ name: 'probe__look', args: { at: 'second' } }] },
      { reply: 'Done.' },
    ]);
    const result = await runToolRounds({
      ws: kit.ws, connection: kit.connection, companion: kit.connection.companion,
      companionName: 'SpeechlessFixture', voiceDNA: null,
      messages: [{ role: 'system', content: 'Do the task.' }, { role: 'user', content: 'Set it up.' }],
      preset: { temperature: 0, maxTokens: 2048, exactMaxTokens: true },
      nativeToolsForRound: () => [probe],
      interrupt: kit.connection.activeTurn,
      route: { provider: 'lm-studio', endpoint: provider.endpoint, model: 'test-model', apiKey: '' },
      turnLora: null, turnEffort: null, take: { turnId: 'speechless-acting-proof', takeIndex: 1 },
      turnCapabilities: null, contextSections: [], contextBudget: null, contextScope: {},
    });
    expect(result.error).toBeNull();
    expect(provider.turns).toHaveLength(4);
    expect(lastUserMessage(provider.turns[2])).toContain('Take your next action now');
    expect(provider.turns[2].tools.map((t) => t.function.name)).toEqual(['probe__look']);
    // The close's act ran: its result is in the history the next round reads.
    const toolMessages = provider.turns[3].messages.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(2);
    expect(result.fullResponse.endsWith('Done.')).toBe(true);
  });

  test('a round that speaks never sees the close', async () => {
    provider.setScript([{ reply: 'Direct answer.' }]);
    const result = await runTurn();
    expect(result.error).toBeNull();
    expect(provider.turns).toHaveLength(1);
    expect(result.fullResponse).toBe('Direct answer.');
  });

  test('the close rides the template\'s thinking-off switch where the wire has one', async () => {
    provider.setScript([
      { reasoning: 'an unbounded deliberation', reply: '', finishReason: 'length', usage: { prompt_tokens: 100, completion_tokens: 2048 } },
      { reply: 'The final answer is 42.', usage: { prompt_tokens: 150, completion_tokens: 40 } },
    ]);
    const result = await runToolRounds({
      ws: kit.ws, connection: kit.connection, companion: kit.connection.companion,
      companionName: 'SpeechlessFixture', voiceDNA: null,
      messages: [{ role: 'system', content: 'Answer the task.' }, { role: 'user', content: 'Solve the problem.' }],
      preset: { temperature: 0, maxTokens: 2048, exactMaxTokens: true, sharedOutputBudget: true },
      nativeToolsForRound: () => [],
      interrupt: kit.connection.activeTurn,
      route: { provider: 'llama-server', endpoint: provider.endpoint, model: 'test-model', apiKey: '' },
      turnLora: null, turnEffort: null, take: { turnId: 'speechless-lever-proof', takeIndex: 1 },
      turnCapabilities: null, contextSections: [], contextBudget: null, contextScope: {},
    });
    expect(result.error).toBeNull();
    expect(provider.turns).toHaveLength(2);
    // The proven lever: llama-server's chat_template_kwargs (llm-request-builders).
    expect(provider.turns[1].chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(provider.turns[0].chat_template_kwargs).toBeUndefined();
    expect(result.fullResponse).toBe('The final answer is 42.');
    // The speechless round's usage rides the gauge BEFORE the close, so a
    // downstream receipt can never again hide whether the recovery engaged.
    const usageFrames = kit.frames.filter((f) => f.type === 'context:composition' && Number.isFinite(f.usage?.outputTokens));
    expect(usageFrames).toHaveLength(1);
    expect(usageFrames[0].usage.outputTokens).toBe(2048);
  });
});

describe('the close on a llama.cpp serving keeps the prompt cached', () => {
  // The kwarg rewrites qwen3.x's first prompt line, so a close re-read the
  // whole conversation; llama.cpp (named by its Server header) closes the
  // thought with a one-token server budget instead (2026-10-04).
  let llamaCpp;
  afterEach(async () => { await llamaCpp?.close(); });

  test('the close sends a one-token thinking budget, never the template switch', async () => {
    llamaCpp = await startLocalProvider({ serverHeader: 'llama.cpp' });
    llamaCpp.setScript([
      { reasoning: 'an unbounded deliberation', reply: '', finishReason: 'length' },
      { reply: 'The final answer is 42.' },
    ]);
    const result = await runToolRounds({
      ws: kit.ws, connection: kit.connection, companion: kit.connection.companion,
      companionName: 'SpeechlessFixture', voiceDNA: null,
      messages: [{ role: 'system', content: 'Answer the task.' }, { role: 'user', content: 'Solve the problem.' }],
      preset: { temperature: 0, maxTokens: 2048, exactMaxTokens: true, sharedOutputBudget: true },
      nativeToolsForRound: () => [],
      interrupt: kit.connection.activeTurn,
      route: { provider: 'llama-server', endpoint: llamaCpp.endpoint, model: 'test-model', apiKey: '' },
      turnLora: null, turnEffort: null, take: { turnId: 'speechless-budget-proof', takeIndex: 1 },
      turnCapabilities: null, contextSections: [], contextBudget: null, contextScope: {},
    });
    expect(result.error).toBeNull();
    expect(llamaCpp.turns).toHaveLength(2);
    expect(llamaCpp.turns[1].chat_template_kwargs).toBeUndefined();
    expect(llamaCpp.turns[1].thinking_budget_tokens).toBe(CLOSE_THINK_BUDGET);
    expect(llamaCpp.turns[1].reasoning_budget_message).toBe(THINKING_BUDGET_MESSAGE);
    expect(result.fullResponse).toBe('The final answer is 42.');
  });
});

describe('speechlessRoundClose (pure)', () => {
  test('no reasoning record asks plainly, with no fabricated trail', () => {
    const close = speechlessRoundClose('');
    expect(close).toContain('the output budget was spent before any answer reached me');
    expect(close).not.toContain('"""');
    expect(close).toContain('in exactly the form the task requires');
  });

  test('the reasoning tail is bounded to the last SPEECHLESS_ROUND_TAIL_CHARS', () => {
    const close = speechlessRoundClose(`head${'x'.repeat(SPEECHLESS_ROUND_TAIL_CHARS + 500)}`);
    expect(close).toContain('"""');
    expect(close).not.toContain('head');
    expect(close.length).toBeLessThan(3000);
  });

  // AA-Omniscience 2026-10-20: a close that only demanded an answer turned
  // unsettled reasoning into guesses; the task's own […] stands.
  test('a forced close leaves the honest way out where the task allows it; mid-work it offers the next act instead', () => {
    expect(speechlessRoundClose('maybe 1926, maybe 1929')).toContain(UNSETTLED_ALLOWANCE);
    expect(leashReaskNote('maybe 1926')).toContain(UNSETTLED_ALLOWANCE);
    expect(UNSETTLED_ALLOWANCE).toMatch(/task allows/);
    expect(speechlessRoundClose('x', { acting: true })).not.toContain(UNSETTLED_ALLOWANCE);
  });
});
