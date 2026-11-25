/** SANDBOX OFF — real direct execution, no bubblewrap or prepared overlay. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { ensureTurnSandbox } from '../../backend/services/turn-sandbox.js';
import { runWitnessCommand, sandboxStatusText } from '../../backend/services/witness-coding-sandbox.js';
import { directShellFor } from '../../backend/services/sandbox-mode.js';
import { renderCommandResult } from '../../backend/services/coding-result.js';
import { reachLines } from '../../backend/services/flight-check.js';

describe('SANDBOX OFF direct shell', () => {
  let priorSecrets;

  beforeEach(async () => {
    priorSecrets = process.env.NEUMA_SECRETS_FILE;
    process.env.NEUMA_SECRETS_FILE = path.join(await createTempDir('direct-shell-secrets'), 'secrets.json');
    process.env.NEUMA_TEST_DIRECT_SECRET = 'scanner-sentinel-only';
  });

  afterEach(() => {
    if (priorSecrets === undefined) delete process.env.NEUMA_SECRETS_FILE;
    else process.env.NEUMA_SECRETS_FILE = priorSecrets;
    delete process.env.NEUMA_TEST_DIRECT_SECRET;
  });

  test('skips preparation, uses the real cwd and an allowlisted environment, and writes directly', async () => {
    const sourceRoot = await createTempDir('direct-shell');
    const connection = {
      sandboxEnabled: false,
      _turnSandboxSource: { laneId: 'not-needed-for-direct-execution', sourceRoot },
    };
    const shell = await ensureTurnSandbox(connection);
    expect(shell).toEqual({ sourceRoot, direct: true });
    expect(shell.workspace).toBeUndefined();
    expect(shell.masks).toBeUndefined();

    const result = await runWitnessCommand({
      ...shell,
      mode: 'write',
      command: 'printf "cwd=%s\\nhome=%s\\nsecret=%s\\n" "$PWD" "$HOME" "${NEUMA_TEST_DIRECT_SECRET:-absent}"; printf "landed\\n" > direct.txt',
    });
    expect(result.exitCode).toBe(0);
    expect(result.direct).toBe(true);
    expect(result.live).toBe(true);
    expect(result.stdout).toContain(`cwd=${sourceRoot}`);
    expect(result.stdout).toContain(`home=${os.homedir()}`);
    expect(result.stdout).toContain('secret=absent');
    expect(result.stdout).not.toContain('scanner-sentinel-only');
    expect(await fs.readFile(path.join(sourceRoot, 'direct.txt'), 'utf8')).toBe('landed\n');
    expect(renderCommandResult(result)).toContain('[direct] SANDBOX OFF');
    expect(renderCommandResult(result)).not.toContain('[overlay]');
    expect(sandboxStatusText(shell)).toContain('SANDBOX OFF, direct execution');
    expect(sandboxStatusText(shell)).toContain('allowlisted environment');
    const reach = reachLines({ focusGround: sourceRoot, sandbox: shell }).join('\n');
    expect(reach).toContain(`DIRECT on ${sourceRoot} (SANDBOX OFF)`);
    expect(reach).toContain('approval');
    expect(reach).toContain('allowlisted environment');
    expect(reach).not.toContain('undefined');
    expect(reach).not.toContain('overlay view');
  });

  test('ON and a missing source never select the direct path', async () => {
    const sourceRoot = await createTempDir('direct-selection');
    const source = { laneId: 'lane', sourceRoot };
    expect(directShellFor({ sandboxEnabled: true }, source)).toBeNull();
    expect(directShellFor({ sandboxEnabled: false }, null)).toBeNull();
    expect(directShellFor({ sandboxEnabled: false }, source)).toEqual({ sourceRoot, direct: true });
  });

});
