/**
 * User-realm settings — where the witness's own data realm lives on this
 * machine. Persisted at data/settings/user-realm.json so the choice
 * survives restarts; applied at boot via applyRealmSettings().
 */
import fs from 'fs/promises';
import { join, dirname } from 'path';
import { setRealmRoot, getRealmRoot, writeJsonAtomic } from './user-realm.js';
import { isTempPath } from './workspace-settings.js';
import { createLogger } from './logger.js';
import { getSettingsDir } from './data-root.js';

const log = createLogger('UserRealm');

const SETTINGS_DIR = getSettingsDir();

// Overridable so tests exercising the REAL persist path never clobber the
// operator's live choice — same pattern as NEUMA_WORKSPACE_SETTINGS_PATH.
// Read per call, not at import, so a test can set it after module load.
const settingsPath = () =>
  process.env.NEUMA_REALM_SETTINGS_PATH || join(SETTINGS_DIR, 'user-realm.json');

// impure — reads the persisted realm root; absent file means the default
export const loadRealmSettings = async () => {
  try {
    const parsed = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
    return { root: typeof parsed.root === 'string' ? parsed.root : null };
  } catch {
    return { root: null };
  }
};

// impure — persists the witness's chosen realm root.
//
// HARD GUARD on the LIVE settings file, mirroring saveWorkspaceSettings: a
// temp-dir root is never a durable home, so persisting one can only do
// damage — observed 2026-07-20, when a test rig's relocation POST wrote a
// scratch /tmp path into data/settings/user-realm.json and the scratch was
// then deleted, silently stranding the witness's whole realm (councils,
// labels, chat logs read as empty until the pointer was repaired by hand).
// Tests that legitimately persist temp roots always set the override; a
// call that reaches the live file with a temp root is an escape, and it
// throws.
export const saveRealmSettings = async ({ root }) => {
  if (!process.env.NEUMA_REALM_SETTINGS_PATH && isTempPath(root)) {
    // Typed refusal — the relocation route maps this code to a 422; match on
    // the code, never on the prose.
    const err = new Error(`refusing to persist a temp-dir realm root to the live settings: ${root}`);
    err.code = 'REALM_TEMP_ROOT_REFUSED';
    throw err;
  }
  const target = settingsPath();
  await fs.mkdir(dirname(target), { recursive: true });
  await writeJsonAtomic(target, { root });
};

// impure — applies a persisted root override at boot; returns the active root.
// NEUMA_REALM_ROOT is the launch-scoped isolation door (the realm's own
// WORKSPACES_ROOT): a sitting or test rig points the realm at its temp dir
// so throwaway walks never write into the witness's real realm. It wins
// over the persisted choice because it is a per-launch operator decision.
//
// Ghost-root doctrine (mirrors the workspace root's law): a persisted root
// under the OS temp dir is never a durable home, so it is treated as no
// choice at all — boot falls back to the default, loudly, rather than
// stranding the realm on a path a reboot can sweep (observed 2026-07-20:
// a scratch /tmp realm root persisted by a test rig hid the witness's
// whole realm). A missing NON-temp root may be an unmounted drive: keep
// the choice (falling back would fork the witness's data across two
// homes) and scream in the log instead.
export const applyRealmSettings = async () => {
  if (process.env.NEUMA_REALM_ROOT) {
    setRealmRoot(process.env.NEUMA_REALM_ROOT);
    return { root: getRealmRoot() };
  }
  const settings = await loadRealmSettings();
  if (settings.root && !isTempPath(settings.root)) {
    const exists = await fs.access(settings.root).then(() => true, () => false);
    if (!exists) {
      log.error('Persisted realm root is missing (unmounted drive?) — keeping the choice; the realm is unreachable until it returns', {
        root: settings.root,
      });
    }
    setRealmRoot(settings.root);
  } else if (settings.root) {
    log.error('Persisted realm root is under the OS temp dir — never a durable home; falling back to the default realm', {
      ghost: settings.root,
      fallback: getRealmRoot(),
    });
  }
  return { root: getRealmRoot() };
};
