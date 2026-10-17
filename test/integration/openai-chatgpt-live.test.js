/**
 * Live OpenAI ChatGPT proof. No mock, stub, fake, or OpenCode process enters
 * this path: Neuma decrypts its own OAuth credential, lists account models,
 * and streams one real Responses API inference.
 *
 * Run deliberately: RUN_LIVE_OPENAI_CHATGPT=1 npx vitest run \
 *   test/integration/openai-chatgpt-live.test.js
 */
import { describe, expect, test } from 'vitest';
import dotenv from 'dotenv';
import { resolveUsableCredential } from '../../backend/services/oauth-token-broker.js';
import { getProvider } from '../../backend/services/provider-registry.js';
import { liveModels } from '../../backend/services/provider-probe.js';
import { consumeStream, createStreamRequest, getRouteCapabilities } from '../../backend/services/llm-provider.js';
import { buildCompositionEvent } from '../../core/runtime/context-composition.js';
import { gaugeFor } from '../../frontend/app/RelinkShell/context-gauge.js';

// test/setup.js deliberately installs a hermetic encryption key. This live
// proof needs the operator key because it reads the operator's real encrypted
// provider store; its Vitest file runs in an isolated fork.
dotenv.config({ override: true });

const live = process.env.RUN_LIVE_OPENAI_CHATGPT === '1' ? describe : describe.skip;

live('OpenAI ChatGPT OAuth owned by Neuma (live)', () => {
  test('lists real models and returns an exact token through Responses SSE', async () => {
    const credential = await resolveUsableCredential('openai-chatgpt');
    expect(credential.apiKey).toBeTruthy();
    expect(credential.accountId).toBeTruthy();

    const entry = getProvider('openai-chatgpt');
    const models = await liveModels(entry, credential.endpoint, credential.apiKey, {
      accountId: credential.accountId,
    });
    expect(models.length).toBeGreaterThan(0);
    const model = models.find((candidate) => candidate.id === 'gpt-5.6-sol')?.id || models[0].id;

    let usage = null;
    const stream = await createStreamRequest([
      { role: 'system', content: 'Answer with exactly the requested token and nothing else.' },
      { role: 'user', content: 'Reply with exactly: NEUMA_DIRECT' },
    ], {
      route: {
        provider: entry.id,
        endpoint: credential.endpoint,
        apiKey: credential.apiKey,
        accountId: credential.accountId,
        model,
        chatPath: entry.chatPath,
      },
    });
    const answer = await consumeStream(stream, () => {}, {
      onUsage: (value) => { usage = value; },
    });
    expect(answer.trim()).toBe('NEUMA_DIRECT');
    expect(usage?.promptTokens).toBeGreaterThan(0);
    expect(usage?.completionTokens).toBeGreaterThan(0);

    // Carry the provider's real counts through the same pure event + gauge
    // derivation the witness stream uses. The readout must include output in
    // used and state this concrete model's context window as the total.
    const route = {
      provider: entry.id,
      endpoint: credential.endpoint,
      apiKey: credential.apiKey,
      accountId: credential.accountId,
      model,
      chatPath: entry.chatPath,
    };
    const capabilities = await getRouteCapabilities(route);
    const published = models.find((candidate) => candidate.id === model)?.contextWindow;
    expect(capabilities.contextWindow).toBe(published);
    expect(capabilities.contextWindowSource).toBe('provider-runtime');
    const contextTokens = capabilities.contextWindow;
    const event = {
      ...buildCompositionEvent({
        sections: [{ id: 'turn', label: 'CURRENT TURN', text: 'Reply with exactly: NEUMA_DIRECT' }],
        usage,
        budget: { contextTokens, source: 'model-capabilities' },
      }),
      route: { provider: entry.id, model },
    };
    const gauge = gaugeFor(event);
    expect(gauge.used).toBe(usage.promptTokens + usage.completionTokens);
    expect(gauge.remaining).toBe(contextTokens - gauge.used);
    expect(gauge.label).toMatch(/^CTX \S+ \/ \S+$/);
    expect(gauge.title).toContain(`${model} via ${entry.id}`);
  }, 120_000);
});
