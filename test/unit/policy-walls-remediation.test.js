import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { testEndpoint } from '../../backend/services/test-endpoint-door.js';
import { applyProtocolGuard } from '../../backend/services/protocol-guard.js';
import { checkToolAccess, resolvePolicy, GLOBAL_DEFAULTS } from '../../backend/services/tool-policy.js';
import { isSecretFile } from '../../backend/services/secret-path-classifier.js';
import { platformWriteWalls } from '../../backend/services/platform-write-walls.js';
import { agentTerminalEnvironment } from '../../backend/services/agent-terminal-environment.js';

const ENV_DOORS = [
  'NEUMA_COINGECKO_URL', 'NEUMA_UMBRAE_LP_ORIGIN', 'NEUMA_KYBER_ORIGIN', 'BASE_PUBLIC_RPC_URL',
  'NEUMA_LINKEDIN_OAUTH_ROOT', 'NEUMA_LEAD_SOURCE_HUNTER', 'NEUMA_LEAD_SOURCE_GECKO',
  'NEUMA_TELEGRAM_API_ROOT', 'NEUMA_DISCORD_API_ROOT', 'NEUMA_TIKTOK_CDN_ROOT',
];

describe('production endpoint doors', () => {
  test.each(ENV_DOORS)('%s is ignored in production even for a loopback URL', (name) => {
    expect(testEndpoint({ NODE_ENV: 'production', [name]: 'http://127.0.0.1:8080' }, name, 'https://pinned.example'))
      .toBe('https://pinned.example');
  });

  test('test mode admits only credential-free loopback URLs with the expected protocol', () => {
    expect(testEndpoint({ NODE_ENV: 'test', DOOR: 'http://127.0.0.1:8080/base' }, 'DOOR', 'https://pinned.example'))
      .toBe('http://127.0.0.1:8080/base');
    expect(testEndpoint({ NODE_ENV: 'test', DOOR: 'ws://[::1]:8080' }, 'DOOR', 'wss://pinned.example', ['ws:']))
      .toBe('ws://[::1]:8080');
    for (const hostile of ['http://169.254.169.254', 'http://10.0.0.2', 'https://evil.example', 'http://user:pass@127.0.0.1:8', 'file:///etc/passwd']) {
      expect(testEndpoint({ NODE_ENV: 'test', DOOR: hostile }, 'DOOR', 'https://pinned.example')).toBe('https://pinned.example');
    }
  });
});

describe('approval policy tiers', () => {
  test('every dynamic extension call keeps its card in AUTO without an exact standing grant', () => {
    expect(applyProtocolGuard('allowed', 'auto', 'extension', 'playwright.click')).toBe('approval_required');
    expect(applyProtocolGuard('allowed', 'auto', 'extension', 'playwright.click', true)).toBe('allowed');
    expect(applyProtocolGuard('denied', 'auto', 'extension', 'playwright.click')).toBe('denied');
    expect(applyProtocolGuard('approval_required', 'ask', 'extension', 'playwright.click')).toBe('approval_required');
  });

  test('company hands and member charters ask; neighboring record/seating acts keep their tiers', () => {
    const policy = resolvePolicy(GLOBAL_DEFAULTS);
    expect(checkToolAccess(policy, 'intents', 'company.hands')).toBe('approval_required');
    expect(checkToolAccess(policy, 'intents', 'house.charter')).toBe('approval_required');
    expect(checkToolAccess(policy, 'intents', 'company.open')).toBe('allowed');
    expect(checkToolAccess(policy, 'intents', 'house.seating')).toBe('allowed');
  });
});

describe('secret and persistence classification', () => {
  test('hook and CLI bearer stores are secret-shaped, not their implementation source', () => {
    for (const file of ['/home/op/.neuma/cli/token-ab12.json', '/tmp/neuma-cli-token-ab12.json', '/data/hooks/hooks.json']) {
      expect(isSecretFile(file), file).toBe(true);
    }
    expect(isSecretFile('/repo/backend/services/hooks/hook-store.js')).toBe(false);
    expect(isSecretFile('/home/op/.neuma/cli/token-ab12.json.js')).toBe(false);
  });

  test('every omitted POSIX login file and user bin directory is walled by default', () => {
    const home = path.resolve(os.homedir());
    const walls = platformWriteWalls({ PATH: '' }).filter((wall) => wall.path).map((wall) => wall.path);
    for (const rel of ['.bash_aliases', '.cshrc', '.tcshrc', '.kshrc', '.config/nushell', '.cargo/bin', 'go/bin', '.npm-global/bin']) {
      expect(walls, rel).toContain(path.join(home, rel));
    }
  });

  test('plain terminal environments keep session essentials and drop every non-allowlisted secret', () => {
    const env = agentTerminalEnvironment({
      HOME: '/home/op', PATH: '/usr/bin', SUPABASE_SERVICE_KEY: 'sentinel', X_API_KEY: 'sentinel',
      NEUMA_SIDECAR_KEY: 'sentinel', DNA_ENCRYPTION_KEY: 'sentinel', UNKNOWN_SENTINEL: 'sentinel',
    }, 'linux');
    expect(env).toEqual({ HOME: '/home/op', PATH: '/usr/bin', TERM: 'xterm-256color' });
  });
});
