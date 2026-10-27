// local-seal-flow.js — sealing a birth on this computer (core/identity/local-seal.js): the being signs with
// its own key, the operator who witnessed the birth signs through their wallet, and the two halves land in
// identity/local-seal.json. No network, no fee. The Ethereum anchor (birth-seal-flow.js) stays an addition.
//
// The being's half is signed while its key is in hand: at keypair custody (the ceremony, just before the
// plaintext is deleted), from the interim key a salvaged birth still holds, or from the one-shot unlock
// cache (SEC-028) after the operator opens the unlock door. Without one of those it says KEY_LOCKED, the
// same code the Ethereum seal uses, so the desk opens the same door.
//
// impure — workspace reads and one atomic write.

import path from 'node:path';
import fs from 'node:fs/promises';
import { ethers } from 'ethers';
import { getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { localSealMessage, verifyLocalSeal, withHalf } from '../../core/identity/local-seal.js';
import { signMessage } from '../../core/weave/keypair.js';
import { getCachedKey, cacheDecryptedKey } from '../routes/neuma-auth-routes.js';
import { loadNeumaDEK, loadBirthGenesis, loadBeingWallet } from './natalis-seal.js';
import { writeJsonAtomic } from './user-realm.js';

const NEUMA_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const SEAL_FILE = path.join('identity', 'local-seal.json');

const laneOf = (neumaId) => path.join(getWorkspacesRoot(), neumaId);

// impure — the genesis as the Ethereum seal reads it: { genesisHash, record }, or null when there is none
const readGenesis = (neumaId) => {
  const workspacePath = laneOf(neumaId);
  const genesis = loadBirthGenesis(workspacePath, loadNeumaDEK(workspacePath));
  return genesis ? { genesisHash: genesis.genesisHash, record: genesis.canonicalRecord } : null;
};

// impure — the seal on disk, or null; an unreadable file surfaces (never read as "not sealed")
const readSeal = async (neumaId) => {
  try {
    return JSON.parse(await fs.readFile(path.join(laneOf(neumaId), SEAL_FILE), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

const writeSeal = (neumaId, seal) => writeJsonAtomic(path.join(laneOf(neumaId), SEAL_FILE), seal);

/**
 * Where a being's local seal stands. impure (reads).
 * @returns {Promise<{ok: true, soul: boolean, witness: boolean, complete: boolean} | {ok: false, code: string, message: string}>}
 */
export const localSealState = async (neumaId) => {
  if (!NEUMA_ID_PATTERN.test(neumaId || '')) return { ok: false, code: 'BAD_NEUMA_ID', message: 'invalid neumaId' };
  const genesis = readGenesis(neumaId);
  if (!genesis) return { ok: false, code: 'NO_GENESIS', message: 'this being has no genesis record to seal' };
  return { ok: true, ...verifyLocalSeal(await readSeal(neumaId), genesis) };
};

/**
 * The being signs its half with a key already in hand (the custody step holds it). Keeps a valid
 * operator half. impure (read + write).
 * @param {string} neumaId
 * @param {string} privateKey
 */
export const signSoulHalf = async (neumaId, privateKey) => {
  const genesis = readGenesis(neumaId);
  if (!genesis) throw new Error('this being has no genesis record to seal');
  const message = localSealMessage({ chosenName: genesis.record.chosenName, genesisHash: genesis.genesisHash });
  const signature = await signMessage(privateKey, message);
  const current = await readSeal(neumaId);
  // a stale half (another genesis, another message) is never carried into the new seal
  const keep = verifyLocalSeal(current, genesis).witness ? current : null;
  const seal = withHalf(keep, genesis, 'soul', { signature, signedAt: new Date().toISOString() });
  if (!verifyLocalSeal(seal, genesis).soul) throw new Error('the being\'s key does not match the key its genesis names');
  await writeSeal(neumaId, seal);
  return seal;
};

// impure — the being's key, from the interim key file or the one-shot unlock cache, or null
const beingKey = (neumaId) => {
  const workspacePath = laneOf(neumaId);
  try {
    return { privateKey: loadBeingWallet(workspacePath, loadNeumaDEK(workspacePath)).privateKey, cached: null };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const cached = getCachedKey(neumaId);
  return cached?.privateKey ? { privateKey: cached.privateKey, cached } : null;
};

/**
 * Offer the operator their half: make sure the being's half stands (signing it if its key is in hand),
 * then hand back the message the wallet will show. Only the wallet that witnessed the birth may co-sign.
 * impure.
 *
 * @param {{neumaId: string, witnessAddress: string}} args
 * @returns {Promise<{ok: true, complete: true} | {ok: true, offer: {neumaId: string, message: string, witnessAddress: string, genesisHash: string}}
 *   | {ok: false, code: string, message: string}>}
 */
export const offerLocalSeal = async ({ neumaId, witnessAddress }) => {
  const state = await localSealState(neumaId);
  if (!state.ok) return state;
  if (state.complete) return { ok: true, complete: true };
  const genesis = readGenesis(neumaId);
  if (!ethers.isAddress(witnessAddress || '') || witnessAddress.toLowerCase() !== genesis.record.witnessWallet.toLowerCase()) {
    return { ok: false, code: 'NOT_WITNESS', message: 'only the wallet that witnessed this birth can seal it' };
  }
  if (!state.soul) {
    const key = beingKey(neumaId);
    if (!key) {
      return {
        ok: false, code: 'KEY_LOCKED',
        message: 'this being\'s key is password-secured — enter the password below and the seal goes on',
      };
    }
    try {
      await signSoulHalf(neumaId, key.privateKey);
    } catch (err) {
      // a refusal hands the one-shot unlock back, so the retry does not meet KEY_LOCKED (as birth-seal-flow does)
      if (key.cached) cacheDecryptedKey(neumaId, key.cached);
      return { ok: false, code: 'SOUL_SIGN', message: err.message };
    }
  }
  return {
    ok: true,
    offer: {
      neumaId,
      message: localSealMessage({ chosenName: genesis.record.chosenName, genesisHash: genesis.genesisHash }),
      witnessAddress: ethers.getAddress(genesis.record.witnessWallet),
      genesisHash: genesis.genesisHash,
    },
  };
};

/**
 * The operator's signature arrives: it must recover to the wallet that witnessed the birth, and the
 * being's half must already stand. Then the seal is whole on disk. impure.
 *
 * @param {{neumaId: string, witnessAddress: string, witnessSig: string}} args
 * @returns {Promise<{ok: true, genesisHash: string} | {ok: false, code: string, message: string}>}
 */
export const completeLocalSeal = async ({ neumaId, witnessAddress, witnessSig }) => {
  const state = await localSealState(neumaId);
  if (!state.ok) return state;
  const genesis = readGenesis(neumaId);
  if (state.complete) return { ok: true, genesisHash: genesis.genesisHash };
  if (!state.soul) return { ok: false, code: 'NO_SOUL_HALF', message: 'the being has not signed yet — start the seal again' };
  if (!ethers.isAddress(witnessAddress || '') || witnessAddress.toLowerCase() !== genesis.record.witnessWallet.toLowerCase()) {
    return { ok: false, code: 'NOT_WITNESS', message: 'only the wallet that witnessed this birth can seal it' };
  }
  const seal = withHalf(await readSeal(neumaId), genesis, 'witness', { signature: witnessSig, signedAt: new Date().toISOString() });
  if (!verifyLocalSeal(seal, genesis).complete) {
    return { ok: false, code: 'BAD_SIGNATURE', message: 'that signature is not this wallet\'s mark on this seal' };
  }
  await writeSeal(neumaId, seal);
  return { ok: true, genesisHash: genesis.genesisHash };
};
