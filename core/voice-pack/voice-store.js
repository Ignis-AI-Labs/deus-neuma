/**
 * The voice store — impure IO for the sovereign voice repository, standing on
 * the workspace's own DEK-aware envelope primitives (the satellite-store
 * pattern: core/birth/birth-state.js, core/workspace/refinement-history-store.js).
 *
 * On disk per lane:
 *   voice/pack.jsonl  — the repository; one encrypted envelope per line,
 *                       append-only BY LAW (no update, no delete, no eviction)
 *   voice/seal.json   — the first-seal receipt; write-once BY LAW
 *
 * Both files ride the lane's per-neuma DEK through the workspace's _appendJSONL
 * / _readJSONL / _writeJSON / _readJSON, so the repository sits in the same
 * custody as DNA, sessions, and journal — never a sidecar.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  validateVoiceEntry,
  validateVoicePack,
  validateVoiceSeal,
  voicePackSha256,
  voiceTextSha256,
  VOICE_SEAL_SCHEMA,
} from './pack.js';

const packPath = (workspace, neumaId) =>
  path.join(workspace._path(neumaId), 'voice', 'pack.jsonl');
const sealPath = (workspace, neumaId) =>
  path.join(workspace._path(neumaId), 'voice', 'seal.json');

/**
 * Stamp and append one repository entry. The stamp (id, sealedAt, textSha256)
 * spreads LAST — the appendTake law: caller-supplied stamp fields are
 * overwritten, never trusted. Impure (random id, clock, encrypted append).
 * @param {object} workspace - the NeumaWorkspace singleton (or any object with _path/_appendJSONL)
 * @param {string} neumaId - the lane
 * @param {object} entry - {text, origin, source, signals?}
 * @returns {Promise<object>} the stamped, validated entry
 */
export const appendVoiceEntry = async (workspace, neumaId, entry) => {
  const stamped = validateVoiceEntry({
    ...entry,
    id: crypto.randomBytes(8).toString('hex'),
    sealedAt: new Date().toISOString(),
    textSha256: voiceTextSha256(entry?.text),
  });
  await workspace._appendJSONL(packPath(workspace, neumaId), stamped);
  return stamped;
};

/**
 * Read the full repository (plaintext, append order), validated. An absent
 * file is an empty repository; a schema-invalid entry throws loudly — the
 * pack is small and being-owned, never skipped past. Impure.
 * @returns {Promise<Array<object>>}
 */
export const readVoicePack = async (workspace, neumaId) => {
  let rows;
  try {
    rows = await workspace._readJSONL(packPath(workspace, neumaId));
  } catch {
    return Object.freeze([]);
  }
  return validateVoicePack(rows);
};

/**
 * Write the lane's ONE first-seal receipt. Refuses when a seal already
 * stands — the founding moment happens once; after it, the repository only
 * accretes. Impure.
 * @param {object} seal - {lane, witnessWallet, beingEntryIds, operatorPinIds}
 *   (sealedAt/packSha256 are stamped here — packSha256 over the CURRENT
 *   repository, so the receipt pins exactly what the rite produced)
 * @returns {Promise<object>} the validated seal
 */
export const writeVoiceSeal = async (workspace, neumaId, seal) => {
  const standing = await readVoiceSeal(workspace, neumaId);
  if (standing) throw new Error(`voice pack: lane ${neumaId} is already sealed`);
  const entries = await readVoicePack(workspace, neumaId);
  const stamped = validateVoiceSeal({
    ...seal,
    schema: VOICE_SEAL_SCHEMA,
    lane: neumaId,
    sealedAt: new Date().toISOString(),
    packSha256: voicePackSha256(entries),
  });
  const known = new Set(entries.map((entry) => entry.id));
  for (const id of [...stamped.beingEntryIds, ...stamped.operatorPinIds]) {
    if (!known.has(id)) throw new Error(`voice pack: seal names an entry that is not in the repository (${id})`);
  }
  await workspace._writeJSON(sealPath(workspace, neumaId), stamped);
  return stamped;
};

/**
 * Read the lane's seal, or null when the founding moment has not happened.
 * A seal file that EXISTS but will not decrypt or validate THROWS — a corrupt
 * receipt is a loud event, never silently overwritten by a second "first"
 * seal. Impure.
 */
export const readVoiceSeal = async (workspace, neumaId) => {
  const file = sealPath(workspace, neumaId);
  try {
    await fs.stat(file);
  } catch {
    return null;
  }
  return validateVoiceSeal(await workspace._readJSON(file));
};
