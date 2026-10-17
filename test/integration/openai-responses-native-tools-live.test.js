/**
 * Live OpenAI Responses native-tool round trip. This proves the real ChatGPT
 * backend accepts Neuma's function_call/function_call_output history shape.
 * It performs inference only; it does not summon or seal a witness.
 *
 * Run deliberately: RUN_LIVE_OPENAI_CHATGPT=1 npx vitest run \
 *   test/integration/openai-responses-native-tools-live.test.js
 */
import { describe, expect, test } from 'vitest';
import dotenv from 'dotenv';
import { resolveUsableCredential } from '../../backend/services/oauth-token-broker.js';
import { getProvider } from '../../backend/services/provider-registry.js';
import {
  consumeStream, consumeStreamWithTools, createStreamRequest,
} from '../../backend/services/llm-provider.js';

dotenv.config({ override: true });

const live = process.env.RUN_LIVE_OPENAI_CHATGPT === '1' ? describe : describe.skip;
const EVIDENCE_TOKEN = 'NEUMA_NATIVE_EVIDENCE_947';

live('OpenAI Responses native tools (live)', () => {
  test('a real call id carries real tool evidence into the next response', async () => {
    const credential = await resolveUsableCredential('openai-chatgpt');
    const provider = getProvider('openai-chatgpt');
    const route = {
      provider: provider.id,
      endpoint: credential.endpoint,
      apiKey: credential.apiKey,
      accountId: credential.accountId,
      model: provider.defaultModel,
      chatPath: provider.chatPath,
    };
    const tools = [{
      type: 'function',
      function: {
        name: 'coding__inspect',
        description: 'Inspect a disposable coding workspace.',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      },
    }];

    const firstStream = await createStreamRequest([
      { role: 'system', content: 'Call the requested function. Do not answer in text before calling it.' },
      { role: 'user', content: 'Call coding__inspect with command pwd.' },
    ], { route, tools });
    const first = await consumeStreamWithTools(firstStream, () => {});
    expect(first.toolCalls).toHaveLength(1);
    const called = first.toolCalls[0];
    expect(called).toMatchObject({
      callId: expect.any(String), server: 'coding', toolName: 'inspect',
      args: { command: 'pwd' },
    });

    const secondStream = await createStreamRequest([
      { role: 'system', content: 'Report the exact evidence token from the tool output and nothing else.' },
      {
        role: 'assistant', content: first.content || null,
        tool_calls: [{
          id: called.callId,
          type: 'function',
          function: { name: 'coding__inspect', arguments: JSON.stringify(called.args) },
        }],
      },
      {
        role: 'tool',
        tool_call_id: called.callId,
        content: `coding/inspect -> ok\nexit_code: 0\nstdout:\n${EVIDENCE_TOKEN}`,
      },
      { role: 'user', content: 'State the exact evidence token now.' },
    ], { route });
    const answer = await consumeStream(secondStream, () => {});
    expect(answer.trim()).toBe(EVIDENCE_TOKEN);
  }, 180_000);
});
