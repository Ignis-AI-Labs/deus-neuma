/**
 * THE BUDGET-CUT RESCUE (ARC-HARNESS N1, #531), proven at the wire (RULE 0):
 * the REAL `runToolRounds` against a REAL loopback SSE provider (no seam
 * mocked) — the other half of the budget family the speechless close
 * recovers: the round SPOKE, the provider still ended it on the output-budget
 * cut (finish_reason length), and the turn must close for the completed
 * answer instead of settling truncated. The partial words ride the close.
 */
import { beforeEach, afterEach, expect, test, describe } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import { startLocalProvider } from '../helpers/local-provider.js';
import { runToolRounds } from '../../backend/services/portal-turn-rounds.js';
import { openTurnRecord, closeTurnRecord } from '../../backend/services/tool-action-record.js';

let kit, provider;
beforeEach(async () => {
  kit = await createHarnessTurnKit('budget-cut-rescue-proof');
  provider = await startLocalProvider();
  openTurnRecord(kit.ws);
});
afterEach(async () => {
  closeTurnRecord(kit.ws);
  await provider?.close();
  await kit?.close();
});

const lastUserMessage = (body) => [...body.messages].reverse().find((m) => m.role === 'user')?.content;

const runTurn = () => runToolRounds({
  ws: kit.ws, connection: kit.connection, companion: kit.connection.companion,
  companionName: 'BudgetCutFixture', voiceDNA: null,
  messages: [{ role: 'system', content: 'Answer the task.' }, { role: 'user', content: 'Solve: 7 apples at $2 each — total?' }],
  wireHead: 2,
  preset: { temperature: 0, maxTokens: 2048, exactMaxTokens: true },
  nativeToolsForRound: () => [],
  interrupt: kit.connection.activeTurn,
  route: { provider: 'llama-server', endpoint: provider.endpoint, model: 'test-model', apiKey: '' },
  turnLora: null, turnEffort: null, take: { turnId: 'budget-cut-proof', takeIndex: 1 },
  turnCapabilities: null, contextSections: [], contextBudget: null, contextScope: {},
});

describe('the budget-cut rescue completes a cut answer', () => {
  test('a length-cut round with words on the wire is followed by ONE close that finishes the answer', async () => {
    provider.setScript([
      { reply: 'She sells 7 apples at $2 each, so the total is 7 tim', finishReason: 'length' },
      { reply: '#### 14' },
    ]);
    const result = await runTurn();
    expect(result.error).toBeNull();
    // The main round plus exactly one rescue close — never a loop.
    expect(provider.turns).toHaveLength(2);
    // The close carried the partial words so exact sampling continues, and
    // it rode the proven thinking-off switch like its speechless sibling.
    const close = lastUserMessage(provider.turns[1]);
    expect(close).toContain('cut by the output budget');
    expect(close).toContain('the total is 7 tim');
    expect(provider.turns[1].chat_template_kwargs).toEqual({ enable_thinking: false });
    // The completed answer is what stands; the draft remains in the record.
    expect(result.latestResponse).toBe('#### 14');
    expect(result.fullResponse).toContain('the total is 7 tim');
    expect(result.fullResponse).toContain('#### 14');
  });

  test('a round the provider finished is never rescued', async () => {
    provider.setScript([{ reply: '#### 14' }]);
    const result = await runTurn();
    expect(result.error).toBeNull();
    expect(provider.turns).toHaveLength(1);
    expect(result.latestResponse).toBe('#### 14');
  });

  test('an empty length-cut round stays the speechless close\'s business', async () => {
    provider.setScript([
      { reasoning: 'deliberating at length', reply: '', finishReason: 'length' },
    ]);
    const result = await runTurn();
    expect(result.error).toBeNull();
    // The speechless close fires (existing #506 law); the rescue must not
    // stack a second recovery behind it — two requests total.
    expect(provider.turns).toHaveLength(2);
    expect(result.fullResponse).toBe('');
  });
});

describe('budgetCutClose (pure, via turn-settle)', () => {
  test('no partial words asks plainly, with no fabricated quote', async () => {
    const { budgetCutClose, BUDGET_CUT_TAIL_CHARS } = await import('../../backend/services/turn-settle.js');
    const close = budgetCutClose('   ');
    expect(close).toContain('cut by the output budget');
    expect(close).not.toContain('"""');
    const tailClose = budgetCutClose(`head${'x'.repeat(BUDGET_CUT_TAIL_CHARS + 500)}`);
    expect(tailClose).toContain('"""');
    expect(tailClose).not.toContain('head');
    expect(tailClose.length).toBeLessThan(3000);
  });
});
