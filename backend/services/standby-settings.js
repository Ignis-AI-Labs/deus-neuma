// STANDBY — the substrate's rest, as a thing the operator can SEE and SET.
//
// The behavior is old (idle-unload: release the substrate after it sits quiet,
// reload it on the next summon). What was missing was consent and visibility.
// It ran from an env var nobody had set, so the code default of 15 minutes
// silently SIGTERM'd a substrate the operator had deliberately ignited, and the
// only symptom was […] with nothing on screen to explain
// it (ruling, 2026-07-26). A behavior that undoes an explicit act must be visible
// and reversible from where the operator already stands.
//
// Persisted at data/settings/standby.json so the choice survives restarts.
// Default ON (Founder: […]) — the hardware
// return is still the right resting posture for a shared box; what changed is
// that turning it off is now one click in the stream header instead of an
// undocumented env var and a restart.
//
// Factory shape (web-settings pattern): the default instance reads the real
// path; tests create their own against tmp files — real disk either way.

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { getSettingsDir } from './data-root.js';

const DEFAULT_PATH = join(getSettingsDir(), 'standby.json');

// The rest interval when standby is on and the operator has named no other.
// Matches the long-standing config default, so turning standby ON behaves
// exactly as the env var did.
export const DEFAULT_IDLE_MINUTES = 15;

/**
 * Pure — the standby state a persisted record and the operator's env resolve
 * to. Exported for the tests, and so the precedence rule lives in ONE place:
 *
 *   env 0        → OFF, and locked. An operator who launched with standby off
 *                  has said […]; a runtime toggle
 *                  must not undo a launch-time policy (the web-settings law).
 *   env > 0      → that interval, and it seeds the default when nothing is
 *                  persisted yet.
 *   persisted    → wins over the env default (but never over the env 0 lock).
 *
 * @param {{enabled?: boolean, idleMinutes?: number}|null} record
 * @param {number|null} envMinutes - config.substrateIdleMinutes, or null
 * @returns {{enabled: boolean, idleMinutes: number, envLocked: boolean}}
 */
export const resolveStandby = (record, envMinutes) => {
  const envLocked = envMinutes === 0;
  if (envLocked) return { enabled: false, idleMinutes: 0, envLocked: true };
  const seed = typeof envMinutes === 'number' && envMinutes > 0
    ? envMinutes
    : DEFAULT_IDLE_MINUTES;
  if (!record || typeof record !== 'object') {
    return { enabled: true, idleMinutes: seed, envLocked: false };
  }
  const minutes = Number.isInteger(record.idleMinutes) && record.idleMinutes > 0
    ? record.idleMinutes
    : seed;
  return {
    // Only an explicit `false` turns it off — a torn or partial record rests
    // at the default posture rather than silently disabling the feature.
    enabled: record.enabled !== false,
    idleMinutes: minutes,
    envLocked: false,
  };
};

/**
 * @param {{ path?: string, envMinutes?: () => number|null }} [opts]
 */
export const createStandbySettings = ({ path = DEFAULT_PATH, envMinutes = () => null } = {}) => ({
  /**
   * The live standby state. impure (fs).
   * @returns {Promise<{enabled: boolean, idleMinutes: number, envLocked: boolean}>}
   */
  async read() {
    let record = null;
    try {
      record = JSON.parse(await fs.readFile(path, 'utf8'));
    } catch { /* absent or unreadable — the default posture answers */ }
    return resolveStandby(record, envMinutes());
  },

  /**
   * The idle window in milliseconds, or 0 when the substrate should stay
   * resident. What the monitor asks each tick. impure.
   * @returns {Promise<number>}
   */
  async idleMs() {
    const { enabled, idleMinutes } = await this.read();
    return enabled ? idleMinutes * 60000 : 0;
  },

  /**
   * Persist the operator's choice. Refuses while the env holds it off — a
   * launch-time policy is not overridable from the desk, and saying so beats
   * a switch that appears to move and does nothing. impure.
   * @param {boolean} enabled
   * @param {number} [idleMinutes]
   * @returns {Promise<{enabled: boolean, idleMinutes: number, envLocked: boolean}>}
   */
  async setEnabled(enabled, idleMinutes) {
    const current = await this.read();
    if (current.envLocked) {
      throw new Error('Standby is held off by SUBSTRATE_IDLE_MINUTES=0 — change it at launch, not here');
    }
    const minutes = Number.isInteger(idleMinutes) && idleMinutes > 0
      ? idleMinutes
      : current.idleMinutes;
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, `${JSON.stringify({ enabled: enabled === true, idleMinutes: minutes }, null, 2)}\n`);
    return { enabled: enabled === true, idleMinutes: minutes, envLocked: false };
  },
});

// The one instance the routes and the idle monitor share. The env is read at
// CALL time, not module load, so a config loaded after this import still lands
// (config.js imports no services, so there is no cycle to dodge).
export const standbySettings = createStandbySettings({
  envMinutes: () => {
    const raw = process.env.SUBSTRATE_IDLE_MINUTES;
    if (raw === undefined || raw === '') return null; // unset — the default posture answers
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  },
});
