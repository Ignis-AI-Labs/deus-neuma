/**
 * The run gates' reach — is there a mind to run on right now?
 *
 * The house model the standby monitor put to rest (substrate-idle.js) is
 * ASLEEP, not offline: every turn wakes it (wakeHouseServing). A gate that
 * only asked testConnection refused a team run, a trial, a capacity scan and
 * the birth flight check as "offline" during ordinary standby. The gate wakes
 * it the same way a turn would, then asks again. Every other down-state keeps
 * offline's honest meaning. Impure.
 */
import { getConfig, testConnection, wakeHouseServing } from './llm-provider.js';
import { deliberateStandby } from './substrate-idle.js';
import { createLogger } from './logger.js';

const log = createLogger('SubstrateReach');

/**
 * Does the configured substrate answer — after waking a resting house model?
 * @returns {Promise<boolean>}
 */
export const reachSubstrate = async () => {
  if (await testConnection()) return true;
  if (!deliberateStandby().standby) return false;
  try {
    if (!(await wakeHouseServing(getConfig()))) return false;
  } catch (err) {
    log.warn('the resting house model did not wake for the gate', { err: err.message });
    return false;
  }
  return testConnection();
};
