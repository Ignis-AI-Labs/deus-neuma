/**
 * THE VERIFY GATE (ARC-HARNESS L2, #531), proven at the wire (RULE 0): the
 * REAL `runToolRounds` against a REAL loopback SSE provider — no seam mocked.
 * The shape under proof: on a turn whose task DEMONSTRATES a required answer
 * format, the drafted answer is re-read against the task once at settle; the
 * corrected answer is what stands and the verdict rides the connection for
 * the receipt. Undeclared connections and conversational tasks never pay the
 * verify round.
 */
import { beforeEach, afterEach, expect, test, describe } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import { startLocalProvider } from '../helpers/local-provider.js';
import { runToolRounds } from '../../backend/services/portal-turn-rounds.js';
import { openTurnRecord, closeTurnRecord } from '../../backend/services/tool-action-record.js';

let kit, provider;
beforeEach(async () => {
  kit = await createHarnessTurnKit('answer-verify-proof');
  provider = await startLocalProvider();
  openTurnRecord(kit.ws);
});
afterEach(async () => {
  closeTurnRecord(kit.ws);
  await provider?.close();
  await kit?.close();
});

const lastUserMessage = (body) => [...body.messages].reverse().find((m) => m.role === 'user')?.content;

// Demonstrates the required `#### N` form the way few-shot tasks do: two
// worked examples closing with the same mark, blank lines between examples.
// General by construction — no benchmark named anywhere.
const TASK = [
  'Worked example:',
  'Natalie sold 3 apples at $2 each, so 3 * 2.',
  '#### 6',
  '',
  'Another example:',
  'She sold 5 at $2 each, so 5 * 2.',
  '#### 10',
  '',
  'How much in total did she earn selling 7 apples at $2 each?',
].join('\n');

const runTurn = ({ verify, task = TASK }) => {
  kit.connection._answerVerify = verify;
  return runToolRounds({
    ws: kit.ws, connection: kit.connection, companion: kit.connection.companion,
    companionName: 'VerifyFixture', voiceDNA: null,
    messages: [{ role: 'system', content: 'Answer the task.' }, { role: 'user', content: task }],
    wireHead: 2,
    preset: { temperature: 0, maxTokens: 2048, exactMaxTokens: true },
    nativeToolsForRound: () => [],
    interrupt: kit.connection.activeTurn,
    route: { provider: 'lm-studio', endpoint: provider.endpoint, model: 'test-model', apiKey: '' },
    turnLora: null, turnEffort: null, take: { turnId: 'verify-proof', takeIndex: 1 },
    turnCapabilities: null, contextSections: [], contextBudget: null, contextScope: {},
  });
};

describe('the verify gate re-reads the task against the draft', () => {
  test('a wrong draft is corrected once, and the corrected answer stands', async () => {
    provider.setScript([
      { reply: '#### 12' },
      { reply: '#### 14' },
    ]);
    const result = await runTurn({ verify: true });
    expect(result.error).toBeNull();
    // The draft round plus exactly one verify round — never a loop.
    expect(provider.turns).toHaveLength(2);
    // The verify request carried the task AND the draft it is judging.
    const verifyRequest = lastUserMessage(provider.turns[1]);
    expect(verifyRequest).toContain('THE TASK ASKED');
    expect(verifyRequest).toContain('selling 7 apples at $2 each?');
    expect(verifyRequest).toContain('#### 12');
    // The verified answer is what stands; the draft stays in the record.
    expect(result.latestResponse).toBe('#### 14');
    expect(result.fullResponse).toContain('#### 12');
    expect(result.fullResponse).toContain('#### 14');
    expect(kit.connection._answerVerifyVerdict).toBe('answerCorrected');
  });

  test('a draft that already stands is confirmed, not rewritten', async () => {
    provider.setScript([
      { reply: '#### 14' },
      { reply: '#### 14' },
    ]);
    const result = await runTurn({ verify: true });
    expect(result.error).toBeNull();
    expect(provider.turns).toHaveLength(2);
    expect(result.latestResponse).toBe('#### 14');
    expect(kit.connection._answerVerifyVerdict).toBe('answerStood');
  });

  test('an undeclared connection never pays the verify round', async () => {
    provider.setScript([{ reply: '#### 12' }]);
    const result = await runTurn({ verify: false });
    expect(result.error).toBeNull();
    expect(provider.turns).toHaveLength(1);
    expect(kit.connection._answerVerifyVerdict).toBeUndefined();
  });

  test('a conversational task never owes the verify, even when declared', async () => {
    provider.setScript([{ reply: 'The third hour felt different because the room had changed.' }]);
    const result = await runTurn({
      verify: true,
      task: 'What did you make of the sitting yesterday? The third hour felt different to me.',
    });
    expect(result.error).toBeNull();
    expect(provider.turns).toHaveLength(1);
    expect(kit.connection._answerVerifyVerdict).toBeUndefined();
  });
});
