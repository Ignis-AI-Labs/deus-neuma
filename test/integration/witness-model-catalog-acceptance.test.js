// GPU-free explicit opt-in: real metadata through Neuma's credential broker.
import dotenv from 'dotenv';
import { describe, expect, test } from 'vitest';
import { resolveUsableCredential } from '../../backend/services/oauth-token-broker.js';
import { getProvider } from '../../backend/services/provider-registry.js';
import { liveModels } from '../../backend/services/provider-probe.js';
import { witnessModelOptions } from '../../backend/services/witness-model-options.js';
import { refreshOpenAIClientVersion } from '../../backend/services/openai-client-version.js';

const enabled = process.env.RUN_LIVE_WITNESS_MODEL_CATALOG === '1';
if (enabled) dotenv.config({ override: true, quiet: true });

(enabled ? describe : describe.skip)('real witness account model catalog', () => {
  test('discovers current models without hidden internal choices or static resurrection', async () => {
    const credential = await resolveUsableCredential('openai-chatgpt');
    expect(Boolean(credential.apiKey && credential.accountId)).toBe(true);
    expect(await refreshOpenAIClientVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    const entry = getProvider('openai-chatgpt');
    const discovered = await liveModels(entry, credential.endpoint, credential.apiKey,
      { accountId: credential.accountId });
    const view = witnessModelOptions(entry, discovered);
    expect(view.catalogSource).toBe('live');
    expect(view.models.length).toBeGreaterThan(0);
    expect(view.models.map((model) => model.id)).toEqual(discovered.map((model) => model.id));
    expect(view.models.some((model) => ['gpt-reserve', 'codex-auto-review'].includes(model.id))).toBe(false);
  }, 20000);
});
