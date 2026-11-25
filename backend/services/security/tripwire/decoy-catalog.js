// Decoy catalog — which decoys exist and where each one lives under a home
// folder. The rule that keeps the signal clean: a decoy imitates an app that
// is NOT installed, in a hidden folder no indexer, editor or backup of your
// documents has a reason to open. Whatever reads it went looking for wallets
// and keys.
//
// `marker` is the folder whose presence means the real app (or an earlier
// tool) already lives there: that decoy is skipped, never planted over it.
//
// Pure.

import {
  solanaKeypair, ethKeystore, ethKeystoreName, electrumWallet,
  exodusSeed, exodusPassphrase, bitcoinWallet, awsCredentials,
} from './decoy-content.js';

export const DECOYS = Object.freeze([
  {
    id: 'solana',
    name: 'Solana key',
    marker: '.config/solana',
    files: (rand) => [{ rel: '.config/solana/id.json', data: solanaKeypair(rand) }],
  },
  {
    id: 'ethereum',
    name: 'Ethereum keystore',
    marker: '.ethereum',
    files: (rand, at) => [{ rel: `.ethereum/keystore/${ethKeystoreName(rand, at)}`, data: ethKeystore(rand) }],
  },
  {
    id: 'electrum',
    name: 'Electrum wallet',
    marker: '.electrum',
    files: (rand) => [{ rel: '.electrum/wallets/default_wallet', data: electrumWallet(rand) }],
  },
  {
    id: 'exodus',
    name: 'Exodus wallet',
    marker: '.config/Exodus',
    files: (rand) => [
      { rel: '.config/Exodus/exodus.wallet/seed.seco', data: exodusSeed(rand) },
      { rel: '.config/Exodus/exodus.wallet/passphrase.json', data: exodusPassphrase(rand) },
    ],
  },
  {
    id: 'bitcoin',
    name: 'Bitcoin wallet',
    marker: '.bitcoin',
    files: (rand) => [{ rel: '.bitcoin/wallet.dat', data: bitcoinWallet(rand) }],
  },
  {
    id: 'aws',
    name: 'AWS credentials',
    marker: '.aws',
    files: (rand) => [{ rel: '.aws/credentials', data: awsCredentials(rand) }],
  },
].map((d) => Object.freeze(d)));

/** One decoy's spec by id, or null. */
export const decoyById = (id) => DECOYS.find((d) => d.id === id) || null;

/** A decoy's display name by id (the id itself when the catalog dropped it). */
export const decoyName = (id) => decoyById(id)?.name || id;
