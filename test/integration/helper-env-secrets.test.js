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
import { execFile } from 'child_process';
import { promisify } from 'util';
import { probeEnvironment } from '../../backend/services/agent-terminal-environment.js';
import { boundedExec } from '../../backend/services/bounded-exec.js';
import { untrustedGitEnv } from '../../backend/services/untrusted-git.js';

const SECRETS = Object.freeze({
  AUTH_SECRET: 'FAKE-auth', DNA_ENCRYPTION_KEY: 'FAKE-dna', DEPLOYER_PRIVATE_KEY: 'FAKE-deployer', OPENAI_API_KEY: 'FAKE-openai',
  // the service keys the 0.1.89 denylist missed (re-audit 2026-10-29, NEW-L2)
  HF_TOKEN: 'FAKE-hf', OPENROUTER_API_KEY: 'FAKE-openrouter', GROQ_API_KEY: 'FAKE-groq', EXA_API_KEY: 'FAKE-exa', ETH_SEPOLIA_RPC_URL: 'https://FAKE-rpc',
});
const namesIn = (dump) => dump.split('\n').map((line) => line.split('=')[0]).filter(Boolean);
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
    // HF_TOKEN is the one key a voice engine is given on purpose: it downloads its own weights
    for (const key of Object.keys(SECRETS).filter((k) => k !== 'HF_TOKEN')) expect(env).not.toHaveProperty(key);
  });

  // re-audit 2026-10-29, NEW-L1/L2: probes and the model server spawned with no env inherited all of them
  test('a real probe child (boundedExec) and a real git child see PATH and HOME (the probe the GPU settings too), and no secret', async () => {
    process.env.CUDA_VISIBLE_DEVICES = '0';
    try {
      const probe = await boundedExec('/usr/bin/env', [], { timeoutMs: 5000 });
      expect(probe.ok).toBe(true);
      const git = await promisify(execFile)('git', ['-c', 'alias.envdump=!env', 'envdump'], { env: untrustedGitEnv() });
      for (const names of [namesIn(probe.stdout), namesIn(git.stdout)]) {
        expect(names).toContain('PATH');
        expect(names).toContain('HOME');
        for (const key of Object.keys(SECRETS)) expect(names).not.toContain(key);
      }
      expect(namesIn(probe.stdout)).toContain('CUDA_VISIBLE_DEVICES'); // a probe reads the GPU; git does not
    } finally {
      delete process.env.CUDA_VISIBLE_DEVICES;
    }
  }, 30000);

  test('the model server keeps its own settings and the GPU runtime, and drops every secret', () => {
    const env = probeEnvironment({ ...SECRETS, PATH: '/usr/bin', OLLAMA_MODELS: '/m', LD_LIBRARY_PATH: '/cuda/lib', HIP_VISIBLE_DEVICES: '1' }, 'linux');
    expect(env).toMatchObject({ PATH: '/usr/bin', OLLAMA_MODELS: '/m', LD_LIBRARY_PATH: '/cuda/lib', HIP_VISIBLE_DEVICES: '1' });
    for (const key of Object.keys(SECRETS)) expect(env).not.toHaveProperty(key);
  });

  test('helperEnvironment adds only the network settings and the names a helper asks for', () => {
    const env = helperEnvironment({ ...SECRETS, PATH: '/usr/bin', NO_PROXY: 'localhost', MINE: 'x', OTHER: 'y' },
      'linux', (key) => key === 'MINE');
    expect(env).toEqual({ PATH: '/usr/bin', TERM: 'xterm-256color', NO_PROXY: 'localhost', MINE: 'x' });
  });
});
