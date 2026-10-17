import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { URL } from 'node:url';
import { createProtectedTempDir, removeProtectedTempDir } from '../helpers/temp-fs.js';
// Real settings file on disk, real global workspaces-root state, NO mock
// (RULE 0). Proves the SAFETY BEHAVIOR — not just the predicate — that keeps a
// being from defaulting into the OS temp dir: applyWorkspaceSettings must
// discard a saved temp root and leave the durable default in force.
//
// Isolated via NEUMA_WORKSPACE_SETTINGS_PATH — the persist path is still the
// real code writing a real file; it just is not the operator's live
// data/settings/workspace.json. The previous version of this suite wrote the
// LIVE file with a backup/restore pattern, and that is exactly how the live
// settings got corrupted (2026-07-03): one crashed run left a temp root in
// place, and every later polite run's beforeAll snapshotted the corruption and
// afterAll faithfully restored it — forever. Never target the live file.
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { applyWorkspaceSettings, saveWorkspaceSettings } from '../../backend/services/workspace-settings.js';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/index.js';

describe('applyWorkspaceSettings — a being never defaults into temp (real fs, no mock)', () => {
  let origRoot;
  let settingsDir;
  const savedEnv = Object.fromEntries(['NEUMA_WORKSPACE_SETTINGS_PATH', 'WORKSPACES_ROOT', 'WORKSPACES_PIN'].map((key) => [key, process.env[key]]));

  beforeAll(async () => {
    origRoot = getWorkspacesRoot();
    settingsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-settings-apply-'));
    process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(settingsDir, 'workspace.json');
  });

  afterAll(async () => {
    setWorkspacesRoot(origRoot);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(settingsDir, { recursive: true, force: true });
  });

  it('discards a saved TEMP root: returns root:null and does NOT move the workspace into temp', async () => {
    const tempRoot = path.join(os.tmpdir(), 'neuma-apply-temp-test');
    setWorkspacesRoot('/mnt/durable-sentinel'); // a known non-temp baseline to detect any change
    await saveWorkspaceSettings({ root: tempRoot, allocationGB: 5 });

    const applied = await applyWorkspaceSettings();

    expect(applied.root).toBe(null);                        // the temp choice is discarded
    expect(getWorkspacesRoot()).not.toBe(tempRoot);         // root was NOT moved into temp
    expect(getWorkspacesRoot()).toBe('/mnt/durable-sentinel'); // left at the prior default
  });

  it('applies a DURABLE saved root', async () => {
    const durable = '/mnt/external/workspaces';
    setWorkspacesRoot('/mnt/durable-sentinel');
    await saveWorkspaceSettings({ root: durable, allocationGB: 10 });

    const applied = await applyWorkspaceSettings();

    expect(applied.root).toBe(durable);
    expect(getWorkspacesRoot()).toBe(durable);
  });

  // Conflict fixtures must live outside the OS temp tree, including when the
  // test checkout itself is under /tmp. The protected scratch helper owns cleanup.
  describe('env/persisted root conflict (ARCH-001)', () => {
    let scratch;
    let envRoot, persistedRoot;

    beforeAll(async () => {
      scratch = await createProtectedTempDir('settings-conflict');
      envRoot = path.join(scratch, 'daemon-home');
      persistedRoot = path.join(scratch, 'electron-choice');
      await fs.mkdir(envRoot, { recursive: true });
      // The persisted (Electron) root holds two inhabited workspace dirs —
      // the beings that would fall out of reach when the other root wins.
      await fs.mkdir(path.join(persistedRoot, 'stranded-being-a'), { recursive: true });
      await fs.mkdir(path.join(persistedRoot, 'stranded-being-b'), { recursive: true });
    });

    afterEach(() => {
      delete process.env.WORKSPACES_ROOT;
      delete process.env.WORKSPACES_PIN;
    });

    afterAll(async () => {
      await removeProtectedTempDir(scratch);
    });

    const applyInChild = async () => {
      const settingsUrl = new URL('../../backend/services/workspace-settings.js', import.meta.url).href;
      const coreUrl = new URL('../../core/index.js', import.meta.url).href;
      const source = `
        import { applyWorkspaceSettings } from ${JSON.stringify(settingsUrl)};
        import { setWorkspacesRoot, getWorkspacesRoot } from ${JSON.stringify(coreUrl)};
        setWorkspacesRoot(${JSON.stringify(envRoot)});
        const applied = await applyWorkspaceSettings();
        process.stdout.write('RESULT ' + JSON.stringify({ applied, root: getWorkspacesRoot() }));
      `;
      const { stdout } = await promisify(execFile)(process.execPath,
        ['--input-type=module', '--eval', source], {
          env: { ...process.env, LOG_LEVEL: 'debug' }, timeout: 5000, maxBuffer: 128 * 1024,
        });
      const result = stdout.split('\n').find((line) => line.startsWith('RESULT '));
      expect(result).toBeDefined();
      return { ...JSON.parse(result.slice(7)), output: stdout };
    };

    it('WORKSPACES_PIN=env keeps the env root — persisted root is NOT adopted', async () => {
      process.env.WORKSPACES_ROOT = envRoot;
      process.env.WORKSPACES_PIN = 'env';
      setWorkspacesRoot(envRoot);
      await saveWorkspaceSettings({ root: persistedRoot, allocationGB: 10 });

      const { applied, root: actualRoot, output } = await applyInChild();

      expect(applied.root).toBe(null); // no adoption reported
      expect(actualRoot).toBe(envRoot); // pin held
      expect(output).toContain('PINNED to env');
    });

    it('without the pin, the persisted root still wins (current semantics preserved) and adoption is LOUD', async () => {
      process.env.WORKSPACES_ROOT = envRoot;
      setWorkspacesRoot(envRoot);
      await saveWorkspaceSettings({ root: persistedRoot, allocationGB: 10 });

      const { applied, root: actualRoot, output } = await applyInChild();

      expect(applied.root).toBe(persistedRoot);
      expect(actualRoot).toBe(persistedRoot);
      expect(output).toContain('ADOPTED over env');
    });

    it('WORKSPACES_PIN=settings adopts the persisted root QUIETLY — a stated choice, not a conflict', async () => {
      process.env.WORKSPACES_ROOT = envRoot;
      process.env.WORKSPACES_PIN = 'settings';
      await fs.mkdir(path.join(envRoot, 'daemon-being'), { recursive: true });
      setWorkspacesRoot(envRoot);
      await saveWorkspaceSettings({ root: persistedRoot, allocationGB: 10 });

      const { applied, root: actualRoot, output } = await applyInChild();

      expect(applied.root).toBe(persistedRoot);
      expect(actualRoot).toBe(persistedRoot);
      const out = output;
      expect(out).toContain('pinned to settings');
      expect(out).not.toContain('ADOPTED over env');
      // Intent does not un-strand a house: the inhabited check still speaks.
      expect(out).toContain('inhabited workspace(s) at the losing root');
    });

    it('warns with the inhabited count when the losing root holds workspaces (real dirs)', async () => {
      // Pin the env root so the persisted root (holding two beings) LOSES —
      // the diagnostic must count and name what falls out of reach.
      process.env.WORKSPACES_ROOT = envRoot;
      process.env.WORKSPACES_PIN = 'env';
      setWorkspacesRoot(envRoot);
      await saveWorkspaceSettings({ root: persistedRoot, allocationGB: 10 });

      const { output: out } = await applyInChild();
      expect(out).toContain('inhabited workspace(s) at the losing root');
      expect(out).toContain('"inhabited":2');
    });
  });
});
