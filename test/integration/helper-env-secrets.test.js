/**
 * Helper processes the platform spawns start from the helper environment,
 * never the backend's own (audit 2026-10-19, E8): a REAL MCP server spawned
 * over the REAL stdio transport answers the names it was given, and the voice
 * helpers' environment is proven on its pure builder. Every secret is FAKE.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { mcpService } from '../../backend/services/mcp.js';
import { helperEnvironment } from '../../backend/services/agent-terminal-environment.js';
import { voiceHelperEnvironment } from '../../backend/services/voice/engine-process.js';

const SECRETS = Object.freeze({
  AUTH_SECRET: 'FAKE-auth', DNA_ENCRYPTION_KEY: 'FAKE-dna', DEPLOYER_PRIVATE_KEY: 'FAKE-deployer', OPENAI_API_KEY: 'FAKE-openai',
});
const PROBE = path.resolve('test/fixtures/env-probe-mcp-server.mjs');

describe('a spawned helper never inherits the backend\'s secrets', () => {
  let saved;
  beforeAll(() => {
    saved = Object.fromEntries(Object.keys(SECRETS).map((k) => [k, process.env[k]]));
    Object.assign(process.env, SECRETS);
  });
  afterAll(async () => {
    await mcpService.disconnect('env-probe').catch(() => {});
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('a real MCP server child sees PATH and HOME and its own configured name, and no secret', async () => {
    await mcpService.connectToServer('env-probe', process.execPath, [PROBE], { PROBE_OWN_SETTING: '1' });
    const result = await mcpService.callTool('env-probe', 'env_names', {});
    const names = JSON.parse(result.content[0].text);
    expect(names).toContain('PATH');
    expect(names).toContain('HOME');
    expect(names).toContain('PROBE_OWN_SETTING');
    for (const key of Object.keys(SECRETS)) expect(names).not.toContain(key);
  }, 30000);

  test('the voice helpers keep their own knobs, the GPU and the model cache, and drop every secret', () => {
    const env = voiceHelperEnvironment({
      ...SECRETS, PATH: '/usr/bin', HOME: '/home/op', HF_HOME: '/models/hf', HF_TOKEN: 'hf-own',
      CUDA_VISIBLE_DEVICES: '0', WHISPER_FORCE_CPU: '1', KYUTAI_VOICE: 'x', NANO_CPUS: '0-7', HTTPS_PROXY: 'http://proxy',
    }, 'whisper', 'linux');
    expect(env).toMatchObject({ PATH: '/usr/bin', HOME: '/home/op', HF_HOME: '/models/hf', HF_TOKEN: 'hf-own',
      CUDA_VISIBLE_DEVICES: '0', WHISPER_FORCE_CPU: '1', NANO_CPUS: '0-7', HTTPS_PROXY: 'http://proxy' });
    expect(env).not.toHaveProperty('KYUTAI_VOICE'); // another engine's knob
    for (const key of Object.keys(SECRETS)) expect(env).not.toHaveProperty(key);
  });

  test('helperEnvironment adds only the network settings and the names a helper asks for', () => {
    const env = helperEnvironment({ ...SECRETS, PATH: '/usr/bin', NO_PROXY: 'localhost', MINE: 'x', OTHER: 'y' },
      'linux', (key) => key === 'MINE');
    expect(env).toEqual({ PATH: '/usr/bin', TERM: 'xterm-256color', NO_PROXY: 'localhost', MINE: 'x' });
  });
});
