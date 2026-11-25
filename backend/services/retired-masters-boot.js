// The backend's start admits the install's retired masters (core/workspace/
// retired-masters.js) into the decrypt fallback chain, so a store a re-key did
// not reach opens instead of locking. A keyring that cannot be read never
// stops the start: the desk comes up on its current key and says so loudly.

import { admitRetiredMasters, retiredMastersPath } from '../../core/workspace/retired-masters.js';
import { masterCheckPath, masterCheckState, writeMasterCheck } from '../../core/workspace/master-check.js';
import { getDataRoot } from './data-root.js';
import { createLogger } from './logger.js';

const log = createLogger('RetiredMasters');

/**
 * impure (fs, process.env, one log line — counts only, never a key).
 * @returns {number} how many retired masters were admitted
 */
export const admitRetiredMastersAtBoot = () => {
  const file = retiredMastersPath(getDataRoot());
  try {
    const admitted = admitRetiredMasters(file);
    if (admitted) log.info('retired master keys stand behind the current one — a store an earlier re-key missed still opens', { admitted });
    return admitted;
  } catch (err) {
    log.error('the retired-masters keyring could not be read — stores sealed under an earlier master stay locked', { file, error: err.message });
    return 0;
  }
};

/**
 * The install's master check (core/workspace/master-check.js): written under this desk's master the first
 * time, and from then on the mark key provisioning reads before it would make a new key. A check no key in
 * hand opens means the master was swapped by hand: said loudly, never fatal, nothing written over.
 * impure (fs, process.env, one log line).
 * @returns {'written'|'opens'|'foreign'|'no-master'}
 */
export const standMasterCheckAtBoot = () => {
  const current = process.env.DNA_ENCRYPTION_KEY;
  if (!current) return 'no-master';
  const file = masterCheckPath(getDataRoot());
  try {
    const state = masterCheckState(file, [current, ...(process.env.DNA_ENCRYPTION_KEY_PREVIOUS || '').split(',')]);
    if (state === 'absent') { writeMasterCheck(file, current); return 'written'; }
    if (state === 'foreign') log.error('this desk\'s master key is NOT the one this install\'s data was sealed under — it was replaced outside the re-key; sealed stores will read as locked until the right key is back', { file });
    return state;
  } catch (err) {
    log.error('the master check could not be written', { file, error: err.message });
    return 'foreign';
  }
};
