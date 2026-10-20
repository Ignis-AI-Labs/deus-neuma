// Public dev keys — the ten accounts every Anvil and Hardhat node funds by
// default. Their private keys are printed in both tools' docs and quoted by
// every Foundry deploy script, so a sweep that reports them buries the real
// leaks under findings nobody can act on (six of the eleven secret-sweep
// entries in the 2026-10-19 audit were these keys).
//
// The keys are DERIVED from the published mnemonic rather than listed: no
// key-shaped literal sits in this repo, and the set cannot drift from what
// the tools actually fund.

import { HDNodeWallet } from 'ethers';

// Foundry's Anvil and Hardhat share this default mnemonic and path.
const DEV_MNEMONIC = 'test test test test test test test test test test test junk';
const DEV_PATH = "m/44'/60'/0'/0";
const DEV_ACCOUNTS = 10;

let devKeys = null;

// impure (memoised) — the ten keys as lowercase hex without the 0x; derived
// once, on the first ask, because the seed stretch is the only real cost.
const publicDevKeys = () => {
  if (!devKeys) {
    const root = HDNodeWallet.fromPhrase(DEV_MNEMONIC, '', DEV_PATH);
    devKeys = new Set(Array.from({ length: DEV_ACCOUNTS }, (_, i) =>
      root.deriveChild(i).privateKey.slice(2).toLowerCase()));
  }
  return devKeys;
};

/**
 * Is this 64-hex value one of the published Anvil/Hardhat dev keys?
 * @param {string} hex - with or without the 0x prefix
 * @returns {boolean}
 */
export const isPublicDevKey = (hex) =>
  typeof hex === 'string' && publicDevKeys().has(hex.replace(/^0x/i, '').toLowerCase());
