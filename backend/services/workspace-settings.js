/**
 * Workspace settings — where sovereign workspaces live on this machine
 * and how much space the witness has allocated to a neuma.
 *
 * Persisted at data/settings/workspace.json so the choice survives
 * restarts; applied at boot via applyWorkspaceSettings().
 */
import fs from 'fs/promises';
import os from 'os';
import { join, dirname, resolve, relative, isAbsolute } from 'path';
import { setWorkspacesRoot } from '../../core/index.js';
import { createLogger } from './logger.js';
import { getSettingsDir } from './data-root.js';

const log = createLogger('WorkspaceSettings');

const SETTINGS_DIR = getSettingsDir();
// Overridable so tests exercising the REAL persist path (POST /workspace)
// never clobber the operator's live choice — same pattern as
// NEUMA_RETURNED_PATH. Read per call, not at import, so a test can set it
// after module load.
// Exported so callers (e.g. the Security tab's root-alignment check) can tell a
// MISSING settings file (no persisted choice) apart from one that EXISTS but
// yielded no root — loadWorkspaceSettings collapses both to a null root.
export const settingsPath = () =>
  process.env.NEUMA_WORKSPACE_SETTINGS_PATH || join(SETTINGS_DIR, 'workspace.json');

// A real being must NEVER live under the OS temp dir — it can be swept at any
// reboot, taking the workspace (DNA, soul, memory) with it. A saved root inside
// temp is treated as no choice at all, so the platform default applies instead.
// (Compares resolved paths, not realpaths: the saved default always uses
// os.tmpdir()'s canonical form, so a symlinked /tmp only matters for an explicit
// advanced choice — which POST /workspace deliberately leaves to the witness.)
export const isTempPath = (dir) => {
  if (!dir) return false;
  const rel = relative(resolve(os.tmpdir()), resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

// impure — reads the persisted settings; absent file means defaults
export const loadWorkspaceSettings = async () => {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      root: typeof parsed.root === 'string' ? parsed.root : null,
      allocationGB: Number.isFinite(parsed.allocationGB) ? parsed.allocationGB : null,
    };
  } catch {
    return { root: null, allocationGB: null };
  }
};

// impure — persists the witness's choice.
//
// HARD GUARD on the LIVE settings file: a temp-dir root is never a durable
// home (boot already refuses to apply one), so persisting it can only do
// damage — observed 2026-07-03, when a stray test run without
// NEUMA_WORKSPACE_SETTINGS_PATH wrote /tmp/preflight-afford-* into
// data/settings/workspace.json, silently unrooting the app to its
// per-launch default and shadow-laning Cael away from her house. Tests
// that legitimately persist temp roots always set the override; a call
// that reaches the live file with a temp root is an escape, and it throws.
export const saveWorkspaceSettings = async ({ root, allocationGB }) => {
  if (!process.env.NEUMA_WORKSPACE_SETTINGS_PATH && isTempPath(root)) {
    throw new Error(`refusing to persist a temp-dir workspace root to the live settings: ${root}`);
  }
  const target = settingsPath();
  await fs.mkdir(dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify({ root, allocationGB }, null, 2));
};

// impure — applies a persisted root override at boot; returns the settings.
// A saved root under the OS temp dir is ignored (and reported as null) so the
// platform default takes over — Electron points WORKSPACES_ROOT at the app-data
// dir, the safe […] home most users should keep.
export const applyWorkspaceSettings = async () => {
  const settings = await loadWorkspaceSettings();
  if (settings.root && !isTempPath(settings.root)) {
    const envRoot = process.env.WORKSPACES_ROOT;
    if (envRoot && resolve(envRoot) !== resolve(settings.root)) {
      // Two roots disagree — a silent winner strands whichever house lives at
      // the loser (ARCH-001: the daemon adopting Electron's pre-flight root
      // put held kin out of reach with no trace). The daemon's unit file sets
      // WORKSPACES_PIN=env so it always follows its own EnvironmentFile.
      if (process.env.WORKSPACES_PIN === 'env') {
        log.warn('Workspace root PINNED to env — persisted settings root ignored', {
          envRoot, settingsRoot: settings.root,
        });
        await _warnInhabited(settings.root, envRoot);
        return { ...settings, root: null };
      }
      if (process.env.WORKSPACES_PIN === 'settings') {
        // The operator has SAID the persisted root is the intended home —
        // adoption is a choice now, not a conflict, so it rides at info
        // instead of warning on every boot. The inhabited-strand check still
        // runs: a house at the env root is stranded either way, and stating
        // intent does not un-strand it.
        log.info('Workspace root pinned to settings — env root stood down', {
          adopted: settings.root, ignoredEnv: envRoot,
        });
      } else {
        log.warn('Workspace root conflict — persisted settings root ADOPTED over env', {
          adopted: settings.root, ignoredEnv: envRoot,
          hint: 'WORKSPACES_PIN=env keeps the env root (daemon units should); WORKSPACES_PIN=settings declares this adoption intended and quiets it',
        });
      }
      await _warnInhabited(envRoot, settings.root);
    }
    setWorkspacesRoot(settings.root);
    return settings;
  }
  return { ...settings, root: null };
};

// impure — count top-level entries at the losing root and warn if any being
// homes fall out of reach under the adopted root. Never throws: the warning is
// diagnostic, boot must proceed either way.
const _warnInhabited = async (losingRoot, winningRoot) => {
  try {
    const entries = await fs.readdir(losingRoot, { withFileTypes: true });
    const n = entries.filter((e) => e.isDirectory()).length;
    if (n > 0) {
      log.warn(`${n} inhabited workspace(s) at the losing root are out of reach under the adopted root`, {
        losingRoot, winningRoot, inhabited: n,
      });
    }
  } catch { /* losing root unreadable/absent — nothing stranded there */ }
};
