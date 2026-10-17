/** Actual signed sockets, round dispatcher and HTTP usage parsing; no inference. */
import { beforeEach, afterEach, expect, test } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import { startLocalProvider } from '../helpers/local-provider.js';
import { runToolRounds } from '../../backend/services/portal-turn-rounds.js';
import { openTurnRecord, closeTurnRecord } from '../../backend/services/tool-action-record.js';

let kit, provider;
beforeEach(async () => {
  kit = await createHarnessTurnKit('standing-round-proof');
  provider = await startLocalProvider();
  openTurnRecord(kit.ws);
});
afterEach(async () => {
  closeTurnRecord(kit.ws);
  await provider?.close();
  await kit?.close();
});

for (const firstUsage of [null, { prompt_tokens: 100, completion_tokens: 1 }]) {
  test(`only round zero can supply standing usage (${firstUsage ? 'measured' : 'absent'})`, async () => {
    provider.setScript([
      { reply: '[TOOL: no_such_tool {}]', usage: firstUsage },
      { reply: 'The requested tool is unavailable.', usage: { prompt_tokens: 9000, completion_tokens: 2 } },
    ]);
    const result = await runToolRounds({
      ws: kit.ws, connection: kit.connection, companion: kit.connection.companion,
      companionName: 'HarnessFixture', voiceDNA: null,
      messages: [{ role: 'system', content: 'Report unavailable tools honestly.' }, { role: 'user', content: 'Inspect the tool result.' }],
      preset: { temperature: 0.7, maxTokens: 512 }, nativeToolsForRound: () => [],
      interrupt: kit.connection.activeTurn,
      route: { provider: 'lm-studio', endpoint: provider.endpoint, model: 'test-model', apiKey: '' },
      turnLora: null, turnEffort: null, take: { turnId: 'round-proof', takeIndex: 1 },
      turnCapabilities: null, contextSections: [], contextBudget: null, contextScope: {},
    });
    expect(result.error).toBeNull();
    expect(provider.turns).toHaveLength(2);
    expect(result.turnUsage).toEqual({ promptTokens: 9000, completionTokens: 2 });
    expect(result.standingUsage).toEqual(firstUsage ? { promptTokens: 100, completionTokens: 1 } : null);
  });
}
