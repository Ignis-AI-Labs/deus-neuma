// Chain access — the operator's master switch for being chain reads.
//
// Persisted at data/settings/chain-access.json so the choice survives restarts.
// A fresh install defaults ON: reading public chain state through the
// operator's own keyed RPC is a base capability, not a hidden feature a
// newborn must know to ask for. Persisted OFF remains OFF.
// NEUMA_CHAIN_ACCESS=0 is the operator's hard kill — it wins over both the
// fresh-install default and a persisted ON, so an air-gap launch cannot be
// undone at runtime.
//
// Factory shape (attachment-store pattern): the default instance reads the
// real path; tests create their own against tmp files — real disk either way.

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { getSettingsDir } from '../data-root.js';

// Resolved PER CALL, not at import: NEUMA_CHAIN_ACCESS_PATH is this module's
// isolation door, the same law as NEUMA_WEB_ACCESS_PATH. An explicit `path`
// argument still wins over both — the factory shape mirrors web-settings.js.
const defaultPath = (env) =>
  env.NEUMA_CHAIN_ACCESS_PATH || join(getSettingsDir(), 'chain-access.json');

/**
 * @param {{ path?: string, env?: Record<string,string|undefined> }} [opts]
 */
export const createChainSettings = ({ path, env = process.env } = {}) => ({
  /**
   * Is chain reading available to beings right now? impure (fs + env).
   * @returns {Promise<boolean>}
   */
  async isEnabled() {
    if (String(env.NEUMA_CHAIN_ACCESS || '') === '0') return false; // operator kill-switch
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
  isEnvLocked: () => String(env.NEUMA_CHAIN_ACCESS || '') === '0',

  /**
   * Persist the operator's choice. impure. Atomic (tmp + rename): a crash
   * mid-write must never leave a torn switch file to read as fail-closed
   * corruption on the next boot.
   * @param {boolean} enabled
   */
  async setEnabled(enabled) {
    const target = path || defaultPath(env);
    await fs.mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify({ enabled: enabled === true }, null, 2)}\n`);
    await fs.rename(tmp, target);
  },
});

// The one instance the routes and the portal share.
export const chainSettings = createChainSettings();
