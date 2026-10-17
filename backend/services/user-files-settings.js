/**
 * User-files settings — which folders the witness has opened to work in
 * (the explorer's browse roots). Persisted at data/settings/user-files.json
 * so the choice survives restarts; applied at boot via applyFileSettings().
 */
import fs from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { statSync } from 'fs';
import { setRoots, getRoots } from './user-files.js';
import { writeJsonAtomic } from './user-realm.js';
import { getSettingsDir } from './data-root.js';


const SETTINGS_DIR = getSettingsDir();
// Tests isolate via NEUMA_FILES_SETTINGS_PATH (the same law as the realm and
// workspace settings paths) — the live file is never written from a test.
//
// Read PER CALL, not at import, exactly as user-realm-settings.js does. As a
// module-level const the door was boot-only: a suite that set the variable
// after this module had loaded silently aimed at the operator's real
// data/settings/user-files.json, so four test files reached for a mock of
// saveFileSettings instead of the seam that was already here (#390 tranche 3).
const settingsPath = () =>
  process.env.NEUMA_FILES_SETTINGS_PATH || join(SETTINGS_DIR, 'user-files.json');

// impure — reads the persisted browse roots; absent file means the default
export const loadFileSettings = async () => {
  try {
    const parsed = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
    return { roots: Array.isArray(parsed.roots) ? parsed.roots.filter((r) => typeof r === 'string') : null };
  } catch {
    return { roots: null };
  }
};

// impure — persists the witness's chosen browse roots
export const saveFileSettings = async ({ roots }) => {
  await writeJsonAtomic(settingsPath(), { roots });
};

const existingDirectory = (root) => {
  try { return statSync(root).isDirectory(); } catch { return false; }
};

/** Drop gone folders and the home directory — home is a picker start, not a watch root. */
export const pruneBrowseRoots = (roots) => {
  const home = resolve(homedir());
  return (Array.isArray(roots) ? roots : [])
    .filter((r) => typeof r === 'string')
    .map((r) => resolve(r))
    .filter((r) => r !== home && existingDirectory(r));
};

// impure — applies persisted roots at boot; returns the active roots
export const applyFileSettings = async () => {
  const settings = await loadFileSettings();
  const next = pruneBrowseRoots(settings.roots);
  setRoots(next);
  if (settings.roots && JSON.stringify(settings.roots.map((r) => resolve(r))) !== JSON.stringify(next)) {
    await saveFileSettings({ roots: next });
  }
  return { roots: getRoots() };
};
