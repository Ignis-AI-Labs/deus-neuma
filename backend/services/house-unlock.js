// house-unlock — open a house's realm stores again after a master-key change
// that left them sealed under the old key (account-store.js ACCOUNTS_LOCKED).
// The re-key (scripts/rekey-house.mjs) moved every being to the new master,
// but not the realm stores — the social keys file among them — and then
// dropped the old key: every platform locked, every post held (2026-10-26).
//
// The operator gives the old key once: pasted in the desk (POST
// /social-channels/accounts/unlock), or read by their own run of
// scripts/unlock-house-keys.mjs. It is used for this run only and never
// stored, logged or echoed.
//
//   1. PROOF — the old key must open the house's keys file; a key that does
//      not changes nothing ([…]).
//   2. KEEP — the locked file's exact bytes stay beside it, read-only
//      (social-channel-credentials.locked-<time>.json).
//   3. RE-SEAL — every sealed file in the house's realm folder the old key
//      opens is sealed again under this desk's key, by the re-key's own
//      engine (rekey-house.js resealTree: back up, write, open it back,
//      roll back on any doubt). A file already under this desk's key, or
//      under neither key, is left exactly as it is.
//   4. CHECK — the keys file opens with this desk's key.
//
// START FRESH (startFreshKeys) is the other way out, when the old key is gone
// for good: the locked file steps aside — kept read-only under the same
// .locked-<time> name, should the old key ever turn up — and the house's
// keys file starts empty, so every platform's keys are pasted again. Account
// ids start over (x-1, tiktok-1…), so queued posts and holders, which name
// those ids, meet their accounts again once re-added.
//
// impure — the house's realm folder, crypto, one log line (names and counts, never a key).

import fs from 'fs/promises';
import { decryptEnvelope, deriveKeyFromSecret } from '../../core/workspace/workspace-crypto.js';
import { masterCandidates, resealTree } from '../../core/workspace/rekey-house.js';
import { walletDir } from './user-realm.js';
import { houseKey } from './staff/cos-designation.js';
import { channelCredentialsPath, loadAccountStore } from './social/account-store.js';
import { createLogger } from './logger.js';

const log = createLogger('HouseUnlock');
const KEPT = /\.locked-[0-9TZ-]+\.json$/;

// pure — where a locked file's exact bytes are kept, beside it.
const keptName = (file, now) => file.replace(/\.json$/, `.locked-${now.toISOString().replace(/[:.]/g, '-')}.json`);

// pure — does this key open this envelope?
const opens = (envelope, key) => {
  try { decryptEnvelope(envelope, { key }); return true; } catch { return false; }
};

/**
 * @param {string} wallet - the house
 * @param {string} oldSecret - the master the stores were sealed under
 * @param {{currentSecret?: string, now?: Date}} [opts] - this desk's master (its env by default)
 * @returns {Promise<{ok: true, already?: boolean, moved: number, left: number, kept?: string} | {ok: false, error: string}>}
 */
export const unlockHouseStores = async (wallet, oldSecret, { currentSecret = process.env.DNA_ENCRYPTION_KEY, now = new Date() } = {}) => {
  const secret = typeof oldSecret === 'string' ? oldSecret.trim() : '';
  if (!secret) return { ok: false, error: 'paste the key the keys file was sealed with' };
  if (!houseKey(wallet)) return { ok: false, error: 'an unlock needs the house\'s wallet' };
  if (!currentSecret) return { ok: false, error: 'this desk holds no key of its own to seal with' };
  const file = channelCredentialsPath(wallet);
  const raw = await fs.readFile(file, 'utf8').catch((err) => (err.code === 'ENOENT' ? null : Promise.reject(err)));
  if (raw === null) return { ok: false, error: 'this house has no keys file to unlock' };
  let envelope;
  try { envelope = JSON.parse(raw); } catch { return { ok: false, error: 'the keys file is damaged — no key opens it; nothing was changed' }; }
  const current = deriveKeyFromSecret(currentSecret);
  if (opens(envelope, current)) return { ok: true, already: true, moved: 0, left: 0 };
  if (!opens(envelope, deriveKeyFromSecret(secret))) {
    return { ok: false, error: 'that key doesn\'t open the keys file — nothing was changed' };
  }

  const kept = keptName(file, now);
  await fs.writeFile(kept, raw, { mode: 0o600, flag: 'wx' });
  await fs.chmod(kept, 0o400);
  const tally = await resealTree(walletDir(houseKey(wallet)), masterCandidates([secret]), current, {
    dryRun: false, skip: (f) => KEPT.test(f),
  });
  await fs.chmod(file, 0o600);
  await loadAccountStore(wallet);
  log.info('the house\'s stores were sealed again under this desk\'s key', {
    house: houseKey(wallet), moved: tally.moved, already: tally.already, left: tally.unreadable.length, kept,
  });
  return { ok: true, moved: tally.moved, left: tally.unreadable.length, kept };
};

/**
 * The locked keys file steps aside, kept read-only; the house's keys start empty. Refused when the file
 * opens with this desk's key (nothing is locked) or there is none. impure.
 * @param {string} wallet
 * @returns {Promise<{ok: true, kept: string} | {ok: false, error: string}>}
 */
export const startFreshKeys = async (wallet, { currentSecret = process.env.DNA_ENCRYPTION_KEY, now = new Date() } = {}) => {
  if (!houseKey(wallet)) return { ok: false, error: 'a fresh start needs the house\'s wallet' };
  const file = channelCredentialsPath(wallet);
  const raw = await fs.readFile(file, 'utf8').catch((err) => (err.code === 'ENOENT' ? null : Promise.reject(err)));
  if (raw === null) return { ok: false, error: 'this house has no keys file — paste the keys in Channel keys' };
  let envelope = null;
  try { envelope = JSON.parse(raw); } catch { /* damaged: it steps aside too */ }
  if (envelope && currentSecret && opens(envelope, deriveKeyFromSecret(currentSecret))) {
    return { ok: false, error: 'the keys file opens with this desk\'s key — nothing is locked' };
  }
  const kept = keptName(file, now);
  await fs.rename(file, kept);
  await fs.chmod(kept, 0o400);
  log.info('the house\'s locked keys file stepped aside; its keys start empty', { house: houseKey(wallet), kept });
  return { ok: true, kept };
};
