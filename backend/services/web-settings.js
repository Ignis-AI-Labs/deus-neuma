// Web access — the operator's master switch for being internet egress.
//
// Persisted at data/settings/web-access.json so the choice survives restarts.
// A fresh install defaults ON: internet research is a base capability, not a
// hidden feature a newborn must know to ask for. Persisted OFF remains OFF.
// NEUMA_WEB_ACCESS=0 is the operator's hard kill — it wins over both the
// fresh-install default and a persisted ON, so an air-gap launch cannot be
// undone at runtime.
//
// Factory shape (attachment-store pattern): the default instance reads the
// real path; tests create their own against tmp files — real disk either way.

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { getSettingsDir } from './data-root.js';

// Resolved PER CALL, not at import: NEUMA_WEB_ACCESS_PATH is this module's
// isolation door, the same law as NEUMA_REALM_SETTINGS_PATH and
// NEUMA_FILES_SETTINGS_PATH. As an import-time const the door was boot-only,
// so the one suite that needed it had to reach for a module mock to repoint
// the shared instance (#390 tranche 3). An explicit `path` argument still
// wins over both — the factory shape is unchanged for existing callers.
const defaultPath = (env) =>
  env.NEUMA_WEB_ACCESS_PATH || join(getSettingsDir(), 'web-access.json');

/**
 * @param {{ path?: string, env?: Record<string,string|undefined> }} [opts]
 */
export const createWebSettings = ({ path, env = process.env } = {}) => ({
  /**
   * Is web egress available to beings right now? impure (fs + env).
   * @returns {Promise<boolean>}
   */
  async isEnabled() {
    if (String(env.NEUMA_WEB_ACCESS || '') === '0') return false; // operator kill-switch
    try {
      const parsed = JSON.parse(await fs.readFile(path || defaultPath(env), 'utf8'));
      return parsed.enabled === true;
    } catch (error) {
      // No choice yet is the fresh-install state. Any other read failure stays
      // fail-closed: corrupt or unreadable policy must never invent consent.
      return error?.code === 'ENOENT';
    }
  },

  /**
   * Is the operator's env kill-switch holding the switch OFF regardless of
   * the persisted choice? Pure read of the injected env.
   * @returns {boolean}
   */
  isEnvLocked: () => String(env.NEUMA_WEB_ACCESS || '') === '0',

  /**
   * Persist the operator's choice. impure.
   * @param {boolean} enabled
   */
  async setEnabled(enabled) {
    const target = path || defaultPath(env);
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify({ enabled: enabled === true }, null, 2)}\n`);
  },
});

// The one instance the routes and the portal share.
export const webSettings = createWebSettings();
