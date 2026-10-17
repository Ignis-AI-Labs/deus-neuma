/**
 * Live capability probing — REAL HTTP against the rig's running llama-server
 * (RULE 0: no mock can tell us whether a real serving reports its senses).
 *
 * Every expectation is derived from the server's OWN /props report, never a
 * hardcoded value: the suite stays truthful whether the substrate is serving
 * with its projector (vision true) or blind (vision false). Run where the rig
 * lives; skipped cleanly where no llama-server answers.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { queryLocalCapabilities, probeEndpointCapabilities } from '../../backend/services/model-capabilities.js';
import { getRouteCapabilities } from '../../backend/services/llm-provider.js';

const BASE = process.env.LLAMA_SERVER_URL || 'http://127.0.0.1:8089';

// Ground truth, straight from the serving: { vision: boolean|null, modelId }
const liveTruth = async () => {
  const props = await fetch(`${BASE}/props`, { signal: AbortSignal.timeout(3000) });
  if (!props.ok) return null;
  const body = await props.json();
  const vision = typeof body?.modalities?.vision === 'boolean' ? body.modalities.vision : null;
  const models = await fetch(`${BASE}/v1/models`, { signal: AbortSignal.timeout(3000) });
  const listed = models.ok ? (await models.json()).data || [] : [];
  return { vision, modelId: listed[0]?.id || null };
};

let truth = null;
beforeAll(async () => {
  truth = await liveTruth().catch(() => null);
});

describe('live llama-server capability probing', () => {
  test('queryLocalCapabilities(llama-server) agrees with the serving\'s own /props', () => {
    if (!truth) return; // no rig here — nothing to prove against
    return expect(queryLocalCapabilities('llama-server', BASE, 'unused').then((caps) => {
      expect(caps).not.toBeNull();
      expect(caps.vision).toBe(truth.vision);
    }));
  });

  test('probeEndpointCapabilities (the custom-provider path) finds llama.cpp and agrees', async () => {
    if (!truth) return;
    const caps = await probeEndpointCapabilities(BASE, 'local-model');
    expect(caps).not.toBeNull();
    expect(caps.vision).toBe(truth.vision);
  });

  test('getRouteCapabilities resolves the local-model placeholder to the served id and reports real vision', async () => {
    if (!truth) return;
    const caps = await getRouteCapabilities({ provider: 'custom', endpoint: BASE, apiKey: '', model: 'local-model' });
    expect(typeof caps.vision).toBe('boolean');
    expect(caps.vision).toBe(truth.vision);
    // The placeholder never reaches the gate's answer — the real vessel does.
    if (truth.modelId) expect(caps.model).toBe(truth.modelId);
  });

  test('getRouteCapabilities for a llama-server route agrees the same way', async () => {
    if (!truth) return;
    const caps = await getRouteCapabilities({ provider: 'llama-server', endpoint: BASE, apiKey: '', model: 'local-model' });
    expect(caps.vision).toBe(truth.vision);
  });
});
