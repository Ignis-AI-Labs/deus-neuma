/** SANDBOX OFF — real direct execution, no bubblewrap or prepared overlay. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { ensureTurnSandbox } from '../../backend/services/turn-sandbox.js';
import { runWitnessCommand, sandboxStatusText } from '../../backend/services/witness-coding-sandbox.js';
import { directShellFor } from '../../backend/services/sandbox-mode.js';
import { renderCommandResult } from '../../backend/services/coding-result.js';
import { reachLines } from '../../backend/services/flight-check.js';

describe('SANDBOX OFF direct shell', () => {
  test('skips preparation, uses the real cwd and environment, and writes directly', async () => {
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
      command: 'printf "cwd=%s\\nhome=%s\\n" "$PWD" "$HOME"; printf "landed\\n" > direct.txt',
    });
    expect(result.exitCode).toBe(0);
    expect(result.direct).toBe(true);
    expect(result.live).toBe(true);
    expect(result.stdout).toContain(`cwd=${sourceRoot}`);
    expect(result.stdout).toContain(`home=${os.homedir()}`);
    expect(await fs.readFile(path.join(sourceRoot, 'direct.txt'), 'utf8')).toBe('landed\n');
    expect(renderCommandResult(result)).toContain('[direct] SANDBOX OFF');
    expect(renderCommandResult(result)).not.toContain('[overlay]');
    expect(sandboxStatusText(shell)).toContain('SANDBOX OFF, direct execution');
    expect(sandboxStatusText(shell)).toContain('no bubblewrap, overlay, mask or sandbox recovery');
    const reach = reachLines({ focusGround: sourceRoot, sandbox: shell }).join('\n');
    expect(reach).toContain(`DIRECT on ${sourceRoot} (SANDBOX OFF)`);
    expect(reach).toContain('normal OS user, environment, network and permissions');
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
