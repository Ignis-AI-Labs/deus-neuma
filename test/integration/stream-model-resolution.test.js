/**
 * Stream model resolution — the portal path must never send the
 * 'local-model' placeholder to the provider. LM Studio with more than one
 * model loaded (substrate + memory summarizer) rejects the placeholder with
 * model_not_found, which severed the consciousness stream on 2026-07-03.
 *
 * Proven against the REAL LM Studio (RULE 0) — skips honestly when it is
 * not running. Requires at least one non-auxiliary model loaded.
 */
import { describe, expect, it } from 'vitest';
import { createStreamRequest, getActiveModel } from '../../backend/services/llm-provider.js';

const probe = await fetch('http://localhost:1234/v1/models').then((r) => r.ok).catch(() => false);
const substrate = probe ? await getActiveModel() : null;

describe.skipIf(!substrate)('createStreamRequest model resolution (real LM Studio)', () => {
  it('resolves the placeholder to the actual substrate before the request leaves', async () => {
    // No options.model and config.model defaults to the 'local-model'
    // placeholder — exactly what the portal sends.
    const { response } = await createStreamRequest(
      [{ role: 'user', content: 'Reply with exactly: ok' }],
      { maxTokens: 8 }
    );
    expect(response.ok).toBe(true);

    // The stream's first chunk names the model that actually answered.
    const reader = response.body.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    const chunk = new TextDecoder().decode(value);
    expect(chunk).not.toContain('"model":"local-model"');
    expect(chunk).toContain(`"model":"${substrate.id}"`);
  }, 120000);
});
