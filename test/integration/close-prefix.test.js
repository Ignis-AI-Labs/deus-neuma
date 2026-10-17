/**
 * A CLOSE KEEPS ITS CHAT'S CACHED PROMPT (2026-10-13), proven at the wire
 * (RULE 0): the REAL `runToolRounds` against a REAL loopback provider that
 * captures every request body and answers the tokenizer as llama.cpp does.
 *
 * Live 2026-10-12, a close in Founder's 128k-token chat dropped the tools — and
 * on llama.cpp, where the tool list renders FIRST, that re-read the whole
 * chat (89 s) for one closing answer. On a local llama.cpp wire the close now
 * carries the round's own tools byte-for-byte (the same rendered prompt — the
 * live /apply-template check: tool_choice […] renders identically to
 * […]), with tool_choice […] and the tool-call opener's token banned so
 * no call can come back. A hosted or LM Studio close stays tool-less.
 */
import { beforeEach, afterEach, expect, test, describe } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import { startLocalProvider } from '../helpers/local-provider.js';
import { runToolRounds } from '../../backend/services/portal-turn-rounds.js';
import { openTurnRecord, closeTurnRecord } from '../../backend/services/tool-action-record.js';
import { roundToolsFor, TOOL_CALL_OPENER } from '../../backend/services/close-prefix.js';

const OPENER_ID = 248058; // the served Qwen3.8 vocabulary's <tool_call> (measured on :8089)
const PROBE = Object.freeze({ type: 'function', function: { name: 'probe__look', description: 'Look.', parameters: { type: 'object', properties: { at: { type: 'string' } } } } });

let kit, provider;
beforeEach(async () => {
  kit = await createHarnessTurnKit('close-prefix-proof');
  provider = await startLocalProvider({ specialTokens: { [TOOL_CALL_OPENER]: OPENER_ID } });
  openTurnRecord(kit.ws);
});
afterEach(async () => {
  closeTurnRecord(kit.ws);
  await provider?.close();
  await kit?.close();
});

const runTurn = (provider_) => runToolRounds({
  ws: kit.ws, connection: kit.connection, companion: kit.connection.companion,
  companionName: 'CloseFixture', voiceDNA: null,
  messages: [{ role: 'system', content: 'Answer the task.' }, { role: 'user', content: 'Solve the problem.' }],
  preset: { temperature: 0, maxTokens: 2048, exactMaxTokens: true },
  nativeToolsForRound: () => [PROBE],
  interrupt: kit.connection.activeTurn,
  route: { provider: provider_, endpoint: provider.endpoint, model: 'test-model', apiKey: '' },
  turnLora: null, turnEffort: null, take: { turnId: 'close-prefix-proof', takeIndex: 1 },
  turnCapabilities: null, contextSections: [], contextBudget: null, contextScope: {},
});

describe('a close keeps the chat\'s cached prompt on llama.cpp', () => {
  test('the speechless close carries the round\'s own tools, tool_choice none, the opener banned — and still answers', async () => {
    provider.setScript([
      { reasoning: 'the answer requires care; first I consider 6 times 7, which is', reply: '', finishReason: 'length' },
      { reply: 'The final answer is 42.' },
    ]);
    const result = await runTurn('custom'); // loopback custom = a kin route at the local llama.cpp
    expect(result.error).toBeNull();
    expect(result.fullResponse).toBe('The final answer is 42.');
    const [round, close] = provider.turns;
    // The prefix the server renders first is byte-identical: the same tools…
    expect(JSON.stringify(close.tools)).toBe(JSON.stringify(round.tools));
    // …and the conversation the round saw leads the close, unchanged.
    expect(JSON.stringify(close.messages.slice(0, round.messages.length))).toBe(JSON.stringify(round.messages));
    // No call can come back: tool_choice none, and the opener's token banned.
    expect(close.tool_choice).toBe('none');
    expect(close.logit_bias).toEqual([[OPENER_ID, false]]);
    expect(round.tool_choice).toBe('auto');
    expect(round.logit_bias).toBeUndefined();
  });

  test('off the local wire the close stays tool-less, as it always was', async () => {
    provider.setScript([
      { reasoning: 'thinking it through', reply: '', finishReason: 'length' },
      { reply: 'Done.' },
    ]);
    const result = await runTurn('lm-studio');
    expect(result.fullResponse).toBe('Done.');
    expect(provider.turns[1].tools).toBeUndefined();
    expect(provider.turns[1].logit_bias).toBeUndefined();
  });

  test('the rule, pure: a round\'s own tools always ride; a close borrows them only on a local llama.cpp wire', () => {
    const local = { provider: 'llama-server' };
    const kin = { provider: 'custom', endpoint: 'http://127.0.0.1:8089' };
    const hosted = { provider: 'custom', endpoint: 'https://api.x.ai/v1' };
    expect(roundToolsFor([PROBE], null, hosted)).toEqual({ tools: [PROBE] });
    expect(roundToolsFor([], [PROBE], local)).toEqual({ tools: [PROBE], toolChoice: 'none', banToolCalls: true });
    expect(roundToolsFor([], [PROBE], kin)).toEqual({ tools: [PROBE], toolChoice: 'none', banToolCalls: true });
    expect(roundToolsFor([], [PROBE], hosted)).toEqual({});
    expect(roundToolsFor([], [], local)).toEqual({});
  });
});
