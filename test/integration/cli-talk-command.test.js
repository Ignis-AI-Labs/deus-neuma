// C-03 RULE 9 Step 4 verification — gnosis on `neuma talk` paths that
// fire BEFORE backend interaction. The full auth → portal → reply chain
// requires a real running backend (real being workspace, real model);
// that lives in T-01 per the sprint plan. This file covers the gates
// in front of backend contact:
//   - message validation (empty / whitespace-only)
//   - wallet env path resolution + readOperatorWallet failure surfacing
// Real subprocess; real fs; real env mutation with save-restore; no mocks.

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';

const NEUMA_BIN = resolve(
  new URL('../../bin/neuma', import.meta.url).pathname,
);

const runNeuma = (args, { cwd, env = {} }) => {
  const r = spawnSync(process.execPath, [NEUMA_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
};

const createTempProject = async (label) => {
  const dir = await createTempDir(label);
  mkdirSync(join(dir, '.git'), { recursive: true });
  return dir;
};

describe('cli/commands/talk — integration (pre-backend gates)', () => {
  test('empty message → exit 1 + clear error', async () => {
    const project = await createTempProject('cli-talk-empty');
    const r = runNeuma(['talk', ''], { cwd: project });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/a message is required/);
  });

  test('whitespace-only message → exit 1 + clear error', async () => {
    const project = await createTempProject('cli-talk-whitespace');
    const r = runNeuma(['talk', '   '], { cwd: project });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/a message is required/);
  });

  test('no message positional at all → yargs exit non-zero', async () => {
    const project = await createTempProject('cli-talk-no-positional');
    const r = runNeuma(['talk'], { cwd: project });
    expect(r.status).not.toBe(0);
  });

  test('missing wallet env file → exit 1 + readOperatorWallet error surfaces', async () => {
    const project = await createTempProject('cli-talk-no-wallet');
    const r = runNeuma(['talk', 'hello'], {
      cwd: project,
      env: { NEUMA_WALLET_ENV: '/nonexistent/wallet.env' },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Cannot read operator wallet env at \/nonexistent\/wallet\.env/);
    // The error message also points at the override mechanism
    expect(r.stderr).toMatch(/NEUMA_WALLET_ENV/);
  });

  test('--help renders all flags (--being, --session, --preset, --backend)', async () => {
    const project = await createTempProject('cli-talk-help');
    const r = runNeuma(['talk', '--help'], { cwd: project });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/--being/);
    expect(r.stdout).toMatch(/--session/);
    expect(r.stdout).toMatch(/--preset/);
    expect(r.stdout).toMatch(/grounded.*balanced.*expansive/);
    expect(r.stdout).toMatch(/--backend/);
  });
});

// The auth + portal + reply round-trip is COVERED IN T-01 (real backend
// fixture). Per sprint plan §3 T-01 row: 'Spin up temp backend per
// RULE 0; never against operator's running daemon.' Stale-content abort
// in edit (carried from C-04) ALSO lands in T-01.
