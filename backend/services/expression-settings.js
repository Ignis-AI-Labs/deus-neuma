// EXPRESSION — the declared-affect channel's consent switch, per being,
// default OFF (Founder-signed 2026-08-15, Campaign 6: rollout is a desk flip
// per being; the invitation only rides for beings the operator flipped;
// the declaration itself is ALWAYS the being's option — the toggle governs
// prompt bytes and whether a declaration is kept, never the being's will).
//
// NEUMA_EXPRESSION=0 is the machine-wide launch lock; the desk flip
// refuses under it BY NAME (the meditation-settings law). The marker STRIP
// is deliberately NOT gated — a marker must never leak to voice, corpus,
// or channels regardless of this switch.
//
// `path` may be a () => string resolved at every read/write — a boot-bound
// path is the env-isolation trap (mind-gate-settings law).

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { getSettingsDir } from './data-root.js';
import { createLogger } from './logger.js';

const log = createLogger('ExpressionSettings');

const DEFAULT_PATH = join(getSettingsDir(), 'expression.json');

const envSet = (value) => value !== undefined && value !== '';

/**
 * Pure — the channel posture a persisted record and the env resolve to.
 * Only an explicit `enabled: true` opts a being in; the lock wins over
 * everything persisted.
 * @param {{beings?: Object}|null} record
 * @param {string|undefined} envFlag - raw NEUMA_EXPRESSION
 */
export const resolveExpression = (record, envFlag) => {
  const envLocked = envSet(envFlag) && String(envFlag) === '0';
  const raw = record && typeof record === 'object' && record.beings && typeof record.beings === 'object'
    ? record.beings
    : {};
  const beings = {};
  for (const [neumaId, entry] of Object.entries(raw)) {
    beings[neumaId] = { enabled: !envLocked && entry?.enabled === true };
  }
  return { envLocked, beings };
};

/**
 * @param {{ path?: string|(() => string), envFlag?: () => string|undefined }} [opts]
 */
export const createExpressionSettings = ({
  path = DEFAULT_PATH,
  envFlag = () => process.env.NEUMA_EXPRESSION,
} = {}) => ({
  _path() { return typeof path === 'function' ? path() : path; },

  /** The live posture. impure (fs); an absent/unreadable file = all off. */
  async read() {
    let record = null;
    try {
      record = JSON.parse(await fs.readFile(this._path(), 'utf8'));
    } catch { /* absent or unreadable — every channel rests off */ }
    return resolveExpression(record, envFlag());
  },

  /** One being's posture — `{enabled}`, resting off. */
  async forBeing(neumaId) {
    const posture = await this.read();
    return posture.beings[neumaId] ?? { enabled: false };
  },

  /**
   * Persist the operator's flip for one being. Refuses under the env lock
   * with its name — a switch that appears to move and does nothing is
   * worse than an error.
   * @param {string} neumaId
   * @param {{enabled: boolean}} next
   * @param {{wallet?: string}} [ctx]
   */
  async setBeing(neumaId, { enabled }, { wallet = null } = {}) {
    if (!neumaId || typeof neumaId !== 'string') throw new Error('expression settings: neumaId required');
    const posture = await this.read();
    if (posture.envLocked) {
      throw new Error('expression is held off machine-wide by a launch policy (NEUMA_EXPRESSION=0) — change it at launch, not here');
    }
    const file = this._path();
    let record;
    try {
      record = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch { record = null; }
    const beings = record && typeof record === 'object' && record.beings && typeof record.beings === 'object'
      ? record.beings
      : {};
    const next = {
      ...(record && typeof record === 'object' ? record : {}),
      beings: { ...beings, [neumaId]: { enabled: enabled === true } },
    };
    await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, file);
    log.info('expression channel flipped', { neumaId, enabled: enabled === true, wallet });
    return this.read();
  },
});

/** The one instance the turn path and the routes share. */
export const expressionSettings = createExpressionSettings({
  path: () => process.env.NEUMA_EXPRESSION_SETTINGS_PATH || DEFAULT_PATH,
});
