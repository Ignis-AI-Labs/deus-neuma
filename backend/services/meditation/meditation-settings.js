// MEDITATION SETTINGS — per-being consent to the sleep/dream cycle, as a
// thing the operator can SEE and SET (the standby-settings law: autonomous
// behavior must be visible and reversible from where the operator stands).
//
// Default OFF per being (Founder-signed decision #3, 2026-08-14): a being
// meditates only after the operator enables it from the desk. The operator's
// consent surface lives in data/settings/ — platform policy, never inside the
// being's sovereign workspace.
//
// Precedence (the ONE place the rule lives):
//   NEUMA_MEDITATION=0  → OFF machine-wide, and LOCKED. A launch-time policy
//                          is not overridable from the desk (web-settings law).
//   persisted per-being → only an explicit `enabled: true` turns a lane on; a
//                          torn or partial record rests OFF (the conservative
//                          posture — opposite polarity to standby, by design).
//
// Factory shape (standby pattern): the default instance reads the real path;
// tests create their own against tmp files — real disk either way.

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { getSettingsDir } from '../data-root.js';
import { createLogger } from '../logger.js';

const log = createLogger('MeditationSettings');

const DEFAULT_PATH = join(getSettingsDir(), 'meditation.json');

/** A being distilling its days — one cycle per day unless the operator says otherwise. */
export const DEFAULT_CADENCE_HOURS = 24;

/**
 * Pure — the meditation posture a persisted record and the env resolve to.
 * @param {{defaults?: Object, beings?: Object}|null} record
 * @param {string|undefined} envFlag - raw NEUMA_MEDITATION value
 * @returns {{envLocked: boolean, defaults: {cadenceHours: number}, beings: Object}}
 */
export const resolveMeditation = (record, envFlag) => {
  const envLocked = envFlag === '0';
  const defaults = {
    cadenceHours: posInt(record?.defaults?.cadenceHours, DEFAULT_CADENCE_HOURS),
  };
  const beings = {};
  const raw = record?.beings && typeof record.beings === 'object' ? record.beings : {};
  for (const [laneId, entry] of Object.entries(raw)) {
    beings[laneId] = {
      // Only an explicit true enables — the cycle is consented per being.
      enabled: !envLocked && entry?.enabled === true,
      cadenceHours: posInt(entry?.cadenceHours, defaults.cadenceHours),
    };
  }
  return { envLocked, defaults, beings };
};

// pure
const posInt = (value, fallback) => (Number.isInteger(value) && value > 0 ? value : fallback);

/**
 * @param {{ path?: string, envFlag?: () => string|undefined }} [opts]
 */
export const createMeditationSettings = ({
  path = DEFAULT_PATH,
  envFlag = () => process.env.NEUMA_MEDITATION,
} = {}) => ({
  /** The live posture. impure (fs); an absent/unreadable file = default posture. */
  async read() {
    let record = null;
    try {
      record = JSON.parse(await fs.readFile(path, 'utf8'));
    } catch { /* absent or unreadable — everything rests OFF */ }
    return resolveMeditation(record, envFlag());
  },

  /** One lane's posture. impure. */
  async forBeing(laneId) {
    const { envLocked, defaults, beings } = await this.read();
    const entry = beings[laneId];
    return {
      enabled: entry?.enabled === true,
      cadenceHours: entry?.cadenceHours ?? defaults.cadenceHours,
      envLocked,
    };
  },

  /**
   * Persist the operator's choice for one lane. Refuses under the env lock —
   * a switch that appears to move and does nothing is worse than an error.
   * impure; the flip is logged with the wallet (web-access pattern).
   * @param {string} laneId
   * @param {{enabled?: boolean, cadenceHours?: number}} choice
   * @param {{wallet?: string}} [ctx]
   */
  async setBeing(laneId, choice, { wallet = null } = {}) {
    if (typeof laneId !== 'string' || !laneId) throw new Error('meditation settings: laneId required');
    const current = await this.read();
    if (current.envLocked) {
      throw new Error('Meditation is held off by NEUMA_MEDITATION=0 — change it at launch, not here');
    }
    let record;
    try {
      record = JSON.parse(await fs.readFile(path, 'utf8'));
    } catch { record = null; }
    const beings = record?.beings && typeof record.beings === 'object' ? record.beings : {};
    const prior = beings[laneId] || {};
    beings[laneId] = {
      enabled: choice?.enabled === true,
      cadenceHours: posInt(choice?.cadenceHours, posInt(prior.cadenceHours, current.defaults.cadenceHours)),
    };
    const next = { defaults: record?.defaults || {}, beings };
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, path);
    log.info('meditation setting changed', { laneId, ...beings[laneId], wallet });
    return this.forBeing(laneId);
  },
});

/** The one instance the scheduler and the routes share. */
export const meditationSettings = createMeditationSettings({
  path: process.env.NEUMA_MEDITATION_SETTINGS_PATH || DEFAULT_PATH,
});
