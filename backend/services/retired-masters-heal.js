// The heal — once the retired masters are admitted (retired-masters-boot.js),
// whatever in the realm still sits under one is sealed again under this desk's
// master, by the re-key's own engine (rekey-house.js resealTree: write, open it
// back, never a file no key here opens). It runs at start, before the desk
// serves, and once per keyring state: a marker in the data root holds a
// fingerprint of (current master, retired masters), so an ordinary start never
// walks the realm. After it, the keyring is a safety net, not a dependency.
//
// impure — the realm tree, the data root, crypto, one log line (counts only).

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { deriveKeyFromSecret } from '../../core/workspace/workspace-crypto.js';
import { masterCandidates, resealTree } from '../../core/workspace/rekey-house.js';
import { readRetiredMasters, retiredMastersPath } from '../../core/workspace/retired-masters.js';
import { getDataRoot } from './data-root.js';
import { getRealmRoot } from './user-realm.js';
import { createLogger } from './logger.js';

const log = createLogger('RetiredMasters.Heal');
const MARKER = '.retired-masters-healed';
// A locked keys file kept aside by an unlock or a fresh start stays byte for byte what it was.
const KEPT_ASIDE = /\.locked-[0-9TZ-]+\.json$|\.v1(\.\d+)?\.json$/;

// pure — which (current master, retired masters) state a heal answered for; no key is recoverable from it
const stateOf = (current, retired) => crypto.createHash('sha256').update(`healed:${current}:${retired.join(',')}`).digest('hex').slice(0, 32);

/**
 * @param {{roots?: string[], dataRoot?: string, currentSecret?: string}} [opts]
 * @returns {Promise<{healed: boolean, moved: number, left: number, why?: string}>} never throws
 */
export const healStrandedStores = async ({ roots = [getRealmRoot()], dataRoot = getDataRoot(), currentSecret = process.env.DNA_ENCRYPTION_KEY } = {}) => {
  try {
    const retired = currentSecret ? readRetiredMasters(retiredMastersPath(dataRoot), [currentSecret]) : [];
    if (!retired.length) return { healed: false, moved: 0, left: 0, why: 'no retired master' };
    const marker = path.join(dataRoot, MARKER);
    const state = stateOf(currentSecret, retired);
    if ((await fs.readFile(marker, 'utf8').catch(() => '')) === state) return { healed: false, moved: 0, left: 0, why: 'already healed' };
    const tally = { moved: 0, left: 0 };
    for (const root of roots) {
      const t = await resealTree(root, masterCandidates(retired), deriveKeyFromSecret(currentSecret), { dryRun: false, skip: (f) => KEPT_ASIDE.test(f) });
      tally.moved += t.moved;
      tally.left += t.unreadable.length;
    }
    await fs.writeFile(marker, state, { mode: 0o600 });
    log.info('stores an earlier re-key left under a retired master are sealed under this desk\'s master', { ...tally, roots: roots.length });
    return { healed: true, ...tally };
  } catch (err) {
    log.error('the heal of stores under a retired master did not finish — they still open through the keyring; the next start tries again', { error: err.message });
    return { healed: false, moved: 0, left: 0, why: err.message };
  }
};
