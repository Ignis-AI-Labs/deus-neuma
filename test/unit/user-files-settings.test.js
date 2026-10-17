/**
 * applyFileSettings prunes gone folders and the home directory, then
 * persists the cleaned list. Isolated via NEUMA_FILES_SETTINGS_PATH.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const SETTINGS = path.join(os.tmpdir(), `neuma-files-settings-${process.pid}.json`);

describe('applyFileSettings prunes ghosts and home', () => {
  let applyFileSettings;
  let pruneBrowseRoots;
  let getRoots;
  let keep;

  beforeEach(async () => {
    vi.resetModules();
    process.env.NEUMA_FILES_SETTINGS_PATH = SETTINGS;
    keep = await fs.mkdtemp(path.join(os.tmpdir(), 'uf-keep-'));
    await fs.writeFile(SETTINGS, JSON.stringify({
      roots: [os.homedir(), keep, path.join(os.tmpdir(), `uf-gone-${Date.now()}`)],
    }));
    const settings = await import('../../backend/services/user-files-settings.js');
    const files = await import('../../backend/services/user-files.js');
    applyFileSettings = settings.applyFileSettings;
    pruneBrowseRoots = settings.pruneBrowseRoots;
    getRoots = files.getRoots;
  });


  afterEach(async () => {
    await fs.rm(keep, { recursive: true, force: true }).catch(() => {});
    await fs.rm(SETTINGS, { force: true }).catch(() => {});
    delete process.env.NEUMA_FILES_SETTINGS_PATH;
  });

  it('pruneBrowseRoots drops home and a missing path', () => {
    const gone = path.join(os.tmpdir(), `uf-gone-${Date.now()}`);
    expect(pruneBrowseRoots([os.homedir(), keep, gone])).toEqual([keep]);
  });

  it('apply writes the pruned list and leaves only living roots', async () => {
    const { roots } = await applyFileSettings();
    expect(roots).toEqual([keep]);
    expect(getRoots()).toEqual([keep]);
    const saved = JSON.parse(await fs.readFile(SETTINGS, 'utf8'));
    expect(saved.roots).toEqual([keep]);
  });
});
