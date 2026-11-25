/* global process */
import { expect, test } from 'vitest';
import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const fixture = fileURLToPath(new URL('../fixtures/pr600-utility-main.cjs', import.meta.url));

const freePort = () => new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

test('utility MCP and the full backend boot for real without RunAsNode on isolated ephemeral ports', async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pr600-utility-'));
  let desktop;
  try {
    const frontendPort = await freePort();
    const env = {
      ...process.env,
      PR600_UTILITY_PROFILE: profile,
      NEUMA_PIPELINE_MODE: 'operator',
      NEUMA_PORT: '0',
      PORT: '0',
      FRONTEND_PORT: String(frontendPort),
      HOST: '127.0.0.1',
      NEUMA_DATA_ROOT: path.join(profile, 'data'),
      NEUMA_VAULT_ROOT: path.join(profile, 'vault'),
      NEUMA_SECRETS_FILE: path.join(profile, 'secrets.json'),
      NEUMA_WORKSPACE_SETTINGS_PATH: path.join(profile, 'workspace-settings.json'),
      NEUMA_REALM_SETTINGS_PATH: path.join(profile, 'realm-settings.json'),
      NEUMA_REALM_ROOT: path.join(profile, 'realm'),
      WORKSPACES_ROOT: path.join(profile, 'workspaces'),
      AI_WITNESSES_ROOT: path.join(profile, 'witnesses'),
      LLM_PROVIDER: 'lm-studio',
      LM_STUDIO_URL: 'http://127.0.0.1:1',
    };
    delete env.ELECTRON_RUN_AS_NODE;
    desktop = await electron.launch({ executablePath: electronPath, args: ['--disable-gpu', fixture], env });
    await expect.poll(() => desktop.evaluate(() => globalThis.result?.ready), { timeout: 60_000 }).toBe(true);
    const result = await desktop.evaluate(() => globalThis.result);
    expect(result.fatal).toBeUndefined();
    expect(result.extension.tools).toEqual(['environment']);
    expect(result.extension.environment.electron).toBe('44.11.3');
    expect(result.extension.environment.runAsNode).toBeNull();
    expect(result.watch.runtime).toBe('node');
    expect(result.watch.inheritsRunAsNode).toBe(false);
    expect(result.watch.check).toMatchObject({ ok: true });
    expect(result.watch.check.stdout).toMatch(/^v\d+\./);
    expect(result.backend.status).toBe(200);
    expect(Number(new URL(result.backend.origin).port)).toBeGreaterThan(0);
    expect(result.backend.body).toContain('healthy');
  } finally {
    await desktop?.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
}, 90_000);
