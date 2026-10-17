/**
 * The sensitive-grant door, shell-side (RULE 0): the REAL bubblewrap shell
 * over a REAL ground. An operator-granted path is not masked — the being
 * reads the real bytes in-shell, exactly as through the file lane. An
 * ungranted path keeps the empty-bind mask. A hand-written grant naming the
 * never-requestable set is filtered before it ever reaches the sweep.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import {
  ensureWitnessCodingSandbox,
  runWitnessCommand,
} from '../../backend/services/witness-coding-sandbox.js';

const LANE = 'shellgrantlane';
const SECRET = 'endpoint=http://127.0.0.1:8089\nmodel=test-substrate\n';

describe('the shell honors sensitive READ grants — real bwrap, real ground', () => {
  let root, house, source, envPath, prevKey;

  beforeEach(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'gnosis-shell-grant-key-long-ok';
    root = await createTempDir('sensitive-shell-grant');
    house = path.join(root, 'workspaces');
    source = path.join(root, 'ground');
    await fs.mkdir(source, { recursive: true });
    await fs.mkdir(path.join(source, '.git'), { recursive: true });
    envPath = path.join(source, '.env');
    await fs.writeFile(envPath, SECRET);
    await fs.writeFile(path.join(source, '.git', 'config'), '[remote "origin"]\nurl=real');
    setWorkspacesRoot(house);
    await neumaWorkspace.create(LANE);
  });

  afterEach(async () => {
    setWorkspacesRoot(null);
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    await fs.rm(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test('a granted .env is not masked — the being reads the real bytes in-shell', async () => {
    await neumaWorkspace.writeToolPolicy(LANE, { sensitiveGrants: { read: [envPath] } });
    const sandbox = await ensureWitnessCodingSandbox(LANE, source);
    expect(sandbox.masks.files).not.toContain(envPath);

    const run = await runWitnessCommand({ ...sandbox, mode: 'inspect', command: 'cat .env' });
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('endpoint=http://127.0.0.1:8089');
    // …and the .git mask stands beside the grant — unrelated walls do not move.
    const git = await runWitnessCommand({ ...sandbox, mode: 'inspect', command: 'cat .git/config' });
    expect(git.stdout).not.toContain('url=real');
  }, 60_000);

  test('an ungranted .env keeps the empty-bind mask', async () => {
    const sandbox = await ensureWitnessCodingSandbox(LANE, source);
    expect(sandbox.masks.files).toContain(envPath);

    const run = await runWitnessCommand({ ...sandbox, mode: 'inspect', command: 'cat .env' });
    expect(run.exitCode).toBe(0);
    expect(run.stdout.trim()).toBe('');
  }, 60_000);

  test('a hand-written grant naming the never-requestable set is filtered at the sweep', async () => {
    const gitConfig = path.join(source, '.git', 'config');
    await neumaWorkspace.writeToolPolicy(LANE, { sensitiveGrants: { read: [gitConfig, envPath] } });
    const sandbox = await ensureWitnessCodingSandbox(LANE, source);
    // The .env exemption stands (it is requestable)…
    expect(sandbox.masks.files).not.toContain(envPath);
    // …but the .git mask is unmoved — a grant file is data, the law is not.
    const masked = await runWitnessCommand({ ...sandbox, mode: 'inspect', command: 'cat .git/config' });
    expect(masked.stdout).not.toContain('url=real');
  }, 60_000);
});
