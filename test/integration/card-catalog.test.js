/** Actual catalog construction on private signed lanes; no image generation. */
import path from 'node:path';
import { expect, test } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import { platformToolsFor } from '../../backend/services/portal-tool-catalog.js';

test.each([
  ['witness', 'witness-test-CardCatalog'],
  ['neuma', 'card-catalog-fixture'],
])('%s catalog carries one card tool without diffusion setup', async (seat, lane) => {
  const kit = await createHarnessTurnKit(lane);
  const keys = ['COMFYUI_CONTENT_LAW_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH',
    'NEUMA_SOCIAL_CREDENTIALS_PATH', 'NEUMA_SECTOR_CREW_PATH',
    'NEUMA_EMAIL_BINDING_PATH', 'NEUMA_EMAIL_CREDENTIALS_PATH',
    'NEUMA_SECURITY_CSO_PATH', 'NEUMA_SECURITY_THREATS_PATH', 'NEUMA_SECURITY_WATCH_PATH'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) process.env[key] = path.join(kit.root, `${key}.json`);
  try {
    const { tools } = await platformToolsFor(kit.connection, { seat });
    const ids = tools.map((tool) => `${tool.server}/${tool.name}`);
    expect(ids.filter((id) => id === 'image/render_card')).toHaveLength(1);
    expect(ids).not.toContain('image/list_pipelines');
    expect(ids).toContain('operator/ask_operator');
    expect(ids).toContain('system/flight_check');
    if (seat === 'witness') expect(ids).not.toContain('wallet/request_seal');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await kit.close();
  }
}, 30000);
