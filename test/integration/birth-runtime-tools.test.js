import { describe, expect, test } from 'vitest';
import { interpretLlamaProps } from '../../backend/services/model-capabilities.js';
import { getRouteCapabilities } from '../../backend/services/llm-provider.js';
import { nativeToolsFor } from '../../backend/services/birth-stage-stream.js';
import { withFsPrimitives } from '../../backend/services/fs-primitives.js';

describe('llama runtime tool declarations', () => {
  test.each([
    [{ supports_tools: true, supports_tool_calls: true }, true],
    [{ supports_tools: true }, true],
    [{ supports_tools: false }, false],
    [{ supports_tools: true, supports_tool_calls: false }, false],
    [{ supports_tool_calls: false }, false],
  ])('honors the serving declaration %j', (declaration, expected) => {
    expect(interpretLlamaProps({ chat_template_caps: declaration }).tools).toBe(expected);
  });

  test.each([undefined, {}, { supports_tools: 'true' }, { supports_tool_calls: true }])(
    'keeps absent or invalid declarations undecided: %j', (declaration) => {
      expect(interpretLlamaProps({ chat_template_caps: declaration })).not.toHaveProperty('tools');
    },
  );
});

describe.runIf(process.env.RUN_LIVE_BIRTH_CAPABILITIES === '1')('actual birth tool schema on the live serving', () => {
  test('server props reach the native birth schema even when the model ID is a descriptor', async () => {
    const endpoint = process.env.LLAMA_SERVER_URL || 'http://127.0.0.1:8089';
    const response = await fetch(`${endpoint}/props`, { signal: AbortSignal.timeout(3000) });
    expect(response.ok).toBe(true);
    const props = await response.json();
    expect(props.chat_template_caps.supports_tools).toBe(true);
    expect(props.chat_template_caps.supports_tool_calls).not.toBe(false);
    const models = await fetch(`${endpoint}/v1/models`, { signal: AbortSignal.timeout(3000) });
    expect(models.ok).toBe(true);
    const model = (await models.json()).data[0].id;
    const caps = await getRouteCapabilities({ provider: 'llama-server', endpoint, apiKey: '', model });
    expect(caps.tools).toBe(true);
    const advertised = withFsPrimitives([{ name: 'write_file', server: 'filesystem' }]);
    expect(nativeToolsFor(model, advertised, caps).length).toBeGreaterThan(0);
    expect(nativeToolsFor(model, advertised, { ...caps, tools: false })).toEqual([]);
  }, 15000);
});
