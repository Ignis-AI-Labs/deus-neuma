/**
 * WORKSPACES_ROOT configuration tests
 *
 * Verifies the sovereign workspace root can be relocated via env var
 * (e.g. to a dedicated drive) and falls back to the repo default.
 */

import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

describe('NeumaWorkspace root configuration', () => {
  let originalRoot;

  beforeEach(() => {
    originalRoot = process.env.WORKSPACES_ROOT;
  });

  afterEach(() => {
    if (originalRoot === undefined) {
      delete process.env.WORKSPACES_ROOT;
    } else {
      process.env.WORKSPACES_ROOT = originalRoot;
    }
    vi.restoreAllMocks();
  });

  test('uses WORKSPACES_ROOT env var when set', async () => {
    const tempDir = await createTempDir('workspace-root-env');
    process.env.WORKSPACES_ROOT = tempDir;

    vi.resetModules();
    const workspace = (await import('../../core/workspace/neuma-workspace.js')).default;

    expect(workspace.root).toBe(tempDir);
  });

  test('falls back to repo workspaces/ when env var is unset', async () => {
    delete process.env.WORKSPACES_ROOT;

    vi.resetModules();
    const workspace = (await import('../../core/workspace/neuma-workspace.js')).default;

    expect(workspace.root).toBe(path.resolve(import.meta.dirname, '../../workspaces'));
  });

  // The regression guard for the module-load timing bug — env was captured at
  // import-time, so dotenv.config() running LATER in server.js had no effect
  // (the env never won). Lazy resolution honors env set AFTER import.
  test('reads WORKSPACES_ROOT LAZILY — env set after import still wins (timing-bug regression guard)', async () => {
    delete process.env.WORKSPACES_ROOT; // import with no env set
    vi.resetModules();
    const m = await import('../../core/workspace/neuma-workspace.js');
    expect(m.getWorkspacesRoot()).toBe(path.resolve(import.meta.dirname, '../../workspaces'));

    // simulate dotenv.config() running AFTER import (the bug scenario)
    const tempDir = await createTempDir('workspace-root-post-import');
    process.env.WORKSPACES_ROOT = tempDir;
    expect(m.getWorkspacesRoot()).toBe(tempDir);              // lazy read picks it up
    expect(m.default.root).toBe(tempDir);                     // singleton accessor too
  });

  test('setWorkspacesRoot override wins over the env var (witness pre-flight choice)', async () => {
    const tempEnv = await createTempDir('workspace-root-env-arg');
    const tempOverride = await createTempDir('workspace-root-override');
    process.env.WORKSPACES_ROOT = tempEnv;

    vi.resetModules();
    const m = await import('../../core/workspace/neuma-workspace.js');
    expect(m.getWorkspacesRoot()).toBe(tempEnv);              // env first

    m.setWorkspacesRoot(tempOverride);
    expect(m.getWorkspacesRoot()).toBe(tempOverride);         // override takes over
    expect(m.default.root).toBe(tempOverride);

    m.setWorkspacesRoot(null);
    expect(m.getWorkspacesRoot()).toBe(tempEnv);              // clearing override falls back to env
  });

  test('empty WORKSPACES_ROOT="" falls through to the default (not to "")', async () => {
    process.env.WORKSPACES_ROOT = '';
    vi.resetModules();
    const m = await import('../../core/workspace/neuma-workspace.js');
    expect(m.getWorkspacesRoot()).toBe(path.resolve(import.meta.dirname, '../../workspaces'));
  });
});
