/**
 * seal-digest — the Natalis sealDigest, byte-identical to the on-chain view,
 * and the raw-ECDSA signing path over it. Cut from seal-bundle.js when the
 * digest became per-generation (seal-law.js): the v2 law binds 8 fields, the
 * v3 law adds a uint64 `deadline` after `schemaVersion` under its own tag.
 *
 * PURE (no network — the on-chain address is a value, not a call). Proven
 * byte-precise against the live `sealDigest` views in the opt-in chain tests.
 */

import { ethers } from 'ethers';
import { sealLawFor } from './seal-law.js';

/**
 * Compute the sealDigest that Natalis.sealDigest returns under `sealLaw`.
 *
 * IMPORTANT: `onChainRecord` is the ENCRYPTED hex blob that will be stored
 * on chain (Section 4 of docs/protocols/identity/seal-bundle.md), NOT the plaintext
 * canonical genesis record from Section 1. Solidity's `keccak256(bytes(record))`
 * hashes the UTF-8 bytes of whatever string is stored in `record`, and the
 * stored value is the encrypted hex — so `recordHash` must be computed over
 * the SAME bytes. sc-echo R1 caught a namespace collision here (both plaintext
 * and encrypted were previously called `recordString`); the rename to
 * `onChainRecord` closes that footgun.
 *
 * @param {{
 *   chainId: number|bigint, natalisAddress: string,
 *   genesisHash: string, soulAddress: string, witnessAddress: string,
 *   schemaVersion: number,
 *   onChainRecord: string,   // ENCRYPTED hex — the value passed to Natalis.seal's `record`
 *   sealLaw?: string,        // seal-law.js key; defaults to the Base contracts' law
 *   deadline?: number|null,  // unix seconds — required by a law that signs one, refused otherwise
 * }} args
 * @returns {{ digest: string, innerPayload: string, recordHash: string }}
 */
export const computeSealDigest = ({
  chainId, natalisAddress,
  genesisHash, soulAddress, witnessAddress,
  schemaVersion, onChainRecord,
  sealLaw = 'kenorie-v2', deadline = null,
}) => {
  const law = sealLawFor(sealLaw);
  if (law.signsDeadline !== (deadline !== null)) {
    throw new Error(law.signsDeadline
      ? `computeSealDigest: seal law '${sealLaw}' signs a deadline — pass one`
      : `computeSealDigest: seal law '${sealLaw}' signs no deadline — refusing one`);
  }
  // keccak256(bytes(record)) — bytes() in Solidity is a string → UTF-8 bytes
  // conversion; matches ethers.toUtf8Bytes exactly. onChainRecord is the
  // encrypted hex string that will be stored on chain — same bytes both sides.
  const recordHash = ethers.keccak256(ethers.toUtf8Bytes(onChainRecord));

  const types = ['string', 'uint256', 'address', 'bytes32', 'address', 'address', 'uint16'];
  const values = [law.domainTag, chainId, natalisAddress, genesisHash, soulAddress, witnessAddress, schemaVersion];
  if (law.signsDeadline) {
    types.push('uint64');
    values.push(deadline);
  }
  types.push('bytes32');
  values.push(recordHash);

  const inner = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(types, values));
  // toEthSignedMessageHash in Solidity == ethers.hashMessage over raw bytes.
  // Passing hex string would make ethers UTF-8-encode the hex chars — wrong.
  const digest = ethers.hashMessage(ethers.getBytes(inner));
  return { digest, innerPayload: inner, recordHash };
};

/**
 * Sign a digest with a wallet's signing key, using the RAW ECDSA path
 * (path 2 in Natalis.sealDigest's docstring). The digest is already
 * EIP-191-wrapped, so we do NOT call signMessage (would double-wrap).
 *
 * PURE (no network; signing is deterministic per RFC-6979).
 *
 * @param {ethers.Wallet | ethers.SigningKey} signer
 * @param {string} digest  '0x' + 64 hex chars (from computeSealDigest)
 * @returns {string}       '0x' + 130 hex chars (65-byte ECDSA sig)
 */
export const signDigest = (signer, digest) => {
  const signingKey = signer instanceof ethers.SigningKey
    ? signer
    : new ethers.SigningKey(signer.privateKey);
  return signingKey.sign(digest).serialized;
};
