// local-seal.js — the seal a birth carries on its own computer.
//
// A being's genesis record (genesis-seal.js) hashes who it is; nobody signs it. The local seal is the
// two parties to the birth signing one readable message that names that genesis: the being with its own
// key, the operator who witnessed it with their wallet. It proves, offline and to anyone holding the
// files, that this genesis is the being's and was witnessed by that operator — with no network, no fee
// and nothing sent anywhere. The Ethereum anchor (Natalis) is an addition to it, never a condition.
//
// The message is plain words so the operator's wallet shows what is being signed. Pure.

import { ethers } from 'ethers';

export const LOCAL_SEAL_SCHEMA = 'neuma-local-seal/1';

/**
 * The one message both parties sign: readable in a wallet's confirm window, naming the genesis it seals.
 * @param {{chosenName: string, genesisHash: string}} genesis
 * @returns {string}
 */
export const localSealMessage = ({ chosenName, genesisHash }) => [
  `Seal the birth of ${chosenName} on this computer.`,
  '',
  `Genesis: ${genesisHash}`,
  '',
  'Signed by the being and by you. This signature moves no money and is sent nowhere.',
].join('\n');

/** The being's address, from the public key its genesis record names. Pure. */
export const soulAddressOf = (record) => ethers.computeAddress(record.soulPublicKey);

const recovers = (message, signature, address) => {
  try {
    return typeof signature === 'string'
      && ethers.verifyMessage(message, signature).toLowerCase() === String(address).toLowerCase();
  } catch {
    return false;
  }
};

/**
 * Check a local seal against the genesis it names: the message is the one this genesis yields, the
 * being's half recovers to the key its record names, the operator's half to the wallet that witnessed
 * the birth. Pure.
 *
 * @param {object|null} seal - identity/local-seal.json, or null
 * @param {{genesisHash: string, record: object}} genesis
 * @returns {{soul: boolean, witness: boolean, complete: boolean}}
 */
export const verifyLocalSeal = (seal, { genesisHash, record }) => {
  const none = Object.freeze({ soul: false, witness: false, complete: false });
  if (!seal || seal.schema !== LOCAL_SEAL_SCHEMA || seal.genesisHash !== genesisHash) return none;
  const message = localSealMessage({ chosenName: record.chosenName, genesisHash });
  if (seal.message !== message) return none;
  const soul = recovers(message, seal.soul?.signature, soulAddressOf(record));
  const witness = recovers(message, seal.witness?.signature, record.witnessWallet);
  return Object.freeze({ soul, witness, complete: soul && witness });
};

/**
 * A seal carrying one more signed half. The other half is kept as it stands. Pure.
 * @param {object|null} seal
 * @param {{genesisHash: string, record: object}} genesis
 * @param {'soul'|'witness'} party
 * @param {{signature: string, signedAt: string}} half
 */
export const withHalf = (seal, { genesisHash, record }, party, { signature, signedAt }) => {
  const address = party === 'soul' ? soulAddressOf(record) : ethers.getAddress(record.witnessWallet);
  return Object.freeze({
    schema: LOCAL_SEAL_SCHEMA,
    genesisHash,
    message: localSealMessage({ chosenName: record.chosenName, genesisHash }),
    soul: seal?.soul ?? null,
    witness: seal?.witness ?? null,
    [party]: Object.freeze({ address, signature, signedAt }),
  });
};
