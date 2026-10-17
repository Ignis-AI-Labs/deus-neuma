import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Realm-settings guard + apply doctrine (backend/services/user-realm-settings.js)
 * — real settings file on disk, real module state, NO mock (RULE 0), isolated
 * via NEUMA_REALM_SETTINGS_PATH so the operator's live
 * data/settings/user-realm.json is never targeted (the exact lesson of the
 * workspace-settings-apply suite: never target the live file).
 *
 * Proves the two behaviors that close the 2026-07-20 incident class:
 *   1. saveRealmSettings REFUSES a temp-dir root on the live file (the escape
 *      that stranded the witness's realm on a deleted /tmp path).
 *   2. applyRealmSettings treats a persisted temp root as no choice at all,
 *      while keeping a missing NON-temp root (unmounted-drive doctrine).
 */

import {
  applyRealmSettings,
  saveRealmSettings,
  loadRealmSettings,
} from '../../backend/services/user-realm-settings.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';

const DEFAULT_REALM = path.join(os.homedir(), '.neuma', 'realm');

let settingsDir;

beforeAll(async () => {
  settingsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'realm-settings-apply-'));
  process.env.NEUMA_REALM_SETTINGS_PATH = path.join(settingsDir, 'user-realm.json');
});

afterAll(async () => {
  delete process.env.NEUMA_REALM_SETTINGS_PATH;
  await fs.rm(settingsDir, { recursive: true, force: true });
});

afterEach(() => setRealmRoot(DEFAULT_REALM));

describe('saveRealmSettings — the live-file temp guard', () => {
  it('REFUSES a temp-dir root when no override isolates the live file', async () => {
    const isolated = process.env.NEUMA_REALM_SETTINGS_PATH;
    delete process.env.NEUMA_REALM_SETTINGS_PATH; // expose the live path for this call only
    const refusal = await saveRealmSettings({ root: path.join(os.tmpdir(), 'ghost-realm') })
      .then(() => null, (err) => err);
    process.env.NEUMA_REALM_SETTINGS_PATH = isolated;
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal.code).toBe('REALM_TEMP_ROOT_REFUSED');
    expect(refusal.message).toMatch(/temp-dir realm root/);
  });

  it('persists through the override door (the legitimate test/rig path)', async () => {
    const tempRoot = path.join(os.tmpdir(), 'rig-realm');
    await saveRealmSettings({ root: tempRoot });
    expect(await loadRealmSettings()).toEqual({ root: tempRoot });
  });

  it('persists a durable root', async () => {
    await saveRealmSettings({ root: '/mnt/durable/realm' });
    expect(await loadRealmSettings()).toEqual({ root: '/mnt/durable/realm' });
  });
});

describe('applyRealmSettings — ghost-root doctrine', () => {
  it('a persisted TEMP root is no choice at all: the default realm stays in force', async () => {
    await saveRealmSettings({ root: path.join(os.tmpdir(), 'deleted-ghost-realm') });
    const applied = await applyRealmSettings();
    expect(applied.root).toBe(DEFAULT_REALM);
    expect(getRealmRoot()).toBe(DEFAULT_REALM);
  });

  it('a missing NON-temp root is KEPT (unmounted drive, not a ghost)', async () => {
    await saveRealmSettings({ root: '/mnt/unmounted-drive/realm' });
    const applied = await applyRealmSettings();
    expect(applied.root).toBe('/mnt/unmounted-drive/realm');
  });

  it('an existing durable root is adopted', async () => {
    // A temp-dir path cannot stand in for "durable" here — the doctrine
    // refuses temp roots — so point at a real non-temp dir created for the test.
    const nonTemp = path.join(os.homedir(), '.neuma-test-durable-realm');
    await fs.mkdir(nonTemp, { recursive: true });
    await saveRealmSettings({ root: nonTemp });
    const applied = await applyRealmSettings();
    expect(applied.root).toBe(nonTemp);
    await fs.rm(nonTemp, { recursive: true, force: true });
  });

  it('NEUMA_REALM_ROOT (the launch-scoped isolation door) wins over the persisted choice', async () => {
    await saveRealmSettings({ root: '/mnt/durable/realm' });
    process.env.NEUMA_REALM_ROOT = path.join(os.tmpdir(), 'launch-realm');
    const applied = await applyRealmSettings();
    delete process.env.NEUMA_REALM_ROOT;
    expect(applied.root).toBe(path.join(os.tmpdir(), 'launch-realm'));
  });
});
